// Do two builds draw the same picture?
//
// The render benchmarks here answer "how fast"; this answers "and identically",
// which is the question a performance change actually has to pass. A rewrite of
// a drawing path can be measured as a large win and be wrong, and no timing
// harness would notice.
//
// Loads the same locus and tracks against two ports, waits for the same
// render-complete contract, screenshots the track area on both, and reports the
// share of differing pixels plus the largest per-channel difference.
//
// Usage: PORTS=8021,8020 TRACKS=200x.longread.mod.bam node scripts/render/pixelab.ts
import puppeteer from 'puppeteer'
import type { Browser } from 'puppeteer'
import fs from 'fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// pngjs is not a dependency here and deliberately isn't becoming one — this is
// the only script that decodes a PNG, and jb2bench's package.json is shared
// with other agents' work. Resolve it out of the jbrowse checkout instead, the
// same way `website/scripts/*` reach puppeteer (see that repo's CLAUDE.md).
const JBROWSE = process.env.JBROWSE ?? join(process.env.HOME!, 'src/jbrowse-components')
const req = createRequire(join(JBROWSE, 'products/jbrowse-web/package.json'))
// Typed by hand rather than with `typeof import('pngjs')`: the package is not
// resolvable from this tsconfig, which is the whole reason for the createRequire.
interface PngImage {
  width: number
  height: number
  data: Uint8Array
}
interface PngCtor {
  new (opts: { width: number; height: number }): PngImage
  sync: {
    read(buf: Buffer): PngImage
    write(png: PngImage): Buffer
  }
}
const { PNG } = req('pngjs') as { PNG: PngCtor }

const PORTS = (process.env.PORTS ?? '8021,8020').split(',').map(Number)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const TRACKS = (process.env.TRACKS ?? '200x.longread.mod.bam').split(',')
const OUT = process.env.OUT ?? 'screenshots'

async function shoot(browser: Browser, port: number, name: string) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const errors: string[] = []
  page.on('pageerror', (e: unknown) =>
    errors.push(e instanceof Error ? e.message : String(e)),
  )
  await page.goto(
    `http://localhost:${port}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACKS.join(',')}&renderer=webgl`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(
    (expected: number) => {
      const s = (globalThis as any).JBrowseSession
      return (
        s?.views?.length &&
        !s.views.some((v: any) => v.initialized === false) &&
        document.querySelectorAll('[data-display-phase]').length >= expected &&
        !document.querySelector('[data-display-phase="loading"]') &&
        !document.querySelector('[data-display-drawn="false"]')
      )
    },
    { timeout: 180000, polling: 200 },
    TRACKS.length,
  )
  // Let the last frame land. A screenshot taken the instant the contract opens
  // can catch a half-composited canvas, which reads as a real pixel difference.
  await new Promise(r => setTimeout(r, 2000))
  fs.mkdirSync(OUT, { recursive: true })
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  await page.close()
  return { path, errors }
}

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})

const a = await shoot(browser, PORTS[0]!, `pixelab-${PORTS[0]}`)
const b = await shoot(browser, PORTS[1]!, `pixelab-${PORTS[1]}`)
await browser.close()

const pa = PNG.sync.read(fs.readFileSync(a.path))
const pb = PNG.sync.read(fs.readFileSync(b.path))
if (pa.width !== pb.width || pa.height !== pb.height) {
  throw new Error(
    `size mismatch ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`,
  )
}
// Rectangles to ignore, as `x,y,w,h` separated by `;`. The default masks the
// header CLOCK: the two shots are taken seconds apart, so its digits differ on
// every run, and 86 pixels of "difference" that are a wall clock is exactly the
// kind of result that gets a real comparison thrown away as noisy. Set MASK= to
// compare everything.
const MASK = (process.env.MASK ?? '700,10,120,25')
  .split(';')
  .filter(Boolean)
  .map(r => r.split(',').map(Number) as [number, number, number, number])

const masked = (x: number, y: number) =>
  MASK.some(([mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh)

let differing = 0
let maxDelta = 0
let minX = Infinity
let maxX = -1
let minY = Infinity
let maxY = -1
const diff = new PNG({ width: pa.width, height: pa.height })
for (let i = 0; i < pa.data.length; i += 4) {
  const px = (i / 4) % pa.width
  const py = Math.floor(i / 4 / pa.width)
  let d = 0
  for (let c = 0; c < 3; c++) {
    d = Math.max(d, Math.abs(pa.data[i + c]! - pb.data[i + c]!))
  }
  if (d > 0 && masked(px, py)) {
    d = 0
  }
  if (d > 0) {
    minX = Math.min(minX, px)
    maxX = Math.max(maxX, px)
    minY = Math.min(minY, py)
    maxY = Math.max(maxY, py)
    differing++
    maxDelta = Math.max(maxDelta, d)
    diff.data[i] = 255
    diff.data[i + 1] = 0
    diff.data[i + 2] = 0
    diff.data[i + 3] = 255
  } else {
    // keep the unchanged picture as a faint backdrop so a diff is locatable
    diff.data[i] = pa.data[i]!
    diff.data[i + 1] = pa.data[i + 1]!
    diff.data[i + 2] = pa.data[i + 2]!
    diff.data[i + 3] = 60
  }
}
fs.writeFileSync(`${OUT}/pixelab-diff.png`, PNG.sync.write(diff))
const total = pa.width * pa.height
console.log(
  JSON.stringify(
    {
      tracks: TRACKS,
      loc: LOC,
      ports: PORTS,
      pixels: total,
      differing,
      differingPct: +((100 * differing) / total).toFixed(4),
      maxChannelDelta: maxDelta,
      // Where the differences are, because "0.007% of pixels" is not a finding
      // and "a 9x11 block at y=17" is — that one turned out to be the clock.
      bbox: differing
        ? { x: [minX, maxX], y: [minY, maxY] }
        : null,
      masked: MASK,
      errorsA: a.errors,
      errorsB: b.errors,
      diff: `${OUT}/pixelab-diff.png`,
    },
    null,
    2,
  ),
)

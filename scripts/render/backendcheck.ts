// Does each rung of the ladder draw the same picture, and what does it complain
// about on the way? Correctness gate for scripts/render/backends.ts: a backend
// that is fast because it drew less is not a faster backend, and this box is
// the one where WebGPU is documented (README, paper §2.10) to emit Dawn
// texture-allocation validation errors, so "does WebGPU paint correctly here"
// is the question that decides whether a WebGPU timing means anything.
//
// Load-insensitive on purpose: it compares pixels and collects console output,
// so it is worth running on a busy box, unlike any timing in this directory.
//
// The browser is its own PNG decoder -- the repo has no image library, and
// pulling one in to answer one question is not worth the dependency.
//
// Usage: node scripts/render/backendcheck.ts [--port=8000] [--case=1000x-shortread]
import fs from 'fs'

import puppeteer from 'puppeteer'

const arg = (name: string, fallback: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const PORT = Number(arg('port', '8000'))
const CASE = arg('case', '200x-shortread')
const LOC = 'chr22_mask:124000-143000'
const OUT = 'screenshots/backendcheck'

const rungs = [
  { id: 'default', extra: '' },
  { id: 'webgl', extra: '&renderer=webgl' },
  { id: 'canvas2d', extra: '&renderer=canvas2d' },
]

// case ids are dashed (`200x-shortread`); the track files are dotted
// (`200x.shortread.bam`), same mapping runner.ts builds
const TRACK = `${CASE.replace('-', '.')}.bam`

const url = (extra: string) =>
  `http://localhost:${PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACK}${extra}`

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})

interface Report {
  id: string
  rung: string
  canvases: { webgpu: number; webgl2: number; canvas2d: number }
  gpuMessages: string[]
  shot: string
}
const reports: Report[] = []

for (const r of rungs) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const gpuMessages: string[] = []
  page.on('console', m => {
    const t = m.text()
    if (/gpu|dawn|webgpu|validation|texture|shader/i.test(t)) {
      gpuMessages.push(`${m.type()}: ${t}`.slice(0, 300))
    }
  })
  page.on('pageerror', e => {
    gpuMessages.push(`pageerror: ${String(e).slice(0, 300)}`)
  })
  await page.goto(url(r.extra), { waitUntil: 'load' })
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as { __stable?: number; __last?: number }
        const done = document.querySelectorAll(
          '[data-testid$="-done"],[data-testid$="_done"]',
        ).length
        const loading =
          document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
        const ready = done > 0 && !loading
        if (ready && done === w.__last) {
          w.__stable = (w.__stable ?? 0) + 1
        } else {
          w.__stable = 0
          w.__last = done
        }
        return ready && (w.__stable ?? 0) >= 5
      },
      { timeout: 180000, polling: 100 },
    )
    .catch(() => {
      gpuMessages.push('WARN: never reached render-complete quiescence')
    })
  // the deliberate half-second debounce on the view's coarse blocks (paper
  // §4.3) keeps repainting after time-to-content, so a screenshot taken at
  // quiescence can catch a frame mid-update. Wait it out before capturing.
  await new Promise(res => setTimeout(res, 1500))

  const canvases = await page.evaluate(() => {
    let webgpu = 0
    let webgl2 = 0
    let other = 0
    for (const c of [...document.querySelectorAll('canvas')]) {
      if (c.width === 0 || c.height === 0) {
        continue
      }
      if (c.getContext('webgpu')) {
        webgpu++
      } else if (c.getContext('webgl2')) {
        webgl2++
      } else {
        other++
      }
    }
    return { webgpu, webgl2, canvas2d: other }
  })

  const shot = `${OUT}/${CASE}-${r.id}.png`
  await page.screenshot({ path: shot })
  reports.push({
    id: r.id,
    rung:
      canvases.webgpu > 0
        ? 'WebGPU'
        : canvases.webgl2 > 0
          ? 'WebGL2'
          : 'Canvas2D',
    canvases,
    gpuMessages,
    shot,
  })
  await page.close()
}

// Pixel comparison, decoded by the browser. Two backends never agree bit for
// bit -- different rasterizers round edges differently -- so report the share of
// pixels that differ at all and the share that differ by more than a quarter of
// the range, which is the difference between antialiasing and a missing mark.
async function compare(a: string, b: string) {
  const page = await browser.newPage()
  const toUri = (p: string) =>
    `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`
  const res = await page.evaluate(
    async ([ua, ub]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            resolve(img)
          }
          img.onerror = reject
          img.src = src
        })
      const [ia, ib] = await Promise.all([load(ua!), load(ub!)])
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { sizeMismatch: true, any: 1, gross: 1 }
      }
      const draw = (img: HTMLImageElement) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height).data
      }
      const da = draw(ia)
      const db = draw(ib)
      let any = 0
      let gross = 0
      for (let i = 0; i < da.length; i += 4) {
        const d =
          Math.abs(da[i]! - db[i]!) +
          Math.abs(da[i + 1]! - db[i + 1]!) +
          Math.abs(da[i + 2]! - db[i + 2]!)
        if (d > 0) {
          any++
        }
        if (d > 190) {
          gross++
        }
      }
      const n = da.length / 4
      return { sizeMismatch: false, any: any / n, gross: gross / n }
    },
    [toUri(a), toUri(b)],
  )
  await page.close()
  return res
}

console.log(`case ${CASE}, port ${PORT}\n`)
for (const r of reports) {
  console.log(`${r.id.padEnd(9)} -> ${r.rung}  canvases=${JSON.stringify(r.canvases)}`)
  if (r.gpuMessages.length) {
    for (const m of [...new Set(r.gpuMessages)].slice(0, 6)) {
      console.log(`    ${m}`)
    }
  } else {
    console.log('    (no GPU-related console output)')
  }
}

console.log('\npixel agreement (share of pixels differing):')
const byId = Object.fromEntries(reports.map(r => [r.id, r]))
for (const [a, b] of [
  ['default', 'webgl'],
  ['default', 'canvas2d'],
  ['webgl', 'canvas2d'],
]) {
  const cmp = await compare(byId[a!]!.shot, byId[b!]!.shot)
  console.log(
    `  ${byId[a!]!.rung} vs ${byId[b!]!.rung}: ` +
      (cmp.sizeMismatch
        ? 'SIZE MISMATCH'
        : `${(cmp.any * 100).toFixed(2)}% any, ${(cmp.gross * 100).toFixed(2)}% gross`),
  )
}
console.log(`\nscreenshots in ${OUT}/`)

await browser.close()

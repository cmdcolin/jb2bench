// What does the rendering backend itself cost? Every other table here compares
// two *builds*; this one holds the build fixed and varies only the rung of the
// ladder the page lands on, via `?renderer=`:
//
//   default    WebGPU -> WebGL2 -> Canvas2D, whichever the browser allows
//   webgl      pinned to WebGL2
//   canvas2d   pinned to the Canvas2D rasterizer, which is also the SVG export
//              path, so this is what a machine with no usable GPU pays
//
// WEBGPU NEEDS FIREFOX NIGHTLY. Chrome renders the WebGPU canvas blank on this
// box: Dawn rejects an undersized texture allocation
// ("Requested allocation size (1310720) is smaller than the image requires
// (1313808)", Vulkan external_memory OpaqueFD), the frame fails validation
// after submit, and nothing paints. `navigator.gpu` *does* resolve a hardware
// adapter (the discrete Radeon, gcn-4) — but only on a secure origin, so an
// `about:blank` probe reports WebGPU absent when it is not, which is the trap
// scripts/gpucheck.ts falls into. jbrowse-components ADR-024 reached the same
// two conclusions and puts its WebGPU goldens on Firefox Nightly for exactly
// this reason; `--browser=firefox` here uses that ADR's launch recipe.
//
// So: `--browser=chrome` measures webgl vs canvas2d (the shipped GPU path
// against the no-GPU path). `--browser=firefox` measures all three, WebGPU
// included. Do not mix the two into one table — different browsers differ in
// everything, and the comparison that means something is within one.
//
// Firefox Nightly must run headed (windows appear on :0), so it is not a run to
// start unattended on a machine someone is using.
//
// Usage:
//   node scripts/render/backends.ts                          chrome, 6 cases
//   node scripts/render/backends.ts --browser=firefox        + WebGPU, headed
//   CASES=20x-shortread node scripts/render/backends.ts      one case
//   node scripts/render/backends.ts --wait-for-load=3        start once idle
import fs from 'fs'

import { launch, type Browser, type Page } from 'puppeteer'

import { loadavg, outliers, peak, type LoadWindow } from './loadavg.ts'
import { resolveBuild } from './servedbuild.ts'

const arg = (name: string, fallback: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const PORT = Number(arg('port', '8000'))
const RUNS = Number(arg('runs', '5'))
const WARMUP = 1
const LOC = 'chr22_mask:124000-143000' // 19kb, same window as every other table
const LOAD_CEILING = 4.0
const BROWSER = arg('browser', 'chrome')
const FIREFOX_PATH = arg('firefox', '/usr/bin/firefox-nightly')

// Same detector constants as profile.ts, so this table's metric is the same
// quantity as every other table's: in-page navigation to render-complete, with
// the detector's own confirmation delay subtracted.
const WAIT_TIMEOUT = 180000
const POLL_MS = 100
const STABLE_POLLS = 5

// Top of the track band in the 1280x800 viewport: below the app bar, the view
// header and the ruler, so the ink measure sees track content and not the
// interface, which every backend draws identically through the DOM.
const TRACK_BAND_TOP = 190

// A shared box: starting a timing run at load 30 produces a table that looks
// like a result and is not one. Rather than refuse, wait — the run is worth
// having whenever the machine next goes quiet, and unattended is the only way
// that happens. Gives up rather than measuring garbage if it never does.
const WAIT_FOR_LOAD = Number(arg('wait-for-load', '0'))
const WAIT_MAX_MIN = Number(arg('wait-max-minutes', '180'))

const isFirefox = BROWSER === 'firefox'
const rungs = isFirefox
  ? [
      { id: 'default', extra: '' },
      { id: 'webgl', extra: '&renderer=webgl' },
      { id: 'canvas2d', extra: '&renderer=canvas2d' },
    ]
  : [
      { id: 'webgl', extra: '&renderer=webgl' },
      { id: 'canvas2d', extra: '&renderer=canvas2d' },
    ]

const allCases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    allCases.push({ id: `${cov}-${read}`, track: `${cov}.${read}.bam` })
  }
}
const selected = process.env.CASES?.split(',')
const cases = selected
  ? allCases.filter(c => selected.includes(c.id))
  : allCases
if (!cases.length) {
  throw new Error(
    `CASES matched nothing; known: ${allCases.map(c => c.id).join(',')}`,
  )
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const stddev = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)))
}

const urlFor = (track: string, extra: string) =>
  `http://localhost:${PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${track}${extra}`

// One browser per measured run, as profile.ts does: a reused browser serves the
// second run out of a warm HTTP cache, which is a different question from the
// cold load every other table here reports.
function launchBrowser(): Promise<Browser> {
  return isFirefox
    ? // ADR-024's recipe. Headed on purpose: WebGPU does not come up under
      // headless Firefox.
      launch({
        browser: 'firefox',
        executablePath: FIREFOX_PATH,
        headless: false,
        timeout: 60000,
        extraPrefsFirefox: {
          'dom.webgpu.enabled': true,
          'gfx.webrender.all': true,
          'gfx.webgpu.ignore-blocklist': true,
        },
        defaultViewport: { width: 1280, height: 800 },
      })
    : launch({
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
        defaultViewport: { width: 1280, height: 800 },
      })
}

const waitReady = (page: Page) =>
  page.waitForFunction(
    ({ stableNeeded }: { stableNeeded: number }) => {
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
      return ready && (w.__stable ?? 0) >= stableNeeded
    },
    { timeout: WAIT_TIMEOUT, polling: POLL_MS },
    { stableNeeded: STABLE_POLLS },
  )

// Which rung did the page actually land on? Resolved, not assumed — the same
// reason servedbuild.ts resolves the build instead of labelling the port by
// hand. `getContext` on a canvas holding a context of another type returns null
// without disturbing it. A silently ineffective `?renderer=` would otherwise
// show up as two identical columns that look like a finding, and a WebGPU
// column that painted nothing (Chrome, above) would look like a fast one.
const probeRung = (page: Page) =>
  page.evaluate(() => {
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

interface RunResult {
  ms: number
  rung?: { webgpu: number; webgl2: number; canvas2d: number }
  drawn?: number
}

// A backend that is fast because it drew nothing is not a faster backend, and
// that is not hypothetical here — it is what Chrome's WebGPU does on this box.
// So every run also reports how much of the track area is non-background, and
// the report refuses to print a ratio for a cell that painted an empty track.
async function measure(
  track: string,
  extra: string,
  shot?: string,
): Promise<RunResult> {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    const t0 = Date.now()
    await page.goto(urlFor(track, extra), { waitUntil: 'load' })
    await waitReady(page)
    const ms = Date.now() - t0 - STABLE_POLLS * POLL_MS
    const rung = await probeRung(page)
    // ink: share of the track band that is not background. Measured from the
    // composited screenshot, NOT by reading the canvas back — a WebGL2 or
    // WebGPU drawing buffer is empty to `drawImage` once the frame has been
    // presented (no `preserveDrawingBuffer`), so a canvas readback reports every
    // GPU backend as blank and would flag the correct renders as the broken one.
    // The compositor has the real pixels; the screenshot is how to reach them.
    const band = await page.screenshot({
      encoding: 'base64',
      clip: { x: 0, y: TRACK_BAND_TOP, width: 1280, height: 800 - TRACK_BAND_TOP },
    })
    const drawn = await page.evaluate(async (b64: string) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => {
          resolve(i)
        }
        i.onerror = reject
        i.src = `data:image/png;base64,${b64}`
      })
      const off = document.createElement('canvas')
      off.width = img.width
      off.height = img.height
      const ctx = off.getContext('2d')
      if (!ctx) {
        return 0
      }
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, off.width, off.height).data
      let ink = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! < 240 || d[i + 1]! < 240 || d[i + 2]! < 240) {
          ink++
        }
      }
      return ink / (off.width * off.height)
    }, band as string)
    if (shot) {
      fs.mkdirSync(shot.replace(/\/[^/]+$/, ''), { recursive: true })
      await page.screenshot({ path: shot })
    }
    return { ms, rung, drawn }
  } catch {
    return { ms: Number.NaN }
  } finally {
    await browser.close()
  }
}

if (WAIT_FOR_LOAD > 0) {
  const deadline = Date.now() + WAIT_MAX_MIN * 60_000
  let l = loadavg()
  while (l > WAIT_FOR_LOAD && Date.now() < deadline) {
    console.log(
      `load ${l.toFixed(1)} > ${WAIT_FOR_LOAD}, waiting (${Math.round(
        (deadline - Date.now()) / 60_000,
      )} min left)`,
    )
    await new Promise(r => setTimeout(r, 120_000))
    l = loadavg()
  }
  if (l > WAIT_FOR_LOAD) {
    console.log(
      `gave up waiting: load still ${l.toFixed(1)} after ${WAIT_MAX_MIN} min. ` +
        'Nothing measured.',
    )
    process.exit(2)
  }
  console.log(`load ${l.toFixed(1)}, starting`)
}

const build = await resolveBuild(PORT)
console.log(`port ${PORT} serving builds/${build}, browser ${BROWSER}`)

interface Cell {
  median: number
  mean: number
  stddev: number
  runs: number[]
  load: LoadWindow
  rung: string
  drawn: number
}

const label = (r?: { webgpu: number; webgl2: number; canvas2d: number }) =>
  !r ? '?' : r.webgpu > 0 ? 'WebGPU' : r.webgl2 > 0 ? 'WebGL2' : 'Canvas2D'

const results: Record<string, Record<string, Cell>> = {}
const measured: { key: string; load: LoadWindow; value: Cell }[] = []

for (const c of cases) {
  results[c.id] = {}
  for (const b of rungs) {
    process.stdout.write(`${c.id} / ${b.id}: `)
    const before = loadavg()
    let first: RunResult = { ms: Number.NaN }
    for (let i = 0; i < WARMUP; i++) {
      first = await measure(
        c.track,
        b.extra,
        `screenshots/backends/${BROWSER}-${c.id}-${b.id}.png`,
      )
    }
    const runs: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const r = await measure(c.track, b.extra)
      runs.push(r.ms)
      process.stdout.write(Number.isFinite(r.ms) ? `${r.ms.toFixed(0)} ` : 'FAIL ')
    }
    const ok = runs.filter(Number.isFinite)
    const load = { before, after: loadavg() }
    const cell: Cell = {
      median: ok.length ? median(ok) : Number.NaN,
      mean: ok.length ? mean(ok) : Number.NaN,
      stddev: ok.length ? stddev(ok) : Number.NaN,
      runs,
      load,
      rung: label(first.rung),
      drawn: first.drawn ?? Number.NaN,
    }
    results[c.id]![b.id] = cell
    measured.push({ key: `${c.id} / ${b.id}`, load, value: cell })
    process.stdout.write(
      `=> ${cell.median.toFixed(0)}ms on ${cell.rung}, ` +
        `ink ${(cell.drawn * 100).toFixed(1)}% ` +
        `(load ${load.before.toFixed(1)}→${load.after.toFixed(1)})\n`,
    )
  }
}

const { medianLoad, suspect } = outliers(measured)
if (suspect.length) {
  console.log(
    `\nWARNING: ${suspect.length} cell(s) measured at more than 2x the run's ` +
      `median load (${medianLoad.toFixed(1)}). Treat these as unverified:`,
  )
  for (const s of suspect) {
    console.log(`  ${s.key} — load peaked at ${peak(s.load).toFixed(1)}`)
  }
}
const worstLoad = Math.max(...measured.map(m => peak(m.load)))
const blank = measured.filter(m => m.value.drawn < 0.005)
if (blank.length) {
  console.log(
    `\nWARNING: ${blank.length} cell(s) painted an essentially empty track. ` +
      'Their timings measure a render that did not happen:',
  )
  for (const b of blank) {
    console.log(`  ${b.key} — ink ${(b.value.drawn * 100).toFixed(2)}%`)
  }
}

const stamp = new Date().toISOString().slice(0, 10)
fs.mkdirSync('results', { recursive: true })
const outfile = `results/backends-${BROWSER}`
fs.writeFileSync(
  `${outfile}.json`,
  JSON.stringify(
    { loc: LOC, runs: RUNS, build, port: PORT, browser: BROWSER, stamp, results },
    null,
    2,
  ),
)

let md = `# Backend comparison (${BROWSER})\n\n`
md += `Build \`${build}\`, region \`${LOC}\` (19kb), ${BROWSER}, measured ${stamp}. `
md += `One build, one machine, one instrument — only the \`?renderer=\` rung `
md += `changes. In-page navigation→render-complete, median of ${RUNS} runs (ms) `
md += `± the standard deviation of those runs.\n\n`
md += `\`rung\` is the backend each column actually reached, probed per cell `
md += `rather than assumed. \`ink\` is the share of the largest canvas that is `
md += `not background: a cell near zero drew nothing, and its timing is not a `
md += `render cost. Chrome's WebGPU is exactly that case on this box `
md += `(blank canvas, Dawn texture-allocation validation error), which is why `
md += `WebGPU is measured through Firefox Nightly — see the header comment and `
md += `jbrowse-components ADR-024.\n\n`
md += `Highest 1-minute load average across all cells: ${worstLoad.toFixed(1)}; `
md += `above ${LOAD_CEILING.toFixed(1)} a cell is not comparable to one measured `
md += `idle. Per-cell load is in \`${outfile}.json\`.\n\n`
md += `| case | ${rungs.map(r => r.id).join(' | ')} | `
md += `canvas2d ÷ ${rungs[0]!.id} |\n`
md += `|---|${rungs.map(() => '---:').join('|')}|---:|\n`
for (const c of cases) {
  const cell = (id: string) => results[c.id]![id]!
  const fmt = (id: string) => {
    const x = cell(id)
    if (!Number.isFinite(x.median)) {
      return 'FAIL'
    }
    const flag = x.drawn < 0.005 ? ' **(blank)**' : ''
    return `${x.median.toFixed(0)} ± ${x.stddev.toFixed(0)} (${x.rung})${flag}`
  }
  const base = cell(rungs[0]!.id)
  const c2d = cell('canvas2d')
  const ratio =
    Number.isFinite(base.median) &&
    Number.isFinite(c2d.median) &&
    base.drawn >= 0.005 &&
    c2d.drawn >= 0.005
      ? `${(c2d.median / base.median).toFixed(2)}x`
      : '—'
  md += `| ${c.id} | ${rungs.map(r => fmt(r.id)).join(' | ')} | ${ratio} |\n`
}
md += `\nScreenshots of every cell's warmup render are in `
md += `\`screenshots/backends/\`.\n`
fs.writeFileSync(`${outfile}.md`, md)
console.log(`\nwrote ${outfile}.md and ${outfile}.json`)

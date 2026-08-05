// Post-load interaction benchmark. Initial render is fetch-dominated (both
// builds fetch in workers) and undersells the GPU branch; the real win is
// re-rendering already-loaded data on zoom.
//
// The old block renderer binds rendered output to a specific bpPerPx, so a
// zoom-IN triggers a refetch + re-render and the user watches "Downloading
// alignments..." until it finishes. The GPU branch re-projects already-loaded
// reads at the new zoom instantly, with no refetch and no loading state.
//
// So the metric that matters is TIME-TO-CONTENT after a zoom: how long a loading
// indicator is shown before correct content is back. We drive the view model
// directly via window.JBrowseSession (exposed by both builds), zoom IN by fixed
// steps (subset of already-loaded data — isolates the cache-redraw path), and
// sample the loading state at high frequency. We also record the redraw frame
// cost (max rAF gap), which is small for both but slightly higher on the GPU
// branch since it genuinely redraws on each zoom. Hardware-GPU headless.
//
// Usage: interaction.ts <url> [screenshotPath]
// Prints JSON with per-step time-to-content and redraw cost.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

const url = process.argv[2]
const screenshotPath = process.argv[3]
if (!url) {
  throw new Error('usage: interaction.ts <url> [screenshot]')
}
if (screenshotPath) {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
}

const STEPS = 5 // zoom-in steps measured (each halves bpPerPx)

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
await page.goto(url, { waitUntil: 'load' })

// wait for initial render-complete (same quiescence detector as profile.ts)
await page.waitForFunction(
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
  { timeout: 120000, polling: 100 },
)

// install a frame recorder for redraw-cost (max rAF gap)
await page.evaluate(() => {
  const w = window as unknown as { __frames: number[] }
  w.__frames = []
  const tick = (t: number) => {
    w.__frames.push(t)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

// loading detector: true while the track shows a loading indicator. Covers the
// shared loading-overlay testid and the alignments "Downloading..." block
// message, so it works on both the old block renderer and the new branch.
const LOADING_FN = () => {
  const overlay =
    document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
  const txt = document.body.innerText
  const msg = /Downloading|Loading alignments|Rendering/i.test(txt)
  return overlay || msg
}

const MAX_WAIT = 15000
const QUIET = 300 // content considered back once loading stays false this long

interface StepMetric {
  timeToContentMs: number // how long a loading indicator was shown post-zoom
  loadingSeen: boolean // did a refetch/re-render loading state appear at all
  redrawGapMs: number // longest rAF gap = cost of the redraw frame
}

async function zoomStep(): Promise<StepMetric> {
  const t0 = await page.evaluate(() => {
    const w = window as unknown as {
      __frames: number[]
      JBrowseSession: { views: unknown[] }
    }
    w.__frames = []
    const v = w.JBrowseSession.views[0] as { bpPerPx: number; zoomTo: (n: number) => void }
    const t = performance.now()
    v.zoomTo(v.bpPerPx * 0.5) // zoom in 2x: strict subset of loaded data
    return t
  })

  // sample loading state until it has been false for QUIET ms (or timeout)
  let lastLoadingTrue = 0
  let loadingSeen = false
  const start = Date.now()
  for (;;) {
    const loading = await page.evaluate(LOADING_FN)
    const elapsed = Date.now() - start
    if (loading) {
      loadingSeen = true
      lastLoadingTrue = elapsed
    }
    if (elapsed - lastLoadingTrue >= QUIET && elapsed >= QUIET) {
      break
    }
    if (elapsed >= MAX_WAIT) {
      break
    }
    await new Promise(r => setTimeout(r, 20))
  }

  const redrawGapMs = await page.evaluate(t0arg => {
    const w = window as unknown as { __frames: number[] }
    const f = w.__frames.filter(x => x >= t0arg)
    let g = 0
    for (let i = 1; i < f.length; i++) {
      g = Math.max(g, f[i]! - f[i - 1]!)
    }
    return g
  }, t0)

  return {
    timeToContentMs: loadingSeen ? lastLoadingTrue : 0,
    loadingSeen,
    redrawGapMs,
  }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : Number.NaN
}

await zoomStep() // warmup
const steps: StepMetric[] = []
for (let i = 0; i < STEPS; i++) {
  steps.push(await zoomStep())
}

if (screenshotPath) {
  await page.screenshot({ path: screenshotPath })
}

const summary = {
  zoomTimeToContentMs: median(steps.map(s => s.timeToContentMs)),
  zoomRedrawGapMs: median(steps.map(s => s.redrawGapMs)),
  loadingEverSeen: steps.some(s => s.loadingSeen),
  steps,
}
console.log(JSON.stringify(summary))
await browser.close()

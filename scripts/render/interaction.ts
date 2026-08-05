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
// directly via window.JBrowseSession (exposed by both builds) and sample the
// loading state at high frequency. We also record the redraw frame cost (max rAF
// gap). Hardware-GPU headless.
//
// TWO DIRECTIONS, set by ZOOM=in|out (default in):
//
//   in  — zoom IN by 2x per step. The new view is a strict subset of loaded
//         data, so the GPU branch never refetches and this isolates the
//         cache-redraw path. This is the asymmetric case: it is the branch's
//         best showing, because only the old renderer has to go back to the
//         network.
//   out — zoom OUT by 2x per step. The new view needs data outside what is
//         loaded, so BOTH architectures must refetch. This is the harder,
//         fairer case: it isolates redraw cost from fetch cost, and answers
//         "when both have to fetch, what is left of the advantage?".
//
// Zoom-out is self-limiting: `chr22_mask` is only 250 kb, so a 19 kb window can
// widen about three times before the view clamps at the contig. A clamped step
// is a no-op, not a measurement, so we detect it (bpPerPx did not change) and
// stop rather than reporting zeros that look like instant content.
//
// Usage: interaction.ts <url> [screenshotPath]     (ZOOM=in|out, MAX_WAIT=ms)
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

const DIRECTION = process.env.ZOOM === 'out' ? 'out' : 'in'
const FACTOR = DIRECTION === 'out' ? 2 : 0.5
const STEPS = 5 // steps attempted (zoom-out stops early when the view clamps)

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

// A step that is still loading when this expires is reported as CENSORED, not as
// a number. The original 15000 silently produced the recorded 1000x-longread
// figure of "15008ms" — five steps that all landed within 19ms of the cap, which
// is the harness giving up rather than content arriving. Zoom-out fetches more
// data than zoom-in, so the ceiling has to be well clear of any real value.
const MAX_WAIT = Number(process.env.MAX_WAIT ?? 120000)
const QUIET = 300 // content considered back once loading stays false this long

// Past a byte threshold JBrowse refuses the fetch and renders "Requested too
// much data (N Mb). Zoom in to see features or force load" instead of reads.
// That path is FAST — the track paints nothing — so without this check a refusal
// scores as content-returned-in-90ms and reads as a good result. Verified
// directly: release-4.3.0 on 200x.shortread bails one zoom-out step in, with 0
// painted pixels, while 20x.shortread renders every step.
const BAILED_FN = () =>
  /Requested too much|Zoom in to see features|force load/i.test(
    document.body.innerText,
  )

interface StepMetric {
  timeToContentMs: number // how long a loading indicator was shown post-zoom
  loadingSeen: boolean // did a refetch/re-render loading state appear at all
  redrawGapMs: number // longest rAF gap = cost of the redraw frame
  /** false once the view clamps at the contig edge — a no-op, not a measurement */
  applied: boolean
  /** true if MAX_WAIT expired with content still not back: value is a lower bound */
  censored: boolean
  /** true if the track refused the fetch and drew no reads — NOT a render timing */
  bailed: boolean
}

async function zoomStep(): Promise<StepMetric> {
  const { t0, applied } = await page.evaluate(factor => {
    const w = window as unknown as {
      __frames: number[]
      JBrowseSession: { views: unknown[] }
    }
    w.__frames = []
    const v = w.JBrowseSession.views[0] as {
      bpPerPx: number
      zoomTo: (n: number) => void
    }
    const before = v.bpPerPx
    const t = performance.now()
    v.zoomTo(before * factor)
    // zoomTo clamps at the assembly's widest bpPerPx. An unchanged value means
    // the view was already as wide as the contig allows and nothing moved, so
    // there is nothing to time — distinguish that from "content came back
    // instantly", which is the same 0ms otherwise.
    return { t0: t, applied: v.bpPerPx !== before }
  }, FACTOR)

  if (!applied) {
    return {
      timeToContentMs: Number.NaN,
      loadingSeen: false,
      redrawGapMs: Number.NaN,
      applied: false,
      censored: false,
      bailed: false,
    }
  }

  // sample loading state until it has been false for QUIET ms (or timeout)
  let lastLoadingTrue = 0
  let loadingSeen = false
  let censored = false
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
      // never observed QUIET ms of settled content, so the true time-to-content
      // is greater than this, not equal to it
      censored = loadingSeen
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

  const bailed = await page.evaluate(BAILED_FN)

  return {
    timeToContentMs: loadingSeen ? lastLoadingTrue : 0,
    loadingSeen,
    redrawGapMs,
    applied: true,
    censored,
    bailed,
  }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : Number.NaN
}

// Warmup only when zooming in. Zooming out has roughly three usable steps before
// the 250 kb contig clamps the view, so spending one on a warmup would leave too
// few — and the page is already quiesced from the initial render anyway.
if (DIRECTION === 'in') {
  await zoomStep()
}
const steps: StepMetric[] = []
for (let i = 0; i < STEPS; i++) {
  const s = await zoomStep()
  if (!s.applied) {
    break // view clamped at the contig edge; further steps would be no-ops
  }
  steps.push(s)
}

if (screenshotPath) {
  await page.screenshot({ path: screenshotPath })
}

// Steps where the track refused to draw are not render timings and must not be
// averaged in with ones that are — including them is what made a refusal look
// like a 90ms success.
const drew = steps.filter(s => !s.bailed)
const censoredSteps = drew.filter(s => s.censored).length
const summary = {
  mode: DIRECTION,
  maxWaitMs: MAX_WAIT,
  stepsAttempted: steps.length,
  stepsMeasured: drew.length,
  stepsBailed: steps.length - drew.length,
  stepsCensored: censoredSteps,
  // when any counted step is censored the median is a LOWER BOUND, not a value
  censored: censoredSteps > 0,
  // nothing was ever drawn: there is no timing here at all
  allBailed: steps.length > 0 && drew.length === 0,
  zoomTimeToContentMs: median(drew.map(s => s.timeToContentMs)),
  zoomRedrawGapMs: median(drew.map(s => s.redrawGapMs)),
  loadingEverSeen: drew.some(s => s.loadingSeen),
  steps,
}
console.log(JSON.stringify(summary))
await browser.close()

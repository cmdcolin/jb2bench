// Post-load interaction benchmark. Initial render is fetch-dominated (both
// builds fetch in workers) and undersells the GPU branch; the real win is
// re-rendering already-loaded data on zoom.
//
// The old block renderer binds rendered output to a specific bpPerPx, so a
// zoom-IN triggers a refetch + re-render and the user watches "Downloading
// alignments..." until it finishes. The GPU branch re-projects already-loaded
// reads at the new zoom instantly, with no refetch and no loading state.
//
// So the metric that matters is TIME-TO-CONTENT after a zoom: how long the view
// goes without correct content before it is back. We drive the view model
// directly via window.JBrowseSession (exposed by every build) and sample
// readiness at high frequency. We also record the redraw frame cost (max rAF
// gap). Hardware-GPU headless.
//
// "Not ready" is asked STRUCTURALLY, in contentready.ts: how many units of the
// current view have yet to finish rendering, counted from each generation's own
// contract. It used to be asked by matching the text of a spinner, which is not
// portable across build generations and silently scored release-2.4.0 at 0 ms —
// that file has the full account, and DETECTOR=text still runs the old way for
// comparison.
//
// THREE MODES, set by MODE=in|out|pan (default in; ZOOM= is the legacy name):
//
//   in  — zoom IN by 2x per step. The new view is a strict subset of loaded
//         data, so the GPU branch never refetches and this isolates the
//         cache-redraw path. This is the asymmetric case: it is the branch's
//         best showing, because only the old renderer has to go back to the
//         network.
//   out — zoom OUT by 2x per step. Intended as the case where BOTH refetch.
//         It does not work: widening multiplies the bytes requested, and past
//         a threshold JBrowse declines the fetch entirely (see BAILED_FN). For
//         anything heavier than 20x shortread this mode measures refusals.
//   pan — scroll sideways by one full viewport at CONSTANT bpPerPx. This is the
//         honest "both refetch" test: the region is new to both builds so
//         neither can serve it from cache, while the byte count per step is
//         identical to the initial render's and so never crosses the cap that
//         defeats zoom-out.
//
// Both out and pan are self-limiting: `chr22_mask` is only 250 kb. Zoom-out
// widens about three times before the view clamps at the contig; pan gets about
// five viewport-widths from the benchmark locus before it runs out of contig. A
// step that could not be applied in full is a no-op, not a measurement, so we
// detect it and stop rather than reporting zeros that look like instant content.
//
// Usage: interaction.ts <url> [screenshotPath]     (MODE=in|out|pan, MAX_WAIT=ms)
// Prints JSON with per-step time-to-content and redraw cost.
import puppeteer from 'puppeteer'
import { waitForRenderComplete } from './rendercomplete.ts'
import {
  contentReadyProbe,
  waitForContentReady,
  QUIET_MS,
} from './contentready.ts'
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

const MODES = ['in', 'out', 'pan'] as const
type Mode = (typeof MODES)[number]
const requested = process.env.MODE ?? process.env.ZOOM ?? 'in'
if (!(MODES as readonly string[]).includes(requested)) {
  throw new Error(`MODE must be one of ${MODES.join('|')}, got "${requested}"`)
}
const MODE = requested as Mode
const FACTOR = MODE === 'out' ? 2 : 0.5 // zoom modes only
const STEPS = 5 // attempted; out and pan stop early when they run out of contig

// Pan LEFT by default. A pan is only a fair refetch-vs-refetch test if every
// step carries the same data volume, and the two ends of chr22_mask do not:
// pbsim's long reads run off the contig, so long-read depth tapers at both
// edges. Measured mean depth per 19 kb window on 1000x.longread:
//
//   5k    29k   48k   67k   86k  105k  124k  143k  162k  181k  200k  219k
//   320   927  1193  1218  1179  1185  1178  1163  1161  1178   938   500
//
// From the benchmark locus at 124k, panning right lands on 938 and 500 for its
// last two steps — two of five steps on thinned data, in both builds. Panning
// left keeps four of five inside the uniform plateau and only grazes the taper
// at 29k. Short reads are flat across the whole contig either way (~1186).
// PAN_DIR=right restores the old path.
const PAN_SIGN = process.env.PAN_DIR === 'right' ? 1 : -1

const browser = await puppeteer.launch({
  // The cache holds whatever `puppeteer browsers install` last fetched, which is
  // not always the version this puppeteer pins. CHROME= names one explicitly.
  executablePath: process.env.CHROME,
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

// Wait for initial render-complete, through the shared detector. This used to
// be a private copy of the legacy poll under a comment claiming it matched
// profile.ts; it did not, and against a build that publishes the newer
// data-display-phase contract it never fired. See rendercomplete.ts.
const contract = await waitForRenderComplete(page)
console.error(`render-complete contract: ${contract}`)

// ...and then wait for every block of the view to be finished, which the
// contract above does not establish on a legacy build: its legacy branch reports
// ready as soon as ONE `-done` node exists anywhere, and on release-2.4.0 that
// is one block of six with the rest still loading. Timing a step against a page
// that had not finished its initial render is half of how 2.4.0 came to record
// zeros.
const settleIn = await waitForContentReady(page, { timeoutMs: 120000 })
console.error(
  `initial render: ${settleIn.contract} contract, a further ` +
    `${settleIn.notReadyUntilMs}ms to finish every block` +
    `${settleIn.censored ? ' (CENSORED: still unfinished)' : ''}`,
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

// loading detector: true while the track shows a loading indicator.
//
// The message set is VERSION-DEPENDENT, and getting it wrong is silent and
// one-directional: an unmatched indicator reads as "content was never missing",
// i.e. a perfect score. builds/release-2.4.0 -- the 2023 paper's version --
// labels a refetching block plain "Loading" and its worker step "Serializing
// results", neither of which the original /Downloading|Loading
// alignments|Rendering/ matched. It therefore scored 0 ms on every zoom-in
// case, identical to the GPU branch, which is the instrument and not the result.
//
// Widening it is not free either, and the second failure is as loud as the first
// one is quiet: something on a release-4.3.0 page matches a bare "Loading"
// permanently, so with the wide pattern every step ran to MAX_WAIT and a single
// cell spent eight minutes reporting five censored values. Both errors come from
// one assumption -- that a fixed word list describes every build's UI.
//
// So the pattern is CHOSEN PER BUILD, by a rule that needs no version table: an
// indicator already showing while the page sits at rest is not an indicator. The
// wide pattern is sampled once after the initial render goes quiescent, and a
// build it already matches there falls back to the narrow one. That keeps
// 2.4.0's "Loading" blocks visible without letting 4.3.0's permanent match
// swallow the run, and it degrades safely on a build nobody has tried yet.
const LOADING_FN = (wide: boolean) => {
  const overlay =
    document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
  const txt = document.body.innerText
  const re = wide
    ? /Downloading|Loading alignments|Rendering|Serializing results|\bLoading\b/i
    : /Downloading|Loading alignments|Rendering/i
  return overlay || re.test(txt)
}

// A step that is still loading when this expires is reported as CENSORED, not as
// a number. The original 15000 silently produced the recorded 1000x-longread
// figure of "15008ms" — five steps that all landed within 19ms of the cap, which
// is the harness giving up rather than content arriving. Zoom-out fetches more
// data than zoom-in, so the ceiling has to be well clear of any real value.
const MAX_WAIT = Number(process.env.MAX_WAIT ?? 120000)
// Content is considered back once the page has stayed settled this long. Shared
// with contentsignature.ts so the two detectors use one definition of "settled
// long enough to count", and overridable with QUIET_MS.
const QUIET = QUIET_MS

// Decide the pattern here, with the page rendered and idle. Printed on stderr
// for the same reason the render-complete contract is: a cell measured under a
// different detector from its neighbours should be visible, not silent.
const WIDE_OK = !(await page.evaluate(LOADING_FN, true))

// DETECTOR=structural is the default as of 2026-08-25. The text detector above
// is kept, behind DETECTOR=text, because every number recorded before that date
// was measured with it and a claim about a change of instrument has to be
// checkable by running both. See contentready.ts for why it cannot be the
// default: on release-2.4.0 it reports 0 ms for a zoom that takes six seconds.
const DETECTOR = process.env.DETECTOR ?? 'structural'
if (DETECTOR !== 'structural' && DETECTOR !== 'text') {
  throw new Error(`DETECTOR must be structural|text, got "${DETECTOR}"`)
}
console.error(
  DETECTOR === 'structural'
    ? 'detector: outstanding blocks (structural)'
    : `detector: loading text, ${WIDE_OK ? 'wide' : 'narrow (wide matches this build at rest)'}`,
)

// Past a byte threshold JBrowse refuses the fetch and renders "Requested too
// much data (N Mb). Zoom in to see features or force load" instead of reads.
// That path is FAST — the track paints nothing — so without this check a refusal
// scores as content-returned-in-90ms and reads as a good result. Verified
// directly: release-4.3.0 on 200x.shortread bails one zoom-out step in, with 0
// painted pixels, while 20x.shortread renders every step.
//
// The other way to score fast by drawing nothing is to land somewhere with no
// reads. That is not a risk on this corpus — read starts are uniform across all
// 250 kb of chr22_mask in every track (checked with samtools; the thinnest,
// 20x.longread, is ~14 reads per 25 kb bin of ~45 kb reads) — and each step
// records the locus it ended on, so a run log can be audited for it. A corpus
// with patchy coverage would need a real painted-content check here.
const BAILED_FN = () =>
  /Requested too much|Zoom in to see features|force load/i.test(
    document.body.innerText,
  )

interface StepMetric {
  timeToContentMs: number // how long a loading indicator was shown post-step
  loadingSeen: boolean // did a refetch/re-render loading state appear at all
  redrawGapMs: number // longest rAF gap = cost of the redraw frame
  /** false once the view runs out of contig — a no-op, not a measurement */
  applied: boolean
  /** true if MAX_WAIT expired with content still not back: value is a lower bound */
  censored: boolean
  /** true if the track refused the fetch and drew no reads — NOT a render timing */
  bailed: boolean
  /** where the view ended up, so a run log can be checked for actual movement */
  locus: string
}

async function interactStep(): Promise<StepMetric> {
  // Which blocks were finished before the view moved. A build that swaps in
  // blocks for the new region has reacted even if it never showed a gap; see
  // ACK_MS in contentready.ts for the race this closes.
  const keysBefore = (await page.evaluate(contentReadyProbe)).doneKeys
  const { t0, applied, locus } = await page.evaluate(
    ({ mode, factor, sign }) => {
      const w = window as unknown as {
        __frames: number[]
        JBrowseSession: { views: unknown[] }
      }
      w.__frames = []
      const v = w.JBrowseSession.views[0] as {
        bpPerPx: number
        width: number
        offsetPx: number
        displayedRegionsTotalPx: number
        visibleLocStrings?: string
        zoomTo: (n: number) => void
        horizontalScroll: (px: number) => number
      }
      const where = () =>
        v.visibleLocStrings ??
        // fallback for builds without the getter: this corpus is one contig
        // displayed from bp 0, so offsetPx * bpPerPx is the left edge in bp
        `${Math.round(v.offsetPx * v.bpPerPx)}-${Math.round((v.offsetPx + v.width) * v.bpPerPx)}`

      if (mode === 'pan') {
        // One full viewport per step, so the new region is disjoint from the
        // old one and neither build can serve any of it from what it already
        // holds. bpPerPx is untouched, so the byte count per step matches the
        // initial render's and the density cap is never approached.
        const target = v.offsetPx + sign * v.width
        // maxOffset lets the view scroll until only ~200px of genome is left on
        // screen. Panning into that would measure a mostly-empty viewport and
        // score as a fast render for the same reason a bail does, so require
        // the whole new viewport to land inside the contig.
        if (target < 0 || target + v.width > v.displayedRegionsTotalPx) {
          return { t0: 0, applied: false, locus: where() }
        }
        const before = v.offsetPx
        const t = performance.now()
        v.horizontalScroll(sign * v.width)
        // read the offset back rather than trusting the return value, so this
        // does not depend on horizontalScroll's contract across builds
        return {
          t0: t,
          applied: Math.abs(v.offsetPx - target) < 1 && v.offsetPx !== before,
          locus: where(),
        }
      }

      const before = v.bpPerPx
      const t = performance.now()
      v.zoomTo(before * factor)
      // zoomTo clamps at the assembly's widest bpPerPx. An unchanged value means
      // the view was already as wide as the contig allows and nothing moved, so
      // there is nothing to time — distinguish that from "content came back
      // instantly", which is the same 0ms otherwise.
      return { t0: t, applied: v.bpPerPx !== before, locus: where() }
    },
    { mode: MODE, factor: FACTOR, sign: PAN_SIGN },
  )

  if (!applied) {
    return {
      timeToContentMs: Number.NaN,
      loadingSeen: false,
      redrawGapMs: Number.NaN,
      applied: false,
      censored: false,
      bailed: false,
      locus,
    }
  }

  // How long until content is back. Both detectors answer it the same shape --
  // the last moment the page was NOT settled, relative to the interaction -- so
  // a step is timed identically either way and only the definition of "settled"
  // differs.
  let lastLoadingTrue = 0
  let loadingSeen = false
  let censored = false
  if (DETECTOR === 'structural') {
    const settle = await waitForContentReady(page, {
      quietMs: QUIET,
      timeoutMs: MAX_WAIT,
      baselineKeys: keysBefore,
    })
    lastLoadingTrue = settle.notReadyUntilMs
    loadingSeen = settle.wasBusy
    censored = settle.censored
    // Per step, on stderr, for the same reason the detector choice is printed:
    // a step that read 0 ms because the build had nothing to refetch and one
    // that read 0 ms because its track was blank look identical in the JSON.
    // `peak` separates them — a blank track has no blocks outstanding.
    console.error(
      `  step: ${settle.notReadyUntilMs}ms busy=${settle.wasBusy} ` +
        `peakOutstanding=${settle.peakOutstanding} ack=${settle.acknowledged}` +
        `${settle.censored ? ' CENSORED' : ''}`,
    )
  } else {
    // sample loading state until it has been false for QUIET ms (or timeout)
    const start = Date.now()
    for (;;) {
      const loading = await page.evaluate(LOADING_FN, WIDE_OK)
      const elapsed = Date.now() - start
      if (loading) {
        loadingSeen = true
        lastLoadingTrue = elapsed
      }
      if (elapsed - lastLoadingTrue >= QUIET && elapsed >= QUIET) {
        break
      }
      if (elapsed >= MAX_WAIT) {
        // never observed QUIET ms of settled content, so the true
        // time-to-content is greater than this, not equal to it
        censored = loadingSeen
        break
      }
      await new Promise(r => setTimeout(r, 20))
    }
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
    locus,
  }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : Number.NaN
}

// Warmup only when zooming in. The other two modes consume contig with every
// step — zoom-out has about three usable steps and pan about five before the
// view runs out of chr22_mask — so spending one on a warmup would leave too few.
// The page is already quiesced from the initial render anyway; for pan, the
// median over five identical steps absorbs a slow first one.
if (MODE === 'in') {
  await interactStep()
}
const steps: StepMetric[] = []
// A crashed tab is an OUTCOME, not a harness error. release-4.3.0 kills its
// renderer zooming out of 1000x shortread CRAM, which reaches puppeteer as
// "Attempted to use detached Frame" from whatever call happens to be next —
// a message about the instrument, describing something the build did. Recorded
// as `crashed` so the table can say so, for the same reason a refusal to fetch
// is recorded rather than averaged in: neither is a render time.
let crashed = false
page.on('error', e => {
  crashed = true
  console.error(`page crashed: ${String(e).split('\n')[0]}`)
})
const detached = (e: unknown) => /detached Frame|Target closed|Session closed/i.test(String(e))
for (let i = 0; i < STEPS; i++) {
  let s: StepMetric
  try {
    s = await interactStep()
  } catch (e) {
    if (crashed || detached(e)) {
      crashed = true
      break
    }
    throw e
  }
  if (!s.applied) {
    break // out of contig; further steps would be no-ops
  }
  steps.push(s)
}

if (screenshotPath && !crashed) {
  await page.screenshot({ path: screenshotPath })
}

// Steps where the track refused to draw are not render timings and must not be
// averaged in with ones that are — including them is what made a refusal look
// like a 90ms success.
const drew = steps.filter(s => !s.bailed)
const censoredSteps = drew.filter(s => s.censored).length
const summary = {
  mode: MODE,
  maxWaitMs: MAX_WAIT,
  stepsAttempted: steps.length,
  stepsMeasured: drew.length,
  stepsBailed: steps.length - drew.length,
  stepsCensored: censoredSteps,
  // when any counted step is censored the median is a LOWER BOUND, not a value
  censored: censoredSteps > 0,
  // nothing was ever drawn: there is no timing here at all
  allBailed: steps.length > 0 && drew.length === 0,
  // the renderer process died partway through; whatever steps completed are
  // not comparable with a cell that survived
  crashed,
  zoomTimeToContentMs: median(drew.map(s => s.timeToContentMs)),
  zoomRedrawGapMs: median(drew.map(s => s.redrawGapMs)),
  loadingEverSeen: drew.some(s => s.loadingSeen),
  steps,
}
console.log(JSON.stringify(summary))
await browser.close()

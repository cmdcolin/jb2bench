// Cross-tool interaction: move the view, and time how long each tool takes to
// put correct pixels back. Two motions, one instrument.
//
//   MOTION=pan (default) — scroll sideways one full viewport at constant scale.
//   MOTION=zoom          — halve the visible width about the view's centre.
//
// The motions ask different questions and neither answers the other's. A pan
// makes both tools go to the network for a region neither holds, so it prices
// fetch-plus-draw. A zoom stays inside data both tools already have, so it
// prices redraw alone — which is where a batched GPU pass and a per-read 2D
// pass differ most, and where the older JBrowse renderer refetches instead.
//
// Why either of these and not a cold load. Every igv.js number in
// `results/crosstool.md` is a cold load, which folds together application boot,
// assembly resolution, fetch and draw — and boot is the part that has nothing
// to do with what a renderer does. Both motions here run against an application
// that is already up, so far less of the number is startup.
//
// The zoom used to be unmeasurable, and the reason is worth keeping. An earlier
// `zoomprofile.ts` polled screenshots every 100 ms and timed what turned out to
// be JBrowse's 500 ms navigation debounce rather than JBrowse's drawing; the
// README retracted the table it produced. What was wrong was the instrument,
// not the interaction, so the zoom is measured here on the draws-plus-network
// gate below, which resolves hundreds of microseconds rather than hundreds of
// milliseconds.
//
// The instrument belongs to neither tool. Same paint-quiescence idea as
// `paintprofile.ts`: poll a screenshot, hash it, call the step done when the
// hash has repeated STABLE_POLLS times AND differs from the frame captured
// immediately before the pan. Trusting either tool's own loading state would be
// wrong in opposite directions — igv hides its spinner when features finish
// *loading*, before drawing them, and JBrowse's indicator wording moves between
// releases.
//
// The two tools are driven differently on purpose:
//
//   JBrowse — `horizontalScroll(±width)` to pan, `zoomTo(bpPerPx / 2)` to zoom.
//     The pan mechanism is exactly what the JBrowse-vs-JBrowse pan in
//     `scripts/render/interaction.ts` does; both avoid depending on a
//     locus-navigation API across builds of differing vintage.
//   igv — `search(locus)` to pan, against the locus computed from the same
//     start and width; `zoomIn()` to zoom.
//   genomespy — `getScaleResolutionByName('pos').zoomTo(interval)` for both
//     motions, which is the only navigation API this harness page has and the
//     one it already uses to reach the benchmark window. It takes an explicit
//     interval, so pan and zoom differ here only in which interval is asked
//     for. Not animated: `zoomTo`'s second argument defaults to false, which
//     takes the branch that sets the domain and requests one render, so this
//     arm times a redraw rather than a transition.
//
// Both zoom drives halve the visible width about the centre, so the two tools
// land on the same region by construction in the same way the pan does.
//
// Both therefore visit the same regions by construction, and the run records
// where each actually landed so the claim is checkable rather than assumed. A
// step whose two tools disagree about the locus is reported, not averaged in.
//
// Usage: panprofile.ts <url> <jbrowse|igv|genomespy> [screenshotDir]
//   MOTION=pan|zoom   which interaction to time (default pan)
// Prints JSON: per-step ms and landed locus.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

import {
  DEFAULT_QUIET_MS,
  DRAW_CLOCK_INIT,
  DRAW_CLOCK_READ,
  DRAW_CLOCK_RESET,
  isContentDrawn,
} from './drawclock.ts'

const TOOLS = ['jbrowse', 'igv', 'genomespy'] as const
type ToolKind = (typeof TOOLS)[number]
const url = process.argv[2]
const tool = process.argv[3] as ToolKind
const shotDir = process.argv[4]
if (!url || !TOOLS.includes(tool)) {
  throw new Error(`usage: panprofile.ts <url> <${TOOLS.join('|')}> [screenshotDir]`)
}
if (shotDir) {
  fs.mkdirSync(shotDir, { recursive: true })
}

const STEPS = Number(process.env.STEPS ?? 5)
const MAX_WAIT = Number(process.env.MAX_WAIT ?? 120000)
const POLL_MS = Number(process.env.POLL_MS ?? 150)
const STABLE_POLLS = Number(process.env.STABLE_POLLS ?? 5)
const READY_TIMEOUT = Number(process.env.READY_TIMEOUT ?? 180000)

// INSTRUMENT=draws (default) times the canvas draw calls; INSTRUMENT=paint uses
// screenshot quiescence. Draws is the default because paint cannot resolve a
// pan and is not neutral between these two tools — a screenshot costs 43 ms on
// the JBrowse page and 161 ms on the igv page, so the detector's own floor is
// ~408 ms for one and ~1119 ms for the other, against pans of about that
// length. `drawclock.ts` has the measurement. Paint is kept because the two
// bracket the truth from either side: a draw call precedes the compositor, a
// screenshot follows it.
const INSTRUMENT = process.env.INSTRUMENT === 'paint' ? 'paint' : 'draws'
// Settling margin on the final draw burst — NOT the completion criterion. The
// criterion is `isContentDrawn`: a canvas was drawn after the region's bytes
// arrived. See drawclock.ts for the trace that forced the distinction.
const QUIET_MS = Number(process.env.QUIET_MS ?? DEFAULT_QUIET_MS)

const MOTION = process.env.MOTION === 'zoom' ? 'zoom' : 'pan'

// Pan LEFT, for the reason interaction.ts documents at length: pbsim's long
// reads run off both ends of chr22_mask, so long-read depth tapers there, and
// panning right from the benchmark locus puts two of five steps on thinned data
// in both tools at once — which reads as a shared speedup rather than as a
// corpus artefact. Leftward keeps four of five inside the plateau.
const PAN_SIGN = process.env.PAN_DIR === 'right' ? 1 : -1

// A zoom step halves the width, so five steps take 19 kb to 594 bp. That floor
// matters: below roughly a hundred bases both tools switch to drawing letters
// rather than reads, which is a different workload and not the one being
// compared. The step loop stops rather than crossing it.
const MIN_WIDTH = Number(process.env.MIN_WIDTH ?? 200)

// The benchmark window, and the step size that follows from it. One full
// viewport per step means the new region is disjoint from the old, so neither
// tool can serve any of it from what it already holds.
const REF = process.env.REF ?? 'chr22_mask'
const START = Number(process.env.START ?? 124000)
const END = Number(process.env.END ?? 143000)
const WIDTH = END - START
const CONTIG_LENGTH = Number(process.env.CONTIG_LENGTH ?? 250001)

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  // Puppeteer's default protocolTimeout is 180 s, and it applies to a single
  // `evaluate` round trip. igv.js parses alignments on the main thread, so at
  // 1000x-longread it blocks JavaScript long enough to blow through that — the
  // first run of this matrix recorded three "Runtime.evaluate timed out"
  // failures on that cell and nothing else. A harness timeout reported as a tool
  // result is the same error as an unrecognized loading indicator scoring a
  // perfect zero, pointed the other way: it censors the case where the
  // difference is largest.
  protocolTimeout: Number(process.env.PROTOCOL_TIMEOUT ?? 600000),
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
// Before any of the tool's own scripts, so the prototypes are wrapped before a
// rendering context exists.
await page.evaluateOnNewDocument(DRAW_CLOCK_INIT)

const hash = (b: Uint8Array) => crypto.createHash('sha1').update(b).digest('hex')
const shot = async () =>
  hash(await page.screenshot({ type: 'png', optimizeForSpeed: true }))

// In-flight request count, from CDP rather than from a patched `fetch`.
//
// This has to come from the protocol because JBrowse fetches in a worker: a
// hook installed on the page's own `fetch` and `XMLHttpRequest` sees igv's
// requests and none of JBrowse's, which would gate one tool and not the other —
// the same asymmetry that made screenshots unusable, arrived at from a
// different direction.
let inFlight = 0
// Not only "is anything in flight now" but "when did anything last happen". A
// tool that fetches in bursts drops to zero between them — traced at 1000x, one
// such lull ran ~300 ms — and an instantaneous test reads that as finished.
let lastNetworkAt = 0
const netEvent = (delta: number) => {
  inFlight += delta
  lastNetworkAt = Date.now()
}
page.on('request', () => netEvent(1))
page.on('requestfinished', () => netEvent(-1))
page.on('requestfailed', () => netEvent(-1))

// Per-step network accounting, because "a pan is the case where BOTH tools must
// fetch" is a claim and not a definition.
//
// It is not automatically true. JBrowse holds a region wider than the viewport,
// so a one-viewport pan can land entirely inside what it already has: measured
// here at 20x-shortread, its first pan step issued **no data request at all**
// and re-projected in 1.6 ms. Comparing that against a tool that did fetch would
// be comparing a cache hit to a network round trip and calling it rendering.
//
// So every step records what each tool actually asked for. A reader can then see
// whether the step was a fetch on both sides, and the report says so instead of
// the method section asserting it.
let stepRequests = 0
let stepBytes = 0
// When the last byte of data landed. This is half of the completion rule: the
// step is not done until a canvas has been drawn *after* this moment.
const DATA_RE = /\.(bam|bai|cram|crai|bw|fa|fai)(\?|$)/
page.on('response', res => {
  if (!DATA_RE.test(res.url())) return
  stepRequests++
  const len = Number(res.headers()['content-length'] ?? 0)
  if (Number.isFinite(len)) stepBytes += len
})

/**
 * Wait until the page has stopped drawing AND stopped fetching.
 *
 * The draw clock alone is not enough, and the way it fails is worth stating
 * because it looks like a result. JBrowse's GPU path re-projects the reads it
 * already holds within a millisecond or two of the pan, then goes quiet while it
 * fetches the new region, then draws again when the data lands. A detector
 * watching only draws sees the first gap and calls the step finished: measured
 * this way, JBrowse's first pan step reported **1.4 ms**, which is the time to
 * re-project stale content and not the time to correct content.
 *
 * So a step is done when no draw has happened for `quietMs` and nothing is in
 * flight. Time-to-content is then the last draw, which is the frame that put the
 * fetched data on screen.
 */
async function drawsSettled(t0: number) {
  for (;;) {
    if (Date.now() - t0 > MAX_WAIT) {
      throw new Error(`no content draw within ${MAX_WAIT} ms`)
    }
    const got = (await page.evaluate(DRAW_CLOCK_READ)) as {
      count: number
      ms: number
      burstMs: number
      sinceLast: number
    }
    // The draw clock runs on page time and the network events on wall clock;
    // t0 is the same instant in both, so this puts the last draw on the wall
    // clock to compare against the last response. Millisecond skew is
    // irrelevant against the hundreds of ms being separated.
    const lastDrawAt = t0 + got.ms
    if (
      isContentDrawn({
        drawCount: got.count,
        lastDrawAt,
        lastNetworkAt,
        inFlight,
        now: Date.now(),
        quietMs: QUIET_MS,
      })
    ) {
      return got
    }
    await new Promise(r => setTimeout(r, 50))
  }
}

/**
 * Wait for the pixels to stop changing and to differ from `reference`.
 *
 * The `!== reference` half is what makes this usable after an interaction as
 * well as after a load. A pan that drew nothing would otherwise satisfy a bare
 * stability test instantly, and score as the fastest result in the table — the
 * exact failure the zoom-out benchmark hit before it learned to detect refusals.
 */
async function settle(t0: number, reference: string) {
  let last = ''
  let stable = 0
  let polls = 0
  let shotTotal = 0
  for (;;) {
    if (Date.now() - t0 > MAX_WAIT) {
      throw new Error(`no stable paint within ${MAX_WAIT} ms`)
    }
    const tShot = Date.now()
    const h = await shot()
    shotTotal += Date.now() - tShot
    polls++
    if (h === last && h !== reference) {
      stable++
    } else {
      stable = 0
      last = h
    }
    if (stable >= STABLE_POLLS) {
      // subtract the settle window, so the number is time-to-last-paint rather
      // than time-to-detector-confidence
      return {
        ms: Date.now() - t0 - STABLE_POLLS * POLL_MS,
        polls,
        shotMs: shotTotal / polls,
      }
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

/**
 * What this instrument cannot resolve.
 *
 * A step cannot be observed in fewer than STABLE_POLLS+1 polls, and each poll
 * costs a screenshot plus POLL_MS. So the smallest number it can report is
 * roughly (STABLE_POLLS+1)*(POLL_MS + screenshot) - STABLE_POLLS*POLL_MS, and
 * anything at or near that is "below the floor" rather than "fast". At cold-load
 * timescales this is a rounding error and the README treats it as a constant
 * offset; at pan timescales it is a large share of the number, so it is reported
 * with every run rather than left for a reader to derive.
 */
const floorMs = (shotMs: number) =>
  (STABLE_POLLS + 1) * (POLL_MS + shotMs) - STABLE_POLLS * POLL_MS

interface Step {
  step: number
  ms: number
  /** canvas draws under INSTRUMENT=draws; detector polls under =paint */
  polls: number
  /**
   * How long the final draw burst itself took: `ms` minus the first draw of
   * that burst. The rest of `ms` is waiting — a debounce on a zoom, a fetch on
   * a pan — and separating the two is the difference between reporting a
   * renderer and reporting a timer.
   */
  drawMs: number
  /** data-file responses during this step — 0 means it was served from cache */
  requests: number
  /** their content-length total */
  bytes: number
  /** where the tool says it ended up */
  locus: string
  /** the region this step was supposed to land on */
  target: string
  applied: boolean
}

const steps: Step[] = []
const shotCosts: number[] = []
let failure: string | undefined
let settlesCoarseBlocks: boolean | undefined

try {
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // Captured here and not after the readiness gate below. The gate can take
  // seconds, and by the time it passes the tool may already have drawn — in
  // which case the "nothing drawn yet" reference is in fact the finished frame,
  // `h !== reference` can never hold, and the initial settle spins until
  // MAX_WAIT. That is not hypothetical; it is what this did first.
  const blank = await shot()

  // A positive gate before any timing. Every signal below is negative — pixels
  // not changing — so all of them pass on a page whose JavaScript never ran.
  if (tool === 'igv') {
    await page.waitForFunction(
      'window.__igvState && (window.__igvState.ready || window.__igvState.error)',
      { timeout: READY_TIMEOUT, polling: 200 },
    )
    const err = await page.evaluate(() => (window as any).__igvState.error)
    if (err) throw new Error(`igv failed to start: ${err}`)
  } else if (tool === 'genomespy') {
    // Every failure on this page is silent -- `embed()` resolves, its promise
    // does not reject, and GenomeSpy logs the exception itself so `pageerror`
    // never fires. crosstool/genomespy.html records `zoomed` and `lazyLoaded`
    // for that reason, and `ready` is only set after both. Waiting on anything
    // weaker would let a dead page reach the step loop, where it would draw
    // nothing and settle instantly.
    await page.waitForFunction(
      'window.__gsState && (window.__gsState.ready || window.__gsState.error)',
      { timeout: READY_TIMEOUT, polling: 200 },
    )
    const state = await page.evaluate(() => (window as any).__gsState)
    if (state.error) throw new Error(`genomespy failed to start: ${state.error}`)
    if (state.lazyLoaded !== 'ok') {
      throw new Error(`genomespy lazy data: ${state.lazyLoaded}`)
    }
  } else {
    await page.waitForFunction(
      'window.JBrowseSession && window.JBrowseSession.views && window.JBrowseSession.views.length > 0',
      { timeout: READY_TIMEOUT, polling: 200 },
    )
  }

  // The initial render has to finish before a pan means anything: panning a
  // half-drawn view would time the tail of the load.
  const initial = await settle(t0, blank)
  shotCosts.push(initial.shotMs)
  let reference = await shot()

  // Recorded per run rather than assumed, because it is the difference between
  // the two numbers this benchmark could report for a JBrowse motion and the
  // arms do not all answer the same way. See the settle in the step driver.
  if (tool === 'jbrowse') {
    settlesCoarseBlocks = await page.evaluate(
      () =>
        typeof (window as any).JBrowseSession.views[0].settleCoarseBlocks ===
        'function',
    )
  }

  for (let i = 1; i <= STEPS; i++) {
    // Where this step is supposed to land, computed the same way for both tools
    // so the locus check afterwards has something to check against.
    const stepWidth = MOTION === 'zoom' ? WIDTH / 2 ** i : WIDTH
    const targetStart =
      MOTION === 'zoom'
        ? Math.round((START + END) / 2 - stepWidth / 2)
        : START + PAN_SIGN * WIDTH * i
    const targetEnd = targetStart + stepWidth
    const target = `${REF}:${Math.round(targetStart)}-${Math.round(targetEnd)}`

    // Stop rather than clamp, in both motions and for the same reason: a view
    // holding almost nothing scores fast the way a refusal does. Panning off
    // the contig empties it — JBrowse's maxOffset allows scrolling until only
    // ~200px of genome remains — and zooming past MIN_WIDTH crosses into
    // base-letter rendering, which is a different workload from a pileup.
    if (MOTION === 'zoom' ? stepWidth < MIN_WIDTH : targetStart < 0 || targetEnd > CONTIG_LENGTH) {
      break
    }

    // Reset the draw clock immediately before issuing the pan, so its zero is
    // the interaction and not the page load.
    await page.evaluate(DRAW_CLOCK_RESET)
    stepRequests = 0
    stepBytes = 0
    lastNetworkAt = Date.now()
    const tStep = Date.now()
    const applied = await page.evaluate(
      ({ tool, sign, locus, motion, ref, from, to }) => {
        if (tool === 'genomespy') {
          const res = (window as any).gsApi.getScaleResolutionByName('pos')
          // Deliberately NOT awaited, for igv's reason below: the instrument
          // must not ask a tool when it has finished.
          ;(window as any).__panPromise = res
            .zoomTo([
              { chrom: ref, pos: from },
              { chrom: ref, pos: to },
            ])
            .catch((e: unknown) => {
              ;(window as any).__panError = String(e)
            })
          return true
        }
        if (tool === 'igv') {
          const b = (window as any).igvBrowser
          // Deliberately NOT awaited: neither call resolves on anything this
          // instrument should trust — the whole point is not to ask a tool when
          // it has finished.
          if (motion === 'zoom') {
            // igv's own 2x, centre-preserving, and the counterpart of
            // JBrowse's zoomTo below. Driving it by locus instead would go
            // through igv's search path and time a parse as well as a redraw.
            b.zoomIn()
            return true
          }
          ;(window as any).__panPromise = b.search(locus).catch((e: unknown) => {
            ;(window as any).__panError = String(e)
          })
          return true
        }
        const v = (window as any).JBrowseSession.views[0]
        // `zoomTo` and `horizontalScroll` are the per-frame chokepoints a
        // gesture writes through, and they deliberately leave the coarse blocks
        // on their 500ms throttle -- flushing them sixty times a second is the
        // cost the throttle exists to avoid. Every DISCRETE placer in the LGV
        // model (moveTo, setNewView, setWindow, navToLocString, centerAt, ...)
        // ends with `settleCoarseBlocks` instead, and jbrowse-components'
        // placersSettleCoarseBlocks.test.ts fails the next placer that forgets.
        //
        // A benchmark step is a discrete jump, so it takes the discrete path.
        // Driven through the bare chokepoint it instead timed the throttle
        // coalescing a gesture that never arrived: a flat ~507 ms at every
        // coverage and both read types, against 0.3-0.8 ms of actual drawing,
        // on a path no UI control takes. igv is driven by `zoomIn`/`search` and
        // GenomeSpy by `zoomTo(interval)` -- both discrete -- so the bare
        // chokepoint also made JBrowse the only arm entering a throttle at all.
        //
        // Optional because the older builds may not have the action; whether
        // each did is recorded per run rather than assumed, so a build that
        // cannot flush shows its throttle as the real difference it is.
        const settle = () => v.settleCoarseBlocks?.()
        if (motion === 'zoom') {
          const before = v.bpPerPx
          // Second argument defaults to width/2, so this zooms about the centre.
          v.zoomTo(v.bpPerPx / 2)
          settle()
          return v.bpPerPx !== before
        }
        const before = v.offsetPx
        v.horizontalScroll(sign * v.width)
        settle()
        return v.offsetPx !== before
      },
      {
        tool,
        sign: PAN_SIGN,
        locus: target,
        motion: MOTION,
        ref: REF,
        from: Math.round(targetStart),
        to: Math.round(targetEnd),
      },
    )

    if (!applied) {
      steps.push({
        step: i,
        ms: Number.NaN,
        polls: 0,
        drawMs: Number.NaN,
        requests: 0,
        bytes: 0,
        locus: '',
        target,
        applied: false,
      })
      break
    }

    let ms: number
    let polls = 0
    let drawMs = Number.NaN
    if (INSTRUMENT === 'draws') {
      const got = await drawsSettled(tStep)
      ms = got.ms
      polls = got.count
      drawMs = got.burstMs
    } else {
      const settled = await settle(tStep, reference)
      ms = settled.ms
      polls = settled.polls
      shotCosts.push(settled.shotMs)
      reference = await shot()
    }

    const locus = await page.evaluate(({ tool, ref }) => {
      if (tool === 'genomespy') {
        const err = (window as any).__panError
        if (err) return `error: ${err}`
        // `getDomain()` is linearized genome coordinates. The corpus is one
        // contig at offset zero, so those are positions on it -- the same
        // assumption crosstool/genomespy.html makes when it zooms to the
        // benchmark window by {chrom, pos}. Nothing here has to trust it: the
        // runner cross-checks every step's locus against JBrowse's, so a
        // linearization offset would show up as a mismatch on every step
        // rather than as a plausible wrong number.
        const [lo, hi] = (window as any).gsApi
          .getScaleResolutionByName('pos')
          .getDomain()
        return `${ref}:${Math.round(lo)}-${Math.round(hi)}`
      }
      if (tool === 'igv') {
        const b = (window as any).igvBrowser
        const f = b.referenceFrameList?.[0]
        return f
          ? `${f.chr}:${Math.round(f.start)}-${Math.round(f.end)}`
          : (b.currentLoci?.() ?? '')
      }
      const v = (window as any).JBrowseSession.views[0]
      return (
        v.visibleLocStrings ??
        `${v.displayedRegions?.[0]?.refName ?? ''}:${Math.round(v.offsetPx * v.bpPerPx)}-${Math.round((v.offsetPx + v.width) * v.bpPerPx)}`
      )
    }, { tool, ref: REF })

    steps.push({
      step: i,
      ms,
      polls,
      drawMs,
      requests: stepRequests,
      bytes: stepBytes,
      locus,
      target,
      applied: true,
    })
    if (shotDir) {
      await page.screenshot({ path: path.join(shotDir, `${tool}-step${i}.png`) })
    }
  }
} catch (e) {
  failure = e instanceof Error ? e.message : String(e)
  if (shotDir) {
    await page
      .screenshot({ path: path.join(shotDir, `${tool}-error.png`) })
      .catch(() => {})
  }
}

const done = steps.filter(s => s.applied)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

const meanShot = shotCosts.length
  ? shotCosts.reduce((a, b) => a + b, 0) / shotCosts.length
  : Number.NaN
const floor = floorMs(meanShot)

console.log(
  JSON.stringify({
    tool,
    url,
    motion: MOTION,
    panDir: PAN_SIGN < 0 ? 'left' : 'right',
    steps,
    appliedSteps: done.length,
    medianMs: done.length ? median(done.map(s => s.ms)) : null,
    // The drawing alone, with the wait taken out. On a JBrowse zoom this is the
    // few milliseconds inside a flat ~504 ms, and quoting the 504 as a render
    // cost would be quoting a debounce.
    medianDrawMs: done.length ? median(done.map(s => s.drawMs)) : null,
    // Steps that issued no data request at all. Not a footnote: a step served
    // from cache is not the "both tools must fetch" case this benchmark claims
    // to be, and the report refuses to call such a row a comparison.
    cachedSteps: done.filter(s => s.requests === 0).length,
    // Whether this build could take the discrete path at all. Undefined for the
    // foreign tools, which have no such concept.
    settlesCoarseBlocks,
    totalRequests: done.reduce((n, s) => n + s.requests, 0),
    totalBytes: done.reduce((n, s) => n + s.bytes, 0),
    // What the instrument can and cannot resolve on this machine, this run.
    // A median at or near the floor means "too fast for this detector", which
    // is a different statement from a measured duration.
    instrument:
      INSTRUMENT === 'draws'
        ? { kind: 'draws', quietMs: QUIET_MS }
        : {
            kind: 'paint',
            pollMs: POLL_MS,
            stablePolls: STABLE_POLLS,
            meanShotMs: Number(meanShot.toFixed(1)),
            floorMs: Number(floor.toFixed(1)),
            // A step resolved in the detector's minimum number of polls was
            // faster than the detector, and its milliseconds are instrument
            // rather than measurement.
            stepsAtFloor: done.filter(s => s.polls <= STABLE_POLLS + 1).length,
          },
    failure,
  }),
)

await browser.close()
process.exit(failure && done.length === 0 ? 1 : 0)

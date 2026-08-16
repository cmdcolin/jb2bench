// Cross-tool pan: scroll sideways one full viewport at constant scale, and time
// how long each tool takes to put correct pixels back.
//
// Why a pan, and why this is the cross-tool measurement worth having. Every
// igv.js number in `results/crosstool.md` is a cold load, which folds together
// application boot, assembly resolution, fetch and draw — and boot is the part
// that has nothing to do with what a renderer does. A zoom is no better here:
// `results/crosstool-zoom.md` measures a JBrowse debounce rather than JBrowse's
// drawing (see the README section that retracts it). A pan at constant
// `bpPerPx` is the one interaction where **both** tools must go to the network
// for a region neither holds, the byte volume per step equals the initial
// render's, and the application is already up. What is left is the cost of
// turning bytes into pixels.
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
//   JBrowse — `horizontalScroll(±width)`, exactly what the JBrowse-vs-JBrowse
//     pan in `scripts/render/interaction.ts` does. Reusing the proven mechanism
//     avoids depending on a navigation API across four builds of differing
//     vintage.
//   igv — `search(locus)` against the locus sequence computed from the same
//     start and width.
//
// Both therefore visit the same regions by construction, and the run records
// where each actually landed so the claim is checkable rather than assumed. A
// step whose two tools disagree about the locus is reported, not averaged in.
//
// Usage: panprofile.ts <url> <jbrowse|igv> [screenshotDir]
// Prints JSON: per-step ms and landed locus.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

import {
  DRAW_CLOCK_INIT,
  DRAW_CLOCK_READ,
  DRAW_CLOCK_RESET,
} from './drawclock.ts'

const url = process.argv[2]
const tool = process.argv[3] as 'jbrowse' | 'igv'
const shotDir = process.argv[4]
if (!url || (tool !== 'jbrowse' && tool !== 'igv')) {
  throw new Error('usage: panprofile.ts <url> <jbrowse|igv> [screenshotDir]')
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
// How long without a canvas draw counts as done. Has to clear a rAF-driven
// redraw sequence without swallowing a refetch that lands later.
const QUIET_MS = Number(process.env.QUIET_MS ?? 400)

// Pan LEFT, for the reason interaction.ts documents at length: pbsim's long
// reads run off both ends of chr22_mask, so long-read depth tapers there, and
// panning right from the benchmark locus puts two of five steps on thinned data
// in both tools at once — which reads as a shared speedup rather than as a
// corpus artefact. Leftward keeps four of five inside the plateau.
const PAN_SIGN = process.env.PAN_DIR === 'right' ? 1 : -1

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
page.on('request', () => {
  inFlight++
})
page.on('requestfinished', () => {
  inFlight--
})
page.on('requestfailed', () => {
  inFlight--
})

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
      throw new Error(`no quiet draw within ${MAX_WAIT} ms`)
    }
    const got = (await page.evaluate(DRAW_CLOCK_READ)) as {
      count: number
      ms: number
      sinceLast: number
    }
    if (got.count > 0 && inFlight <= 0 && got.sinceLast > QUIET_MS) {
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

  for (let i = 1; i <= STEPS; i++) {
    const targetStart = START + PAN_SIGN * WIDTH * i
    const targetEnd = targetStart + WIDTH
    const target = `${REF}:${targetStart}-${targetEnd}`

    // Stop rather than clamp. JBrowse's maxOffset allows scrolling until only
    // ~200px of genome remains on screen, and a mostly-empty viewport scores
    // fast for the same reason a refusal does.
    if (targetStart < 0 || targetEnd > CONTIG_LENGTH) {
      break
    }

    // Reset the draw clock immediately before issuing the pan, so its zero is
    // the interaction and not the page load.
    await page.evaluate(DRAW_CLOCK_RESET)
    stepRequests = 0
    stepBytes = 0
    const tStep = Date.now()
    const applied = await page.evaluate(
      ({ tool, sign, locus }) => {
        if (tool === 'igv') {
          const b = (window as any).igvBrowser
          // Deliberately NOT awaited: search resolves on igv's own notion of
          // done, and the whole point of this instrument is not to ask a tool
          // when it has finished.
          ;(window as any).__panPromise = b.search(locus).catch((e: unknown) => {
            ;(window as any).__panError = String(e)
          })
          return true
        }
        const v = (window as any).JBrowseSession.views[0]
        const before = v.offsetPx
        v.horizontalScroll(sign * v.width)
        return v.offsetPx !== before
      },
      { tool, sign: PAN_SIGN, locus: target },
    )

    if (!applied) {
      steps.push({
        step: i,
        ms: Number.NaN,
        polls: 0,
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
    if (INSTRUMENT === 'draws') {
      const got = await drawsSettled(tStep)
      ms = got.ms
      polls = got.count
    } else {
      const settled = await settle(tStep, reference)
      ms = settled.ms
      polls = settled.polls
      shotCosts.push(settled.shotMs)
      reference = await shot()
    }

    const locus = await page.evaluate(tool => {
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
    }, tool)

    steps.push({
      step: i,
      ms,
      polls,
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
    panDir: PAN_SIGN < 0 ? 'left' : 'right',
    steps,
    appliedSteps: done.length,
    medianMs: done.length ? median(done.map(s => s.ms)) : null,
    // Steps that issued no data request at all. Not a footnote: a step served
    // from cache is not the "both tools must fetch" case this benchmark claims
    // to be, and the report refuses to call such a row a comparison.
    cachedSteps: done.filter(s => s.requests === 0).length,
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

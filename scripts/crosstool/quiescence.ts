// When is a genome browser finished?
//
// Every timing in this repository is the answer to that question, and almost
// every measurement error recorded in `README.md` is a wrong answer to it: the
// zoom-out benchmark that scored a refusal to draw as its best result, the
// release-2.4.0 column that read 0 ms on every case because its loading
// indicator says "Loading" and the pattern looked for "Downloading", the
// crosstool zoom that measured a 500 ms debounce, the pan that read 1.4 ms
// because the tool re-projected stale pixels before fetching. The detector is
// the instrument, and it has been the thing that broke far more often than the
// thing being measured.
//
// So it is a module with a stated contract rather than a loop inside whichever
// script needed it, and `quiescheck.ts` calibrates the strategies against each
// other on real pages instead of asserting that one is right.
//
// THREE STRATEGIES. None is correct in general; they fail differently, and the
// point of having them together is that a disagreement is visible.
//
//   draws   Patch the canvas drawing APIs, timestamp every call, and wait for a
//           quiet interval WITH nothing in flight on the network. Cheap
//           (an array push), tool-agnostic (asks the platform, not the app), and
//           high resolution.
//             Fails when: a page animates to canvas forever (never quiet); work
//             happens that never reaches a main-thread canvas; or — measured,
//             not hypothetical — a page keeps issuing draw calls after the
//             visible result has settled, which makes this read LATE rather
//             than early. On a JBrowse cold load `quiescheck.ts` put draws at
//             4792 ms against paint's 2346 ms.
//
//   paint   Poll a screenshot, hash it, wait for the hash to repeat and to
//           differ from a reference frame. The only strategy that sees actual
//           pixels. Its problem is resolution: one `page.screenshot()` on this
//           box has measured anywhere from 43 to 161 ms, so the detector's own
//           floor lands between roughly 450 and 1100 ms — comparable to the
//           whole of the interaction being timed.
//             Fails when: the interaction is faster than that floor. Usable for
//             cold load, where the floor is a small share of a multi-second
//             number and `results/crosstool.md` already treats it as a constant
//             offset applied to both columns.
//
//   idle    Wait for no network in flight and a quiet main thread. Says nothing
//           about pixels, so it is a lower bound and a cross-check, never a
//           headline.
//
// **Do not assume `draws` reads early and `paint` reads late.** That was the
// first thing written here and the calibration harness contradicted it within a
// run. What is established is that they disagree, in both directions, by
// hundreds of milliseconds; `quiescheck.ts` measures the disagreement so a
// report can state it rather than assume a sign for it.
import type { Page } from 'puppeteer'

import { DRAW_CLOCK_INIT, DRAW_CLOCK_READ, DRAW_CLOCK_RESET } from './drawclock.ts'

export type Strategy = 'draws' | 'paint' | 'idle'

export interface QuiescenceOptions {
  /**
   * ms without a canvas draw AND without network activity before `draws` calls
   * it done.
   *
   * **Must exceed the longest pause the application takes while still working**,
   * and 400 ms does not. Traced on a 1000x-shortread pan, JBrowse re-projects
   * the reads it already holds at t=6 ms, then sits completely idle for 501 ms —
   * that is the 500 ms `LGVCoarseDynamicBlocks` debounce `README.md` documents
   * elsewhere — then draws again at 507 ms, pauses ~300 ms between requests,
   * fetches from 1251 to 2069 ms, and finally draws the real content at
   * 2345 ms. A 400 ms gate opens twice during that, and the first time it does,
   * the step reports **42 ms** for work that took 2.3 s.
   *
   * 1000 ms clears the documented debounce with margin. Raising it costs wall
   * clock and **does not inflate the result**: what is reported is the timestamp
   * of the last draw, not the moment the detector became confident.
   */
  quietMs?: number
  /** ms between screenshots for `paint` */
  pollMs?: number
  /** repeats of an identical frame before `paint` calls it done */
  stablePolls?: number
  /** give up after this long */
  maxWaitMs?: number
}

export interface Settled {
  strategy: Strategy
  /** time from the start marker to completion, ms */
  ms: number
  /** canvas draw calls observed (draws), or detector polls (paint) */
  events: number
  /** data-file responses seen during the window */
  requests: number
  /** their content-length total */
  bytes: number
  /**
   * True when the number is at or below what this detector can resolve, so it
   * means "faster than the instrument" rather than a duration. Only `paint`
   * can report this; `draws` has no meaningful floor at these timescales.
   */
  atFloor: boolean
}

const DATA_RE = /\.(bam|bai|cram|crai|bw|fa|fai|vcf|gz|tbi)(\?|$)/

/**
 * Attach the detectors to a page. Call BEFORE `page.goto`: the draw clock has to
 * wrap the canvas prototypes before the tool creates a rendering context, and
 * the network counters have to see the first request.
 */
export async function attachQuiescence(page: Page, opts: QuiescenceOptions = {}) {
  const quietMs = opts.quietMs ?? 1000
  const pollMs = opts.pollMs ?? 150
  const stablePolls = opts.stablePolls ?? 5
  const maxWaitMs = opts.maxWaitMs ?? 120000

  await page.evaluateOnNewDocument(DRAW_CLOCK_INIT)

  // In-flight tracking comes from CDP, not from a patched `fetch`. JBrowse
  // fetches in a worker, so a page-side hook sees igv's requests and none of
  // JBrowse's — the same asymmetry that makes screenshots unusable here,
  // arrived at from a different direction.
  let inFlight = 0
  let requests = 0
  let bytes = 0
  // Not just "is anything in flight right now" but "when did anything last
  // happen". A tool that fetches in bursts drops to zero in flight between them,
  // and an instantaneous test treats that as finished — traced at 1000x, one
  // such lull lasted ~300 ms.
  let lastNetwork = 0
  page.on('request', () => {
    inFlight++
    lastNetwork = Date.now()
  })
  const done = () => {
    inFlight--
    lastNetwork = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  page.on('response', res => {
    if (!DATA_RE.test(res.url())) return
    requests++
    const len = Number(res.headers()['content-length'] ?? 0)
    if (Number.isFinite(len)) bytes += len
  })

  const { createHash } = await import('node:crypto')
  const shot = async () => {
    const t = Date.now()
    const buf = await page.screenshot({ type: 'png', optimizeForSpeed: true })
    return {
      hash: createHash('sha1').update(buf).digest('hex'),
      costMs: Date.now() - t,
    }
  }

  return {
    /**
     * Zero the counters. Call immediately before the interaction under test —
     * but NOT before the first navigation: the draw clock is installed by
     * `evaluateOnNewDocument`, so it does not exist until the document does, and
     * it stamps its own start there. For a cold load that stamp already is
     * navigation time, so the load phase wants no mark at all.
     */
    async mark() {
      requests = 0
      bytes = 0
      lastNetwork = Date.now()
      await page
        .evaluate(DRAW_CLOCK_RESET)
        .catch(() => undefined /* no document yet */)
      return Date.now()
    },

    /** A reference frame for `paint`, so "unchanged" can be distinguished. */
    reference: async () => (await shot()).hash,

    /** What one screenshot costs on this page — the `paint` floor's main term. */
    async screenshotCost() {
      const runs = [await shot(), await shot(), await shot()]
      return runs.reduce((n, r) => n + r.costMs, 0) / runs.length
    },

    async settle(strategy: Strategy, t0: number, reference = ''): Promise<Settled> {
      if (strategy === 'draws' || strategy === 'idle') {
        for (;;) {
          if (Date.now() - t0 > maxWaitMs) {
            throw new Error(`${strategy}: no quiescence within ${maxWaitMs} ms`)
          }
          const c = (await page.evaluate(DRAW_CLOCK_READ)) as {
            count: number
            ms: number
            sinceLast: number
          }
          // Three conditions, not one. Nothing in flight, nothing having
          // *recently* been in flight, and nothing drawn recently — a tool that
          // pauses between bursts satisfies any one of these while still
          // working.
          const networkQuiet = inFlight <= 0 && Date.now() - lastNetwork > quietMs
          if (strategy === 'idle') {
            if (networkQuiet && Date.now() - t0 > quietMs) {
              return {
                strategy,
                ms: Date.now() - t0,
                events: c.count,
                requests,
                bytes,
                atFloor: false,
              }
            }
          } else if (c.count > 0 && networkQuiet && c.sinceLast > quietMs) {
            return {
              strategy,
              ms: c.ms,
              events: c.count,
              requests,
              bytes,
              atFloor: false,
            }
          }
          await new Promise(r => setTimeout(r, 50))
        }
      }

      // paint
      let last = ''
      let stable = 0
      let polls = 0
      for (;;) {
        if (Date.now() - t0 > maxWaitMs) {
          throw new Error(`paint: no stable frame within ${maxWaitMs} ms`)
        }
        const { hash } = await shot()
        polls++
        if (hash === last && hash !== reference) {
          stable++
        } else {
          stable = 0
          last = hash
        }
        if (stable >= stablePolls) {
          return {
            strategy: 'paint',
            // subtract the settle window: the number should be
            // time-to-last-paint, not time-to-detector-confidence
            ms: Date.now() - t0 - stablePolls * pollMs,
            events: polls,
            requests,
            bytes,
            // resolved in the minimum possible number of polls, so the
            // interaction was faster than the detector and this is instrument
            atFloor: polls <= stablePolls + 1,
          }
        }
        await new Promise(r => setTimeout(r, pollMs))
      }
    },
  }
}

/**
 * The smallest number `paint` can report on a page whose screenshot costs
 * `shotMs`. Anything at or near it is "below the floor", not "fast".
 */
export const paintFloorMs = (shotMs: number, pollMs = 150, stablePolls = 5) =>
  (stablePolls + 1) * (pollMs + shotMs) - stablePolls * pollMs

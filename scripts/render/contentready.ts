// "Is the rendered content back yet?" — asked structurally, of any build, with
// no knowledge of what words that build puts on a spinner.
//
// This is the loading indicator `interaction.ts` uses. It replaces a text match
// against document.body.innerText, which cannot be made to work across build
// generations. Both of that approach's failure modes were real and are recorded
// here so nobody reintroduces it:
//
//   - the narrow pattern (/Downloading|Loading alignments|Rendering/) misses
//     release-2.4.0, which labels a refetching block plain "Loading". An
//     indicator that goes unmatched reads as "content was never missing", so the
//     build scores 0 ms — indistinguishable from a build that genuinely had
//     nothing to refetch, and the flattering direction to be wrong in.
//   - the wide pattern (adding /\bLoading\b/) matches release-4.3.0
//     PERMANENTLY: 4.3.0 sitting fully rendered and idle still carries four
//     "Loading" strings in its innerText. Every step then runs to MAX_WAIT.
//
// The per-build fallback that tried to square this — sample the wide pattern
// once at rest, fall back to narrow on a build it already matches — depends on
// the page being genuinely at rest when it samples, and on release-2.4.0
// `rendercomplete.ts` reports "at rest" with one block of six painted. So the
// fallback picked the narrow pattern for 2.4.0 in seven of twelve cells, and
// those cells recorded 0 ms with `loadingEverSeen: false`. Measured 2026-08-25:
// 200x-longread-bam tears its block set down at the zoom and takes ~6 s to
// rebuild it, and the recorded figure for that cell is 0 ms.
//
// WHAT THIS ASKS INSTEAD. Every build says structurally how much of the view it
// has finished, and the two generations say it in two different ways:
//
//   phase     builds from the DisplayChrome work publish `data-display-phase`
//             on each display and `data-display-drawn="false"` until the canvas
//             is painted. Outstanding work is any display in phase "loading" or
//             any undrawn one.
//   blockset  older builds (4.3.0 and 2.4.0 both) mount a `Blockset-*` container
//             per display whose children are the blocks of the current view.
//             A block that has finished contains a `…_done` marker; one that has
//             not, does not. Outstanding work is blocks minus finished blocks.
//
// Both generations tear the whole set down on a refetch and build it back, so
// "outstanding > 0" covers the gap from the interaction to the last block
// arriving. Measured on 200x-longread-bam: at the zoom both legacy builds drop
// every block, then rebuild over seconds; the current build changes nothing at
// all across 734 samples in 20 s, because it re-projects a buffer it already
// holds — which is why it reads 0 ms here, structurally rather than by a regex
// happening to miss.
//
// WHY NOT "HAS THE DOM STOPPED CHANGING". That was the first attempt and it is
// wrong in a way worth recording: block markers appear one at a time with
// seconds between them under load, so a detector that waits for a quiet window
// declares content back in the GAP BETWEEN TWO BLOCKS. On release-2.4.0 that
// ended the warmup step early, the next zoom fired on a half-rendered page, and
// the track was blank for the rest of the run while every step recorded 0 ms.
// Absence of change is not completion; only a positive count of outstanding work
// is.
import type { Page } from 'puppeteer'

export type Contract = 'phase' | 'blockset' | 'none'

export interface Readiness {
  contract: Contract
  ready: boolean
  /** units of view still to render; -1 when nothing has mounted */
  outstanding: number
  /** total units the current view is made of */
  units: number
  /**
   * Identity of the finished blocks. The legacy marker is region-keyed —
   * `prerendered_canvas_{hg19mod}chr22_mask:119891..131879-0_done` — so this
   * changes whenever the view moves, which is what lets a caller tell "the build
   * has not reacted yet" from "the build had nothing to do". Empty under the
   * phase contract, which publishes no per-block identity.
   */
  doneKeys: string
  /** bp of the current view no finished block covers; NaN if not measurable */
  uncoveredBp: number
}

/**
 * Runs in the page. Self-contained — puppeteer serializes it, so it closes over
 * nothing.
 */
export function contentReadyProbe(): Readiness {
  // A loading overlay is authoritative wherever a build draws one, and cheap.
  const overlays = document.querySelectorAll(
    '[data-testid="loading-overlay"]',
  ).length

  // Where the view is now, in bp. Read from the same three view fields
  // `interaction.ts` drives, which every build in the matrix exposes. Used to
  // decide whether a finished block belongs to the CURRENT view or is left over
  // from the one before it — the difference between "content is back" and "the
  // build has not started yet".
  let viewStart = Number.NaN
  let viewEnd = Number.NaN
  try {
    const v = (globalThis as unknown as {
      JBrowseSession?: {
        views?: {
          bpPerPx: number
          width: number
          offsetPx: number
          displayedRegionsTotalPx: number
        }[]
      }
    }).JBrowseSession?.views?.[0]
    if (v) {
      // Clamped to the displayed regions: at either end of the contig the view
      // runs past the sequence, and no block will ever cover the overhang.
      const total = v.displayedRegionsTotalPx * v.bpPerPx
      viewStart = Math.max(0, v.offsetPx * v.bpPerPx)
      viewEnd = Math.min(total, (v.offsetPx + v.width) * v.bpPerPx)
    }
  } catch {
    // a build that does not expose the view falls back to counting alone
  }

  const phaseNodes = document.querySelectorAll('[data-display-phase]')
  if (phaseNodes.length > 0) {
    const outstanding =
      document.querySelectorAll(
        '[data-display-phase="loading"],[data-display-drawn="false"]',
      ).length + overlays
    return {
      contract: 'phase',
      ready: outstanding === 0,
      outstanding,
      units: phaseNodes.length,
      doneKeys: '',
      uncoveredBp: 0,
    }
  }

  // Prefer the phase contract where both exist: it is the more precise of the
  // two, and a build mid-migration could publish each on a different display.
  const blocksets = [...document.querySelectorAll('[data-testid^="Blockset"]')]
  if (blocksets.length > 0) {
    // COVERAGE, not a count of finished blocks. The marker names the region it
    // drew — `prerendered_canvas_{hg19mod}chr22_mask:119891..131879-0_done` — so
    // the question "is the content back" is answerable exactly: do the finished
    // regions cover the region on screen?
    //
    // Counting was the previous rule and it is wrong in both directions.
    // Measured on release-2.4.0, 2026-08-25, view 124001..143002: the blockset
    // held ONE child, finished, covering 119891..131879 — the left half of the
    // view. Every child was done, so counting called it ready with half the
    // screen unrendered. Panning one viewport LEFT to 105000..124001 then left
    // that same block overlapping the new view, so an overlap test called it
    // ready too, and the step recorded 0 ms for a pan that had not begun.
    //
    // Markers are read from the whole document rather than from blockset
    // children: 2.4.0 keeps finished canvases outside the blockset it mounts
    // them under, so the children are a subset of what has actually rendered.
    const markers = [
      ...document.querySelectorAll('[data-testid$="_done"],[data-testid$="-done"]'),
    ].map(e => (e as HTMLElement).dataset.testid ?? '?')

    let units = 0
    for (const set of blocksets) {
      units += set.children.length
    }

    const spans: number[][] = []
    let unparseable = 0
    for (const id of markers) {
      const m = /:(\d[\d,]*)\.\.(\d[\d,]*)/.exec(id)
      if (m) {
        spans.push([
          Number(m[1]!.replace(/,/g, '')),
          Number(m[2]!.replace(/,/g, '')),
        ])
      } else {
        unparseable++
      }
    }

    // A build that renames its markers degrades to the old count rule rather
    // than stalling forever on a coverage test it can never satisfy.
    const canMeasureCoverage =
      unparseable === 0 &&
      spans.length > 0 &&
      Number.isFinite(viewStart) &&
      Number.isFinite(viewEnd) &&
      viewEnd > viewStart

    let uncovered = Number.NaN
    if (canMeasureCoverage) {
      spans.sort((a, b) => a[0]! - b[0]!)
      // Walk the merged spans and add up what they leave out of the view.
      let gap = 0
      let at = viewStart
      for (const [from, to] of spans) {
        if (to! < at) {
          continue
        }
        if (from! > at) {
          gap += Math.min(from!, viewEnd) - at
        }
        at = Math.max(at, to!)
        if (at >= viewEnd) {
          break
        }
      }
      if (at < viewEnd) {
        gap += viewEnd - at
      }
      uncovered = gap
    }

    // One display's worth of slack. Block edges are on a grid and the view is
    // fractional, so an exact comparison flags a few bp of rounding as a hole.
    const SLACK_BP = 2
    const covered = canMeasureCoverage && uncovered <= SLACK_BP
    const done = markers.length - unparseable
    const outstanding = canMeasureCoverage
      ? (covered ? 0 : 1) + overlays
      : units - done + overlays
    return {
      contract: 'blockset',
      ready: canMeasureCoverage
        ? covered && overlays === 0
        : units > 0 && outstanding === 0,
      outstanding,
      units,
      doneKeys: [...markers].sort().join(','),
      uncoveredBp: uncovered,
    }
  }

  // Nothing has mounted yet — which is "not ready", not "this build publishes
  // no contract".
  return {
    contract: 'none',
    ready: false,
    outstanding: -1,
    units: 0,
    doneKeys: '',
    uncoveredBp: Number.NaN,
  }
}

/** Content counts as back once it has stayed ready this long. */
export const QUIET_MS = Number(process.env.QUIET_MS ?? 400)
export const POLL_MS = 20

export interface Settled {
  /** ms from the call to the last moment content was NOT ready; 0 if it always was */
  notReadyUntilMs: number
  /** was content ever not ready — the structural "a loading indicator was seen" */
  wasBusy: boolean
  /** the deadline expired with work still outstanding: the value is a lower bound */
  censored: boolean
  contract: Contract
  /** most work seen outstanding at once, for a run log */
  peakOutstanding: number
  /** did the build visibly react to the interaction at all */
  acknowledged: boolean
}

/**
 * How long a build is given to visibly react to the interaction before "it is
 * still ready" is taken at face value.
 *
 * Without it there is a race in the flattering direction. Tearing the block set
 * down is asynchronous, so the first polls after a pan can still see the OLD
 * view fully rendered; if that lasts past `quietMs` the step reports 0 ms and
 * "never busy" for work that had not started. Observed on release-2.4.0,
 * 2026-08-25: one pan step of five read 0 ms while its four siblings read 0.7 to
 * 17 s.
 *
 * This is a grace period, not padding: it delays the EARLIEST RETURN, and never
 * counts as time-to-content, so a build that genuinely had nothing to do still
 * reports 0.
 */
export const ACK_MS = Number(process.env.ACK_MS ?? 750)

/**
 * Polls until content has been ready for `quietMs`, and reports when it was last
 * not.
 *
 * The reported time is the LAST NOT-READY moment, not the moment quiet was
 * confirmed, so the quiet window does not add itself to every measurement: a
 * build that was ready throughout reports 0 rather than `quietMs`. That is the
 * whole point for a zoom that re-projects without refetching.
 *
 * `baselineKeys` is the finished-block identity from before the interaction.
 * A build that has swapped in blocks for the new region has reacted even if it
 * never showed a gap, which is the case a pure outstanding-count would miss.
 */
export async function waitForContentReady(
  page: Page,
  {
    quietMs = QUIET_MS,
    timeoutMs = 120000,
    ackMs = ACK_MS,
    baselineKeys = undefined as string | undefined,
  } = {},
): Promise<Settled> {
  const start = Date.now()
  let notReadyUntil = 0
  let wasBusy = false
  let peak = 0
  let contract: Contract = 'none'
  let acknowledged = baselineKeys === undefined
  for (;;) {
    const r = await page.evaluate(contentReadyProbe)
    const elapsed = Date.now() - start
    contract = r.contract
    peak = Math.max(peak, r.outstanding)
    if (!r.ready) {
      wasBusy = true
      notReadyUntil = elapsed
    }
    if (!acknowledged && (!r.ready || r.doneKeys !== baselineKeys)) {
      acknowledged = true
    }
    const settled = elapsed - notReadyUntil >= quietMs && elapsed >= quietMs
    if (settled && (acknowledged || elapsed >= ackMs)) {
      return {
        notReadyUntilMs: notReadyUntil,
        wasBusy,
        censored: false,
        contract,
        peakOutstanding: peak,
        acknowledged,
      }
    }
    if (elapsed >= timeoutMs) {
      return {
        notReadyUntilMs: notReadyUntil,
        wasBusy,
        censored: wasBusy,
        contract,
        peakOutstanding: peak,
        acknowledged,
      }
    }
    await new Promise(r2 => setTimeout(r2, POLL_MS))
  }
}

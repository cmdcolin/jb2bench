// When has a JBrowse build finished its initial render?
//
// Shared by `profile.ts` (cold load) and `interaction.ts` (zoom and pan),
// because the two asked the same question and only one of them kept up.
//
// **The two build generations publish DISJOINT contracts.** Older builds mark
// each display `data-testid="…-done"`; builds from the DisplayChrome work
// publish `data-display-phase` and `data-display-drawn` instead and emit no
// `-done` node at all. A detector that knows only the legacy form waits the full
// timeout against a current build and then fails — which is exactly what
// happened: `interaction.ts` carried a copy of the legacy poll under a comment
// claiming it was "the same quiescence detector as profile.ts", profile.ts grew
// the second contract, and the copy did not. From the 2026-08-18 restaging of
// `builds/current` the interaction matrix could not measure the build under
// test at all, 120 s per cell, and nothing said so because the failure looked
// like a slow machine.
//
// Hence one module. A detector duplicated between two runners is a detector
// that will disagree with itself, and this one already did.
//
// **COMPLETION IS COVERAGE, NOT QUIET.** Until 2026-09-06 the legacy branch here
// asked whether the count of finished markers had held still for five polls.
// The old renderer finishes one block at a time, so any half-second gap between
// two blocks satisfies that — and the wider the window, the more gaps there are
// to be fooled by. Measured on release-2.4.0 at a 1 Mb window: this returned
// after 14 s with ONE of seven blocks painted and "Downloading alignments"
// across the other six, and the screenshot proves it. The build was then
// credited with a 14 s render it had not done, and the speedup against it came
// out correspondingly small — the flattering direction for the older build and
// the one a benchmark must never be quietly wrong in.
//
// contentready.ts already answers this properly, and its header already said
// this branch was broken: the legacy marker names the region it drew, so
// "is the content back" is answerable as "do the finished regions cover the
// region on screen". That is what runs here now, for both generations, and it
// is the same probe zoom and pan have used since 2026-08-25 — one definition of
// finished for every measurement in this repo.
import type { Page } from 'puppeteer'
import { contentReadyProbe, type Contract } from './contentready.ts'

export const WAIT_TIMEOUT = Number(process.env.WAIT_TIMEOUT ?? 120000)
export const POLL_MS = 100
export const STABLE_POLLS = 5

/**
 * The session gate: views exist and none reports itself uninitialized.
 *
 * This mirrors `waitForSession` from `@jbrowse/capture`, which is the maintained
 * implementation of the whole problem and has more stages than this. It is NOT
 * imported, because that package's `exports` resolves to `./src/index.ts` while
 * its `files` ships only `esm/` — so the bare specifier lands on TypeScript
 * inside node_modules, which node refuses to strip
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and the built output is
 * unreachable through the exports map (ERR_PACKAGE_PATH_NOT_EXPORTED). If that
 * is fixed — @jbrowse/img is the sibling that has it right — replace this with
 * `waitForSession(page, { timeout: WAIT_TIMEOUT })` and take its other stages.
 */
function sessionReady() {
  const session = (
    globalThis as { JBrowseSession?: { views?: { initialized?: boolean }[] } }
  ).JBrowseSession
  const views = session?.views
  if (!views?.length) {
    return false
  }
  // `initialized` is an LGV getter; a view type without one is mounted content
  // the moment it exists, so absent counts as initialized and only an explicit
  // false is pending.
  return !views.some(v => v.initialized === false)
}

/**
 * Waits for the session, then for every block of the view to be drawn.
 *
 * Polled from here rather than through `page.waitForFunction`, because the probe
 * is shared with the motion runners and a serialized predicate cannot call it.
 * Returns which contract fired, so a row measured under a different one from its
 * neighbours is visible rather than silently incomparable.
 */
export async function waitForRenderComplete(
  page: Page,
  { timeout = WAIT_TIMEOUT, stableNeeded = STABLE_POLLS } = {},
): Promise<Contract> {
  await page.waitForFunction(sessionReady, { timeout, polling: POLL_MS })
  const deadline = Date.now() + timeout
  let stable = 0
  for (;;) {
    const r = await page.evaluate(contentReadyProbe)
    stable = r.ready ? stable + 1 : 0
    if (stable >= stableNeeded) {
      return r.contract
    }
    if (Date.now() > deadline) {
      // What was still outstanding, because "120000ms exceeded" sends you
      // looking at the machine when the answer is usually on the page.
      throw new Error(
        `render did not complete in ${timeout}ms: contract ${r.contract}, ` +
          `${r.outstanding} of ${r.units} outstanding` +
          (Number.isFinite(r.uncoveredBp)
            ? `, ${Math.round(r.uncoveredBp)} bp of the view uncovered`
            : ''),
      )
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

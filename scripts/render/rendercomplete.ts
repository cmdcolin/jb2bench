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
import type { Page } from 'puppeteer'

export const WAIT_TIMEOUT = Number(process.env.WAIT_TIMEOUT ?? 120000)
export const POLL_MS = 100
export const STABLE_POLLS = 5

/**
 * Runs in the page. Self-contained on purpose — puppeteer serializes it, so it
 * can close over nothing and takes what it needs as an argument.
 *
 * Decides the contract *inside* the poll rather than sampling it first. Sampling
 * was the first attempt and it is wrong: at the moment the session gate opens no
 * display has mounted, so neither signal is present yet and every build looks
 * like it publishes nothing.
 */
export function renderCompletePredicate({ stableNeeded }: { stableNeeded: number }) {
  const w = window as unknown as {
    __stable?: number
    __last?: number
    __mode?: string
  }
  const phaseNodes = document.querySelectorAll('[data-display-phase]').length
  const legacyNodes = document.querySelectorAll(
    '[data-testid$="-done"],[data-testid$="_done"]',
  ).length

  let ready: boolean
  let count: number
  if (phaseNodes > 0) {
    // DisplayChrome publishes data-display-phase from the model's own
    // mutually-exclusive DisplayPhase, whose `loading` covers the whole fetch,
    // and data-display-drawn="false" until the canvas is painted. Both, because
    // the first says the data arrived and the second says it was drawn.
    w.__mode = 'phase'
    count = phaseNodes
    ready =
      document.querySelector('[data-display-phase="loading"]') === null &&
      document.querySelector('[data-display-drawn="false"]') === null
  } else if (legacyNodes > 0) {
    w.__mode = 'legacy'
    count = legacyNodes
    ready = true
  } else {
    // nothing has mounted yet — not "this build has no contract"
    w.__stable = 0
    w.__last = -1
    return false
  }
  const loading =
    document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
  ready = ready && !loading
  if (ready && count === w.__last) {
    w.__stable = (w.__stable ?? 0) + 1
  } else {
    w.__stable = 0
    w.__last = count
  }
  return ready && (w.__stable ?? 0) >= stableNeeded
}

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
 * Waits for the session, then for the initial render to go quiescent.
 *
 * Returns which contract fired, so a row measured under a different one from its
 * neighbours is visible rather than silently incomparable.
 */
export async function waitForRenderComplete(
  page: Page,
  { timeout = WAIT_TIMEOUT, stableNeeded = STABLE_POLLS } = {},
): Promise<'phase' | 'legacy' | 'unknown'> {
  await page.waitForFunction(sessionReady, { timeout, polling: POLL_MS })
  await page.waitForFunction(
    renderCompletePredicate,
    { timeout, polling: POLL_MS },
    { stableNeeded },
  )
  return page.evaluate(
    () => (window as unknown as { __mode?: string }).__mode ?? 'unknown',
  ) as Promise<'phase' | 'legacy' | 'unknown'>
}

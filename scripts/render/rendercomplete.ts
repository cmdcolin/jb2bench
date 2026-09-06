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
import { treeStats } from './proctree.ts'

export const WAIT_TIMEOUT = Number(process.env.WAIT_TIMEOUT ?? 120000)
export const POLL_MS = 100
export const STABLE_POLLS = 5

/**
 * How long a page may make no progress before the run is called stalled.
 *
 * A ceiling answers "how long am I willing to wait"; it does not answer "is
 * anything still happening". Those are different questions, and the gap between
 * them is where a benchmark spends its evening: a page that loaded and then did
 * nothing at all is indistinguishable from a slow one until the ceiling
 * expires, twice, per run. Measured 2026-09-06, release-2.4.0 at the 1 Mb
 * window did exactly that — renderers at 0% CPU and 70 MB, nothing fetched —
 * and it cost thirteen minutes of silence per cell to find out.
 *
 * Progress is anything: a block finishing, a display changing phase, a byte
 * arriving. NOT the absence of it while the page is busy — a build that holds
 * the main thread for two minutes is working, and the poll that blocks behind
 * it is the evidence. So the stall test asks for all three: nothing changed,
 * nothing on the wire, and the page answered promptly when asked.
 */
export const STALL_MS = Number(process.env.STALL_MS ?? 60000)
/** A poll that took longer than this means the page was busy, not idle. */
const RESPONSIVE_MS = 1000
/** How often the watchdog samples the browser's CPU. */
const WATCH_MS = 5000
/**
 * CPU-seconds the browser must burn across a stall window to count as working.
 *
 * Small: this is telling "rendering hard" apart from "doing nothing at all",
 * and the second one burns essentially zero. A tenth of a second over a minute
 * is not a render by any measure.
 */
const BUSY_CPU_S = 0.1

export async function waitForRenderComplete(
  page: Page,
  { timeout = WAIT_TIMEOUT, stableNeeded = STABLE_POLLS } = {},
): Promise<Contract> {
  // Bytes are progress even before a block finishes, so the stall test can tell
  // a page that is fetching slowly from one that has stopped.
  let responses = 0
  const seen = () => responses++
  page.on('response', seen)
  // The watchdog runs BESIDE the poll rather than inside it, because the poll
  // is the thing that can hang. Whichever settles first wins: a finished
  // render, a ceiling, or a browser that has stopped doing anything at all.
  const watch = watchdog(page, () => responses)
  try {
    return await Promise.race([
      poll(page, timeout, stableNeeded, () => responses),
      watch.stalled,
    ])
  } finally {
    watch.stop()
    page.off('response', seen)
  }
}

/**
 * Rejects when the browser has burned no CPU and moved no bytes for STALL_MS.
 *
 * This is the "is anything still happening" question, asked of the operating
 * system rather than of the page. It is not a second ceiling: a build that
 * holds the main thread for two minutes is burning CPU the whole time and this
 * never fires on it. What it catches is the other thing — a tab that loaded,
 * did some of the work and stopped, which on this corpus costs the ceiling
 * twice per run and reports nothing but FAIL.
 */
function watchdog(page: Page, responses: () => number) {
  const pid = page.browser().process()?.pid
  let stop = () => {}
  const stalled = new Promise<never>((_, reject) => {
    if (!pid) {
      return // a browser we did not spawn is one we cannot watch
    }
    let lastCpu = treeStats(pid).cpuSeconds
    let lastResponses = responses()
    let idleSince = Date.now()
    const timer = setInterval(() => {
      const cpu = treeStats(pid).cpuSeconds
      const busy = cpu - lastCpu > BUSY_CPU_S || responses() !== lastResponses
      lastCpu = cpu
      lastResponses = responses()
      if (busy) {
        idleSince = Date.now()
        return
      }
      const idleFor = Date.now() - idleSince
      if (idleFor > STALL_MS) {
        clearInterval(timer)
        reject(
          new Error(
            `stalled: the browser has used no CPU and received nothing for ` +
              `${(idleFor / 1000).toFixed(0)}s. The page is not slow, it has ` +
              `stopped — measured, not waited out.`,
          ),
        )
      }
    }, WATCH_MS)
    timer.unref()
    stop = () => clearInterval(timer)
  })
  // Nothing may ever settle this promise, and an unhandled rejection on the
  // losing side of a race is still an unhandled rejection.
  stalled.catch(() => {})
  return { stalled, stop: () => stop() }
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

async function poll(
  page: Page,
  timeout: number,
  stableNeeded: number,
  responses: () => number,
): Promise<Contract> {
  await page.waitForFunction(sessionReady, { timeout, polling: POLL_MS })
  const deadline = Date.now() + timeout
  let stable = 0
  // What the page looked like when it last changed, and when that was.
  let mark = ''
  let changed = Date.now()
  for (;;) {
    const asked = Date.now()
    const r = await page.evaluate(contentReadyProbe)
    const answeredIn = Date.now() - asked
    stable = r.ready ? stable + 1 : 0
    if (stable >= stableNeeded) {
      return r.contract
    }
    const now = `${r.contract}|${r.outstanding}|${r.units}|${r.doneKeys}|${responses()}`
    if (now !== mark) {
      mark = now
      changed = Date.now()
    } else if (
      Date.now() - changed > STALL_MS &&
      answeredIn < RESPONSIVE_MS
    ) {
      // Not a timeout: a timeout says the ceiling ran out, and this says the
      // page stopped. The distinction is the whole point — one is a slow render
      // worth waiting for and the other is minutes of nothing.
      throw new Error(
        `stalled: no progress for ${((Date.now() - changed) / 1000).toFixed(0)}s ` +
          `and the page answers immediately — contract ${r.contract}, ` +
          `${r.outstanding} of ${r.units} outstanding, ` +
          `${responses()} responses received` +
          (Number.isFinite(r.uncoveredBp)
            ? `, ${Math.round(r.uncoveredBp)} bp of the view uncovered`
            : ''),
      )
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

// Cold-start render profiler. Emits the in-page elapsed time (ms) from
// navigation start to a fully painted track, isolating fetch+render from the
// ~constant browser-launch overhead that otherwise dominates light loads.
//
// Render-complete detection spans two generations of jbrowse, which publish
// DISJOINT signals — verified against the builds in builds/ on 2026-08-12:
//
//   release-4.3.0   4 legacy [data-testid$="-done"], no phase attributes
//   current main    1 [data-display-phase] + [data-display-drawn], no markers
//
// This file used to wait on the legacy markers alone, and the comment here said
// that worked for both. It does not, and had stopped being true: against a build
// from current main it finds zero markers and every row times out at 120 s. So
// the contract is detected per build and the matching wait used, and a build
// publishing NEITHER is failed rather than timed — the failure mode of guessing
// is not an error but a vacuous gate that returns ~0 ms and looks like the
// fastest build in the table.
//
// In front of both sits `@jbrowse/capture`'s session gate. Every signal above is
// negative (no overlay, no unpainted display, no unstable count) and therefore
// passes on a page whose JavaScript has not run; the session gate is positive,
// so a 404ed config fails loudly instead of reporting a very fast empty render.
// That package is the maintained implementation of this problem — prefer adding
// stages from it over hand-rolling more waits here.
//
// Runs headless by default but still on the real hardware GPU: on this box
// `--use-angle=gl` makes headless Chrome render WebGL2 through ANGLE on the Mesa
// Intel UHD 630 (verified via scripts/gpucheck.ts), not the SwiftShader
// software fallback that plain headless would pick. Set HEADLESS=0 to watch it
// run on the X display instead.
//
// Usage: profile.ts <url> [screenshotPath]
// Prints: a single floating-point millisecond value on stdout (or "FAIL").
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

const WAIT_TIMEOUT = 120000
const POLL_MS = 100
const STABLE_POLLS = 5

const url = process.argv[2]
const screenshotPath = process.argv[3]
if (!url) {
  throw new Error('usage: profile.ts <url> [screenshot]')
}
if (screenshotPath) {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
}

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

const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })

try {
  // The positive gate, before any readiness signal is consulted. Every signal
  // below is NEGATIVE — no loading overlay, no unpainted display, no unstable
  // marker count — so every one of them passes on a page whose JavaScript has
  // not run, and a build that 404s its config would report a very fast render of
  // nothing.
  //
  // This mirrors `waitForSession` from `@jbrowse/capture`, which is the
  // maintained implementation of the whole problem and has more stages than
  // this (view phases, quiescence, a paint contract). It is NOT imported,
  // because that package's `exports` resolves to `./src/index.ts` while its
  // `files` ships only `esm/` — so the bare specifier lands on TypeScript
  // inside node_modules, which node refuses to strip
  // (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and the built output is
  // unreachable through the exports map (ERR_PACKAGE_PATH_NOT_EXPORTED). If
  // that is fixed — @jbrowse/img is the sibling that has it right — replace
  // this block with `waitForSession(page, { timeout: WAIT_TIMEOUT })` and take
  // the rest of its stages too.
  await page.waitForFunction(
    () => {
      const session = (
        globalThis as { JBrowseSession?: { views?: { initialized?: boolean }[] } }
      ).JBrowseSession
      const views = session?.views
      if (!views?.length) {
        return false
      }
      // `initialized` is an LGV getter; a view type without one is mounted
      // content the moment it exists, so absent counts as initialized and only
      // an explicit false is pending.
      return !views.some(v => v.initialized === false)
    },
    { timeout: WAIT_TIMEOUT, polling: POLL_MS },
  )

  // Which render-complete contract does this build publish? The two generations
  // are DISJOINT — see the header — so the contract is decided inside the poll
  // rather than sampled before it. Sampling was the first attempt and it is
  // wrong: at the moment the session gate opens no display has mounted, so
  // neither signal is present yet and every build looks like it publishes
  // nothing.
  await page.waitForFunction(
    ({ stableNeeded }: { stableNeeded: number }) => {
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
        // mutually-exclusive DisplayPhase, whose `loading` covers the whole
        // fetch, and data-display-drawn="false" until the canvas is painted.
        // Both, because the first says the data arrived and the second says it
        // was drawn.
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
    },
    { timeout: WAIT_TIMEOUT, polling: POLL_MS },
    { stableNeeded: STABLE_POLLS },
  )
  // Which one actually fired, so a row measured under a different contract than
  // its neighbours is visible rather than silently incomparable. Goes to stderr:
  // runner.ts reads the last line of stdout as the number.
  const mode = await page.evaluate(
    () => (window as unknown as { __mode?: string }).__mode ?? 'unknown',
  )
  console.error(`render-complete contract: ${mode}`)
  // subtract the quiescence settle window so the number reflects time to the
  // last paint, not the detector's confirmation delay (constant, but removing
  // it makes the metric mean what it says)
  const elapsed = Date.now() - t0 - STABLE_POLLS * POLL_MS
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath })
  }
  console.log(elapsed.toFixed(1))
} catch (e) {
  // A timeout with no display mounted at all is almost always a trackId the
  // config does not define, not a slow render — the session gate passes (the
  // view initialized fine) and then nothing ever appears to wait on. Say so,
  // because the bare "Waiting failed: 120000ms exceeded" sends you looking at
  // performance. `@jbrowse/capture`'s session gate checks the requested
  // trackIds are actually open and fails immediately; this is the cheap
  // stand-in for that, after the fact.
  const displays = await page
    .evaluate(
      () =>
        document.querySelectorAll('[data-display-phase]').length +
        document.querySelectorAll('[data-testid$="-done"],[data-testid$="_done"]')
          .length,
    )
    .catch(() => -1)
  if (displays === 0) {
    console.error(
      'no display ever mounted — check that every trackId in the URL exists in ' +
        "this build's config.json, and that the assembly name matches",
    )
  }
  console.error('profiling error:', e instanceof Error ? e.message : e)
  if (screenshotPath) {
    await page
      .screenshot({ path: screenshotPath.replace(/\.png$/, '.error.png') })
      .catch(() => {})
  }
  console.log('FAIL')
  process.exitCode = 1
}
await browser.close()
process.exit(process.exitCode ?? 0)

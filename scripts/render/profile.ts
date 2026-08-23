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
// Behind all of them sits one more positive check: a track that drew something
// has a canvas, and a track that drew nothing has none. Measured on all three
// build generations, the canvas element does not exist until there is content in
// it — sampled mid-load at 0.7 s and 2.2 s, with megabytes of BAM already
// fetched, `document.querySelectorAll('canvas')` is still empty. So counting
// canvases separates "drew" from "declined to draw" without a pixel threshold
// to tune, and it catches the failure the readiness contracts cannot see:
// release-4.3.0 asked for the whole contig reports done, with bytes fetched and
// zero canvases, which is the refusal `results/interaction.md` records as its
// best-looking column.
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
// POLL_MS and STABLE_POLLS come from the detector that uses them: the elapsed
// correction below subtracts the settle window, and a local copy that drifted
// from the real one would quietly bias every timing in the table.
import {
  POLL_MS,
  STABLE_POLLS,
  waitForRenderComplete,
} from './rendercomplete.ts'
import fs from 'fs'
import path from 'path'

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

// Alignment bytes actually pulled over the wire, so "it drew nothing" can be
// told apart from "it fetched nothing". Both are failures; they have different
// causes, and the message should not have to guess which.
let dataBytes = 0
page.on('response', r => {
  if (/\.(bam|bai|cram|crai)(\?|$)/.test(r.url())) {
    dataBytes += Number(r.headers()['content-length'] ?? 0)
  }
})

const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })

try {
  // The positive gate, before any readiness signal is consulted. Every signal
  // below is NEGATIVE — no loading overlay, no unpainted display, no unstable
  // marker count — so every one of them passes on a page whose JavaScript has
  // not run, and a build that 404s its config would report a very fast render of
  // nothing.
  //
  // Both the session gate and the render-complete poll live in
  // rendercomplete.ts, shared with interaction.ts. They were duplicated until
  // 2026-08-23, and the copy that did not keep up silently stopped being able
  // to measure the build under test.
  const mode = await waitForRenderComplete(page)
  // Which one fired, so a row measured under a different contract than its
  // neighbours is visible rather than silently incomparable. Goes to stderr:
  // runner.ts reads the last line of stdout as the number.
  console.error(`render-complete contract: ${mode}`)
  // The positive content check. A readiness contract can only say the
  // application stopped working; this says it produced something.
  const canvases = await page.evaluate(
    () => document.querySelectorAll('canvas').length,
  )
  if (canvases === 0) {
    throw new Error(
      `render reported complete with no canvas — nothing was drawn ` +
        `(${(dataBytes / 1e6).toFixed(1)} MB of alignment data fetched). ` +
        `A build that declines to draw is not a build that drew fast.`,
    )
  }
  console.error(`canvases: ${canvases}, data: ${(dataBytes / 1e6).toFixed(1)} MB`)
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

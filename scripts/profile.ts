// Cold-start render profiler. Emits the in-page elapsed time (ms) from
// navigation start to a fully painted track, isolating fetch+render from the
// ~constant browser-launch overhead that otherwise dominates light loads.
//
// Render-complete detection is NOT overfit to the old block renderer. Old
// releases paint N offscreen "prerendered_canvas ... _done" blocks (count
// varies with view width); the new branch paints a single "<testid>-done"
// canvas. We wait for quiescence: >=1 render-complete marker present, no loading
// overlay, and the marker count stable across several polls. Works for both.
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
  await page.waitForFunction(
    ({ stableNeeded }: { stableNeeded: number }) => {
      const w = window as unknown as { __stable?: number; __last?: number }
      const doneMarkers = document.querySelectorAll(
        '[data-testid$="-done"],[data-testid$="_done"]',
      ).length
      const loading =
        document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
      const ready = doneMarkers > 0 && !loading
      if (ready && doneMarkers === w.__last) {
        w.__stable = (w.__stable ?? 0) + 1
      } else {
        w.__stable = 0
        w.__last = doneMarkers
      }
      return ready && (w.__stable ?? 0) >= stableNeeded
    },
    { timeout: WAIT_TIMEOUT, polling: POLL_MS },
    { stableNeeded: STABLE_POLLS },
  )
  // subtract the quiescence settle window so the number reflects time to the
  // last paint, not the detector's confirmation delay (constant, but removing
  // it makes the metric mean what it says)
  const elapsed = Date.now() - t0 - STABLE_POLLS * POLL_MS
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath })
  }
  console.log(elapsed.toFixed(1))
} catch (e) {
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

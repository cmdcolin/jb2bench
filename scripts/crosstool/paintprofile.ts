// Renderer-agnostic cold-start profiler: navigation -> the pixels stop changing.
//
// The JBrowse-vs-JBrowse benchmarks one directory up detect render-complete from
// JBrowse's own testids. That is fine when both sides are JBrowse and useless
// across tools, and a cross-tool comparison whose instrument is one tool's
// self-reporting is not a comparison. igv.js in particular hides its spinner
// when features finish *loading*, before it draws them, so believing its
// loading state would credit it with a render it has not done yet.
//
// So this asks the only question both tools answer the same way: when does the
// screen stop changing? Poll a screenshot, hash it, and call it done when the
// hash has repeated STABLE_POLLS times and differs from the frame captured right
// after navigation. A loading spinner animates, so a tool that is still working
// cannot satisfy the stability test — the animation is doing the waiting for us.
//
// Validated against the testid instrument on the same JBrowse builds: see
// results/crosstool.md. If the two disagree by more than the poll interval on a
// build where both apply, this one is wrong and the results are not usable.
//
// Usage: paintprofile.ts <url> [screenshotPath]
// Prints: a single floating-point millisecond value on stdout (or "FAIL").
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

const WAIT_TIMEOUT = Number(process.env.MAX_WAIT ?? 120000)
const POLL_MS = Number(process.env.POLL_MS ?? 150)
const STABLE_POLLS = Number(process.env.STABLE_POLLS ?? 5)

const url = process.argv[2]
const screenshotPath = process.argv[3]
if (!url) {
  throw new Error('usage: paintprofile.ts <url> [screenshot]')
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

const hash = (b: Uint8Array) =>
  crypto.createHash('sha1').update(b).digest('hex')

const shot = async () =>
  hash(await page.screenshot({ type: 'png', optimizeForSpeed: true }))

const t0 = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded' })

try {
  // The frame at navigation is the "nothing drawn yet" reference. A run whose
  // final frame equals it drew nothing, which is a failure and not a fast run —
  // that is exactly how the JBrowse zoom-out benchmark once scored a refusal to
  // draw as its best result.
  const blank = await shot()
  let last = ''
  let stable = 0
  let elapsed = Number.NaN
  for (;;) {
    if (Date.now() - t0 > WAIT_TIMEOUT) {
      throw new Error(`no stable paint within ${WAIT_TIMEOUT} ms`)
    }
    const h = await shot()
    if (h === last && h !== blank) {
      stable++
    } else {
      stable = 0
      last = h
    }
    if (stable >= STABLE_POLLS) {
      // subtract the settle window so the number is time-to-last-paint, not
      // time-to-detector-confidence (constant, but it should mean what it says)
      elapsed = Date.now() - t0 - STABLE_POLLS * POLL_MS
      break
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
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

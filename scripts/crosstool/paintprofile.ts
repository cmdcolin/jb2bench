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
// after navigation.
//
// ## Stable pixels alone are not enough, and Gosling is why
//
// This file used to argue that "a loading spinner animates, so a tool that is
// still working cannot satisfy the stability test — the animation is doing the
// waiting for us". **That is false for a tool whose loading state is static
// text.** Measured 2026-08-28: Gosling with its tile cap raised, at the 100 kb
// window, settled at 2402 ms on a frame showing an empty plot and the word
// "Fetching" — its worker was still pulling the BAM. Nothing animated, five
// identical frames, done. The number was a third of the truth and would have
// made the patched arm the fastest column in the table.
//
// Two things now hold the countdown off, and neither is a tool reporting its own
// completion time.
//
// **A corpus read in flight.** The clock is still the pixels, but the run cannot
// settle while a data file is being read. Same `isData` URL-path match
// `drewcheck.ts` uses, and it sees web-worker requests, which is where Gosling
// fetches. An arm this changes was settling mid-fetch and was never right; an arm
// it does not change reports exactly what it reported before.
//
// **`window.__harnessBusy()`, where the page defines it.** Network idleness alone
// does not cover the Gosling case: traced on 2026-08-28, that page spends its
// first 3.9 s booting a worker and reading the index with *zero* requests
// outstanding and a static frame, which is the dead zone the wrong number came
// out of. The first data then lands in a single event at 7.6 s. So a harness may
// export a predicate that is true while it is knowably not done, and this will
// not settle while it returns true. Gosling's is `records === 0` — "no feature
// has arrived yet" — which is a *content* gate, not a completion timestamp:
// once it clears, the pixels do all the timing, so it adds no constant to the
// measurement. A page that defines no such predicate is measured exactly as
// before, which is why every already-recorded number stays comparable.
//
// This still cannot catch the whole class. A tool that has its data, then thinks
// with nothing moving on screen for longer than the settle window, satisfies both
// tests. Guarding that needs a per-tool notion of finished, which is the thing
// this instrument exists not to trust. So: check the screenshot when an arm's
// number surprises you. The Gosling clip was found that way and by nothing else.
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
import { isData } from './drewcheck.ts'

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

// Corpus reads in flight. Counted by URL *path* like everywhere else in this
// directory, so the harness page's own `&track=…bam` query string is not
// mistaken for a data request. Failed and cancelled requests resolve too, or a
// single aborted range read would hang the run until MAX_WAIT.
let inFlight = 0
let fetches = 0
page.on('request', r => {
  if (isData(r.url())) {
    inFlight++
    fetches++
  }
})
const settled = (r: { url: () => string }) => {
  if (isData(r.url())) {
    inFlight--
  }
}
page.on('response', settled)
page.on('requestfailed', settled)

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
    const busy =
      inFlight > 0 ||
      (await page.evaluate(() => {
        const f = (window as unknown as { __harnessBusy?: () => boolean })
          .__harnessBusy
        return typeof f === 'function' ? f() === true : false
      }))
    if (busy) {
      // Reading the corpus, or the page says it has no data yet. A static
      // "loading" frame is not a settled one.
      stable = 0
      last = h
    } else if (h === last && h !== blank) {
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
  // Diagnostic, on stderr so the contract of "one number on stdout" holds. A
  // run that settles having read nothing is the signature of a harness that
  // drew nothing — the case `toolcheck.ts` exists for.
  console.error(`data requests: ${fetches}`)
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

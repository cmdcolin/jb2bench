// Does this track actually fetch, or is the build quietly refusing?
//
// `BamAdapter`/`CramAdapter` default `fetchSizeLimit` to 5 MB, and a track over
// that limit renders "Requested too much data (N Mb). Zoom in to see features,
// or force load" instead of reads. Nothing errors: the page loads, the chrome
// paints, the render-complete markers appear, and a benchmark run happily times
// an empty browser. It is the same family of failure as a config that 404s and
// photographs perfectly.
//
// So this asks the two questions that separate a render from a refusal — did any
// data bytes move, and is the refusal text on the page — and it asks them
// cheaply enough to run before every 1000x measurement rather than once a year.
//
// Verified 2026-08-16 against builds/current, which sets the slot nowhere:
// 1000x.shortread.bam made 13 data requests and 1000x.longread.bam 15, with no
// refusal text on either. So the limit is not currently firing on this corpus,
// and the config pass the README used to demand is not owed. WHY the 28.1 MB
// window does not trip a 5 MB limit is not established — the check is against an
// estimate the adapter computes, and that estimate is evidently not the
// whole-window byte count. Re-run this after any adapter change rather than
// trusting either the old warning or that correction.
//
// Usage:
//   node --experimental-strip-types scripts/render/bailcheck.ts [track...]
//   PORT=8000 node --experimental-strip-types scripts/render/bailcheck.ts
//
// Exits non-zero if any track refused, so it can gate a run.
import puppeteer from 'puppeteer'

const PORT = Number(process.env.PORT ?? 8000)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 12000)
const tracks =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['1000x.shortread.bam', '1000x.longread.bam']

const REFUSAL = /too much data|Zoom in to see features|force load/i
const DATA = /\.(bam|bai|cram|crai)(\?|$)/

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})

let refused = 0
for (const track of tracks) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  let dataRequests = 0
  page.on('response', r => {
    if (DATA.test(r.url())) dataRequests++
  })
  try {
    await page.goto(
      `http://localhost:${PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${track}&renderer=webgl`,
      { waitUntil: 'domcontentloaded' },
    )
    // The positive gate first: every signal below is negative, and all of them
    // pass on a page whose JavaScript never ran.
    await page.waitForFunction(
      'window.JBrowseSession && window.JBrowseSession.views && window.JBrowseSession.views.length > 0',
      { timeout: 120000, polling: 200 },
    )
    await new Promise(r => setTimeout(r, SETTLE_MS))
    const text = await page.evaluate(() => document.body.innerText)
    const bailed = REFUSAL.test(text)
    // Both conditions matter. Refusal text with no bytes is the documented
    // failure; no text and no bytes is a different one (a trackId the config
    // does not define) and should not be reported as a refusal.
    const verdict = bailed ? 'REFUSED' : dataRequests > 0 ? 'ok' : 'NO DATA, NO REFUSAL'
    if (bailed || dataRequests === 0) refused++
    console.log(
      `${verdict.padEnd(22)} ${track.padEnd(24)} ${dataRequests} data requests` +
        (bailed ? `  ${(REFUSAL.exec(text) ?? [''])[0]}` : ''),
    )
  } catch (e) {
    refused++
    console.log(`ERROR                  ${track.padEnd(24)} ${String(e).split('\n')[0]}`)
  } finally {
    await page.close()
  }
}

await browser.close()
if (refused > 0) {
  console.error(
    `\n${refused} track(s) did not fetch. Raise fetchSizeLimit on every track in ` +
      "the build's config.json before timing anything at this coverage.",
  )
}
process.exit(refused > 0 ? 1 : 0)

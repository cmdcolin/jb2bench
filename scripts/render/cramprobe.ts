// Why does a cell fail? Load the URL, wait a fixed short window, and dump what
// the page said: console errors with their stacks, page errors, failed requests,
// and any error text sitting in the track area.
//
// This exists because profile.ts answers only FAIL-or-a-number, and pays the
// full 120 s WAIT_TIMEOUT to say FAIL. A 20 s run of this said what the CRAM
// cells on builds/release-2.4.0 were actually doing:
// `TypeError: Cannot convert undefined or null to object`, with a stack through
// Object.keys in core/util/idMaker.ts — the missing sequenceAdapter that
// shell/cram_seqadapter.js now fills in.
//
// Minified frames are worth resolving rather than eyeballing. Every build in
// builds/ ships .map files beside its chunks, and node's own SourceMap does it:
//
//   const {SourceMap} = require('node:module')
//   new SourceMap(JSON.parse(fs.readFileSync(chunk + '.map', 'utf8')))
//     .findEntry(line - 1, column)   // -> originalSource, originalLine
//
// Usage: cramprobe.ts <url> [waitMs] [screenshotPath]
import puppeteer from 'puppeteer'

const url = process.argv[2]!
const WAIT = Number(process.argv[3] ?? 20000)

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=gl', '--use-gl=angle', '--window-size=1280,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const seen = new Set<string>()
page.on('console', async m => {
  if (m.type() !== 'error' && m.type() !== 'warn') {
    return
  }
  const text = m.text().slice(0, 400)
  if (seen.has(text)) {
    return
  }
  seen.add(text)
  console.log(`[console.${m.type()}] ${text}`)
  const loc = m.location()
  console.log(`  at ${loc.url?.slice(-60)}:${loc.lineNumber}:${loc.columnNumber}`)
  for (const f of m.stackTrace().slice(0, 12)) {
    console.log(`  frame ${f.url?.slice(-50)}:${f.lineNumber}:${f.columnNumber}`)
  }
  for (const a of m.args()) {
    const stack = await a
      .evaluate((v: unknown) => (v as Error)?.stack ?? null)
      .catch(() => null)
    if (stack) {
      console.log(`  stack: ${String(stack).slice(0, 2000)}`)
    }
  }
})
page.on('pageerror', e => {
  const { message, stack } = e as Error
  console.log(`[pageerror] ${message.slice(0, 400)}\n${stack?.slice(0, 2000)}`)
})
page.on('requestfailed', r =>
  console.log(`[reqfail] ${r.url().slice(-60)} ${r.failure()?.errorText}`),
)
page.on('response', r => {
  if (r.status() >= 400) {
    console.log(`[http ${r.status()}] ${r.url().slice(-60)}`)
  }
})

await page.goto(url, { waitUntil: 'load' })
await new Promise(r => setTimeout(r, WAIT))

const state = await page.evaluate(() => {
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ')
  return {
    phases: [...document.querySelectorAll('[data-display-phase]')].map(n =>
      n.getAttribute('data-display-phase'),
    ),
    legacy: document.querySelectorAll('[data-testid$="-done"],[data-testid$="_done"]')
      .length,
    loadingOverlays: document.querySelectorAll('[data-testid="loading-overlay"]').length,
    bodyText: txt.slice(0, 1200),
  }
})
console.log('state:', JSON.stringify(state, null, 2))
await page.screenshot({ path: process.argv[4] ?? '/tmp/cramprobe.png' })
await browser.close()

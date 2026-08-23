// Does a competing tool's harness page actually draw the corpus?
//
// The cross-tool tables are only as good as the harness pages behind them, and a
// harness that silently draws nothing looks exactly like a fast one — the same
// failure the JBrowse side gets `bailcheck.ts` for. igv.js is exercised on every
// run so it cannot rot unnoticed; the GenomeSpy page is driven by nothing, so it
// can and did.
//
// The check is the same positive one profile.ts uses, and it needs no per-tool
// knowledge: a tool that drew has a canvas with content, a tool that failed has
// none. Bytes fetched separates "never asked for the data" from "asked and drew
// nothing".
//
// **It has to walk shadow roots, and this is not a detail.** igv.js 3.x calls
// `parentDiv.attachShadow()` and appends its whole UI inside, so
// `document.querySelectorAll('canvas')` returns ZERO for a page igv has drawn
// twelve canvases onto, and `document.contains(browser.root)` is false. A probe
// that does not descend reports a working igv as drawing nothing — which is
// what the first version of this file did. `drawclock.ts` is unaffected, since
// patching the canvas prototypes catches a draw wherever the element lives; any
// check that goes through a DOM query is not.
//
// Usage:
//   node --experimental-strip-types scripts/crosstool/toolcheck.ts
//   PAGES=genomespy.html TRACKS=200x.shortread.bam ... toolcheck.ts
import puppeteer from 'puppeteer'

const PORT = Number(process.env.PORT ?? 8003)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 15000)
const pages = (process.env.PAGES ?? 'index.html,genomespy.html').split(',')
const tracks = (process.env.TRACKS ?? '20x.shortread.bam,200x.shortread.bam').split(
  ',',
)

const DATA = /\.(bam|bai|cram|crai|bw)(\?|$)/

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl', '--use-gl=angle'],
})

let bad = 0
for (const harness of pages) {
  for (const track of tracks) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    let bytes = 0
    const errors: string[] = []
    page.on('response', r => {
      if (DATA.test(r.url())) bytes += Number(r.headers()['content-length'] ?? 0)
    })
    page.on('pageerror', e => errors.push(String(e).split('\n')[0]!.slice(0, 120)))
    const url = `http://localhost:${PORT}/${harness}?loc=${LOC}&track=${track}`
    try {
      await page.goto(url, { waitUntil: 'load' })
      await new Promise(r => setTimeout(r, SETTLE_MS))
      // Canvas pixels rather than a per-tool readiness flag: the point is that
      // something is on screen, and every tool here renders to canvas.
      const drawn = await page.evaluate(() => {
        const canvases: HTMLCanvasElement[] = []
        const walk = (root: Document | ShadowRoot) => {
          for (const el of root.querySelectorAll('*')) {
            if (el instanceof HTMLCanvasElement) canvases.push(el)
            if (el.shadowRoot) walk(el.shadowRoot)
          }
        }
        walk(document)
        let painted = 0
        for (const c of canvases) {
          try {
            // A blank canvas of any size encodes to a very short data URL;
            // anything with marks in it is an order of magnitude longer. This is
            // a presence test, not a measurement, so the margin is ample.
            if (c.toDataURL().length > 3000) painted++
          } catch {
            /* tainted or contextless — cannot tell, so do not claim it drew */
          }
        }
        return { canvases: canvases.length, painted }
      })
      // A tool-declared error, where the tool declares one, is worth printing
      // even when pixels appeared.
      const declared = await page.evaluate(() => {
        const w = window as Record<string, any>
        return w.__igvState?.error ?? w.__gsState?.error ?? null
      })
      const ok = drawn.painted > 0 && bytes > 0
      if (!ok) bad++
      console.log(
        `${(ok ? 'ok' : 'NOTHING DRAWN').padEnd(14)} ${harness.padEnd(16)} ` +
          `${track.padEnd(22)} ${drawn.painted}/${drawn.canvases} canvases painted, ` +
          `${(bytes / 1e6).toFixed(1)} MB`,
      )
      if (declared) console.log(`               declared error: ${declared}`)
      for (const e of [...new Set(errors)].slice(0, 3)) {
        console.log(`               page error: ${e}`)
      }
    } catch (e) {
      bad++
      console.log(
        `${'ERROR'.padEnd(14)} ${harness.padEnd(16)} ${track.padEnd(22)} ` +
          `${String(e).split('\n')[0]}`,
      )
    } finally {
      await page.close()
    }
  }
}

await browser.close()
if (bad) {
  console.error(`\n${bad} harness/track pair(s) drew nothing.`)
}
process.exit(bad ? 1 : 0)

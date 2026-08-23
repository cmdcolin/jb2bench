// Does a competing tool's harness page still draw the corpus?
//
// The cross-tool tables are only as good as the harness pages behind them, and a
// harness that silently draws nothing looks exactly like a fast one — the same
// failure the JBrowse side gets `bailcheck.ts` for. Worse than looking fast: the
// instrument on those runs is paint quiescence, and a page that throws settles
// *immediately*, so a dead harness reports the best number in the table.
//
// igv.js is exercised on every run so it cannot rot unnoticed; the GenomeSpy
// page was driven by nothing, so it could and did — see that page's header.
//
// The probe itself is `drewcheck.ts`, shared with `formatsupport.ts`.
//
// Usage:
//   node --experimental-strip-types scripts/crosstool/toolcheck.ts
//   PAGES=genomespy.html TRACKS=200x.shortread.bam ... toolcheck.ts
import puppeteer from 'puppeteer'
import { drew, drewCheck } from './drewcheck.ts'

const PORT = Number(process.env.PORT ?? 8003)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 15000)
const pages = (process.env.PAGES ?? 'index.html,genomespy.html').split(',')
const tracks = (process.env.TRACKS ?? '20x.shortread.bam,200x.shortread.bam').split(
  ',',
)

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl', '--use-gl=angle'],
})

let bad = 0
for (const harness of pages) {
  for (const track of tracks) {
    const url = `http://localhost:${PORT}/${harness}?loc=${LOC}&track=${track}`
    const d = await drewCheck(browser, url, SETTLE_MS)
    const ok = drew(d)
    if (!ok) {
      bad++
    }
    console.log(
      `${(ok ? 'ok' : 'NOTHING DRAWN').padEnd(14)} ${harness.padEnd(16)} ` +
        `${track.padEnd(22)} ${d.painted}/${d.canvases} canvases painted, ` +
        `${(d.bytes / 1e6).toFixed(1)} MB`,
    )
    if (d.declared) {
      console.log(`               declared error: ${d.declared}`)
    }
    for (const e of d.errors.slice(0, 3)) {
      console.log(`               page error: ${e}`)
    }
  }
}

await browser.close()
if (bad) {
  console.error(`\n${bad} harness/track pair(s) drew nothing.`)
}
process.exit(bad ? 1 : 0)

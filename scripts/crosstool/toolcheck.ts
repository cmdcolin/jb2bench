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
// It checks every window, not just the narrow one, because a harness can draw at
// one width and not another for reasons that belong to the tool: Gosling's BAM
// track declines any tile wider than 20 kb, so it draws the 19 kb window and
// paints an empty frame at 100 kb. A pass at one window is not a pass.
//
// The probe itself is `drewcheck.ts`, shared with `formatsupport.ts`.
//
// Usage:
//   node --experimental-strip-types scripts/crosstool/toolcheck.ts
//   PAGES=genomespy.html TRACKS=200x.shortread.bam ... toolcheck.ts
//   LOC=chr22_mask:1-1000 overrides the window sweep with one window
import puppeteer from 'puppeteer'
import { drew, drewCheck } from './drewcheck.ts'
import { contigSize, selectWindows, WINDOWS, type Window } from './windows.ts'

const PORT = Number(process.env.PORT ?? 8003)
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 15000)
const windows: Window[] = process.env.LOC
  ? [{ id: 'LOC', loc: process.env.LOC, scale: WINDOWS[0]!.scale }]
  : selectWindows()
// A page entry may carry its own query string — `gosling.html?bundle=...` is a
// different arm of the same page, and the patched Gosling bundle can rot the same
// way any other harness can.
const pages = (
  process.env.PAGES ??
  'index.html,genomespy.html,gosling.html,gosling.html?bundle=gosling-patched.bundle.js'
).split(',')
// Default tracks come from the WINDOW's corpus, since a window carries the
// files it can be a window on: the two narrow ones get 20x and 200x of the
// 250 kb contig, the 1 Mb one 20x and 100x of its own. `TRACKS=` still names
// them by hand, and then it applies to every window in the sweep.
const trackList = process.env.TRACKS?.split(',')
const tracksFor = (w: Window) =>
  trackList ??
  w.scale.coverages.slice(0, 2).map(c => `${w.scale.prefix}${c}.shortread.bam`)

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl', '--use-gl=angle'],
})

// Known capability limits, so a run reports them as expected rather than as
// breakage. `toolcheck.ts` says whether a page still does what it can do; what
// it cannot do belongs in the report, and the runner records those cells as
// `n/a`. Keep this in step with the `formats` and `maxSpan` fields in
// `runner.ts` — the two describe the same limits to different readers.
const EXPECTED_EMPTY: { page: string; window: string; why: string }[] = [
  {
    page: 'gosling.html',
    window: '100kb',
    why: "Gosling's BAM fetcher declines a tile wider than 20 kb",
  },
  {
    page: 'gosling.html',
    window: '1mb',
    why: "Gosling's BAM fetcher declines a tile wider than 20 kb",
  },
]

let bad = 0
for (const harness of pages) {
  for (const w of windows) {
    for (const track of tracksFor(w)) {
      // Same reference parameters the runner passes. Without them this preflight
      // would open the wide tracks against the 250 kb assembly and report the
      // harness broken when what is wrong is the check.
      const url =
        `http://localhost:${PORT}/${harness}` +
        `${harness.includes('?') ? '&' : '?'}loc=${w.loc}&track=${track}` +
        `&ref=${w.scale.assembly}&size=${contigSize(w)}`
      const d = await drewCheck(browser, url, SETTLE_MS)
      const ok = drew(d)
      const expected = EXPECTED_EMPTY.find(
        e => e.page === harness && e.window === w.id,
      )
      if (!ok && !expected) {
        bad++
      }
      const verdict = ok ? 'ok' : expected ? 'empty, expected' : 'NOTHING DRAWN'
      console.log(
        `${verdict.padEnd(14)} ${harness.padEnd(45)} ${w.id.padEnd(6)} ` +
          `${track.padEnd(22)} ${d.painted}/${d.canvases} canvases painted, ` +
          `${(d.bytes / 1e6).toFixed(1)} MB` +
          (d.records === null ? '' : `, ${d.records} features`),
      )
      if (!ok && expected) {
        console.log(`               ${expected.why}`)
      }
      if (d.declared) {
        console.log(`               declared error: ${d.declared}`)
      }
      for (const e of d.errors.slice(0, 3)) {
        console.log(`               page error: ${e}`)
      }
    }
  }
}

await browser.close()
if (bad) {
  console.error(`\n${bad} harness/window/track combination(s) drew nothing.`)
}
process.exit(bad ? 1 : 0)

// Cross-tool initial-render matrix: JBrowse against igv.js, same corpus, same
// window, same instrument.
//
// Everything else in results/ compares JBrowse against older JBrowse, which
// shows what changed and not how the result stands beside another tool. This
// runs the one comparison that is available without re-implementing a benchmark
// per tool: both are web genome browsers, both read an indexed BAM over HTTP
// range requests, and both draw a pileup into a canvas.
//
// Three things make it a comparison rather than a ranking:
//
//   1. One instrument, neither tool's own. scripts/crosstool/paintprofile.ts
//      waits for the pixels to stop changing; see its header for why the
//      tools' own loading states are not usable here.
//   2. Runs are interleaved. Every measured round runs every tool back to back,
//      so drift on this shared box lands on all of them rather than on whichever
//      one happened to be measured during a load spike. The ratios survive
//      contamination that the absolutes do not.
//   3. igv is measured twice, at its default sampling depth and with
//      downsampling effectively off. igv.js draws at most `samplingDepth` reads
//      per 100 bp window (default 500, hard maximum 10000) and JBrowse draws
//      every read, so the two could be doing different amounts of work. On this
//      corpus they are not: the deepest 100 bp window here holds roughly 700
//      short reads, so the default clips a little and the maximum clips
//      nothing. The two igv columns are therefore a check that downsampling is
//      not what the comparison is measuring, rather than a workload knob.
//
// Usage: node scripts/crosstool/runner.ts
//   CASES=20x-shortread,...   subset of rows (CASES=none regenerates the report)
//   WINDOWS=19kb,100kb        subset of windows; see scripts/crosstool/windows.ts
//   TOOLS=jbrowse,igv,igv-deep  subset of columns
//   RUNS=3 WARMUP=1
import { execFileSync } from 'child_process'
import fs from 'fs'
import { enumerateCases, selectCases, type Case } from '../render/cases.ts'
import {
  FOREIGN_CORE_CEILING,
  foreign,
  loadavg,
  outliers,
  peak,
  waitForQuiet,
  watchForeignCpu,
  type LoadWindow,
} from '../render/loadavg.ts'
import { resolveBuild } from '../render/servedbuild.ts'
import {
  migrateRowKeys,
  rowKey,
  selectWindows,
  span,
  WINDOWS,
  type Window,
} from './windows.ts'

const RUNS = Number(process.env.RUNS ?? 3)
const WARMUP = Number(process.env.WARMUP ?? 1)
const LOAD_CEILING = 4.0
// igv's samplingDepth is per samplingWindowSize (100 bp). 10000 is igv's own
// MAXIMUM_SAMPLING_DEPTH — it clamps anything larger and logs a warning — and
// is an order of magnitude above the deepest window in this corpus, so nothing
// is dropped.
const DEEP = 10000

// One JBrowse arm per port, the way `panrunner.ts` does it. The comparison a
// reader of the 2023 paper wants is igv.js against the JBrowse the paper
// benchmarked, and the comparison a reader of this repo wants is igv.js against
// the current one; a matrix that carries only the second answers half the
// question. 8004 is v2.4.0 (what the paper shipped), 8001 the last release,
// 8000 the build under test.
//
// The first port keeps the tool id `jbrowse`, because that is the key every
// already-recorded row in results/crosstool.json is stored under and the ratio
// column is against it. The rest are `jbrowse-<build>`.
const JBROWSE_PORTS = (process.env.JBROWSE_PORTS ?? process.env.JBROWSE_PORT ?? '8000')
  .split(',')
  .map(Number)
// One port serves every non-JBrowse harness page; the page is chosen by path.
const CROSSTOOL_PORT = Number(process.env.CROSSTOOL_PORT ?? 8003)
const IGV_PORT = CROSSTOOL_PORT

const jbrowseArms = await Promise.all(
  JBROWSE_PORTS.map(async (port, i) => {
    const build = await resolveBuild(port)
    console.log(`port ${port} is serving builds/${build}`)
    return { port, build, id: i === 0 ? 'jbrowse' : `jbrowse-${build}` }
  }),
)
const jbrowseBuild = jbrowseArms[0]!.build

// Read from the installed package rather than typed in, so a bump cannot leave
// the column labelled with the version it used to be. igv 3.8.5 is npm `latest`
// as of 2026-08-23, so this column is the current release and not a trailing
// pin; the 2023 paper's igv 2.12.1 is vendored beside the harness and selected
// by URL when that comparison is the one wanted.
const igvVersion = JSON.parse(
  fs.readFileSync('node_modules/igv/package.json', 'utf8'),
).version as string
const gsVersion = JSON.parse(
  fs.readFileSync('node_modules/@genome-spy/core/package.json', 'utf8'),
).version as string
const goslingVersion = JSON.parse(
  fs.readFileSync('node_modules/gosling.js/package.json', 'utf8'),
).version as string
console.log(`igv.js ${igvVersion}, GenomeSpy ${gsVersion}, Gosling ${goslingVersion}`)

interface Tool {
  id: string
  label: string
  url: (track: string, loc: string) => string
  /**
   * Container formats this arm can open, where it cannot open all of them.
   *
   * Neither GenomeSpy 0.85.0 nor Gosling 1.0.7 has a CRAM reader — GenomeSpy's
   * lazy sources are bam, bigbed, bigwig, gff3, tabix and vcf, and Gosling's
   * fetchers are bam, bigwig, vcf, gff, bed and csv — so the format axis the
   * JBrowse and igv.js arms run stops at BAM for those two. A cell no arm can
   * open is recorded as unsupported rather than left blank, because blank
   * already means "not measured in the run that produced this row" and a
   * capability limit is not a gap in the run.
   */
  formats?: string[]
  /** The widest window this arm draws, and why it stops there. */
  maxSpan?: { bp: number; why: string }
}
const allTools: Tool[] = [
  // `renderer=webgl` goes only to the build under test: it is the branch's
  // WebGL2 pin, and a release that predates the parameter ignores it anyway.
  ...jbrowseArms.map(({ port, build, id }, i) => ({
    id,
    label: `JBrowse (${build})`,
    url: (t: string, loc: string) =>
      `http://localhost:${port}/?loc=${loc}&assembly=hg19mod&tracks=${t}` +
      (i === 0 ? '&renderer=webgl' : ''),
  })),
  {
    id: 'igv',
    label: `igv.js ${igvVersion}`,
    url: (t, loc) => `http://localhost:${IGV_PORT}/?loc=${loc}&track=${t}`,
  },
  {
    id: 'igv-deep',
    label: `igv.js ${igvVersion}, no downsampling`,
    url: (t, loc) => `http://localhost:${IGV_PORT}/?loc=${loc}&track=${t}&depth=${DEEP}`,
  },
  {
    // Height control. The harness gives igv a 600 px track; igv's own default
    // for a BAM track is 300, and JBrowse's pileup canvas on this viewport is
    // about 210. igv draws packed rows until it runs out of canvas and JBrowse
    // draws every read it holds, so a taller igv track is more igv work and no
    // more JBrowse work. This column says how much that is worth.
    //
    // Run it as `TOOLS=igv-h600ctl,igv-h300`, never as `TOOLS=igv,igv-h300`:
    // the latter re-measures the main table's `igv` cell in a round that does
    // not re-measure `jbrowse`, so the headline ratio silently ends up
    // comparing two different rounds on a box whose load moves between them.
    // `igv-h600ctl` is the same URL as `igv` under a name the table ignores.
    id: 'igv-h300',
    label: `igv.js ${igvVersion}, 300 px track`,
    url: (t, loc) => `http://localhost:${IGV_PORT}/?loc=${loc}&track=${t}&height=300`,
  },
  {
    id: 'igv-h600ctl',
    label: `igv.js ${igvVersion}, 600 px track (control arm)`,
    url: (t, loc) => `http://localhost:${IGV_PORT}/?loc=${loc}&track=${t}`,
  },
  {
    // GenomeSpy, on the same BAM through its own lazy BAM source and `pileup`
    // transform. It reads its indexed formats through the same @gmod packages
    // JBrowse does, so read this column as renderer-against-renderer over a
    // shared decoder, not as a whole-stack comparison — which is the opposite
    // of what the igv columns are, since igv maintains its own readers.
    //
    // This arm was off behind GENOMESPY=1 from 2026-08-23 to 2026-08-28,
    // because the harness page drew nothing: a `domain` on the x scale makes
    // 0.85.0 read the genome before its own assembly preflight has loaded it,
    // and every spec form tried failed the same way. It now declares no domain
    // and moves to the window with `zoomTo` afterwards, which lands on exactly
    // the requested interval — see crosstool/genomespy.html for the whole
    // account. The gate is gone because a gated arm goes unexercised, which is
    // how the page rotted in the first place; `toolcheck.ts` preflights it on
    // every run instead.
    id: 'genomespy',
    label: `GenomeSpy ${gsVersion}`,
    formats: ['bam'],
    url: (t, loc) =>
      `http://localhost:${CROSSTOOL_PORT}/genomespy.html?loc=${loc}&track=${t}`,
  },
  {
    // Gosling, on the same BAM through its own `bam` fetcher and its
    // `displace`/`pile` transform. Also a renderer comparison over a shared
    // decoder, and more sharply so than GenomeSpy: Gosling 1.0.7 pins
    // `@gmod/bam` ^1.1.18, which is the version `ecosystem/versions.json` calls
    // the 2023 side, so whatever that benchmark measures as the parser speedup
    // since 2023 is speedup this column has not had.
    //
    // Gosling draws reads only while the visible tile is at most 20 kb wide —
    // `MAX_TILE_WIDTH = 2e4` in its `BamDataFetcher`, which
    // `gosling-track.ts:calculateVisibleTiles` compares against every visible
    // tile and returns early rather than fetching. Tile width is the declared
    // genome length over 2^zoom, so on this 250 kb assembly the 19 kb window
    // draws and the 100 kb one does not: it paints axes and no reads, having
    // fetched only the header and index. That is a capability limit, so the
    // runner records it as unsupported instead of timing an empty page — the
    // instrument is paint quiescence, and an empty page settles fast.
    id: 'gosling',
    label: `Gosling ${goslingVersion}`,
    formats: ['bam'],
    maxSpan: {
      bp: 20000,
      why: "Gosling's BAM fetcher declines a tile wider than 20 kb",
    },
    url: (t, loc) =>
      `http://localhost:${CROSSTOOL_PORT}/gosling.html?loc=${loc}&track=${t}`,
  },
  {
    // Gosling with its tile-width caps raised, which is the only way it reaches
    // the wide window — `scripts/crosstool/goslingbundle.ts` builds this bundle
    // from the same entry point as the stock one, patches the two constants, and
    // fails the build if either pattern stops matching.
    //
    // **Not a substitute for the stock column**, which keeps its `n/a`: a
    // patched library is not the library anyone installs, and where a tool stops
    // is a result. Two arms, and the pair is the finding.
    //
    // It also reads a whole tile rather than the window. At 100 kb it lays out
    // 40002 reads — every read in the 20x file — against roughly 16000 in view,
    // because the tile HiGlass asks for at that zoom covers the contig. Same
    // kind of over-read as GenomeSpy's windowSize snapping and larger, so this
    // column is an upper bound on what an unpatched Gosling would cost at this
    // width even if it could draw it.
    id: 'gosling-patched',
    label: `Gosling ${goslingVersion}, tile cap raised`,
    formats: ['bam'],
    url: (t, loc) =>
      `http://localhost:${CROSSTOOL_PORT}/gosling.html?loc=${loc}&track=${t}` +
      `&bundle=gosling-patched.bundle.js`,
  },
]
const toolFilter = process.env.TOOLS?.split(',')
const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.id)) : allTools

/**
 * Why this arm cannot measure this cell, or null if it can.
 *
 * A capability limit is recorded, not skipped: a blank cell already means "not
 * measured in the run that produced this row", and a reader cannot tell that
 * from "this tool does not open CRAM".
 */
function unsupported(tool: Tool, c: Case, w: Window): string | null {
  const fmt = c.track.split('.').pop()!
  if (tool.formats && !tool.formats.includes(fmt)) {
    return `no ${fmt} reader`
  }
  if (tool.maxSpan && span(w) > tool.maxSpan.bp) {
    return tool.maxSpan.why
  }
  return null
}

// From the shared enumeration, which spells the format into every id. This was
// a private BAM-only loop emitting bare `20x-shortread`, while the cold-load and
// interaction matrices had moved to `20x-shortread-bam` — so the three recorded
// files disagreed about what a case is called, and the paper's extractor grew a
// fallback to paper over it.
//
// FORMATS defaults to bam here rather than to both: the igv.js harness is
// exercised on BAM in this benchmark, and widening it is a measurement decision
// rather than a rename.
// Both containers by default, the way the interaction matrix does it. It used
// to default to BAM alone, which left the cold-load figure with a CRAM row the
// pan figure had and it did not.
const allCases = enumerateCases()
const cases = selectCases(allCases)
const windows = selectWindows()
console.log(
  `windows: ${windows.map(w => `${w.id} (${w.loc}, ${(span(w) / 1000).toFixed(0)} kb)`).join(', ')}`,
)

// gosling.js ships ESM with bare specifiers, so unlike igv.js and GenomeSpy it
// has to be bundled before a browser can load it. Refuse before the first cell
// rather than letting the arm paint an empty frame and report the best number in
// the table — and only when the arm has a cell to measure, so a JBrowse-only run
// and a report-only `CASES=none` need no bundle.
const GOSLING_BUNDLES: Record<string, string> = {
  gosling: 'crosstool/gosling.bundle.js',
  'gosling-patched': 'crosstool/gosling-patched.bundle.js',
}
for (const [id, bundle] of Object.entries(GOSLING_BUNDLES)) {
  const measures = cases.some(c =>
    windows.some(w => tools.some(t => t.id === id && !unsupported(t, c, w))),
  )
  if (measures && !fs.existsSync(bundle)) {
    throw new Error(`${bundle} is missing — run \`make crosstool-bundles\``)
  }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const stddev = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)))
}

function runOnce(url: string): number {
  let out = ''
  try {
    out = execFileSync('node', ['scripts/crosstool/paintprofile.ts', url], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    })
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const val = Number.parseFloat(out.trim().split('\n').pop() || 'NaN')
  return Number.isFinite(val) ? val : Number.NaN
}

interface Cell {
  median: number
  mean: number
  stddev: number
  runs: number[]
  load: LoadWindow
  /** Set instead of a timing where the arm cannot open this cell at all. */
  unsupported?: string
}
type Row = Record<string, Cell>

const RESULTS = 'results/crosstool.json'
interface Recorded {
  igvVersion: string
  jbrowseBuild: string
  /** every JBrowse arm this file holds, tool id → build directory */
  jbrowseBuilds: Record<string, string>
  rows: Record<string, Row>
  dates: Record<string, string>
}
const prior: Recorded = fs.existsSync(RESULTS)
  ? JSON.parse(fs.readFileSync(RESULTS, 'utf8'))
  : { igvVersion, jbrowseBuild, jbrowseBuilds: {}, rows: {}, dates: {} }
// Two relabels in one pass: `<cov>-<read>` -> `<cov>-<read>-bam` for rows
// recorded before the format axis, and `<case>` -> `<case>@19kb` for rows
// recorded before the window axis. Both are renames of measurements that were
// always of that format and that window; neither re-values a cell. One function
// and not two composed, because composing them appends a second `-bam` to a key
// that already carries a window — see migrateRowKeys.
prior.rows = migrateRowKeys(prior.rows)
prior.dates = migrateRowKeys(prior.dates)
// Written before the first cell rather than only after one, so `CASES=none` --
// the report-only run -- leaves the file on disk keyed the way the code reads
// it. The migration is a relabel and idempotent, so re-running it is free; a
// file that stays half-migrated until someone happens to measure a cell is a
// second schema for every other reader of it to handle.
if (fs.existsSync(RESULTS)) {
  fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
}

const today = new Date().toISOString().slice(0, 10)

for (const w of windows) {
  for (const c of cases) {
    const key = rowKey(c.id, w.id)
    const runs: Record<string, number[]> = {}
    const before: Record<string, number> = {}
    const foreignCores: Record<string, number> = {}
    const foreignTop: Record<string, string | undefined> = {}
    // An arm that cannot open this cell is recorded as such and dropped from the
    // round, so the interleaving stays honest: a cell nobody measured must not
    // sit in the rotation contributing a fast empty page.
    const measurable = tools.filter(t => {
      const why = unsupported(t, c, w)
      if (why) {
        console.log(`${key} ${t.id}: unsupported — ${why}`)
      }
      return !why
    })
    for (const t of measurable) {
      runs[t.id] = []
      // The previous cell's Chrome is still tearing down when execFileSync
      // returns, so a cell that starts immediately measures the last one's exit.
      // Same settle the render matrix takes, for the same reason.
      const quiet = waitForQuiet()
      if (quiet.waitedMs > 1500) {
        console.log(`  [settled ${(quiet.waitedMs / 1000).toFixed(1)}s]`)
      }
      before[t.id] = loadavg()
      for (let i = 0; i < WARMUP; i++) {
        runOnce(t.url(c.track, w.loc))
      }
    }
    // interleaved: one round runs every tool, so a load spike lands on all of
    // them rather than on whichever tool owned the clock at the time
    const cpu = Object.fromEntries(measurable.map(t => [t.id, watchForeignCpu()]))
    for (let r = 0; r < RUNS; r++) {
      for (const t of measurable) {
        const ms = runOnce(t.url(c.track, w.loc))
        runs[t.id]!.push(ms)
        console.log(`${key} ${t.id} run ${r + 1}: ${ms}`)
      }
    }
    // Foreign CPU, not the load average, is what says whether a cell is
    // trustworthy: the load average counts this benchmark's own threads, so a
    // heavy cell inflates it by working. A watcher per arm, all started after the
    // warmups, so what each reports is contention rather than its own cost.
    for (const t of measurable) {
      const { cores, top } = await cpu[t.id]!.done()
      foreignCores[t.id] = cores
      foreignTop[t.id] = top
    }
    const row: Row = prior.rows[key] ?? {}
    for (const t of tools) {
      const why = unsupported(t, c, w)
      if (why) {
        row[t.id] = {
          median: Number.NaN,
          mean: Number.NaN,
          stddev: Number.NaN,
          runs: [],
          load: { before: 0, after: 0 },
          unsupported: why,
        }
        continue
      }
      const vals = runs[t.id]!.filter(Number.isFinite)
      row[t.id] = {
        median: vals.length ? median(vals) : Number.NaN,
        mean: vals.length ? mean(vals) : Number.NaN,
        stddev: vals.length ? stddev(vals) : Number.NaN,
        runs: runs[t.id]!,
        load: {
          before: before[t.id]!,
          after: loadavg(),
          foreignCores: foreignCores[t.id],
          foreignTop: foreignTop[t.id],
        },
      }
    }
    prior.rows[key] = row
    prior.dates[key] = today
    prior.igvVersion = igvVersion
    prior.jbrowseBuild = jbrowseBuild
    prior.jbrowseBuilds = {
      ...prior.jbrowseBuilds,
      ...Object.fromEntries(jbrowseArms.map(a => [a.id, a.build])),
    }
    fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
  }
}

// ---- report ----------------------------------------------------------------

const cells: { key: string; load: LoadWindow; value: number }[] = []
for (const [id, row] of Object.entries(prior.rows)) {
  for (const [tool, cell] of Object.entries(row)) {
    // An unsupported cell carries a zeroed load window and no timing, so it
    // would drag the median load down and read as the quietest cell in the run.
    if (cell.load && !cell.unsupported) {
      cells.push({ key: `${id}/${tool}`, load: cell.load, value: cell.median })
    }
  }
}
const { medianLoad, suspect } = outliers(cells)

const fmt = (c?: Cell) => {
  if (c?.unsupported) {
    return 'n/a'
  }
  return c && Number.isFinite(c.median)
    ? `${c.median.toFixed(0)} ±${c.stddev.toFixed(0)}`
    : 'FAIL'
}

const rowPeak = (row: Row) =>
  Math.max(
    ...Object.values(row).map(c => (c.load && !c.unsupported ? peak(c.load) : 0)),
  )

// Columns come from what the file holds, not only from what this run served. A
// re-run of the 8000 arm alone must not silently drop a v2.4.0 column measured
// last week: the data is still in the JSON, and a table that omits it makes a
// narrower claim than the one on disk.
const recordedArms: Tool[] = Object.entries(prior.jbrowseBuilds ?? {})
  .filter(([id]) => !allTools.some(t => t.id === id))
  .map(([id, build]) => ({
    id,
    label: `JBrowse (${build})`,
    url: () => {
      throw new Error(`${id} was not served this run; serve its port to measure it`)
    },
  }))

const jbFirst = allTools.filter(t => t.id.startsWith('jbrowse'))
const shownTools = [
  ...jbFirst,
  ...recordedArms,
  ...allTools.filter(t => !t.id.startsWith('jbrowse')),
].filter(t => Object.values(prior.rows).some(r => r[t.id]))

const lines: string[] = []
lines.push('# Cross-tool render benchmark: JBrowse vs igv.js, GenomeSpy and Gosling')
lines.push('')
lines.push(
  `JBrowse against igv.js ${prior.igvVersion}, GenomeSpy ${gsVersion} and Gosling ${goslingVersion} — same files, same windows, same instrument. ` +
    `The JBrowse arms are ${Object.values(prior.jbrowseBuilds ?? { jbrowse: prior.jbrowseBuild })
      .map(b => `\`builds/${b}\``)
      .join(', ')}; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.`,
)
lines.push('')
lines.push(
  `Two windows, both on the same contig, the wider one containing the narrower: ${WINDOWS.map(
    w => `**${w.id}** \`${w.loc}\``,
  ).join(', ')}. Same reads, more of them, so a row pair says how each tool scales with what is on screen rather than with what is in the file.`,
)
lines.push('')
lines.push(
  'Three limits decide which cells exist at all, and the table names them rather than leaving a reader to infer them from a suspiciously fast cell:',
)
lines.push('')
lines.push(
  '- **Gosling stops at 20 kb.** `MAX_TILE_WIDTH = 2e4` in its `BamDataFetcher`, checked against every visible tile by `gosling-track.ts:calculateVisibleTiles`, which returns before fetching. Tile width is the declared genome length over 2^zoom, so on this 250 kb assembly the 19 kb window draws and the 100 kb one paints a full axis and no reads. Its 100 kb cells are `n/a`, not a timing — a page that draws nothing settles immediately under this instrument, so timing it would make Gosling the fastest tool in the table at the window it cannot render.',
)
lines.push(
  '- **`tile cap raised` is that same build with the cap patched out**, which is the only way Gosling reaches the wider window. Read the pair, not the patched column alone: a patched library is not the one anyone installs. It also fetches a whole tile rather than the window — 40002 reads at 100 kb on the 20x file against roughly 16000 in view — so it is an upper bound on what an unpatched Gosling would cost at this width even if it could draw it.',
)
lines.push(
  "- **Neither GenomeSpy nor Gosling reads CRAM**, so the format axis stops at BAM for both columns. igv.js and JBrowse carry the CRAM rows.",
)
lines.push('')
lines.push(
  'The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to every column.',
)
lines.push('')
lines.push(
  '**Stable pixels alone were not enough, and the Gosling arms are why.** A page that is working with nothing moving on screen satisfies a pixel-stability test, and Gosling shows a *static* "Fetching" frame for its first few seconds while a worker boots and reads the index — no animation, and no request outstanding either. Measured 2026-08-28, it settled at 2.4 s on an empty plot against a true 7.6 s. So the instrument now also refuses to settle while a corpus read is in flight, and while a harness page exports `__harnessBusy()` returning true; Gosling\'s is `records === 0`, a content gate that adds no constant once the first feature lands. Correcting it moved the stock 19 kb Gosling cell up by roughly half while the ungated igv arm held within 9% across the same runs. **A page that defines no such predicate is measured exactly as before**, so every column other than GenomeSpy and Gosling is unaffected and comparable with the rows recorded before this axis existed.',
)
lines.push('')
lines.push(
  'Three JBrowse arms and one igv.js arm carry the comparison; the remaining igv columns are controls rather than workload knobs:',
)
lines.push('')
lines.push(
  '- **Downsampling.** igv draws at most `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000) and JBrowse draws every read. On this corpus the deepest 100 bp window holds roughly 700 short reads, so the default clips a little and the maximum clips nothing — if the default and `no downsampling` columns agree, downsampling is not what the comparison is measuring.',
)
lines.push(
  "- **Track height.** The harness gives igv a 600 px track; igv's own default for a BAM track is 300, and JBrowse's pileup canvas at this viewport is about 210. igv draws packed rows until it runs out of canvas while JBrowse draws every read it holds and lets the rasterizer clip, so a taller igv track is more igv work and no more JBrowse work. The last two columns are that control, run as its own interleaved pair so it does not disturb the headline ratio.",
)
lines.push('')
lines.push(
  `Median of ${RUNS} runs after ${WARMUP} warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; \`n/a\` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw.`,
)
lines.push('')
lines.push(
  `\`foreign\` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above ${FOREIGN_CORE_CEILING} is contended and its absolute milliseconds are not a run of record. \`load\` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show \`?\`; they were judged against a ${LOAD_CEILING.toFixed(1)} load ceiling, which is the best that can be done with what they recorded.`,
)
lines.push('')
const header = [
  'case',
  'window',
  ...shownTools.map(t => t.label),
  'igv default ÷ JBrowse',
  'measured',
  'foreign',
  'by',
  'load',
]
lines.push(`| ${header.join(' | ')} |`)
lines.push(`|${header.map((_, i) => (i === 0 ? '---' : '---:')).join('|')}|`)
// Row order is window-major within each case, so a case's two windows sit next
// to each other and the pair reads as one comparison.
for (const c of allCases) {
  for (const w of WINDOWS) {
  const key = rowKey(c.id, w.id)
  const row = prior.rows[key]
  if (!row) {
    continue
  }
  const jb = row.jbrowse?.median
  const ratio = (id: string) => {
    const v = row[id]?.median
    return jb && v && Number.isFinite(v) && Number.isFinite(jb)
      ? `${(v / jb).toFixed(2)}×`
      : '—'
  }
  const load = rowPeak(row)
  const foreigns = Object.values(row)
    .filter(cell => !cell.unsupported)
    .map(cell => foreign(cell.load ?? { before: 0, after: 0 }))
    .filter(Number.isFinite)
  const rowForeign = foreigns.length ? Math.max(...foreigns) : Number.NaN
  // Name what burned it. A bare 0.55 cannot be acted on; "tsc" can.
  const by = Object.values(row)
    .filter(
      cell =>
        !cell.unsupported &&
        foreign(cell.load ?? { before: 0, after: 0 }) === rowForeign,
    )
    .map(cell => cell.load?.foreignTop)
    .find(Boolean)
  lines.push(
    `| ${c.id} | ${w.id} | ${shownTools.map(t => (row[t.id] ? fmt(row[t.id]) : '')).join(' | ')} | ${ratio('igv')} | ${prior.dates[key] ?? '?'} | ${Number.isFinite(rowForeign) ? rowForeign.toFixed(2) : '?'} | ${by ?? '—'} | ${load ? load.toFixed(1) : '?'} |`,
  )
  }
}
lines.push('')
lines.push(
  `Median cell load across the matrix: ${Number.isFinite(medianLoad) ? medianLoad.toFixed(2) : '?'}.` +
    (suspect.length
      ? ` Cells measured at more than twice that: ${suspect.map(s => s.key).join(', ')}.`
      : ' No cell stands out from the run.'),
)
lines.push('')
lines.push(
  'A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.',
)
lines.push('')
fs.writeFileSync('results/crosstool.md', lines.join('\n'))
console.log(lines.join('\n'))

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
//   TOOLS=jbrowse,igv,igv-deep  subset of columns
//   RUNS=3 WARMUP=1
import { execFileSync } from 'child_process'
import fs from 'fs'
import { loadavg, outliers, peak, type LoadWindow } from '../render/loadavg.ts'
import { resolveBuild } from '../render/servedbuild.ts'

const RUNS = Number(process.env.RUNS ?? 3)
const WARMUP = Number(process.env.WARMUP ?? 1)
const LOC = 'chr22_mask:124000-143000'
const LOAD_CEILING = 4.0
// igv's samplingDepth is per samplingWindowSize (100 bp). 10000 is igv's own
// MAXIMUM_SAMPLING_DEPTH — it clamps anything larger and logs a warning — and
// is an order of magnitude above the deepest window in this corpus, so nothing
// is dropped.
const DEEP = 10000

const JBROWSE_PORT = 8000
// One port serves every non-JBrowse harness page; the page is chosen by path.
const CROSSTOOL_PORT = Number(process.env.CROSSTOOL_PORT ?? 8003)
const IGV_PORT = CROSSTOOL_PORT

const jbrowseBuild = await resolveBuild(JBROWSE_PORT)
console.log(`port ${JBROWSE_PORT} is serving builds/${jbrowseBuild}`)

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
console.log(`igv.js ${igvVersion}, GenomeSpy ${gsVersion}`)

interface Tool {
  id: string
  label: string
  url: (track: string) => string
}
const allTools: Tool[] = [
  {
    id: 'jbrowse',
    label: `JBrowse (${jbrowseBuild})`,
    url: t =>
      `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${t}&renderer=webgl`,
  },
  {
    id: 'igv',
    label: `igv.js ${igvVersion}`,
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}`,
  },
  {
    id: 'igv-deep',
    label: `igv.js ${igvVersion}, no downsampling`,
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}&depth=${DEEP}`,
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
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}&height=300`,
  },
  {
    id: 'igv-h600ctl',
    label: `igv.js ${igvVersion}, 600 px track (control arm)`,
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}`,
  },
  {
    // GenomeSpy, on the same BAM through its own lazy BAM source and `pileup`
    // transform. It reads its indexed formats through the same @gmod packages
    // JBrowse does, so read this column as renderer-against-renderer over a
    // shared decoder, not as a whole-stack comparison — which is the opposite
    // of what the igv columns are, since igv maintains its own readers.
    //
    // **Preflight this arm with `toolcheck.ts`.** The instrument is paint
    // quiescence, and a harness page that throws settles immediately and
    // reports a very small number: on 2026-08-23 this page was doing exactly
    // that, drawing an error where the reads should be, and its own
    // `__gsState.ready` was true throughout. Nothing had ever driven it.
    id: 'genomespy',
    label: `GenomeSpy ${gsVersion}`,
    url: t =>
      `http://localhost:${CROSSTOOL_PORT}/genomespy.html?loc=${LOC}&track=${t}`,
  },
]
const toolFilter = process.env.TOOLS?.split(',')
const tools = toolFilter
  ? allTools.filter(t => toolFilter.includes(t.id))
  : allTools

const allCases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    allCases.push({ id: `${cov}-${read}`, track: `${cov}.${read}.bam` })
  }
}
const selected = process.env.CASES?.split(',')
const cases =
  process.env.CASES === 'none'
    ? []
    : selected
      ? allCases.filter(c => selected.includes(c.id))
      : allCases

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
}
type Row = Record<string, Cell>

const RESULTS = 'results/crosstool.json'
interface Recorded {
  igvVersion: string
  jbrowseBuild: string
  rows: Record<string, Row>
  dates: Record<string, string>
}
const prior: Recorded = fs.existsSync(RESULTS)
  ? JSON.parse(fs.readFileSync(RESULTS, 'utf8'))
  : { igvVersion, jbrowseBuild, rows: {}, dates: {} }

const today = new Date().toISOString().slice(0, 10)

for (const c of cases) {
  const runs: Record<string, number[]> = {}
  const before: Record<string, number> = {}
  for (const t of tools) {
    runs[t.id] = []
    before[t.id] = loadavg()
    for (let i = 0; i < WARMUP; i++) {
      runOnce(t.url(c.track))
    }
  }
  // interleaved: one round runs every tool, so a load spike lands on all of
  // them rather than on whichever tool owned the clock at the time
  for (let r = 0; r < RUNS; r++) {
    for (const t of tools) {
      const ms = runOnce(t.url(c.track))
      runs[t.id]!.push(ms)
      console.log(`${c.id} ${t.id} run ${r + 1}: ${ms}`)
    }
  }
  const row: Row = prior.rows[c.id] ?? {}
  for (const t of tools) {
    const vals = runs[t.id]!.filter(Number.isFinite)
    row[t.id] = {
      median: vals.length ? median(vals) : Number.NaN,
      mean: vals.length ? mean(vals) : Number.NaN,
      stddev: vals.length ? stddev(vals) : Number.NaN,
      runs: runs[t.id]!,
      load: { before: before[t.id]!, after: loadavg() },
    }
  }
  prior.rows[c.id] = row
  prior.dates[c.id] = today
  prior.igvVersion = igvVersion
  prior.jbrowseBuild = jbrowseBuild
  fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
}

// ---- report ----------------------------------------------------------------

const cells: { key: string; load: LoadWindow; value: number }[] = []
for (const [id, row] of Object.entries(prior.rows)) {
  for (const [tool, cell] of Object.entries(row)) {
    if (cell.load) {
      cells.push({ key: `${id}/${tool}`, load: cell.load, value: cell.median })
    }
  }
}
const { medianLoad, suspect } = outliers(cells)

const fmt = (c?: Cell) =>
  c && Number.isFinite(c.median)
    ? `${c.median.toFixed(0)} ±${c.stddev.toFixed(0)}`
    : 'FAIL'

const rowPeak = (row: Row) =>
  Math.max(...Object.values(row).map(c => (c.load ? peak(c.load) : 0)))

const lines: string[] = []
lines.push('# Cross-tool render benchmark: JBrowse vs igv.js')
lines.push('')
lines.push(
  `JBrowse \`builds/${prior.jbrowseBuild}\` (WebGL2) against igv.js ${prior.igvVersion}, same BAM files, same window \`${LOC}\`, same instrument.`,
)
lines.push('')
lines.push(
  'The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to both columns.',
)
lines.push('')
lines.push(
  '`igv.js` is measured three ways, two of them controls rather than workload knobs:',
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
  `Median of ${RUNS} runs after ${WARMUP} warmup, tools interleaved within each round. \`load\` is the highest 1-minute load average across the row's cells; this box is shared, and a row above ${LOAD_CEILING.toFixed(1)} is not comparable to one measured idle. A blank cell was not measured in the run that produced its row.`,
)
lines.push('')
const header = [
  'case',
  ...allTools.map(t => t.label),
  'igv default ÷ JBrowse',
  'measured',
  'load',
]
lines.push(`| ${header.join(' | ')} |`)
lines.push(`|${header.map((_, i) => (i === 0 ? '---' : '---:')).join('|')}|`)
for (const c of allCases) {
  const row = prior.rows[c.id]
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
  lines.push(
    `| ${c.id} | ${allTools.map(t => (row[t.id] ? fmt(row[t.id]) : '')).join(' | ')} | ${ratio('igv')} | ${prior.dates[c.id] ?? '?'} | ${load ? load.toFixed(1) : '?'} |`,
  )
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
  'A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: both columns of a row are measured within seconds of each other, so a ratio survives load the absolutes do not.',
)
lines.push('')
fs.writeFileSync('results/crosstool.md', lines.join('\n'))
console.log(lines.join('\n'))

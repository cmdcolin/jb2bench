// Cross-tool pan matrix: JBrowse against igv.js, scrolling sideways at constant
// scale, same corpus and same instrument.
//
// This is the cross-tool measurement `results/crosstool.md` is missing. Every
// number there is a cold load, which folds application boot and assembly
// resolution in with the drawing — and boot is the part that says nothing about
// a renderer. The zoom comparison is worse rather than better: the README
// retracts it, because what it timed was a 500 ms JBrowse debounce and not
// JBrowse's pixels.
//
// A pan at constant `bpPerPx` is the interaction where the comparison is
// cleanest. The region is new to both tools so neither serves it from cache;
// the byte volume per step equals the initial render's, so no density cap is
// approached; and both applications are already up. What is left is the cost of
// turning bytes into pixels, which is what the JBrowse-vs-JBrowse pan in
// `results/interaction.md` measures and what nothing has measured across tools.
//
// The three properties that make the cold-load matrix a comparison hold here
// too, and one is added:
//
//   1. One instrument, neither tool's own — `panprofile.ts`, paint quiescence.
//   2. Runs are interleaved, so a load spike on this shared box lands on every
//      tool rather than on whichever owned the clock.
//   3. igv is measured at its default sampling depth and with downsampling
//      effectively off, as a control on whether downsampling is what is being
//      measured.
//   4. NEW: every step records the locus it landed on, in both tools, and the
//      runner checks them against each other. A pan comparison is only a
//      comparison if the two tools visited the same regions, and the two drive
//      differently — JBrowse by `horizontalScroll`, igv by `search` — so that
//      has to be verified rather than assumed.
//
// Usage: node scripts/crosstool/panrunner.ts
//   CASES=20x-shortread,...     subset of rows (CASES=none regenerates report)
//   TOOLS=jbrowse,igv,igv-deep  subset of columns
//   RUNS=3 STEPS=5 PAN_DIR=left
import { execFileSync } from 'child_process'
import fs from 'fs'

import { loadavg, outliers, peak, type LoadWindow } from '../render/loadavg.ts'
import { resolveBuild } from '../render/servedbuild.ts'

const RUNS = Number(process.env.RUNS ?? 3)
const LOC = 'chr22_mask:124000-143000'
const LOAD_CEILING = 4.0
const DEEP = 10000

const JBROWSE_PORT = Number(process.env.JBROWSE_PORT ?? 8000)
const IGV_PORT = Number(process.env.IGV_PORT ?? 8003)

const jbrowseBuild = await resolveBuild(JBROWSE_PORT)
console.log(`port ${JBROWSE_PORT} is serving builds/${jbrowseBuild}`)

const igvVersion = JSON.parse(
  fs.readFileSync('node_modules/igv/package.json', 'utf8'),
).version as string
console.log(`igv.js ${igvVersion}`)

interface Tool {
  id: string
  label: string
  kind: 'jbrowse' | 'igv'
  url: (track: string) => string
}

const allTools: Tool[] = [
  {
    id: 'jbrowse',
    label: `JBrowse (${jbrowseBuild})`,
    kind: 'jbrowse',
    url: t =>
      `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${t}&renderer=webgl`,
  },
  {
    id: 'igv',
    label: `igv.js ${igvVersion}`,
    kind: 'igv',
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}`,
  },
  {
    id: 'igv-deep',
    label: `igv.js ${igvVersion} (depth ${DEEP})`,
    kind: 'igv',
    url: t => `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${t}&depth=${DEEP}`,
  },
]

const toolFilter = process.env.TOOLS?.split(',')
const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.id)) : allTools

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

/**
 * Both tools report a locus, and neither reports it the same way: JBrowse says
 * `chr22_mask:105,001..124,001` and igv says `chr22_mask:104999-124000`. Reduce
 * each to a start so the two can be compared, since what matters is whether
 * they went to the same place and not how they spell it.
 */
function locusStart(s: string): number {
  const m = /:([\d,]+)/.exec(s)
  return m ? Number(m[1]!.replaceAll(',', '')) : Number.NaN
}

interface StepResult {
  step: number
  ms: number
  polls: number
  requests: number
  bytes: number
  locus: string
  target: string
  applied: boolean
}
interface PanResult {
  tool: string
  steps: StepResult[]
  appliedSteps: number
  medianMs: number | null
  cachedSteps: number
  totalRequests: number
  totalBytes: number
  instrument: { kind: string }
  failure?: string
}

function runOnce(url: string, kind: string): PanResult | undefined {
  let out = ''
  try {
    out = execFileSync(
      'node',
      ['--experimental-strip-types', 'scripts/crosstool/panprofile.ts', url, kind],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1 << 22,
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
      },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const line = out.trim().split('\n').pop()
  if (!line) return undefined
  try {
    return JSON.parse(line) as PanResult
  } catch {
    return undefined
  }
}

interface Cell {
  median: number
  /**
   * Median over only those steps that actually issued a data request.
   *
   * The headline number this table wants is "both tools had to fetch, so what
   * is left is drawing" — and that is not automatically what happened. JBrowse
   * reads in 256 KiB blocks, so one fetch can cover about two viewports and half
   * its pan steps are cache hits; igv's never are. Averaging a cache hit into a
   * fetch is how a benchmark ends up comparing two different things and calling
   * the difference rendering.
   */
  fetchedMedian: number
  runs: (number | null)[]
  appliedSteps: number[]
  cachedSteps: number
  requests: number
  bytes: number
  /** canvas draw calls per step, last run — the architectural difference */
  drawsPerStep: number[]
  /** the loci of the last run, so a row can be audited for where it went */
  loci: string[]
  load: LoadWindow
  failures: string[]
}
type Row = Record<string, Cell>

const RESULTS = 'results/crosstool-pan.json'
interface Recorded {
  igvVersion: string
  jbrowseBuild: string
  panDir: string
  steps: number
  rows: Record<string, Row>
  dates: Record<string, string>
  /** cases where the two tools did not visit the same regions */
  locusMismatch: Record<string, string>
}
const prior: Recorded = fs.existsSync(RESULTS)
  ? JSON.parse(fs.readFileSync(RESULTS, 'utf8'))
  : {
      igvVersion,
      jbrowseBuild,
      panDir: process.env.PAN_DIR ?? 'left',
      steps: Number(process.env.STEPS ?? 5),
      rows: {},
      dates: {},
      locusMismatch: {},
    }

const today = new Date().toISOString().slice(0, 10)

for (const c of cases) {
  const runs: Record<string, (number | null)[]> = {}
  const fetchedRuns: Record<string, number[]> = {}
  const applied: Record<string, number[]> = {}
  const loci: Record<string, string[]> = {}
  const failures: Record<string, string[]> = {}
  const before: Record<string, number> = {}
  const cached: Record<string, number> = {}
  const reqs: Record<string, number> = {}
  const bytes: Record<string, number> = {}
  const draws: Record<string, number[]> = {}
  for (const t of tools) {
    runs[t.id] = []
    fetchedRuns[t.id] = []
    applied[t.id] = []
    loci[t.id] = []
    failures[t.id] = []
    before[t.id] = loadavg()
    cached[t.id] = 0
    reqs[t.id] = 0
    bytes[t.id] = 0
    draws[t.id] = []
  }

  // Interleaved: one round runs every tool back to back, so drift lands on all
  // of them rather than on whichever tool owned the clock at the time.
  for (let r = 0; r < RUNS; r++) {
    for (const t of tools) {
      const got = runOnce(t.url(c.track), t.kind)
      if (!got) {
        runs[t.id]!.push(null)
        failures[t.id]!.push('no output')
        console.log(`${c.id} ${t.id} run ${r + 1}: NO OUTPUT`)
        continue
      }
      runs[t.id]!.push(got.medianMs)
      applied[t.id]!.push(got.appliedSteps)
      loci[t.id] = got.steps.filter(s => s.applied).map(s => s.locus)
      const fetched = got.steps.filter(s => s.applied && s.requests > 0)
      if (fetched.length) fetchedRuns[t.id]!.push(median(fetched.map(s => s.ms)))
      cached[t.id] = got.cachedSteps
      reqs[t.id] = got.totalRequests
      bytes[t.id] = got.totalBytes
      draws[t.id] = got.steps.filter(s => s.applied).map(s => s.polls)
      if (got.failure) failures[t.id]!.push(got.failure)
      console.log(
        `${c.id} ${t.id} run ${r + 1}: ${got.medianMs?.toFixed(0) ?? 'FAIL'} ms ` +
          `(${got.appliedSteps} steps, ${got.cachedSteps} cached, ` +
          `${got.totalRequests} reqs)${got.failure ? ` [${got.failure}]` : ''}`,
      )
    }
  }

  const row: Row = prior.rows[c.id] ?? {}
  for (const t of tools) {
    const vals = runs[t.id]!.filter((v): v is number => typeof v === 'number')
    row[t.id] = {
      median: vals.length ? median(vals) : Number.NaN,
      fetchedMedian: fetchedRuns[t.id]!.length
        ? median(fetchedRuns[t.id]!)
        : Number.NaN,
      runs: runs[t.id]!,
      appliedSteps: applied[t.id]!,
      cachedSteps: cached[t.id]!,
      requests: reqs[t.id]!,
      bytes: bytes[t.id]!,
      drawsPerStep: draws[t.id]!,
      loci: loci[t.id]!,
      load: { before: before[t.id]!, after: loadavg() },
      failures: failures[t.id]!,
    }
  }
  prior.rows[c.id] = row
  prior.dates[c.id] = today

  // Did the tools actually visit the same regions? They are driven by different
  // mechanisms, so this is checked rather than assumed — and a mismatch
  // invalidates the row rather than costing it a footnote.
  const jb = row.jbrowse?.loci ?? []
  const ig = row.igv?.loci ?? []
  if (jb.length && ig.length) {
    const n = Math.min(jb.length, ig.length)
    const bad: string[] = []
    for (let i = 0; i < n; i++) {
      const d = Math.abs(locusStart(jb[i]!) - locusStart(ig[i]!))
      if (!(d <= 50)) bad.push(`step ${i + 1}: ${jb[i]} vs ${ig[i]}`)
    }
    if (jb.length !== ig.length) {
      bad.push(`step counts differ: jbrowse ${jb.length}, igv ${ig.length}`)
    }
    if (bad.length) {
      prior.locusMismatch[c.id] = bad.join('; ')
      console.log(`  LOCUS MISMATCH ${c.id}: ${bad.join('; ')}`)
    } else {
      delete prior.locusMismatch[c.id]
    }
  }

  prior.igvVersion = igvVersion
  prior.jbrowseBuild = jbrowseBuild
  fs.mkdirSync('results', { recursive: true })
  fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
}

// ---- report ----------------------------------------------------------------

const cells: { key: string; load: LoadWindow; value: number }[] = []
for (const [id, row] of Object.entries(prior.rows)) {
  for (const [tool, cell] of Object.entries(row)) {
    cells.push({ key: `${id}/${tool}`, load: cell.load, value: cell.median })
  }
}
const hot = outliers(cells)

const shownTools = allTools.filter(t =>
  Object.values(prior.rows).some(r => r[t.id]),
)
const fmt = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}`

const lines: string[] = [
  '# Cross-tool pan: JBrowse against igv.js',
  '',
  `Generated by \`scripts/crosstool/panrunner.ts\`. Pan **${prior.panDir}** by one`,
  `full viewport per step at constant scale, ${prior.steps} steps attempted, from`,
  `the benchmark window \`${LOC}\`. Each cell is the median over ${RUNS} runs of`,
  'each run\'s median step; tools are interleaved within a round.',
  '',
  '## The instrument, and why it is not screenshots',
  '',
  'A step is done when **the page has stopped drawing to any canvas and stopped',
  'fetching**; time-to-content is the last draw before that. Both halves are',
  'necessary and both were arrived at by getting it wrong first.',
  '',
  'The cold-load matrix uses paint quiescence — poll a screenshot, wait for the',
  'hash to repeat — because neither tool\'s own loading state is trustworthy: igv',
  'hides its spinner when features finish *loading*, before drawing them, and',
  "JBrowse's indicator wording moves between releases. That instrument cannot",
  'resolve a pan. It needs six samples at best, and one `page.screenshot()` on',
  'this box measures anywhere from 43 to 161 ms, which puts its own floor between',
  'roughly 450 and 1100 ms — against pans of about that length. Steps duly came',
  'back resolved in exactly the minimum six polls, reporting numbers made almost',
  'entirely of instrument. `results/quiescence.md` has the calibration.',
  '',
  'So `drawclock.ts` patches the canvas drawing APIs instead and timestamps every',
  'call. That asks the platform rather than the application, and costs an array',
  'push rather than a composite and a PNG encode.',
  '',
  'Draws alone are still not enough: JBrowse re-projects the reads it already',
  'holds within a millisecond or two, then goes quiet while it fetches, then draws',
  'again. A detector watching only draws stops at the first gap — measured that',
  'way, JBrowse\'s first pan step read **1.4 ms**, the time to re-project stale',
  'content. Hence the network gate, taken from CDP rather than from a patched',
  '`fetch`, because JBrowse fetches in a worker and a page-side hook would see',
  "igv's requests and none of JBrowse's — the same asymmetry as the screenshots,",
  'reached from another direction.',
  '',
  '`INSTRUMENT=paint` keeps the screenshot detector available for comparison,',
  'and `results/quiescence.md` measures how far apart the two land. Do not assume',
  'a sign for that difference: the natural story — a draw call precedes the',
  'compositor, so draws should read early — is contradicted on a JBrowse cold',
  'load, where draws read 4792 ms against paint\'s 2346 ms, because the page goes',
  'on issuing draw calls after the visible result has settled.',
  '',
  '**Why pan and not cold load.** Every other cross-tool number here is a cold',
  'load, which includes application boot and assembly resolution — the part with',
  'nothing to do with rendering. A pan holds scale fixed, moves to a region the',
  'view did not previously show, and runs against an application that is already',
  'up, so far less of the number is startup. Whether it also made both tools go',
  'to the network is a question the run answers rather than assumes; see "What',
  'each step actually did".',
  '',
  '## Time to content, over the steps where the tool actually fetched',
  '',
  `| case | ${shownTools.map(t => t.label).join(' | ')} | ratio | load | date |`,
  `| --- | ${shownTools.map(() => '---:').join(' | ')} | ---: | ---: | --- |`,
]

/**
 * A tool that fetched on no step has no fetched median, and printing a bare dash
 * throws away a real finding: at 20x-longread JBrowse served all five pan steps
 * from one 256 KiB block, with a full render burst each time. Show its
 * all-steps median instead, daggered, so the cell says "measured, but not the
 * same measurement as its neighbour" rather than "missing".
 */
const cell = (c: Cell | undefined) => {
  if (!c) return { text: '—', comparable: false }
  if (Number.isFinite(c.fetchedMedian)) {
    return { text: `${fmt(c.fetchedMedian)} ms`, comparable: true }
  }
  if (Number.isFinite(c.median)) {
    return { text: `${fmt(c.median)} ms †`, comparable: false }
  }
  return { text: '—', comparable: false }
}

let anyDaggered = false
for (const c of allCases) {
  const row = prior.rows[c.id]
  if (!row) continue
  const cells = shownTools.map(t => cell(row[t.id]))
  if (cells.some(x => x.text.includes('†'))) anyDaggered = true
  const jb = row.jbrowse?.fetchedMedian
  const ig = row.igv?.fetchedMedian
  const ratio =
    jb && ig && Number.isFinite(jb) && Number.isFinite(ig)
      ? `${(ig / jb).toFixed(2)}x`
      : '—'
  const rowPeak = Math.max(
    ...(shownTools.map(t => row[t.id]?.load).filter(Boolean) as LoadWindow[]).map(
      peak,
    ),
  )
  lines.push(
    `| ${c.id} | ${cells.map(x => x.text).join(' | ')} | ${ratio} | ` +
      `${rowPeak.toFixed(1)} | ${prior.dates[c.id] ?? '—'} |`,
  )
}

lines.push(
  '',
  '`ratio` is igv ÷ JBrowse: above 1.0 means JBrowse got content back sooner.',
  ...(anyDaggered
    ? [
        '',
        '`†` is a median over **all** steps rather than fetched ones, because that',
        'tool issued no data request on any of them. It is not a missing',
        'measurement and not a comparable one: on both long-read rows below,',
        'JBrowse rendered fully on every step — the same 45-50 draw burst it shows',
        'everywhere else — while fetching nothing, so what it already held from the',
        'initial load covered the whole five-viewport pan. The ratio is left blank',
        'for those rows rather than dividing a cached median by a fetched one.',
        '',
        '**Why it held that much is not established here.** Long reads force a',
        'wider fetch than the viewport, since a read overlapping the left edge may',
        'start tens of kilobases earlier, and the BAI chunk granularity is coarse',
        'at this depth — but neither of those has been measured against the bytes',
        'the initial load actually pulled. Treat it as an observation about where',
        'the cost went, not an account of the caching.',
      ]
    : []),
  '',
  '## What each step actually did',
  '',
  'This table is not supporting detail; it is the reason the one above is',
  'restricted to fetched steps. **A pan is not automatically the "both tools must',
  'fetch" case.** JBrowse reads in 256 KiB blocks, so at low coverage one request',
  'can cover more than a viewport and some of its pan steps are served entirely',
  'from what it already holds; the `cached` column counts them. Averaging a cache',
  'hit together with a fetch and calling the difference "rendering" is exactly the',
  'error this benchmark exists to avoid.',
  '',
  'A cache hit and a step the detector gave up on before the fetch began look the',
  'same in a request count, and an earlier version of this instrument confused',
  'them — it reported 3 of 5 steps cached at 1000x where the true answer is none.',
  '`draws` is what separates them: a real cache hit still shows a full render',
  'burst, while an abandoned step shows only the handful of draws that',
  're-project stale content.',
  '',
  '`draws` is canvas draw calls per step, and it is the most robust number in',
  'this file: it repeats to within about 1% across runs, because it is a function',
  'of the data and the code rather than of the machine. Like the request counts,',
  'it can be quoted from a contaminated run.',
  '',
  'It is also the architectural difference in one column — three to four orders of',
  'magnitude between a tool that draws through the 2D canvas API and one that',
  'batches the pileup into a handful of GPU draws. **It is not one call per',
  'read.** At 20x-shortread igv issues about 30 calls per read in the window, and',
  'at 200x about 8, so the count grows far more slowly than the read count and',
  'nothing here explains the shape of that. Report the magnitude, not a per-read',
  'rate.',
  '',
  `| case | tool | steps | cached | requests | bytes | draws/step |`,
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
)

for (const c of allCases) {
  const row = prior.rows[c.id]
  if (!row) continue
  for (const t of shownTools) {
    const cell = row[t.id]
    if (!cell) continue
    const d = cell.drawsPerStep ?? []
    const drawRange = d.length
      ? d.length > 1
        ? `${Math.min(...d)}–${Math.max(...d)}`
        : String(d[0])
      : '—'
    lines.push(
      `| ${c.id} | ${t.id} | ${cell.appliedSteps?.at(-1) ?? '—'} | ` +
        `${cell.cachedSteps ?? '—'} | ${cell.requests ?? '—'} | ` +
        `${cell.bytes ? `${(cell.bytes / 1024).toFixed(0)} KB` : '—'} | ${drawRange} |`,
    )
  }
}

lines.push(
  '',
  `\`steps\` is how many of the ${prior.steps} attempted pans applied — a pan stops`,
  'rather than clamps when the next viewport would run off the contig, because a',
  'mostly-empty view scores fast for the same reason a refusal does.',
  '',
  '### Read the load column carefully here',
  '',
  "`README.md` warns that a heavy row does not generate its own load — that was",
  'established for the cold-load matrix, where sampling during a 1000x-longread',
  'render found load already at 35 with `chrome=0`. **It is not true of this',
  'benchmark.** A pan run on the heavier cases sits at `chrome=11` and drives the',
  'load average up by itself, and it does so unequally: the tool issuing a quarter',
  'of a million canvas draws per step is the one making the machine busy.',
  '',
  'So a high `load` on a row here is partly a consequence of the measurement',
  'rather than a contaminant of it, and treating it as automatic grounds to',
  'discard the row would throw away the heavy cases — which are the ones worth',
  'having. The protection that matters is the interleaving: each round runs every',
  'tool back to back, so whatever the machine is doing lands on all of them.',
  '',
)

// Cells that produced no measurement at all. Reported rather than left blank,
// because "this tool could not finish this case" is a result — and the blank it
// would otherwise leave sits in the heaviest row, which is the one the framing
// says to weight most.
const dead: string[] = []
for (const c of allCases) {
  const row = prior.rows[c.id]
  if (!row) continue
  for (const t of shownTools) {
    const cellData = row[t.id]
    if (!cellData || cellData.failures?.length === 0) continue
    if (Number.isFinite(cellData.median)) continue
    dead.push(`\`${c.id}\` / ${t.id}: ${[...new Set(cellData.failures)].join('; ')}`)
  }
}
if (dead.length) {
  lines.push(
    '## Cells that did not complete',
    '',
    ...dead.map(d => `- ${d}`),
    '',
    'A tool that cannot finish a case is a result, not a gap, and it is reported',
    'the way `results/crosstool.md` reports its censored igv rows.',
    '',
    '**igv.js at 1000x-longread is at the browser\'s memory ceiling, not merely',
    'slow.** Diagnosed separately on 2026-08-16: the renderer reaches **2299 MB of',
    'heap** and becomes ready at **80.6 s** — before any pan. Across attempts it',
    'has timed out on a 180 s protocol limit three times, closed its target',
    'outright once, and completed once. igv parses alignments on the main thread,',
    'so a 268 MB BAM lands in one renderer process; JBrowse decodes the same file',
    'in a worker and completed all five pan steps. Read the blank as "not',
    'reliably measurable at this depth" rather than as a large number.',
    '',
  )
}

const mismatches = Object.entries(prior.locusMismatch ?? {})
if (mismatches.length) {
  lines.push(
    '## Locus mismatches — these rows are not comparisons',
    '',
    'The two tools are driven by different mechanisms (JBrowse by',
    '`horizontalScroll`, igv by `search`), so where they actually landed is',
    'checked rather than assumed. These cases disagreed by more than 50 bp and',
    'should not be read as a comparison of anything:',
    '',
    ...mismatches.map(([id, why]) => `- \`${id}\`: ${why}`),
    '',
  )
} else if (Object.keys(prior.rows).length) {
  lines.push(
    'Every measured case agreed on where it panned to, within 50 bp — the two',
    'tools report a locus differently (`105,001..124,001` against',
    '`104999-124000`) but visited the same regions.',
    '',
  )
}

if (hot.suspect.length) {
  lines.push(
    "> Cells measured at more than twice the run's median load " +
      `(${hot.medianLoad.toFixed(1)}): ` +
      `${hot.suspect.map(s => s.key).join(', ')}.`,
    '',
  )
}

const overall = cells.length ? Math.max(...cells.map(c => peak(c.load))) : 0
if (overall > LOAD_CEILING) {
  lines.push(
    `> **Peak 1-minute load across this run was ${overall.toFixed(1)}**, above the`,
    `> ${LOAD_CEILING.toFixed(1)} this repo treats as the ceiling for a quotable`,
    '> absolute. Tools are interleaved within a round, so the ratio column is the',
    '> part that survives; the milliseconds are not a run of record.',
    '',
  )
}

lines.push(
  'Caveats that travel with any external claim: one other tool, one workload',
  'family, one locus, one machine. igv.js parses in the main thread and JBrowse',
  'in workers, and JBrowse boots an application shell where igv mounts a widget.',
  'Those are real architectural differences and they are inside the number — but',
  'less of it than in the cold-load table, which is the reason this measurement',
  'exists.',
  '',
)

fs.writeFileSync('results/crosstool-pan.md', lines.join('\n'))
console.log('\nwrote results/crosstool-pan.md and results/crosstool-pan.json')

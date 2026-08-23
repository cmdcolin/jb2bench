// Orchestrates the alignments render benchmark: every (build x case) pair gets
// a warmup run plus N measured runs of scripts/render/profile.ts, which prints the
// in-page navigation->render-complete time in ms. Aggregates median/mean/stddev
// and writes a markdown comparison table + raw JSON to results/.
import { execFileSync } from 'child_process'
import fs from 'fs'
import { resolveBuild } from './servedbuild.ts'
import { loadavg, outliers, peak, type LoadWindow } from './loadavg.ts'

// RUNS=1 takes a spike: one measured run per cell, enough to see the shape of a
// matrix in minutes rather than in an hour. A spike has no spread, so stddev is
// 0 and the error bars vanish -- it answers "roughly where does this sit" and
// not "is this difference real". The recorded JSON carries the count, so a
// figure drawn from a spike can say which it was.
const RUNS = Number(process.env.RUNS ?? 6)
const WARMUP = Number(process.env.WARMUP ?? 1)
if (!Number.isInteger(RUNS) || RUNS < 1) {
  throw new Error(`RUNS must be a positive integer, got ${process.env.RUNS}`)
}
const LOC = 'chr22_mask:124000-143000' // 19kb, matches historical jb2profile

// renderer pinned to webgl2 for the new branch: WebGPU works but emits Dawn
// validation errors on this Intel/Vulkan stack, so webgl2 is the credible path
// (and the realistic fallback most users hit). Releases ignore the param.
//
// Column headers come from what the ports are actually serving, not from a
// hardcoded guess — see servedbuild.ts for why. The first entry is the build
// under test, whatever it turns out to be, and the speedup column is against it.
// 8004 is the version the 2023 paper describes. The other baselines answer
// "what did this release change"; that one answers "what has changed since the
// version people have read about", which is the question a reader of the 2023
// paper is actually asking. Three years of change land in that column and not
// only the renderer, so it is a cumulative comparison and the report has to say
// so — it is not a second isolation of the same variable.
//
// profile.ts already caps a run at WAIT_TIMEOUT (120 s), so a 2023 build that
// cannot finish 1000x longread fails that cell instead of hanging the matrix.
const ports = [
  { port: 8000, extra: '&renderer=webgl' },
  { port: 8001, extra: '' },
  { port: 8002, extra: '' },
  { port: 8004, extra: '' },
]
const builds = await Promise.all(
  ports.map(async p => ({ ...p, name: await resolveBuild(p.port) })),
)
for (const b of builds) {
  console.log(`port ${b.port} is serving builds/${b.name}`)
}
const UNDER_TEST = builds[0]!.name

// Both formats, because the question the 2023 paper's Fig 8 asks is what a
// format costs at a coverage — CRAM trades bytes on the wire for a reference
// -based decode, and which side of that trade wins is the whole point of
// plotting them beside each other. shell/load_alignments.sh has always staged
// the CRAM tracks; until 2026-08-16 nothing measured them.
const FORMATS = process.env.FORMATS?.split(',') ?? ['bam', 'cram']
const allCases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    for (const fmt of FORMATS) {
      allCases.push({ id: `${cov}-${read}-${fmt}`, track: `${cov}.${read}.${fmt}` })
    }
  }
}

// CASES=1000x-longread re-measures one row without spending 20 minutes on the
// other five. Rows not selected keep their previous values, so the table is not
// blanked — but that means a filtered run mixes vintages, which the report says.
// This exists because contamination lands per-cell: the 2026-08-05 run was fine
// everywhere except the 1000x-longread row, which sat inside a load spike of 16
// to 32 and had to be redone on its own.
// CASES=none measures nothing and just regenerates the report from the recorded
// JSON, for when the presentation changes but the numbers do not.
const selected = process.env.CASES?.split(',')
const cases =
  process.env.CASES === 'none'
    ? []
    : selected
      ? allCases.filter(c => selected.includes(c.id))
      : allCases
if (!cases.length && process.env.CASES !== 'none') {
  throw new Error(
    `CASES matched nothing; known: ${allCases.map(c => c.id).join(',')}`,
  )
}

// Above this 1-minute load average a row is not comparable to one measured on a
// quiet box, and the report says so instead of printing a speedup. A clean run
// on this machine sits at 1.45-2.90; the ceiling is deliberately close to that
// rather than to the load at which numbers become obviously absurd, because the
// damage starts long before it is obvious. On 2026-08-05 the 1000x-longread row
// was attempted twice, at peak loads of 31.9 and 35.4, and release-4.1.15 landed
// at 25187ms and then 56452ms for the same work -- a 2.2x spread between two
// measurements of one unchanged build, which is what an unusable row looks like.
const LOAD_CEILING = 4.0

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

function runOnceRaw(build: (typeof builds)[number], track: string): number {
  const url = `http://localhost:${build.port}/?loc=${LOC}&assembly=hg19mod&tracks=${track}${build.extra}`
  // profile.ts prints the timing on stdout and exits non-zero on render
  // failure; execFileSync throws on non-zero, but still hands back the captured
  // stdout on the thrown error, so read from either path.
  let out = ''
  try {
    out = execFileSync('node', ['scripts/render/profile.ts', url], {
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

// one retry to absorb transient headful-chrome flakiness (occasional render
// timeout under GPU/window contention)
function runOnce(build: (typeof builds)[number], track: string): number {
  const v = runOnceRaw(build, track)
  return Number.isFinite(v) ? v : runOnceRaw(build, track)
}

interface Cell {
  median: number
  mean: number
  stddev: number
  runs: number[]
  /**
   * Load average either side of this cell, so contamination stays attributable.
   * Optional because results recorded before this instrumentation existed —
   * including the 2026-08-05 run this was written in response to — have none.
   */
  load?: LoadWindow
}
// Rows not selected this run keep whatever the last run recorded.
interface Saved {
  results?: Record<string, Record<string, Cell>>
  measuredAt?: Record<string, string>
}
const priorRaw: Saved = fs.existsSync('results/alignments.json')
  ? (JSON.parse(fs.readFileSync('results/alignments.json', 'utf8')) as Saved)
  : {}

// Every row recorded before 2026-08-16 was keyed `<cov>-<read>` and was BAM,
// since BAM was all the runner enumerated. Renaming those keys to carry the
// format they always described keeps three years of measurements on the same
// axis as the CRAM rows rather than stranding them under names nothing reads.
// It relabels, never re-values.
function migrate<T>(byCase: Record<string, T> | undefined) {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(byCase ?? {})) {
    out[/-(bam|cram)$/.test(k) ? k : `${k}-bam`] = v
  }
  return out
}
const prior: Saved = {
  results: migrate(priorRaw.results),
  measuredAt: migrate(priorRaw.measuredAt),
}

const stamp = new Date().toISOString().slice(0, 10)
const measuredAt = { ...prior.measuredAt }

const results: Record<string, Record<string, Cell>> = { ...prior.results }
const measured: { key: string; load: LoadWindow; value: Cell }[] = []

for (const c of cases) {
  results[c.id] = {}
  measuredAt[c.id] = stamp
  for (const b of builds) {
    process.stdout.write(`${c.id} / ${b.name}: `)
    const before = loadavg()
    for (let i = 0; i < WARMUP; i++) {
      runOnce(b, c.track)
    }
    const runs: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const v = runOnce(b, c.track)
      runs.push(v)
      process.stdout.write(Number.isFinite(v) ? `${v.toFixed(0)} ` : 'FAIL ')
    }
    const ok = runs.filter(Number.isFinite)
    const load = { before, after: loadavg() }
    const cell: Cell = {
      median: ok.length ? median(ok) : Number.NaN,
      mean: ok.length ? mean(ok) : Number.NaN,
      stddev: ok.length ? stddev(ok) : Number.NaN,
      runs,
      load,
    }
    results[c.id]![b.name] = cell
    measured.push({ key: `${c.id} / ${b.name}`, load, value: cell })
    process.stdout.write(
      `=> median ${cell.median.toFixed(0)}ms ` +
        `(load ${load.before.toFixed(1)}→${load.after.toFixed(1)})\n`,
    )
  }
}

// A run whose median load looks fine can still contain one badly contaminated
// cell, and that cell is invisible in any per-run summary. Name it instead.
const { medianLoad, suspect } = outliers(measured)
if (suspect.length) {
  console.log(
    `\nWARNING: ${suspect.length} cell(s) measured at more than 2x the run's ` +
      `median load (${medianLoad.toFixed(1)}). Treat these as unverified:`,
  )
  for (const s of suspect) {
    console.log(`  ${s.key} — load peaked at ${peak(s.load).toFixed(1)}`)
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/alignments.json',
  JSON.stringify({ loc: LOC, runs: RUNS, builds, measuredAt, results }, null, 2),
)

// second port is the comparison baseline, named by what it actually serves —
// hardcoding 'release-4.3.0' here would index an undefined cell if the ports
// were ever restaged, which is the failure this whole resolution step exists for
const baseline = builds[1]!.name
let md = `# Alignments render benchmark\n\n`
md += `Region \`${LOC}\` (19kb). In-page navigation→render-complete time, median of ${RUNS} runs (ms). `
md += `Speedup = ${baseline} median ÷ ${UNDER_TEST} median.\n\n`

// Rows can be re-measured independently (CASES=), so the table can hold numbers
// from different runs. Date each row rather than letting the page imply one
// sitting, and carry the load it was taken under, since that is what decides
// whether a row is worth believing.
md += `\`measured\` is when each row was taken and \`load\` the highest 1-minute load average recorded across its cells. This machine is shared: a row measured under load is not comparable to one measured idle, so any row above ${LOAD_CEILING.toFixed(1)} reports **unusable** in place of a speedup rather than a number that looks like a result. \`?\` means the row predates per-cell load recording.\n\n`
// The published version is the 2023 paper's, resolved from port 8004 rather than
// by name so a restaged ports table cannot silently point this column at a
// different build. Its speedup is the one a reader of that paper is asking for;
// the baseline column answers the narrower "what did this release change".
const published = builds.find(b => b.port === 8004)?.name
md += `| case | ${builds.map(b => b.name).join(' | ')} | speedup vs ${baseline} |${published ? ` speedup vs ${published} |` : ''} measured | load |\n`
md += `|---|${builds.map(() => '---:').join('|')}|---:|${published ? '---:|' : ''}---|---:|\n`
const unusable: string[] = []
// A build column can be missing from a row rather than merely stale: adding
// release-2.4.0 gave every previously-recorded row a cell it never had, and
// indexing it blind threw before any markdown was written -- so a run that had
// measured fine produced no table at all. An absent cell prints as an em dash
// and drops out of the speedup and the row load.
for (const c of allCases) {
  const cellOf = (name: string) => results[c.id]?.[name]
  const row = builds.map(b => {
    const cell = cellOf(b.name)
    return cell ? `${cell.median.toFixed(0)} ±${cell.stddev.toFixed(0)}` : '—'
  })
  const base = cellOf(baseline)
  const test = cellOf(UNDER_TEST)
  const sp = base && test ? base.median / test.median : Number.NaN
  const loads = builds
    .map(b => cellOf(b.name))
    .filter(cell => cell !== undefined)
    .map(cell => peak(cell.load ?? { before: 0, after: 0 }))
  const rowLoad = loads.length ? Math.max(...loads) : 0
  const over = rowLoad > LOAD_CEILING
  if (over) {
    unusable.push(c.id)
  }
  const fmt = (v: number) =>
    Number.isFinite(v) ? (over ? '**unusable**' : `${v.toFixed(2)}×`) : '—'
  const pubCell = published
    ? ` ${fmt(cellOf(published) && test ? cellOf(published)!.median / test.median : Number.NaN)} |`
    : ''
  md += `| ${c.id} | ${row.join(' | ')} | ${fmt(sp)} |${pubCell} ${measuredAt[c.id] ?? 'unknown'} | ${rowLoad ? rowLoad.toFixed(1) : '?'} |\n`
}
if (unusable.length) {
  md += `\n> **${unusable.join(', ')}** ${unusable.length === 1 ? 'was' : 'were'} measured on a machine under heavy external load and the timings are not usable. The medians are left in the table because they are what was measured, not because they mean anything; re-run with \`CASES=${unusable.join(',')}\` on an idle box. Judge that the box is idle from \`uptime\` before starting, not from the load at the moment the run begins — on 2026-08-05 a run that started at load 3.15 was at 35 by the time it finished.\n`
}
fs.writeFileSync('results/alignments.md', md)
console.log('\n' + md)
console.log('Wrote results/alignments.json and results/alignments.md')

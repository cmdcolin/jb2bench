// Orchestrates the alignments render benchmark: every (build x case) pair gets
// a warmup run plus N measured runs of scripts/render/profile.ts, which prints the
// in-page navigation->render-complete time in ms. Aggregates median/mean/stddev
// and writes a markdown comparison table + raw JSON to results/.
import { execFileSync } from 'child_process'
import fs from 'fs'

const RUNS = 6
const WARMUP = 1
const LOC = 'chr22_mask:124000-143000' // 19kb, matches historical jb2profile

// renderer pinned to webgl2 for the new branch: WebGPU works but emits Dawn
// validation errors on this Intel/Vulkan stack, so webgl2 is the credible path
// (and the realistic fallback most users hit). Releases ignore the param.
const builds = [
  { name: 'current', port: 8000, extra: '&renderer=webgl' },
  { name: 'release-4.3.0', port: 8001, extra: '' },
  { name: 'release-4.1.15', port: 8002, extra: '' },
]

const cases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    cases.push({ id: `${cov}-${read}`, track: `${cov}.${read}.bam` })
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
}
const results: Record<string, Record<string, Cell>> = {}

for (const c of cases) {
  results[c.id] = {}
  for (const b of builds) {
    process.stdout.write(`${c.id} / ${b.name}: `)
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
    results[c.id]![b.name] = {
      median: ok.length ? median(ok) : Number.NaN,
      mean: ok.length ? mean(ok) : Number.NaN,
      stddev: ok.length ? stddev(ok) : Number.NaN,
      runs,
    }
    process.stdout.write(
      `=> median ${results[c.id]![b.name]!.median.toFixed(0)}ms\n`,
    )
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/alignments.json',
  JSON.stringify({ loc: LOC, runs: RUNS, builds, results }, null, 2),
)

const baseline = 'release-4.3.0'
let md = `# Alignments render benchmark\n\n`
md += `Region \`${LOC}\` (19kb). In-page navigation→render-complete time, median of ${RUNS} runs (ms). `
md += `Speedup = ${baseline} median ÷ current median.\n\n`
md += `| case | ${builds.map(b => b.name).join(' | ')} | speedup vs ${baseline} |\n`
md += `|---|${builds.map(() => '---:').join('|')}|---:|\n`
for (const c of cases) {
  const row = builds.map(b => {
    const cell = results[c.id]![b.name]!
    return `${cell.median.toFixed(0)} ±${cell.stddev.toFixed(0)}`
  })
  const sp = results[c.id]![baseline]!.median / results[c.id]!['current']!.median
  md += `| ${c.id} | ${row.join(' | ')} | ${sp.toFixed(2)}× |\n`
}
fs.writeFileSync('results/alignments.md', md)
console.log('\n' + md)
console.log('Wrote results/alignments.json and results/alignments.md')

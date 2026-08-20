// The paper macros report.ts does not write, because they come from benchmarks
// with their own JSON rather than from bench.json: the 2019 cram-js paper's
// samtools comparison (`make cram-samtools`) and the N-BigWig cohort panel
// (`make cohort`).
//
// Separate from report.ts for two reasons. That script refuses to run when
// bench.json's arms are off-pin, which is the right refusal for the two-point
// speedup table and would otherwise take these numbers down with it. And
// neither benchmark is part of `make bench`, so their results move on their own
// schedule.
//
// What each one gives the paper that the two-point table cannot:
//
//   - **samtools** is the only external baseline in this directory. Every other
//     comparison here is the libraries against their own past, which answers
//     "did we improve" and not "is this fast". The 2019 paper published a
//     cram-js that was an order of magnitude behind htslib; re-running its
//     procedure says where the same library stands now.
//   - **cohort** is the per-file cost the single-file BigWig row cannot show,
//     and it is a count rather than a timing, so it needs no idle machine.
//
//   node --experimental-strip-types report-extras.ts
import { readFileSync, writeFileSync } from 'node:fs'

const here = (p: string) => new URL(p, import.meta.url)
const read = (p: string) => JSON.parse(readFileSync(here(p), 'utf8'))

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!

// ------------------------------------------------------------- samtools ---

interface Arm {
  arm: string
  wallRatio: number | null
  queryRatio: number | null
  agree: number
  runs: number
  failed: number
}
interface Summary {
  fixture: string
  group: string
  length: number
  arms: Arm[]
}

const sam = read('results/cram-samtools.json') as {
  measured: string
  samtools: string
  reps: number
  loadPeak: number
  summaries: Summary[]
}

// The paper's own fixtures only. This repo's simulated corpus is in the same
// JSON and is deliberately left out of the paper table: it is a different
// question — how the library behaves on the corpus everything else here reads —
// and its checksum agreement against samtools is low on both sides for reasons
// nothing has yet explained.
const cells = sam.summaries.filter(s => s.group === 'paper2019')
if (cells.length === 0) {
  throw new Error('no paper2019 cells in cram-samtools.json — run ../shell/fetch_paper2019.sh')
}

// Oldest and newest built cram-js arm, taken from the data rather than named
// here, so adding a major to sweep.json moves the table by itself.
const armTags = [...new Set(cells.flatMap(s => s.arms.map(a => a.arm)))].filter(
  a => a !== 'samtools',
)
const byMajor = (t: string) => Number(t.replace(/^v/, '').split('.')[0])
const sorted = [...armTags].sort((a, b) => byMajor(a) - byMajor(b))
const oldArm = sorted[0]!
const newArm = sorted.at(-1)!

const armOf = (s: Summary, tag: string) => {
  const a = s.arms.find(x => x.arm === tag)
  if (!a || a.failed === a.runs) {
    throw new Error(`${s.fixture} ${s.length}: ${tag} has no complete run`)
  }
  return a
}

const span = (tag: string, pick: (a: Arm) => number | null) => {
  const xs = cells.map(s => pick(armOf(s, tag))).filter((x): x is number => x !== null)
  return [Math.min(...xs), Math.max(...xs)] as const
}

const [procOldMin, procOldMax] = span(oldArm, a => a.wallRatio)
const [procNewMin, procNewMax] = span(newArm, a => a.wallRatio)
const [queryOldMin, queryOldMax] = span(oldArm, a => a.queryRatio)
const [queryNewMin, queryNewMax] = span(newArm, a => a.queryRatio)
const [agreeOldMin, agreeOldMax] = span(oldArm, a => a.agree)
const [agreeNewMin, agreeNewMax] = span(newArm, a => a.agree)

// The 2019 baseline, recomputed from the vendored raw runtimes for the same
// reason cram-samtools.ts recomputes it: the published figure plots means, and
// three of its nine cells are skewed enough that its bars and these medians
// differ by 10%. Restricted to the fixtures the re-run could resolve, so the
// published span and the measured span describe the same files.
const PAPER_FIXTURES: Record<string, string> = {
  low: 'human low-coverage',
  exome: 'human exome',
  high: 'E. coli high-coverage',
}

const published = (() => {
  const tsv = readFileSync(here('paper-2019/cram_js_runtime.tsv'), 'utf8').split('\n')
  const head = tsv[0]!.split('\t')
  const col = (name: string) => head.indexOf(name)
  const by = new Map<string, { cj: number[]; sam: number[] }>()
  for (const line of tsv.slice(1)) {
    if (line.length === 0) continue
    const f = line.split('\t')
    const key = `${f[col('Coverage')]}\t${f[col('Interval Length')]}`
    const e = by.get(key) ?? { cj: [], sam: [] }
    e.cj.push(Number(f[col('CRAM-JS')]))
    e.sam.push(Number(f[col('Samtools')]))
    by.set(key, e)
  }
  return [...by].map(([key, v]) => {
    const [coverage, length] = key.split('\t')
    return {
      fixture: PAPER_FIXTURES[coverage!] ?? coverage!,
      length: Number(length),
      ratio: median(v.cj) / median(v.sam),
    }
  })
})()

const publishedFor = (fixture: string, length: number) => {
  const hit = published.find(p => p.fixture === fixture && p.length === length)
  if (!hit) throw new Error(`no 2019 baseline for ${fixture} ${length}`)
  return hit.ratio
}

const measuredFixtures = new Set(cells.map(s => s.fixture))
const publishedSpan = published
  .filter(p => measuredFixtures.has(p.fixture))
  .map(p => p.ratio)

// ---------------------------------------------------------------- cohort ---

const cohort = read('results/cohort-bw.json') as {
  rows: { build: string; n: number; reads: number; bytes: number }[]
}

// The two sides are named in the build label rather than in a field, so match
// on the label and fail loudly if either side is missing — a silent empty side
// would emit a macro reading the other one's number.
const readsPerFile = (side: '(2023)' | '(current)') => {
  const rows = cohort.rows.filter(r => r.build.includes(side))
  if (rows.length === 0) throw new Error(`no cohort rows for ${side}`)
  const per = [...new Set(rows.map(r => r.reads / r.n))]
  if (per.length !== 1) {
    throw new Error(`${side}: reads per file is not flat across N (${per.join(', ')})`)
  }
  return per[0]!
}

const cohortMaxN = Math.max(...cohort.rows.map(r => r.n))

// ---------------------------------------------------------------- output ---

const x = (n: number) => n.toFixed(1)
const int = (n: number) => Math.round(n).toString()

const macros: [string, string][] = [
  ['samtoolsMeasured', sam.measured],
  ['samtoolsVersion', sam.samtools.replace(/^samtools\s+/, '')],
  ['samtoolsCramOldVer', oldArm.replace(/^v/, '')],
  ['samtoolsCramNewVer', newArm.replace(/^v/, '')],
  ['samtoolsIntervals', String(sam.reps)],
  ['samtoolsPubMin', x(Math.min(...publishedSpan))],
  ['samtoolsPubMax', x(Math.max(...publishedSpan))],
  ['samtoolsProcOldMin', x(procOldMin)],
  ['samtoolsProcOldMax', x(procOldMax)],
  ['samtoolsProcNewMin', x(procNewMin)],
  ['samtoolsProcNewMax', x(procNewMax)],
  ['samtoolsQueryOldMin', x(queryOldMin)],
  ['samtoolsQueryOldMax', x(queryOldMax)],
  ['samtoolsQueryNewMin', x(queryNewMin)],
  ['samtoolsQueryNewMax', x(queryNewMax)],
  ['samtoolsAgreeOldMin', int(agreeOldMin)],
  ['samtoolsAgreeOldMax', int(agreeOldMax)],
  ['samtoolsAgreeNewMin', int(agreeNewMin)],
  ['samtoolsAgreeNewMax', int(agreeNewMax)],
  ['cohortFiles', int(cohortMaxN)],
  ['cohortReadsOld', int(readsPerFile('(2023)'))],
  ['cohortReadsNew', int(readsPerFile('(current)'))],
]

for (const [name, value] of macros) {
  if (!value || value.includes('NaN')) {
    throw new Error(`macro \\${name} came out as "${value}" — the run is incomplete`)
  }
}

const banner = `% Generated by jb2bench/ecosystem/report-extras.ts. Do not edit.
% Regenerate with \`make cram-samtools\` and \`make cohort\` there, then
% \`make report-extras\`, then \`make sync-benchmarks\` in the paper.`

writeFileSync(
  here('results/paper/parser-extras.tex'),
  `${banner}\n${macros.map(([n, v]) => `\\newcommand{\\${n}}{${v}}`).join('\n')}\n`,
)

const kb = (n: number) => `${n / 1000} kb`
const rows = cells
  .map(
    s =>
      `${s.fixture} & ${kb(s.length)} & ${x(publishedFor(s.fixture, s.length))}$\\times$ & ` +
      `${x(armOf(s, oldArm).wallRatio!)}$\\times$ & ${x(armOf(s, newArm).wallRatio!)}$\\times$ & ` +
      `${x(armOf(s, oldArm).queryRatio!)}$\\times$ & ${x(armOf(s, newArm).queryRatio!)}$\\times$ \\\\`,
  )
  .join('\n')

const header =
  'Fixture & Interval & Published & Process & Process & Query & Query \\\\\n' +
  ` &  & 2019 & ${oldArm} & ${newArm} & ${oldArm} & ${newArm} \\\\`

writeFileSync(
  here('results/paper/parser-samtools.tex'),
  `${banner}
\\begin{longtable}[]{@{}llrrrrr@{}}
\\caption{\\label{tab:cram-samtools}The 2019 cram-js benchmark re-run, on its own
corpus and its own procedure. Every cell is the ratio of cram-js to
\\texttt{samtools ${sam.samtools.replace(/^samtools\s+/, '')}} over the same
${sam.reps} random intervals, taken per interval and then as a median; lower is
closer to htslib. \\emph{Published} recomputes the ratio the 2019 paper measured
from its own raw runtimes, on its own machine. \\emph{Process} repeats its
procedure here, timing whole processes on both sides, and \\emph{Query} excludes
node's startup, the module load and the index parse, which is what a browser
pays after it has loaded the library once.}\\tabularnewline
\\toprule\\noalign{}
${header}
\\midrule\\noalign{}
\\endfirsthead
\\toprule\\noalign{}
${header}
\\midrule\\noalign{}
\\endhead
\\bottomrule\\noalign{}
\\endlastfoot
${rows}
\\end{longtable}
`,
)

console.log('wrote results/paper/parser-extras.tex and results/paper/parser-samtools.tex')

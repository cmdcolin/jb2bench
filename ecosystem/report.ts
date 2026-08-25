// Turn the raw vitest bench output into results/ecosystem.md, and into the
// LaTeX the paper reads.
//
// The paper holds no hand-typed benchmark number. Every figure it states comes
// from results/paper/*.tex, which this writes, so re-running the benchmark and
// re-syncing is the only way those numbers change. That is the whole point: a
// constant copied into prose is a constant that goes stale silently.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

interface Bench {
  name: string
  mean: number
  hz: number
  rme: number
}

const here = (p: string) => new URL(p, import.meta.url)
const readJson = (p: string) => JSON.parse(readFileSync(here(p), 'utf8'))

const raw = readJson('results/bench.json')
const versions = readJson('versions.json')
const zarr = readJson('zarr.json')

const lib = (name: string) => {
  const l = versions.libraries.find((x: any) => x.name === name)
  if (!l) throw new Error(`no library "${name}" in versions.json`)
  return l
}
const tag = (name: string, side: 'old' | 'new') => lib(name)[side].tag

let equivalenceData: any
try {
  equivalenceData = readJson('results/equivalence.json')
} catch {
  equivalenceData = undefined
}

// vitest's shape has moved between versions; accept either files[].groups[] or a
// flat testResults map, and fail loudly rather than emit an empty table.
interface Group {
  name: string
  benches: Bench[]
}

function groups(): Group[] {
  const out: Group[] = []
  for (const f of raw.files ?? []) {
    for (const g of f.groups ?? []) {
      out.push({
        name: (g.fullName ?? g.name).replace(/^.*\.bench\.ts > /, ''),
        benches: (g.benchmarks ?? []).map((b: any) => ({
          name: b.name,
          mean: b.mean,
          hz: b.hz,
          rme: b.rme,
        })),
      })
    }
  }
  if (out.length === 0) {
    throw new Error('no benchmark groups found in results/bench.json')
  }
  return out
}

// bench.json is a measurement; versions.json is a pin. When they disagree the
// pin moved and the numbers did not, and every version this report prints would
// name a build that produced none of them. That is not hypothetical: until
// 2026-08-18 the pins said the 2023 side was @gmod/bam v2.0.0 while the paper's
// v2.4.0 shipped 1.1.18, and the table published the wrong one for months
// because nothing compared the two files. Refuse rather than relabel.
const pinnedTags = new Set<string>(
  versions.libraries.flatMap((l: any) => [l.old.tag, l.new.tag]),
)
const measuredTags = new Set<string>()
for (const g of groups()) {
  for (const b of g.benches) {
    const v = /^v\d+\.\d+\.\d+/.exec(b.name)?.[0]
    if (v) {
      measuredTags.add(v)
    }
  }
}
const stalePins = [...measuredTags].filter(v => !pinnedTags.has(v))
if (stalePins.length) {
  throw new Error(
    `results/bench.json holds timings for ${stalePins.join(', ')}, which ` +
      'versions.json no longer pins. Re-run `./setup.sh && make time` before ' +
      '`make report` — relabelling old numbers with new pins is the one thing ' +
      'this report must not do.',
  )
}

interface Row {
  name: string
  old: Bench
  new: Bench
  ratio: number
  /** percent the current release is slower; negative when it is faster */
  slowerPct: number
}

const rows: Row[] = []
const unpaired: Group[] = []
for (const g of groups()) {
  if (g.benches.length !== 2) {
    unpaired.push(g)
    continue
  }
  const [o, n] = g.benches
  rows.push({
    name: g.name,
    old: o,
    new: n,
    ratio: o.mean / n.mean,
    slowerPct: ((n.mean - o.mean) / o.mean) * 100,
  })
}

const find = (pred: (r: Row) => boolean) => rows.filter(pred)
const byKind = (kind: string) => find(r => r.name.startsWith(kind))
const one = (name: string) => {
  const r = rows.find(x => x.name === name)
  if (!r) throw new Error(`benchmark case "${name}" is missing from bench.json`)
  return r
}

// ---------------------------------------------------------------- markdown ---

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))

const mdRows = rows.map(
  r =>
    `| ${r.name} | ${fmt(r.old.mean)} ms ±${r.old.rme.toFixed(1)}% | ` +
    `${fmt(r.new.mean)} ms ±${r.new.rme.toFixed(1)}% | ${r.ratio.toFixed(2)}x | ` +
    `${(-r.slowerPct).toFixed(0)}% |`,
)
for (const g of unpaired) {
  mdRows.push(`| ${g.name} | (${g.benches.length} benches, not a pair) | | | |`)
}

// A library named in versions.json with no rows in bench.json was added after
// the last `make time`. Derived rather than written into the template as prose:
// prose would have to be deleted by hand once the gap closed, and would not be,
// so the docs would go on claiming a gap that no longer existed. This line
// removes itself on the next full run.
const missingLibs = versions.libraries.filter(
  (l: any) => l.rowPrefix && !rows.some(r => r.name.startsWith(l.rowPrefix)),
)
const staleNote = missingLibs.length
  ? `\n> **${missingLibs.map((l: any) => `\`${l.package}\``).join(' and ')} ` +
    `${missingLibs.length === 1 ? 'is' : 'are'} missing from this table.** ` +
    `${missingLibs.length === 1 ? 'It was' : 'They were'} added to ` +
    '`versions.json` after the last `make time`; re-run it (or `make bench`) to ' +
    'fill the rows in.\n'
  : ''

let equivalence = '\n(no equivalence.json; run `make verify` first)\n'
if (equivalenceData) {
  const changed = equivalenceData.deltas.filter(
    (d: any) => d.kind !== 'cram-lengthOnRef' && (d.gained || d.lostBoundary),
  )
  equivalence =
    changed.length === 0
      ? '\nEvery case returned identical results on both sides.\n'
      : '\n| case | 2023 | current | the 2023 release missed | omitted at the window edge |\n' +
        '| --- | --- | --- | --- | --- |\n' +
        changed
          .map(
            (d: any) =>
              `| ${d.kind} ${d.case} | ${d.old} | ${d.new} | ${d.gained} | ${d.lostBoundary} |`,
          )
          .join('\n') +
        '\n'

  const spans = equivalenceData.deltas.filter((d: any) => d.kind === 'cram-lengthOnRef')
  if (spans.length) {
    equivalence +=
      '\n### CRAM reference spans, against the BAM holding the same alignments\n\n' +
      `| case | ${tag('cram-js', 'old')} agrees | current agrees | of |\n| --- | --- | --- | --- |\n` +
      spans.map((d: any) => `| ${d.case} | ${d.old} | ${d.new} | ${d.compared} |`).join('\n') +
      `\n\n${tag('cram-js', 'old')} derives a long read's reference span wrongly; the current\n` +
      'release reproduces the BAM exactly. Short reads were always correct in both.\n'
  }
}

let manifest = '(no manifest; run ./setup.sh)'
try {
  manifest = readFileSync(here('.libs/manifest.txt'), 'utf8')
} catch {
  /* keep the placeholder */
}

mkdirSync(here('results/'), { recursive: true })
writeFileSync(
  here('results/ecosystem.md'),
  `# Parser libraries: 2023 release vs current

Same corpus and same window as the render benchmarks: simulated alignments over
a 250 kb slice of hg19 chr22, window \`chr22_mask:124000-143000\` (19 kb).

Both sides are built from source from a pinned GitHub tag with the same
toolchain, so the difference is library code rather than a change of transpiler
target or module format. \`old\` is the version JBrowse 2 depended on at the 2023
paper; \`new\` is the current release.

| case | 2023 | current | speedup | time cut |
| --- | --- | --- | --- | --- |
${mdRows.join('\n')}
${staleNote}
## Do both sides return the same thing?

Checked by \`equivalence.test.ts\`, which runs before these timings and fails if
the current release drops any record that lies inside the window.
${equivalence}
## Versions measured

\`\`\`
${manifest}\`\`\`

Generated by \`report.ts\`; raw numbers in \`results/bench.json\`.
`,
)

// ------------------------------------------------------------------- LaTeX ---

const CASES = [
  { key: '20x shortread', label: '20x short read' },
  { key: '200x shortread', label: '200x short read' },
  { key: '1000x shortread', label: '1000x short read' },
  { key: '20x longread', label: '20x long read' },
  { key: '200x longread', label: '200x long read' },
  { key: '1000x longread', label: '1000x long read' },
]

const COLUMNS = [
  { head: 'BAM', prefix: 'bam ' },
  { head: 'CRAM', prefix: 'cram ' },
  { head: 'BGZF', prefix: 'bgzf browser path ' },
]

// Bold any case the current release lost, matching how tab:initial-render marks
// its one regression. A rule over the data rather than a judgement, so the
// emphasis cannot drift out of step with the numbers on a re-run.
const bodyRows = CASES.map(c => {
  const cells = COLUMNS.map(col => {
    const r = rows.find(x => x.name === `${col.prefix}${c.key}`)
    if (!r) return '---'
    const cell = `${r.ratio.toFixed(2)}x`
    return r.ratio < 1 ? `\\textbf{${cell}}` : cell
  })
  return `${c.label} & ${cells.join(' & ')} \\\\`
})

writeFileSync(
  here('results/paper/parser-speedup.tex'),
  `% Generated by jb2bench/ecosystem/report.ts. Do not edit.
% Regenerate with \`make bench\` there, then \`make sync-benchmarks\` here.
\\begin{longtable}[]{@{}lrrr@{}}
\\caption{\\label{tab:parser-speedup}Parsing a 19 kb window, current release against the
version in use in 2023. Ratio of mean wall-clock; BGZF is the pure-JavaScript
path both releases run in a browser. The BGZF column has no 1000$\\times$ rows:
BAM is BGZF end to end, so decompressing those files whole would time garbage
collection rather than the codec.}\\tabularnewline
\\toprule\\noalign{}
Case & ${COLUMNS.map(c => c.head).join(' & ')} \\\\
\\midrule\\noalign{}
\\endfirsthead
\\toprule\\noalign{}
Case & ${COLUMNS.map(c => c.head).join(' & ')} \\\\
\\midrule\\noalign{}
\\endhead
\\bottomrule\\noalign{}
\\endlastfoot
${bodyRows.join('\n')}
\\end{longtable}
`,
)

// --- the inline numbers -------------------------------------------------------

const ver = (name: string, side: 'old' | 'new') => lib(name)[side].tag.replace(/^v/, '')

const secs = (r: Row, side: 'old' | 'new') => (r[side].mean / 1000).toFixed(1)

const bgzfNode = byKind('bgzf node path ')

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

const gainedBam = equivalenceData
  ? equivalenceData.deltas.filter((d: any) => d.kind === 'bam' && d.gained > 0)
  : []
const cramSpans = equivalenceData
  ? equivalenceData.deltas.filter(
      (d: any) => d.kind === 'cram-lengthOnRef' && d.case.includes('longread'),
    )
  : []

const bamPeak = one('bam 1000x longread')
const cramPeak = one('cram 1000x longread')

// The span the prose quotes for "the parsing layer got N times faster": the
// record readers, which is what that sentence is about. Stated to one decimal
// rather than rounded to whole numbers, so it never flatters the result.
const readerRatios = [...byKind('bam '), ...byKind('cram ')].map(r => r.ratio)

const macros: [string, string][] = [
  ['parserPinDate', versions.pinDateProse],
  ['parserBamOldVer', ver('bam-js', 'old')],
  ['parserBamNewVer', ver('bam-js', 'new')],
  ['parserCramOldVer', ver('cram-js', 'old')],
  ['parserCramNewVer', ver('cram-js', 'new')],
  ['parserBgzfOldVer', ver('bgzf-filehandle', 'old')],
  ['parserBgzfNewVer', ver('bgzf-filehandle', 'new')],
  ['parserBbiOldVer', ver('bbi-js', 'old')],
  ['parserBbiNewVer', ver('bbi-js', 'new')],
  ['parserBamPeakOld', secs(bamPeak, 'old')],
  ['parserBamPeakNew', secs(bamPeak, 'new')],
  ['parserCramPeakOld', secs(cramPeak, 'old')],
  ['parserCramPeakNew', secs(cramPeak, 'new')],
  ['parserBgzfNodeMin', Math.min(...bgzfNode.map(r => r.ratio)).toFixed(2)],
  ['parserBgzfNodeMax', Math.max(...bgzfNode.map(r => r.ratio)).toFixed(2)],
  ['parserReaderMin', Math.min(...readerRatios).toFixed(1)],
  ['parserReaderMax', Math.max(...readerRatios).toFixed(1)],
  ['parserBamGained', list(gainedBam.map((d: any) => String(d.gained)))],
  ['parserCramSpans', list(cramSpans.map((d: any) => `${d.old} of ${d.compared}`))],
  ['zarrSamples', zarr.samples.toLocaleString('en-US')],
  ['zarrPanel', zarr.panel],
  ['zarrBwRequests', zarr.bigwigs.requests.toLocaleString('en-US')],
  ['zarrBwMb', String(zarr.bigwigs.megabytes)],
  ['zarrBwSeconds', String(zarr.bigwigs.seconds)],
  ['zarrStoreRequests', String(zarr.zarr.requests)],
  ['zarrStoreMb', String(zarr.zarr.megabytes)],
  ['zarrStoreSeconds', String(zarr.zarr.seconds)],
]

for (const [name, value] of macros) {
  if (value === undefined || value === '' || value.includes('NaN')) {
    throw new Error(`macro \\${name} came out as "${value}" — the run is incomplete`)
  }
}

writeFileSync(
  here('results/paper/parser-numbers.tex'),
  `% Generated by jb2bench/ecosystem/report.ts. Do not edit.
% Regenerate with \`make bench\` there, then \`make sync-benchmarks\` here.
${macros.map(([n, v]) => `\\newcommand{\\${n}}{${v}}`).join('\n')}
`,
)

// ------------------------------------------------------------------ README ---

// README.md is rendered from README.template.md rather than maintained by hand,
// for the same reason the paper is: it quotes a dozen measured numbers, and a
// hand-kept copy of a number is a number that goes stale without anyone noticing.
// The prose lives in the template; only the values come from here.

// Entries carrying an `axis` are measured on something other than the
// 2023-vs-current-on-one-file axis this table is about — `vcf-js-scan` is a
// single-release before/after, `bbi-js` is a per-file cost that only shows up
// with the file count as the axis — so they are listed under it rather than in
// it, where a reader would take them for a row that exists.
const versionsTable = [
  '| library | 2023 | current |',
  '| --- | --- | --- |',
  ...versions.libraries
    .filter((l: any) => !l.axis)
    .map((l: any) => `| \`${l.package}\` | ${l.old.tag} | ${l.new.tag} |`),
  '',
  ...versions.libraries
    .filter((l: any) => l.axis === 'scan')
    .map(
      (l: any) =>
        `Plus one narrower pair, on its own axis: \`${l.package}\` ` +
        `${l.old.tag} against ${l.new.tag}, which isolates the genotype-scan ` +
        `rewrite. Measured by \`make scan\`, reported in ` +
        '[`results/vcf-scan.md`](results/vcf-scan.md).',
    ),
  ...versions.libraries
    .filter((l: any) => l.axis === 'cohort')
    .map(
      (l: any) =>
        `And one pinned pair with no row above: \`${l.package}\` ` +
        `${l.old.tag} against ${l.new.tag}. Its cost is per *file*, so one file ` +
        'measures the wrong thing; `make cohort` makes the file count the axis ' +
        'and reports it in [`results/cohort-bw.md`](results/cohort-bw.md). Why ' +
        'the single-file row was withdrawn is in `versions.json`.',
    ),
].join('\n')

const zarrTable = [
  '| | requests | bytes | time |',
  '| --- | --- | --- | --- |',
  `| ${zarr.samples.toLocaleString('en-US')} BigWigs | ${zarr.bigwigs.requests.toLocaleString('en-US')} | ${zarr.bigwigs.megabytes} MB | ${zarr.bigwigs.seconds} s |`,
  `| one Zarr store | ${zarr.zarr.requests} | ${zarr.zarr.megabytes} MB | ${zarr.zarr.seconds} s |`,
].join('\n')

const speedupTable = [
  '| case | 2023 | current | speedup |',
  '| --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.name} | ${fmt(r.old.mean)} ms | ${fmt(r.new.mean)} ms | ${r.ratio.toFixed(2)}x |`),
  staleNote,
].join('\n')

const bindings = new Map<string, string>([
  ...macros,
  ['versionsTable', versionsTable],
  ['zarrTable', zarrTable],
  ['speedupTable', speedupTable],
  ['zarrRegion', zarr.region],
  ['pinRev', versions.pinRev],
  ['pinDateIso', versions.pinDate],
])

const template = readFileSync(here('README.template.md'), 'utf8')
const rendered = template.replaceAll(/\{\{(\w+)\}\}/g, (_m, name: string) => {
  const v = bindings.get(name)
  if (v === undefined) {
    throw new Error(`README.template.md references {{${name}}}, which report.ts does not define`)
  }
  return v
})
const leftover = /\{\{(\w+)\}\}/.exec(rendered)
if (leftover) throw new Error(`unrendered placeholder ${leftover[0]}`)

writeFileSync(
  here('README.md'),
  `<!-- Generated from README.template.md by report.ts. Do not edit; edit the template. -->\n${rendered}`,
)

console.log(`wrote results/ecosystem.md`)
console.log(`wrote results/paper/parser-speedup.tex (${bodyRows.length} rows)`)
console.log(`wrote results/paper/parser-numbers.tex (${macros.length} macros)`)
console.log(`wrote README.md from README.template.md`)

// The 100-BigWig cohort: what a per-sample signal panel costs to open.
//
// The two-point table measured @gmod/bbi on one file until 2026-08-25 and
// reported 1-3 ms, flat to slightly negative. The reason is structural rather
// than a matter of picking a bigger file: most of what it costs to answer a
// BigWig query is per-file and paid before any data is touched — the header, the
// chromosome B+ tree, then a descent of the R-tree to find which blocks overlap.
// Measured once, that cost is a rounding error. A cohort panel pays it once per
// sample, and 2,504 of them is the workload behind the Zarr comparison this
// directory already reports. So that row is gone and this benchmark is what
// replaced it; versions.json records the second reason it went.
//
// So this benchmark is the same library on the same window, with N as the axis.
// It reports two things that answer different questions:
//
//   Request shape — how many reads, and how many bytes, to answer the query
//   across N files. Counted, not timed, so it is exact and identical on every
//   machine: this half needs no idle box and does not decay. It is also the
//   half that transfers to the network, where each read is a range request and
//   a round trip, and round trips are what a panel actually waits on.
//
//   Time — the CPU and syscall cost of the same work, sequential, one process
//   per version. This half is a timing on a shared box like everything else
//   here and carries the same caveat: above load 4.0, read the ratios.
//
// Sequential on purpose. A browser opens N tracks concurrently, so the wall
// clock a user sees is not this number; what overlapping hides is exactly the
// per-file cost being measured, and the request count is unchanged by it.
//
//   ./../shell/generate_cohort_bw.sh 100      # corpus, once
//   node --experimental-strip-types cohort-bw.ts
//   SWEEP=1 node --experimental-strip-types cohort-bw.ts   # every built major
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { END, REF, START } from './lib/corpus.ts'
import { countingFile } from './lib/counting-filehandle.ts'

const SELF = fileURLToPath(import.meta.url)
const here = (p: string) => new URL(p, import.meta.url)
const COHORT = fileURLToPath(here('../data/cohort/'))

const ROUNDS = Number(process.env.ROUNDS ?? 5)
const INNER = Number(process.env.INNER ?? 3)
const SIZES = (process.env.SIZES ?? '1,10,100').split(',').map(Number)

const sampleFiles = (n: number) =>
  Array.from({ length: n }, (_, i) => `${COHORT}sample${String(i).padStart(3, '0')}.bw`)

// ------------------------------------------------------------------- arm ---

// The counting filehandle is shared with sweep.ts, which counts the same way
// on BAM and CRAM. Only the counting arm uses it: the timing arm passes a plain
// path, so no wrapper sits in a measured path.

async function armCount(dir: string, n: number) {
  const { BigWig } = await import(`${dir}/esm/index.js`)
  let reads = 0
  let bytes = 0
  let features = 0
  // The first file's read sizes, in order. Every sample takes the same path
  // through the same file layout, so one file's pattern is the pattern — and a
  // count on its own says a version issues one more read without saying which,
  // which is the part a library author can act on.
  let pattern: number[] = []
  for (const file of sampleFiles(n)) {
    const { handle, counter } = await countingFile(dir, file)
    const bw = new BigWig({ filehandle: handle })
    features += (await bw.getFeatures(REF, START, END)).length
    reads += counter.reads
    bytes += counter.bytes
    if (pattern.length === 0) pattern = counter.sizes
    await handle.close()
  }
  console.log(JSON.stringify({ reads, bytes, features, pattern }))
}

async function armTime(dir: string, n: number) {
  const { BigWig } = await import(`${dir}/esm/index.js`)
  const files = sampleFiles(n)
  // A fresh BigWig per file per pass: the header and index caches live on the
  // instance, and reusing them across passes would measure the cache rather
  // than the open — which is the cost this benchmark exists to find.
  const pass = async () => {
    let total = 0
    for (const file of files) {
      const bw = new BigWig({ path: file })
      total += (await bw.getFeatures(REF, START, END)).length
    }
    return total
  }
  const features = await pass()
  await pass()
  const ts: number[] = []
  for (let i = 0; i < INNER; i++) {
    const t = performance.now()
    await pass()
    ts.push(performance.now() - t)
  }
  ts.sort((a, b) => a - b)
  console.log(`${ts[0]!.toFixed(4)} ${features}`)
}

if (process.argv[2] === '--arm') {
  const mode = process.argv[3]
  const dir = process.argv[4]!
  const n = Number(process.argv[5])
  if (mode === 'count') {
    await armCount(dir, n)
  } else {
    await armTime(dir, n)
  }
  process.exit(0)
}

// ---------------------------------------------------------------- driver ---

if (!existsSync(`${COHORT}sample000.bw`)) {
  console.error(`no cohort corpus at ${COHORT} — run shell/generate_cohort_bw.sh`)
  process.exit(1)
}

interface Build {
  label: string
  dir: string
}

const builds: Build[] = []
const versionsCfg = JSON.parse(readFileSync(here('versions.json'), 'utf8'))
const bbi = versionsCfg.libraries.find((l: any) => l.name === 'bbi-js')

for (const side of ['old', 'new'] as const) {
  const dir = fileURLToPath(here(`.libs/bbi-js/${side}`))
  if (existsSync(`${dir}/esm/index.js`)) {
    builds.push({ label: `${bbi[side].tag}${side === 'old' ? ' (2023)' : ' (current)'}`, dir })
  }
}

if (process.env.SWEEP) {
  const sweepCfg = JSON.parse(readFileSync(here('sweep.json'), 'utf8'))
  const lib = sweepCfg.libraries.find((l: any) => l.name === 'bbi-js')
  builds.length = 0
  for (const v of lib.versions) {
    const dir = fileURLToPath(here(`.libs/bbi-js/sweep/${v.tag}`))
    if (existsSync(`${dir}/esm/index.js`)) builds.push({ label: v.tag, dir })
  }
}

if (builds.length === 0) {
  console.error('no @gmod/bbi builds found — run ./setup.sh (or ./setup-sweep.sh)')
  process.exit(1)
}

function arm(mode: string, dir: string, n: number) {
  return execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      fileURLToPath(here('lib/legacy-resolve-register.mjs')),
      SELF,
      '--arm',
      mode,
      dir,
      String(n),
    ],
    { encoding: 'utf8', maxBuffer: 1 << 20 },
  ).trim()
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!
const loadAvg = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0])

interface Row {
  build: string
  n: number
  reads: number
  bytes: number
  features: number
  pattern: number[]
  ms: number | null
}

const rows: Row[] = []
const loads: number[] = []

// Counting first, and separately: it is exact, so it wants no repetition, and
// keeping it out of the timed loop means the wrapper never sits in a timing.
console.log('## request shape (exact, machine-independent)\n')
console.log(
  `${'build'.padEnd(20)}${'N'.padStart(5)}${'reads'.padStart(9)}${'bytes'.padStart(11)}${'reads/file'.padStart(12)}`,
)
const counted = new Map<
  string,
  { reads: number; bytes: number; features: number; pattern: number[] }
>()
for (const b of builds) {
  for (const n of SIZES) {
    const got = JSON.parse(arm('count', b.dir, n))
    counted.set(`${b.label}|${n}`, got)
    console.log(
      `${b.label.padEnd(20)}${String(n).padStart(5)}${String(got.reads).padStart(9)}` +
        `${String(got.bytes).padStart(11)}${(got.reads / n).toFixed(1).padStart(12)}`,
    )
  }
}

console.log('\n## time (sequential opens, one process per version)\n')
const times = new Map<string, number[]>()
for (let r = 0; r < ROUNDS; r++) {
  loads.push(loadAvg())
  for (let k = 0; k < builds.length; k++) {
    // Rotate, so drift over a round does not line up with the version axis.
    const b = builds[(k + r) % builds.length]!
    for (const n of SIZES) {
      const key = `${b.label}|${n}`
      const [ms] = arm('time', b.dir, n).split(' ')
      if (!times.has(key)) times.set(key, [])
      times.get(key)!.push(Number(ms))
    }
  }
}

for (const b of builds) {
  for (const n of SIZES) {
    const key = `${b.label}|${n}`
    const c = counted.get(key)!
    rows.push({
      build: b.label,
      n,
      reads: c.reads,
      bytes: c.bytes,
      features: c.features,
      pattern: c.pattern,
      ms: median(times.get(key)!),
    })
  }
}
for (const row of rows) {
  console.log(
    `${row.build.padEnd(20)}${String(row.n).padStart(5)}${`${row.ms!.toFixed(2)} ms`.padStart(12)}`,
  )
}

// ---------------------------------------------------------------- report ---

const peak = Math.max(...loads)
mkdirSync(here('results/'), { recursive: true })
writeFileSync(
  here('results/cohort-bw.json'),
  JSON.stringify(
    {
      rounds: ROUNDS,
      inner: INNER,
      sizes: SIZES,
      window: `${REF}:${START}-${END}`,
      measured: new Date().toISOString().slice(0, 10),
      loadPeak: peak,
      loadMedian: median(loads),
      rows,
    },
    null,
    2,
  ),
)

const byBuild = (n: number) => rows.filter(r => r.n === n)
const biggest = Math.max(...SIZES)

const md: string[] = [
  '# The cohort BigWig panel: N files, one window',
  '',
  `Generated by \`make cohort\`. Window \`${REF}:${START}-${END}\`, the same one`,
  'every other benchmark here reads. Corpus: per-sample signal at 100 bp bins over',
  'the 250 kb contig, one BigWig a sample, written by',
  '`shell/generate_cohort_bw.sh` from a seeded generator so every machine has the',
  'same bytes.',
  '',
  '## Why this exists',
  '',
  'The single-file BigWig comparison reports 1-3 ms and no meaningful change, and',
  'reads as "the library did not improve". What it actually shows is that a',
  'per-file cost measured once is invisible. Answering a BigWig query means',
  'reading the header, walking the chromosome B+ tree and descending the R-tree',
  'before a byte of data is touched, and a panel of N samples pays all of it N',
  'times. That is the shape of the workload behind the Zarr result in the main',
  'README — 2,504 BigWigs, 15,048 requests — measured here on the library rather',
  'than over the network.',
  '',
  '## Request shape',
  '',
  'Exact rather than timed: these are counts of `read()` calls and bytes through a',
  'filehandle that records them, so they are identical on every machine and do not',
  'decay. This is the half that transfers to the network, where each read is a',
  'range request and a round trip.',
  '',
  '| version | N | reads | bytes | reads per file |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...rows
    .filter(r => r.n === biggest || SIZES.length === 1)
    .map(
      r =>
        `| ${r.build} | ${r.n} | ${r.reads} | ${(r.bytes / 1024).toFixed(0)} KB | ` +
        `${(r.reads / r.n).toFixed(1)} |`,
    ),
  '',
  'Full sizes are in `results/cohort-bw.json`. Reads per file is flat across N in',
  'every row, which is the finding: this cost is per-file and does not amortize —',
  'the hundredth sample costs what the first did.',
  '',
  '### What each read is',
  '',
  'One file\'s reads, in order and in bytes. Every sample takes the same path',
  'through the same layout, so this is the pattern each version repeats N times.',
  '',
  '| version | reads, in order (bytes) |',
  '| --- | --- |',
  ...builds.map(b => {
    const r = rows.find(x => x.build === b.label)!
    return `| ${b.label} | ${r.pattern.join(', ')} |`
  }),
  '',
  '## Time',
  '',
  'Sequential opens, one process per version, version order rotated every round,',
  `each arm best-of-${INNER} and the table the median over ${ROUNDS} rounds.`,
  '',
  peak > 4
    ? `> **This half is not a run of record. Peak 1-minute load was ` +
      `${peak.toFixed(1)}**, against the 4.0 this repo treats as the ceiling for a ` +
      'quotable absolute. Do not quote a millisecond from this table. The request ' +
      'counts above are unaffected — they are counts, not timings, and they are ' +
      'the same on an idle box and a loaded one.'
    : `Peak 1-minute load during this run: ${peak.toFixed(1)}.`,
  '',
  `| version | ${SIZES.map(n => `N=${n}`).join(' | ')} |`,
  `| --- | ${SIZES.map(() => '---:').join(' | ')} |`,
  ...builds.map(b => {
    const cells = SIZES.map(n => {
      const r = rows.find(x => x.build === b.label && x.n === n)!
      return `${r.ms!.toFixed(1)} ms`
    })
    return `| ${b.label} | ${cells.join(' | ')} |`
  }),
  '',
  'A browser opens its tracks concurrently, so this is not the wall clock a user',
  'sees. What concurrency hides is precisely the per-file cost the table is about,',
  'and it does not change the request counts above.',
  '',
]

writeFileSync(here('results/cohort-bw.md'), md.join('\n'))
console.log('\nwrote results/cohort-bw.md and results/cohort-bw.json')

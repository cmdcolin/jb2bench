// The 2019 cram-js paper's benchmark, re-run: @gmod/cram against samtools on the
// same region, one query per process, random intervals at 1 kb / 10 kb / 100 kb.
//
// The published figure (paper-2019/, vendored in full with its raw runtimes) put
// cram-js roughly an order of magnitude behind samtools, near enough flat across
// three files and three interval lengths. Everything under it has since moved:
// the library is twelve majors on, its codecs are compiled to wasm, and samtools
// has had six years of its own. Nobody has re-measured it, and the number that
// gets quoted is still the 2019 one.
//
// Three things this does that the original could not, each of them the reason a
// cell of the original says less than it appears to:
//
//   1. **It separates node's startup from the decode.** The fastest cram-js run
//      in the paper's 900 is 0.284 s and its median is 0.885 s, so six of the
//      nine cells are within a factor of 1.3 of their own floor: they timed
//      process startup, module load and a .crai parse. Each arm here reports the
//      import, the first query and a warm query separately, and the driver times
//      the whole process around them. The paper's comparison is the process
//      column; the browser's question is the query column.
//
//   2. **It counts records.** A uniform random interval on an exome is usually
//      off-target, and one on low-coverage WGS is often nearly empty. The 2019
//      harness discarded record counts, so nothing in its TSV distinguishes a
//      cell that decoded reads from one that decoded none. Every interval here
//      carries its record count and a checksum.
//
//   3. **It checks the two tools returned the same reads.** A ratio between two
//      answers that disagree is not a ratio. The checksum is computed the same
//      way from cram-js records and from samtools' SAM output, and disagreement
//      is reported per cell rather than being averaged into a speedup.
//
// The slice worker pool is deliberately absent. It is browser-only — it needs a
// Worker and a Blob URL, and `getSharedSliceWorkerPool` returns undefined under
// node by design — so this harness cannot see it at all. What it is worth is in
// ../results/crampool.md, measured in the place it exists.
//
//   node --experimental-strip-types cram-samtools.ts
//   FIXTURES='200x shortread' REPS=10 node --experimental-strip-types cram-samtools.ts
//   ARMS=v1.7.4,v13.4.1 LENGTHS=10000 node --experimental-strip-types cram-samtools.ts
//
// Needs ./setup-sweep.sh for the cram-js builds, samtools on PATH, and — for the
// paper's own fixtures — ../shell/fetch_paper2019.sh. Fixtures whose files are
// absent are named and skipped, not dropped.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IndexedRef } from './lib/indexed-ref.ts'

const SELF = fileURLToPath(import.meta.url)
const here = (p: string) => new URL(p, import.meta.url)
const DATA = fileURLToPath(new URL('../data/', import.meta.url))

// Same normalization the sweep uses: @gmod/cram before v8 reports a 1-based
// alignmentStart with the span in lengthOnRef, later versions a 0-based start
// and end. Order-independent, because two versions returning the same records in
// a different order do not disagree.
const fold = (recs: Iterable<any>) => {
  let sum = 0
  let n = 0
  for (const r of recs) {
    const start = r.start ?? r.alignmentStart - 1
    const end = r.end ?? start + (r.lengthOnRef ?? 0)
    const h = (start * 31 + end * 17 + (r.flags ?? 0)) % 1_000_000_007
    sum = (sum + h) % 1_000_000_007
    n++
  }
  return { n, sum }
}

// ------------------------------------------------------------------- arm ---
//
// One process, one region, three clocks. `importMs` is everything before the
// query — node booting, the build being imported, the reference index being
// read — measured from process start, so process wall time minus importMs minus
// queryMs is what the harness itself costs. `warmMs` opens a fresh
// IndexedCramFile each pass for the reason sweep.ts and bam.bench.ts do: the
// current releases cache parsed chunks on the instance, so reusing one would
// measure the cache rather than the decode.

async function armMain(argv: string[]) {
  const [dir, cram, ref, refName, seqIdStr, startStr, endStr, passesStr] = argv
  const seqId = Number(seqIdStr)
  const start = Number(startStr)
  const end = Number(endStr)
  const passes = Number(passesStr)

  const mod = await import(`${dir}/esm/index.js`)
  const fasta = new IndexedRef(ref!)
  const fai = fasta.records
  if (fai[seqId]?.name !== refName) {
    throw new Error(
      `reference id ${seqId} is ${fai[seqId]?.name} in the .fai, ${refName} in the CRAM header`,
    )
  }
  const importMs = performance.now()

  const opts = JSON.parse(process.env.CRAM_OPTS ?? '{}')
  const query = async () => {
    const file = new mod.IndexedCramFile({
      cramPath: cram,
      index: new mod.CraiIndex({ path: `${cram}.crai` }),
      seqFetch: async (id: number, s: number, e: number) =>
        fasta.fetch(fai[id]!.name, s, e),
      ...opts,
    })
    return fold(await file.getRecordsForRange(seqId, start, end))
  }

  const t0 = performance.now()
  const first = await query()
  const queryMs = performance.now() - t0

  let warmMs = queryMs
  for (let i = 0; i < passes; i++) {
    const t = performance.now()
    await query()
    warmMs = Math.min(warmMs, performance.now() - t)
  }

  console.log(
    JSON.stringify({
      importMs,
      queryMs,
      warmMs,
      records: first.n,
      checksum: String(first.sum),
    }),
  )
}

if (process.argv[2] === '--arm') {
  await armMain(process.argv.slice(3))
  process.exit(0)
}

// ---------------------------------------------------------------- driver ---

interface Fixture {
  name: string
  group: string
  cram: string
  ref: string
  contigs: number
}
interface Arm {
  tag: string
  label: string
}
const cfg = JSON.parse(readFileSync(here('cram-samtools.json'), 'utf8')) as {
  lengths: number[]
  reps: number
  seed: number
  arms: Arm[]
  paperOpts: Record<string, unknown>
  fixtures: Fixture[]
}

const REPS = Number(process.env.REPS ?? cfg.reps)
const SEED = Number(process.env.SEED ?? cfg.seed)
const WARM = Number(process.env.WARM ?? 2)
const LENGTHS = process.env.LENGTHS?.split(',').map(Number) ?? cfg.lengths
const onlyFixtures = process.env.FIXTURES?.split(',').map(s => s.trim())
const onlyArms = process.env.ARMS?.split(',').map(s => s.trim())

// Seeded, so every arm answers the identical intervals and a re-run of a cell
// that looked wrong asks the same questions again. The 2019 harness called
// random.seed() with no argument, which is why its intervals are unrecoverable
// and its cells cannot be re-measured, only re-drawn.
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!
const quantile = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!
const loadavg = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0])

const samtoolsVersion = execFileSync('samtools', ['--version'], { encoding: 'utf8' })
  .split('\n')[0]!
  .trim()

const scratch = mkdtempSync(join(tmpdir(), 'cram-samtools-'))
const samOut = join(scratch, 'view.sam')

/**
 * The samtools arm, as close to the 2019 call as is defensible.
 *
 * Two deliberate deviations, both documented in paper-2019/README.md. The
 * original passed `-t reference.fa`, which names a list of sequence names and
 * lengths rather than the reference CRAM decode needs; this passes `-T`, so what
 * resolves the reference is the file on disk and not whatever REF_PATH or the
 * EBI M5 lookup would have supplied. And the timing is taken here rather than
 * from `/usr/bin/time`, whose 10 ms resolution quantized most of the original
 * samtools column into a handful of distinct values.
 *
 * The write to a file is kept. It is what the paper timed, it is what a consumer
 * of `samtools view` actually pays, and dropping the output would flatter
 * samtools on exactly the cells where it writes the most.
 */
function samtoolsArm(fixture: ResolvedFixture, region: string) {
  const t = process.hrtime.bigint()
  execFileSync(
    'samtools',
    ['view', '-T', fixture.refPath, '-o', samOut, fixture.cramPath, region],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const wallMs = Number(process.hrtime.bigint() - t) / 1e6

  // Outside the clock: the same checksum the cram-js arms fold, recomputed from
  // SAM text so the two tools can be asked whether they returned the same reads.
  let n = 0
  let sum = 0
  const text = readFileSync(samOut, 'utf8')
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const f = line.split('\t')
    const start = Number(f[3]) - 1
    let span = 0
    for (const m of f[5]!.matchAll(/(\d+)([MIDNSHP=X])/g)) {
      if ('MDN=X'.includes(m[2]!)) span += Number(m[1])
    }
    const h = (start * 31 + (start + span) * 17 + Number(f[1])) % 1_000_000_007
    sum = (sum + h) % 1_000_000_007
    n++
  }
  return { wallMs, records: n, checksum: String(sum), bytes: text.length }
}

function cramArm(dir: string, fixture: ResolvedFixture, seqId: number, start: number, end: number) {
  const t = process.hrtime.bigint()
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      // Every pre-2024 build emits ESM into a package.json with no "type", and
      // says so once per process. sweep.ts silences it for the same reason.
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      fileURLToPath(here('lib/legacy-resolve-register.mjs')),
      SELF,
      '--arm',
      dir,
      fixture.cramPath,
      fixture.refPath,
      fixture.contigNames[seqId]!,
      String(seqId),
      String(start),
      String(end),
      String(WARM),
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1 << 20,
      env: { ...process.env, CRAM_OPTS: JSON.stringify(cfg.paperOpts) },
    },
  )
  const wallMs = Number(process.hrtime.bigint() - t) / 1e6
  return { wallMs, ...(JSON.parse(out) as {
    importMs: number
    queryMs: number
    warmMs: number
    records: number
    checksum: string
  }) }
}

// ------------------------------------------------------------- fixtures ---
//
// A fixture resolves only if every file it needs is present AND the reference id
// a CRAM uses means the same contig in the .fai the reference arm reads. That
// second check is not paranoia: `seqFetch` is handed a number, this harness turns
// it into a name through the .fai, and if the two orders differ the query still
// runs, still returns records, and silently decodes against the wrong reference.

interface ResolvedFixture extends Fixture {
  cramPath: string
  refPath: string
  contigNames: string[]
  contigLengths: number[]
  bytes: number
}

const skipped: string[] = []
const fixtures: ResolvedFixture[] = []

for (const f of cfg.fixtures) {
  if (onlyFixtures && !onlyFixtures.includes(f.name)) continue
  const cramPath = `${DATA}${f.cram}`
  const refPath = `${DATA}${f.ref}`
  const missing = [cramPath, `${cramPath}.crai`, refPath, `${refPath}.fai`].filter(
    p => !existsSync(p),
  )
  if (missing.length > 0) {
    skipped.push(`${f.name}: no ${missing.map(m => m.replace(DATA, '')).join(', ')}`)
    continue
  }

  const header = execFileSync('samtools', ['view', '-H', cramPath], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
  const sq = header
    .split('\n')
    .filter(l => l.startsWith('@SQ'))
    .map(l => ({
      name: /\tSN:([^\t]+)/.exec(l)![1]!,
      length: Number(/\tLN:(\d+)/.exec(l)![1]),
    }))
  const fai = readFileSync(`${refPath}.fai`, 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => l.split('\t')[0]!)

  const n = Math.min(f.contigs, sq.length)
  const disagree = sq.slice(0, n).findIndex((s, i) => s.name !== fai[i])
  if (disagree !== -1) {
    skipped.push(
      `${f.name}: reference id ${disagree} is ${sq[disagree]!.name} in the CRAM ` +
        `and ${fai[disagree]} in the .fai`,
    )
    continue
  }

  fixtures.push({
    ...f,
    cramPath,
    refPath,
    contigNames: sq.map(s => s.name),
    contigLengths: sq.map(s => s.length),
    bytes: statSync(cramPath).size,
  })
}

const arms = cfg.arms
  .filter(a => !onlyArms || onlyArms.includes(a.tag))
  .map(a => ({ ...a, dir: fileURLToPath(here(`.libs/cram-js/sweep/${a.tag}`)) }))
const missingArms = arms.filter(a => !existsSync(`${a.dir}/esm/index.js`))
const built = arms.filter(a => existsSync(`${a.dir}/esm/index.js`))

if (built.length === 0) {
  console.error('no cram-js builds found — run ./setup-sweep.sh cram-js first')
  process.exit(1)
}
if (fixtures.length === 0) {
  console.error(`no fixtures resolved:\n  ${skipped.join('\n  ')}`)
  console.error('\n../shell/fetch_paper2019.sh fetches the paper corpus;')
  console.error('../shell/generate_alignments.sh generates this repo\'s own.')
  process.exit(1)
}

// ------------------------------------------------------------------- run ---

interface Run {
  arm: string
  wallMs: number
  importMs: number | null
  queryMs: number | null
  warmMs: number | null
  records: number
  checksum: string
  error?: string
}
interface Interval {
  contig: string
  seqId: number
  start: number
  end: number
  runs: Run[]
}
interface Cell {
  fixture: string
  group: string
  length: number
  intervals: Interval[]
  load: { before: number; after: number }
}

const cells: Cell[] = []
const loads: number[] = [loadavg()]

for (const f of fixtures) {
  console.log(`\n## ${f.name} — ${(f.bytes / 1024 ** 2).toFixed(0)} MB`)

  // One start per replicate, reused across the three lengths, which is the
  // paper's shape: it makes the lengths within a replicate comparable rather
  // than three unrelated draws.
  const rand = mulberry32(SEED)
  const maxLen = Math.max(...LENGTHS)
  const draws = Array.from({ length: REPS }, () => {
    const seqId = Math.floor(rand() * Math.min(f.contigs, f.contigNames.length))
    const span = f.contigLengths[seqId]!
    const start = span > maxLen ? 1 + Math.floor(rand() * (span - maxLen)) : 1
    return { seqId, start }
  })

  for (const length of LENGTHS) {
    const before = loadavg()
    const intervals: Interval[] = []

    for (const [rep, draw] of draws.entries()) {
      const { seqId, start } = draw
      const end = start + length
      const contig = f.contigNames[seqId]!
      const region = `${contig}:${start}-${end}`
      const runs: Run[] = []

      // Arm order rotates with the replicate. Page cache, thermal drift and
      // whatever else the machine is doing all favour whichever arm goes last,
      // and a fixed order would hand that advantage to the same arm every time.
      const order = [
        { tag: 'samtools' as const },
        ...built.map(a => ({ tag: a.tag, dir: a.dir })),
      ]
      for (let k = 0; k < order.length; k++) {
        const a = order[(k + rep) % order.length]!
        try {
          if (a.tag === 'samtools') {
            const got = samtoolsArm(f, region)
            runs.push({
              arm: 'samtools',
              wallMs: got.wallMs,
              importMs: null,
              queryMs: null,
              warmMs: null,
              records: got.records,
              checksum: got.checksum,
            })
          } else {
            const got = cramArm((a as { dir: string }).dir, f, seqId, start, end)
            runs.push({ arm: a.tag, ...got })
          }
        } catch (e) {
          // A version that cannot answer this query is a result — cram-js 1.x
          // throws past its 50 MB fetchSizeLimit, which is a thing the 2019
          // library did to its users and belongs in the table.
          runs.push({
            arm: a.tag,
            wallMs: Number.NaN,
            importMs: null,
            queryMs: null,
            warmMs: null,
            records: -1,
            checksum: '',
            error: String((e as Error).message ?? e).split('\n')[0],
          })
        }
      }
      intervals.push({ contig, seqId, start, end, runs })
    }

    const after = loadavg()
    loads.push(before, after)
    cells.push({ fixture: f.name, group: f.group, length, intervals, load: { before, after } })

    const line = (arm: string) => {
      const ok = intervals.flatMap(i => i.runs.filter(r => r.arm === arm && !r.error))
      if (ok.length === 0) {
        const err = intervals[0]!.runs.find(r => r.arm === arm)?.error ?? 'no runs'
        return `${arm.padEnd(10)} ${err}`
      }
      const wall = median(ok.map(r => r.wallMs))
      const q = ok[0]!.queryMs === null ? null : median(ok.map(r => r.queryMs!))
      const recs = median(ok.map(r => r.records))
      return (
        `${arm.padEnd(10)}${`${wall.toFixed(0)} ms`.padStart(10)}` +
        `${(q === null ? '' : `${q.toFixed(0)} ms query`).padStart(16)}` +
        `${`${recs} recs`.padStart(12)}` +
        `${ok.length < intervals.length ? `  ${intervals.length - ok.length} failed` : ''}`
      )
    }
    console.log(`\n   ${length} bp, ${REPS} intervals, load ${before.toFixed(1)}`)
    for (const arm of ['samtools', ...built.map(a => a.tag)]) {
      console.log(`     ${line(arm)}`)
    }
  }
}

rmSync(scratch, { recursive: true, force: true })

// ---------------------------------------------------------------- report ---

/** paired per-interval ratios, which is what survives a drifting machine */
function ratios(cell: Cell, arm: string, clock: 'wallMs' | 'queryMs') {
  const out: number[] = []
  for (const i of cell.intervals) {
    const base = i.runs.find(r => r.arm === 'samtools' && !r.error)
    const got = i.runs.find(r => r.arm === arm && !r.error)
    const t = clock === 'wallMs' ? got?.wallMs : got?.queryMs
    if (base && got && t !== null && t !== undefined && base.wallMs > 0) {
      out.push(t / base.wallMs)
    }
  }
  return out
}

function summary(cell: Cell, arm: string) {
  const runs = cell.intervals.flatMap(i => i.runs.filter(r => r.arm === arm))
  const ok = runs.filter(r => !r.error)
  const agree = cell.intervals.filter(i => {
    const a = i.runs.find(r => r.arm === 'samtools')
    const b = i.runs.find(r => r.arm === arm)
    return a && b && !b.error && a.checksum === b.checksum
  }).length
  const wallR = ratios(cell, arm, 'wallMs')
  const queryR = ratios(cell, arm, 'queryMs')
  return {
    arm,
    runs: runs.length,
    failed: runs.length - ok.length,
    error: runs.find(r => r.error)?.error ?? null,
    wallMs: ok.length ? median(ok.map(r => r.wallMs)) : null,
    importMs: ok.length && ok[0]!.importMs !== null ? median(ok.map(r => r.importMs!)) : null,
    queryMs: ok.length && ok[0]!.queryMs !== null ? median(ok.map(r => r.queryMs!)) : null,
    warmMs: ok.length && ok[0]!.warmMs !== null ? median(ok.map(r => r.warmMs!)) : null,
    records: ok.length ? median(ok.map(r => r.records)) : null,
    empty: ok.filter(r => r.records === 0).length,
    agree,
    wallRatio: wallR.length ? median(wallR) : null,
    wallRatioP25: wallR.length ? quantile(wallR, 0.25) : null,
    wallRatioP75: wallR.length ? quantile(wallR, 0.75) : null,
    queryRatio: queryR.length ? median(queryR) : null,
  }
}

const summaries = cells.map(c => ({
  fixture: c.fixture,
  group: c.group,
  length: c.length,
  load: c.load,
  arms: ['samtools', ...built.map(a => a.tag)].map(a => summary(c, a)),
}))

mkdirSync(here('results/'), { recursive: true })
writeFileSync(
  here('results/cram-samtools.json'),
  JSON.stringify(
    {
      measured: new Date().toISOString().slice(0, 10),
      samtools: samtoolsVersion,
      node: process.version,
      reps: REPS,
      seed: SEED,
      warm: WARM,
      lengths: LENGTHS,
      opts: cfg.paperOpts,
      loadPeak: Math.max(...loads),
      loadMedian: median(loads),
      skipped,
      notBuilt: missingArms.map(a => a.tag),
      summaries,
      cells,
    },
    null,
    2,
  ),
)

// The TSV names its fixtures by coverage class; these are the files behind
// them, and the names cram-samtools.json gives the same three fixtures.
const PAPER_FIXTURES: Record<string, string> = {
  low: 'human low-coverage',
  exome: 'human exome',
  high: 'E. coli high-coverage',
}

// The 2019 baseline, recomputed from the vendored raw runtimes rather than read
// off the published figure — the figure plots means, and three of its nine cells
// are skewed enough that its bars and these medians differ by 10%.
function baseline2019() {
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
      coverage: coverage!,
      length: Number(length),
      cramjs: median(v.cj),
      samtools: median(v.sam),
      ratio: median(v.cj) / median(v.sam),
    }
  })
}

const peak = Math.max(...loads)
const fmt = (n: number | null, unit = ' ms', digits = 0) =>
  n === null ? '—' : `${n.toFixed(digits)}${unit}`
const ratio = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}x`)

const groups = [...new Set(summaries.map(s => s.group))]
const armTable = (group: string, clock: 'wall' | 'query') =>
  summaries
    .filter(s => s.group === group)
    .map(s => {
      const sam = s.arms.find(a => a.arm === 'samtools')!
      const cells = built.map(a => {
        const x = s.arms.find(v => v.arm === a.tag)!
        if (x.failed === x.runs) return `— *${x.error ? 'failed' : ''}*`
        const t = clock === 'wall' ? x.wallMs : x.queryMs
        const r = clock === 'wall' ? x.wallRatio : x.queryRatio
        return `${fmt(t)} (${ratio(r)})`
      })
      return `| ${s.fixture} | ${s.length / 1000} kb | ${fmt(sam.wallMs)} | ${cells.join(' | ')} | ${sam.records ?? '—'} |`
    })

const md = [
  `# cram-js against samtools, 2019 and now${peak > 4 ? ' — provisional' : ''}`,
  '',
  `Generated by \`make cram-samtools\` on ${new Date().toISOString().slice(0, 10)}.`,
  `${samtoolsVersion}, node ${process.version}, ${REPS} random interval${REPS === 1 ? '' : 's'}`,
  `per cell, seed ${SEED}. Peak 1-minute load ${peak.toFixed(2)}. Per-interval`,
  'ratio quartiles are in the JSON beside this file.',
  ...(peak > 4
    ? ['', '**Load was above this repo\'s 4.0 threshold. These are not a run of record.**']
    : []),
  '',
  'The 2019 paper\'s procedure, re-run against every cram-js line since. The',
  'original harness and its raw runtimes are vendored in',
  '[`paper-2019/`](../paper-2019/README.md); read its README before this table,',
  'because three of the choices it made are the reason its cells report what they',
  'do.',
  '',
  '## What the paper measured',
  '',
  'Medians recomputed from the vendored TSV, n = 100 per cell:',
  '',
  '| fixture | interval | cram-js 1.x | samtools (2019) | ratio |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...baseline2019().map(
    b =>
      `| ${PAPER_FIXTURES[b.coverage] ?? b.coverage} | ${b.length / 1000} kb | ${b.cramjs.toFixed(3)} s | ` +
      `${b.samtools.toFixed(3)} s | ${b.ratio.toFixed(1)}x |`,
  ),
  '',
  '## The same comparison today',
  '',
  'Process wall time, which is what the paper compared: spawn to exit, module',
  'load and index parse included, on both sides. Ratios are per-interval and',
  'paired, then taken as a median — never a ratio of two aggregates.',
  '',
  ...groups.flatMap(g => [
    `### ${g === 'paper2019' ? 'The paper\'s own corpus' : 'This repo\'s corpus'}`,
    '',
    `| fixture | interval | samtools | ${built.map(a => `cram-js ${a.label}`).join(' | ')} | reads |`,
    `| --- | ---: | ---: | ${built.map(() => '---:').join(' | ')} | ---: |`,
    ...armTable(g, 'wall'),
    '',
  ]),
  '## With process startup out of it',
  '',
  'The same runs, timed around `getRecordsForRange` alone. This is the number a',
  'browser pays, since it imports the library once and queries thousands of',
  'times — and it is the half of the 2019 figure that could not be seen, because',
  'six of its nine cells were within a factor of 1.3 of node\'s own startup.',
  '',
  ...groups.flatMap(g => [
    `### ${g === 'paper2019' ? 'The paper\'s own corpus' : 'This repo\'s corpus'}`,
    '',
    `| fixture | interval | samtools (process) | ${built.map(a => `cram-js ${a.label} (query)`).join(' | ')} | reads |`,
    `| --- | ---: | ---: | ${built.map(() => '---:').join(' | ')} | ---: |`,
    ...armTable(g, 'query'),
    '',
  ]),
  '## Do they return the same reads?',
  '',
  'Per cell: intervals where the cram-js arm and samtools folded to the same',
  'checksum over (start, end, flags), out of the intervals both answered.',
  '',
  `| fixture | interval | ${built.map(a => a.label).join(' | ')} | empty windows |`,
  `| --- | ---: | ${built.map(() => '---:').join(' | ')} | ---: |`,
  ...summaries.map(s => {
    const cellsOut = built.map(a => {
      const x = s.arms.find(v => v.arm === a.tag)!
      return `${x.agree}/${x.runs - x.failed}`
    })
    const sam = s.arms.find(a => a.arm === 'samtools')!
    return `| ${s.fixture} | ${s.length / 1000} kb | ${cellsOut.join(' | ')} | ${sam.empty}/${sam.runs} |`
  }),
  '',
  '## What is not in here',
  '',
  '**The slice worker pool.** `getSharedSliceWorkerPool` needs a Worker and a',
  'Blob URL and returns undefined under node, by design, so no arm above can',
  'reach it. It is the largest single change to CRAM decode since the paper and',
  'it is invisible to a CLI benchmark. See [`../../results/crampool.md`](../../results/crampool.md).',
  '',
  '**A network filehandle.** Every arm reads a local file. The paper did too, and',
  'the thing a genome browser actually waits on is a range request over HTTP.',
  '[`sweep.md`](sweep.md) counts requests and bytes for that reason; this measures',
  'CPU with the network removed.',
  '',
  ...(() => {
    // Distinct failures, named. cram-js 1.x throws past the 50 MB
    // fetchSizeLimit the paper's script set, and a run where that happens has
    // measured the 2019 library's limit rather than its speed — which is worth
    // more than the missing cell it leaves.
    const failures = summaries.flatMap(s =>
      s.arms
        .filter(a => a.failed > 0)
        .map(a => `- ${s.fixture} ${s.length / 1000} kb, ${a.arm}: ${a.failed}/${a.runs} — ${a.error}`),
    )
    return failures.length
      ? ['**Queries that failed.** Counted, not dropped:', '', ...failures, '']
      : []
  })(),
  ...(skipped.length
    ? [
        '**Fixtures that could not be resolved.** Reported rather than dropped:',
        '',
        ...skipped.map(s => `- ${s}`),
        '',
      ]
    : []),
  ...(missingArms.length
    ? [
        `**Versions not built:** ${missingArms.map(a => a.tag).join(', ')} —`,
        '`./setup-sweep.sh cram-js`.',
        '',
      ]
    : []),
].join('\n')

writeFileSync(here('results/cram-samtools.md'), md)
console.log('\nwrote results/cram-samtools.md and results/cram-samtools.json')
if (skipped.length) {
  console.log(`skipped:\n  ${skipped.join('\n  ')}`)
}

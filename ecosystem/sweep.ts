// The version sweep: every major line of @gmod/bam, @gmod/cram and @gmod/bbi
// on the same window the render benchmarks draw, one process per version.
//
// versions.json answers "how much faster did the parsers get since 2023" with a
// ratio between two points. That is the number the paper quotes, and it cannot
// say where the change landed — whether the library got steadily faster, or one
// release did all of it and the rest were flat, or something regressed and was
// recovered. A reader deciding whether to upgrade is asking the second question.
//
// Why one process per version, and not a vitest bench. scan.ts explains it for
// two builds; the argument gets worse with eight. Every build imported into one
// V8 shares inline caches at the call sites they all reach, so each is slower
// than it would be alone and not by the same amount — and here the arms are not
// even symmetric, since a sweep loads N of them rather than two. Whatever that
// does to the numbers, it does unevenly along the axis being plotted, which is
// the one shape a curve must not have imposed on it.
//
// So: one child process per version, the version order rotated every round so
// machine drift cannot align with position on the curve, each child reporting
// its own best-of-N, and the driver taking the median across rounds.
//
//   node --experimental-strip-types sweep.ts                    # everything
//   LIBS=bam-js node --experimental-strip-types sweep.ts        # one library
//   CASES='200x shortread' node --experimental-strip-types sweep.ts
//
// Needs ./setup-sweep.sh to have run. Versions it could not build are skipped
// and named in the output rather than dropped.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { fileURLToPath } from 'node:url'

import { END, OLD_CRAM_OPTS, REF, START, seqFetch, vcfParts } from './lib/corpus.ts'
import { type Counter, countingFile, totals } from './lib/counting-filehandle.ts'

const SELF = fileURLToPath(import.meta.url)
const here = (p: string) => new URL(p, import.meta.url)

const ROUNDS = Number(process.env.ROUNDS ?? 5)
const INNER = Number(process.env.INNER ?? 3)

// ------------------------------------------------------------------- arm ---
//
// Prints one line: "<best ms> <record count> <checksum>". The checksum is
// order-independent — summed rather than folded — because two majors may return
// the same records in a different order, which is not a disagreement. Count and
// checksum both travel so the driver can flag a version whose numbers describe
// different work from its neighbours' rather than printing it as a speedup.

function fold(recs: Iterable<{ start: number; end: number; flags: number }>) {
  let sum = 0
  let n = 0
  for (const r of recs) {
    const h = (r.start * 31 + r.end * 17 + r.flags) % 1_000_000_007
    sum = (sum + h) % 1_000_000_007
    n++
  }
  return { n, sum }
}

// Accessors moved from methods to properties between majors: @gmod/bam v1-v2
// answer r.get('start')/r.end()/r.flags, later ones r.start/r.end/r.flags, and
// @gmod/cram before v8 reports a 1-based alignmentStart with the span in
// lengthOnRef. Normalizing here rather than per version keeps one definition of
// what is being checksummed.
// `flags` is a plain property on every major, including the ones whose start
// and end are methods — `get('flags')` throws on those, because their `get`
// only reaches fields that have a matching accessor. equivalence.test.ts reads
// it the same way.
const bamRec = (r: any) => ({
  start: typeof r.get === 'function' ? r.get('start') : r.start,
  end: typeof r.end === 'function' ? r.end() : r.end,
  flags: r.flags,
})

const cramRec = (r: any) => {
  const start = r.start ?? r.alignmentStart - 1
  return { start, end: start + (r.lengthOnRef ?? 0), flags: r.flags }
}

const bwRec = (f: any) => ({
  start: f.start,
  end: f.end,
  flags: Math.round(Math.fround(f.score) * 1000) | 0,
})

/**
 * One definition of the query, for all three arms.
 *
 * The timed arm reads by path and the counting arm reads through a wrapped
 * filehandle, and those were separate code paths until the self-test started
 * comparing them: two constructions of the same query drift, and a drift here
 * is indistinguishable from a library difference, which is the one thing this
 * benchmark exists to measure. Now `counting` picks the constructor argument
 * and nothing else differs.
 *
 * `counters` comes back non-empty only when counting, so the caller can total
 * reads without knowing which shape it asked for.
 */
async function makeQuery(kind: string, mod: any, dir: string, file: string, counting: boolean) {
  const counters: Counter[] = []
  const open = async (path: string) => {
    if (!counting) return { handle: undefined, path }
    const { handle, counter } = await countingFile(dir, path)
    counters.push(counter)
    return { handle, path: undefined }
  }

  let run: () => Promise<{ n: number; sum: number }>

  if (kind === 'bam') {
    // A fresh BamFile per pass: current releases cache parsed chunks on the
    // instance, so reusing one would measure the cache. bam.bench.ts does the
    // same, for the same reason.
    run = async () => {
      counters.length = 0
      const data = await open(file)
      const index = await open(`${file}.bai`)
      const bam = new mod.BamFile(
        counting
          ? { bamFilehandle: data.handle, baiFilehandle: index.handle }
          : { bamPath: file },
      )
      await bam.getHeader()
      return fold((await bam.getRecordsForRange(REF, START, END)).map(bamRec))
    }
  } else if (kind === 'cram') {
    // fetchSizeLimit is passed to every version that has it, not only the 2023
    // one: majors before 8 default it to 3 MB and throw on every long-read
    // window here, and JBrowse's own CramAdapter raised it. Passing an option a
    // later version ignores is harmless; withholding it would make the early
    // majors unmeasurable rather than slow.
    run = async () => {
      counters.length = 0
      const data = await open(file)
      const index = await open(`${file}.crai`)
      const cram = new mod.IndexedCramFile({
        ...(counting
          ? {
              cramFilehandle: data.handle,
              index: new mod.CraiIndex({ filehandle: index.handle }),
            }
          : {
              cramPath: file,
              index: new mod.CraiIndex({ path: `${file}.crai` }),
            }),
        seqFetch,
        checkSequenceMD5: false,
        ...OLD_CRAM_OPTS,
      })
      return fold((await cram.getRecordsForRange(0, START, END)).map(cramRec))
    }
  } else if (kind === 'bigwig') {
    run = async () => {
      counters.length = 0
      const data = await open(file)
      const bw = new mod.BigWig(counting ? { filehandle: data.handle } : { path: file })
      return fold((await bw.getFeatures(REF, START, END)).map(bwRec))
    }
  } else if (kind === 'vcf') {
    // Read and split once, outside the timed callback: this measures the
    // parser, and lib/corpus.ts explains why the lines are decoded per line
    // rather than by splitting one big string — the two hand V8 different
    // string representations, and the difference is half of what changed in
    // 7.2.0.
    const { header, lines } = vcfParts(file)
    // parseLine on every version, not each version's cheapest genotype call.
    // The cheap call appears partway along the axis, so sweeping it would put
    // a step in the curve that is a change of question rather than of speed.
    const Ctor = mod.default ?? mod.VCF
    run = async () => {
      const parser = new Ctor({ header })
      return fold(
        lines.map(line => {
          const v = parser.parseLine(line)
          return { start: v.POS, end: v.POS, flags: v.ALT?.length ?? 0 }
        }),
      )
    }
  } else if (kind === 'bgzf') {
    // The browser path on every version. v1.x shipped two decompressors and
    // picked between them at import time — `unzip` wrapping zlib.gunzip in
    // Node, `pakoUnzip` for browsers — so preferring pakoUnzip where it exists
    // keeps the pure-JS path a genome browser actually runs on every point of
    // the curve. Sweeping `unzip` would compare C++ against JavaScript at the
    // version where the split ends, and report it as a regression.
    const unzipMod = await import(`${dir}/esm/unzip.js`)
    const unzip = unzipMod.pakoUnzip ?? unzipMod.unzip
    if (typeof unzip !== 'function') {
      throw new Error('no unzip export')
    }
    // Buffer rather than a Uint8Array wrapper: 1.x declares `unzip(input:
    // Buffer)` and later versions take a Uint8Array, and Buffer satisfies both.
    const input = readFileSync(file)
    run = async () => {
      const out = await unzip(input)
      // Length and a cheap fold of the head: enough to catch two versions
      // returning different bytes, without a hash of hundreds of MB.
      let h = 0
      for (let i = 0; i < Math.min(out.length, 4096); i++) {
        h = (h * 31 + out[i]!) % 1_000_000_007
      }
      return { n: out.length, sum: h }
    }
  } else {
    throw new Error(`unknown kind ${kind}`)
  }

  return { run, counters }
}

async function armMain(kind: string, dir: string, file: string) {
  const mod = await import(`${dir}/esm/index.js`)
  const { run } = await makeQuery(kind, mod, dir, file, false)

  const first = await run()
  await run()
  const ts: number[] = []
  for (let i = 0; i < INNER; i++) {
    const t = performance.now()
    await run()
    ts.push(performance.now() - t)
  }
  ts.sort((a, b) => a - b)
  // best-of-N: on a shared box the minimum is the least contaminated estimate
  // of the work, which is what the rest of this repo also assumes.
  console.log(`${ts[0]!.toFixed(4)} ${first.n} ${first.sum}`)
}

/**
 * The same query, counted rather than timed: how many reads, over how many
 * bytes, split between the data file and its index.
 *
 * This half needs no idle machine, which is why it exists. It is also the half
 * that transfers to the network — a read is a range request there, and a panel
 * waits on round trips rather than on bytes.
 */
async function armCount(kind: string, dir: string, file: string) {
  const mod = await import(`${dir}/esm/index.js`)
  const { run, counters } = await makeQuery(kind, mod, dir, file, true)
  const got = await run()
  const [data, index] = counters
  console.log(
    JSON.stringify({
      ...totals(counters),
      dataReads: data?.reads ?? 0,
      indexReads: index?.reads ?? 0,
      records: got.n,
      checksum: String(got.sum),
      pattern: data?.sizes.slice(0, 12) ?? [],
    }),
  )
}

/**
 * Does this build work, and does the counting instrument change its answer?
 *
 * Two failures this catches that nothing else did. A build can produce
 * `esm/index.js` and still be unimportable — cram v3.0.7 did, from an undeclared
 * dependency — and that only surfaced minutes into a sweep, as one blank row.
 * And an instrument that wraps the filehandle can change what the library
 * returns: the first counting filehandle here was hand-written, and under it two
 * majors of @gmod/bam failed with "Not a BAI file" while their neighbours
 * passed, which reads as a library defect and was the harness.
 *
 * So the self-test runs the query both ways and requires the same records and
 * the same checksum. A version that disagrees with itself is reported before any
 * number derived from it is.
 */
async function armSelftest(kind: string, dir: string, file: string) {
  const mod = await import(`${dir}/esm/index.js`)
  const byPath = await (await makeQuery(kind, mod, dir, file, false)).run()
  const byHandle = await (await makeQuery(kind, mod, dir, file, true)).run()
  const agree = byPath.n === byHandle.n && byPath.sum === byHandle.sum
  console.log(
    JSON.stringify({
      ok: agree && byPath.n > 0,
      pathRecords: byPath.n,
      handleRecords: byHandle.n,
      pathChecksum: String(byPath.sum),
      handleChecksum: String(byHandle.sum),
    }),
  )
}

if (process.argv[2] === '--arm') {
  const mode = process.argv[3]
  if (mode === 'count' || mode === 'selftest') {
    const fn = mode === 'count' ? armCount : armSelftest
    await fn(process.argv[4]!, process.argv[5]!, process.argv[6]!)
  } else {
    await armMain(process.argv[3]!, process.argv[4]!, process.argv[5]!)
  }
  process.exit(0)
}

// ---------------------------------------------------------------- driver ---

interface Version {
  tag: string
  dir: string
}
interface Library {
  name: string
  package: string
  kind: string
  pinnedMajor2023: number
  /** overrides CASE_LABELS when this library's corpus is its own */
  cases?: string[]
  versions: Version[]
  /** setup-sweep.sh tried these and could not produce a build */
  unbuildable: string[]
  /** setup-sweep.sh has not been run for these — a missing step, not a defect */
  notBuilt: string[]
}

const sweepCfg = JSON.parse(readFileSync(here('sweep.json'), 'utf8'))

const onlyLibs = process.env.LIBS?.split(',').map(s => s.trim())
const onlyCases = process.env.CASES?.split(',').map(s => s.trim())

// MODE=count skips the timings entirely. Counts are exact and identical on every
// machine, so that mode produces a result on a box far too busy for a timing —
// which this one has been for weeks. MODE=time skips the counting for a quick
// re-run of the curve alone.
const MODE = process.env.MODE ?? 'both'
const doCount = MODE !== 'time'
const doTime = MODE !== 'count'

// The default cases. Heavy first, because that is where a parser difference is
// legible and where the paper's framing puts the weight; the light case is kept
// as the control that says whether a curve is the parser or is process startup.
// A library may override them in sweep.json — the VCF corpus is its own, since
// what a VCF parser costs scales with samples x variants and not with depth.
const CASE_LABELS = ['20x shortread', '200x shortread', '200x longread']

const caseFile = (kind: string, label: string) => {
  if (kind === 'vcf') {
    // "1000 samples gtonly" -> data/variants.1000.gtonly.vcf
    const [samples, , shape] = label.split(' ')
    return fileURLToPath(here(`../data/variants.${samples}.${shape}.vcf`))
  }
  const [cov, read] = label.split(' ')
  // bgzf decompresses the alignment files themselves — BAM is BGZF end to end.
  const ext = kind === 'bigwig' ? 'bw' : kind === 'bgzf' ? 'bam' : kind
  return fileURLToPath(here(`../data/${cov}.${read}.${ext}`))
}

// "setup-sweep.sh tried and failed" and "setup-sweep.sh has not been run for
// this library yet" both look like a missing directory, and they mean opposite
// things: the first is a fact about the library worth reporting, the second is a
// missing step. The manifest is what distinguishes them, so read it rather than
// inferring from the filesystem — otherwise adding a block to sweep.json makes
// the report announce that six versions of a library cannot be built.
const manifest = (() => {
  try {
    return readFileSync(fileURLToPath(here('.libs/sweep-manifest.txt')), 'utf8')
  } catch {
    return ''
  }
})()
const attempted = new Set(
  manifest
    .split('\n')
    .filter(l => / (ok|unbuildable) /.test(l))
    .map(l => l.split(' ').slice(0, 2).join(' ')),
)

const libraries: Library[] = []
for (const l of sweepCfg.libraries) {
  if (onlyLibs && !onlyLibs.includes(l.name)) continue
  const versions: Version[] = []
  const unbuildable: string[] = []
  const notBuilt: string[] = []
  for (const v of l.versions) {
    const dir = fileURLToPath(here(`.libs/${l.name}/sweep/${v.tag}`))
    if (existsSync(`${dir}/esm/index.js`)) {
      versions.push({ tag: v.tag, dir })
    } else if (attempted.has(`${l.name} ${v.tag}`)) {
      unbuildable.push(v.tag)
    } else {
      notBuilt.push(v.tag)
    }
  }
  libraries.push({ ...l, versions, unbuildable, notBuilt })
}

if (libraries.every(l => l.versions.length === 0)) {
  console.error('no sweep builds found — run ./setup-sweep.sh first')
  process.exit(1)
}

function runArm(args: string[]) {
  return execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      // Every pre-2024 build emits ESM into a package.json with no "type", so
      // node warns once per arm about reparsing it. True, expected, and 60
      // lines of it per round would bury the failures that matter.
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      // Supplies the extensionless and directory specifiers the pre-2024 builds
      // emit, which node's ESM resolver rejects. Fallback only; see the hook.
      '--import',
      fileURLToPath(here('lib/legacy-resolve-register.mjs')),
      SELF,
      '--arm',
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 20 },
  ).trim()
}

function arm(kind: string, dir: string, file: string) {
  const [ms, n, sum] = runArm([kind, dir, file]).split(' ')
  return { ms: Number(ms), n: Number(n), sum: sum! }
}

interface Counts {
  reads: number
  bytes: number
  dataReads: number
  indexReads: number
  records: number
  checksum: string
  pattern: number[]
}

function countArm(kind: string, dir: string, file: string): Counts {
  return JSON.parse(runArm(['count', kind, dir, file]))
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!

// --------------------------------------------------------------- the gate ---
//
// `make sweep-verify`. Runs before anything is timed, in the same spirit as
// `make verify` gating `make bench`: a curve drawn through versions that do not
// all answer the same query is not a curve. It checks two things per version —
// that the build imports and returns records at all, and that reading through
// the counting filehandle gives the identical record set as reading by path.
//
// The second is the one worth having. An instrument that wraps I/O can change
// what the library returns, and when it does the damage looks like a library
// difference, which is exactly what a sweep is trying to detect.
if (MODE === 'verify') {
  let failures = 0
  let checked = 0
  for (const lib of libraries) {
    if (lib.versions.length === 0) continue
    const label = (onlyCases ?? lib.cases ?? CASE_LABELS)[0]!
    const file = caseFile(lib.kind, label)
    if (!existsSync(file)) {
      console.log(`${lib.package}: no corpus at ${file}, skipping`)
      continue
    }
    console.log(`\n${lib.package} — ${label}`)
    for (const v of lib.versions) {
      checked++
      try {
        const got = JSON.parse(runArm(['selftest', lib.kind, v.dir, file]))
        if (got.ok) {
          console.log(`  ok    ${v.tag.padEnd(10)} ${got.pathRecords} records`)
        } else {
          failures++
          console.log(
            `  FAIL  ${v.tag.padEnd(10)} path ${got.pathRecords}/${got.pathChecksum} ` +
              `vs filehandle ${got.handleRecords}/${got.handleChecksum}`,
          )
        }
      } catch (e) {
        failures++
        console.log(`  FAIL  ${v.tag.padEnd(10)} ${String(e).split('\n')[0]}`)
      }
    }
  }
  console.log(`\n${checked - failures}/${checked} versions verified`)
  process.exit(failures === 0 ? 0 : 1)
}

interface Point {
  tag: string
  major: number
  ms: number | null
  records: number
  checksum: string
  counts: Counts | null
}
interface CaseResult {
  library: string
  package: string
  case: string
  points: Point[]
  /** versions whose record set differs from the newest built version's */
  disagree: string[]
}

const results: CaseResult[] = []
const loadAvg = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0])
// Sampled even under MODE=count, where it changes no conclusion: without it the
// report says "peak load 0.0", which reads as an idle box rather than as a run
// that never asked.
const loads: number[] = [loadAvg()]

for (const lib of libraries) {
  if (lib.versions.length === 0) {
    console.log(`\n## ${lib.package}: nothing built, skipping`)
    continue
  }
  console.log(`\n## ${lib.package} — ${lib.versions.length} versions`)
  if (lib.unbuildable.length) {
    console.log(`   unbuildable: ${lib.unbuildable.join(', ')}`)
  }
  if (lib.notBuilt.length) {
    console.log(
      `   not built yet (run ./setup-sweep.sh ${lib.name}): ${lib.notBuilt.join(', ')}`,
    )
  }

  for (const label of lib.cases ?? CASE_LABELS) {
    if (onlyCases && !onlyCases.includes(label)) continue
    const file = caseFile(lib.kind, label)
    if (!existsSync(file)) {
      console.log(`   ${label}: no ${file}, skipping`)
      continue
    }

    const times = new Map<string, number[]>(lib.versions.map(v => [v.tag, []]))
    const meta = new Map<string, { n: number; sum: string }>()
    const counts = new Map<string, Counts>()

    // Counting first, and once: it is exact, so repeating it would only cost
    // time. Its record count also stands in for the timing arm's when MODE=count
    // means no timing arm ever runs.
    if (doCount) {
      for (const v of lib.versions) {
        try {
          const got = countArm(lib.kind, v.dir, file)
          counts.set(v.tag, got)
          if (!meta.has(v.tag)) meta.set(v.tag, { n: got.records, sum: '' })
        } catch (e) {
          console.log(`   ${label} ${v.tag}: count FAILED (${String(e).split('\n')[0]})`)
        }
      }
    }

    for (let r = 0; doTime && r < ROUNDS; r++) {
      loads.push(loadAvg())
      // Rotate the order every round. Machine drift over a round is real and
      // roughly monotonic; if the order were fixed it would add a tilt along
      // the version axis, which is the exact artefact a curve would be read as
      // a trend.
      for (let k = 0; k < lib.versions.length; k++) {
        const v = lib.versions[(k + r) % lib.versions.length]!
        try {
          const got = arm(lib.kind, v.dir, file)
          times.get(v.tag)!.push(got.ms)
          meta.set(v.tag, { n: got.n, sum: got.sum })
        } catch (e) {
          // A version that builds but cannot read this file is a result. Record
          // it as absent from this case rather than killing the sweep.
          if (r === 0) {
            console.log(`   ${label} ${v.tag}: FAILED (${String(e).split('\n')[0]})`)
          }
        }
      }
    }

    const points: Point[] = []
    for (const v of lib.versions) {
      const ts = times.get(v.tag)!
      const m = meta.get(v.tag)
      if (!m) continue
      points.push({
        tag: v.tag,
        major: Number(v.tag.slice(1).split('.')[0]),
        ms: ts.length ? median(ts) : null,
        records: m.n,
        checksum: m.sum,
        counts: counts.get(v.tag) ?? null,
      })
    }
    if (points.length === 0) continue

    // Compare against the newest built version. The checksum is the stronger
    // test — two versions can return the same number of different records — but
    // MODE=count never runs the arm that computes one, so fall back to the
    // record count there rather than reporting a silent all-clear.
    const newest = points[points.length - 1]!
    const disagree = points
      .filter(p =>
        newest.checksum ? p.checksum !== newest.checksum : p.records !== newest.records,
      )
      .map(p => p.tag)

    results.push({
      library: lib.name,
      package: lib.package,
      case: label,
      points,
      disagree,
    })

    console.log(`\n   ${label}`)
    const base = points[0]!.ms
    for (const p of points) {
      const flag = disagree.includes(p.tag) ? ' *' : ''
      const time =
        p.ms === null
          ? ''.padStart(21)
          : `${`${p.ms.toFixed(2)} ms`.padStart(12)}` +
            `${`${(base! / p.ms).toFixed(2)}x`.padStart(9)}`
      const req = p.counts
        ? `  ${p.counts.reads} reads (${p.counts.dataReads}+${p.counts.indexReads}), ` +
          `${(p.counts.bytes / 1024).toFixed(0)} KB`
        : ''
      console.log(`     ${p.tag.padEnd(10)}${time}  ${p.records} recs${flag}${req}`)
    }
  }
}

// ---------------------------------------------------------------- report ---

mkdirSync(here('results/'), { recursive: true })
writeFileSync(
  here('results/sweep.json'),
  JSON.stringify(
    {
      rounds: ROUNDS,
      inner: INNER,
      rule: sweepCfg.rule,
      ruleDate: sweepCfg.ruleDate,
      measured: new Date().toISOString().slice(0, 10),
      loadPeak: loads.length ? Math.max(...loads) : null,
      loadMedian: loads.length ? median(loads) : null,
      unbuildable: Object.fromEntries(
        libraries.map(l => [l.name, l.unbuildable]),
      ),
      notBuilt: Object.fromEntries(libraries.map(l => [l.name, l.notBuilt])),
      results,
    },
    null,
    2,
  ),
)

const peak = loads.length ? Math.max(...loads) : 0
const md: string[] = [
  `# Parser version sweep${peak > 4 ? ' — timings provisional' : ''}`,
  '',
  `Generated by \`make sweep\`. One process per version, version order rotated`,
  `every round, each arm reporting its own best-of-${INNER} and the table the`,
  `median over ${ROUNDS} rounds. Window \`${REF}:${START}-${END}\`, the same one`,
  'the render benchmarks draw.',
  '',
  `Version selection: ${sweepCfg.rule}.`,
  '',
  !doTime
    ? `> **Counts only** (\`MODE=count\`); no timing was taken, so every \`time\` ` +
      'cell reads `—`. Nothing in this table is a timing, and nothing in it ' +
      `depends on what the machine was doing — load was ${peak.toFixed(1)} and it ` +
      'would not have mattered.'
    : peak > 4
    ? `> **This is not a run of record. Peak 1-minute load was ${peak.toFixed(1)}**, ` +
      'against the 4.0 this repo treats as the ceiling for a quotable absolute ' +
      'and the 1.5–2.9 a clean run wants. Do not quote a millisecond from this ' +
      'table. What survives contamination is the **record count** column, which ' +
      'is not a timing at all, and — more weakly — the shape of each curve, ' +
      'which the rotated version order protects from drift but not from a spike ' +
      'landing on one version.'
    : `Peak 1-minute load during this run: ${peak.toFixed(1)}.`,
  '',
  'Each table carries two kinds of column, and they do not decay together.',
  '',
  '**`time` and `vs oldest` are timings.** `vs oldest` is against the oldest',
  'built version of that library, so a row reads as "how much of the total gain',
  'had arrived by here".',
  '',
  '**`reads`, `bytes` and `records` are counts.** They come from a filehandle that',
  'records every call, so they are exact, identical on every machine, and',
  'unaffected by whatever else the box was doing. `reads` splits as data + index.',
  'A `*` on `records` marks a version returning a different record set from the',
  'newest one it is being compared against — a reason to distrust that row rather',
  'than a speedup.',
  '',
  'Reads are the quantity that transfers to the network: locally one is a syscall,',
  'over HTTP it is a range request and a round trip.',
  '',
]

for (const r of results) {
  md.push(`## ${r.package} — ${r.case}`, '')
  md.push(
    '| version | time | vs oldest | reads | bytes | records |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  )
  const base = r.points[0]!.ms
  for (const p of r.points) {
    const star = r.disagree.includes(p.tag) ? ' \\*' : ''
    const time = p.ms === null ? '—' : `${p.ms.toFixed(2)} ms`
    const rel = p.ms === null || base === null ? '—' : `${(base / p.ms).toFixed(2)}x`
    const reads = p.counts
      ? `${p.counts.reads} (${p.counts.dataReads}+${p.counts.indexReads})`
      : '—'
    const bytes = p.counts ? `${(p.counts.bytes / 1024).toFixed(0)} KB` : '—'
    md.push(`| ${p.tag} | ${time} | ${rel} | ${reads} | ${bytes} | ${p.records}${star} |`)
  }
  md.push('')
  if (r.disagree.length) {
    md.push(
      `> Record sets differ from the newest version at: ${r.disagree.join(', ')}. ` +
        'The equivalence gate (`make verify`) adjudicates the 2023-vs-current ' +
        'case of this; nothing yet adjudicates the intermediate ones.',
      '',
    )
  }
}

const unb = libraries.filter(l => l.unbuildable.length)
if (unb.length) {
  md.push('## Versions that would not build', '')
  md.push(
    'Recorded rather than dropped: which majors of a library can still be built',
    'from source with a current toolchain is a fact about the library, and a gap',
    'in a curve should be visible as a gap.',
    '',
  )
  for (const l of unb) {
    md.push(`- \`${l.package}\`: ${l.unbuildable.join(', ')}`)
  }
  md.push('')
}

const pending = libraries.filter(l => l.notBuilt.length)
if (pending.length) {
  md.push(
    '## Versions not built yet',
    '',
    'Named in `sweep.json` but never attempted by `setup-sweep.sh`. This is a',
    'missing step rather than a fact about the library, and it is listed apart',
    'from the section above for exactly that reason — a version absent because',
    'nobody ran setup should not read as a version that cannot be built.',
    '',
  )
  for (const l of pending) {
    md.push(
      `- \`${l.package}\`: ${l.notBuilt.join(', ')} — \`./setup-sweep.sh ${l.name}\``,
    )
  }
  md.push('')
}

writeFileSync(here('results/sweep.md'), md.join('\n'))
console.log('\nwrote results/sweep.md and results/sweep.json')

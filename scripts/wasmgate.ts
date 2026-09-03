// When is compiling a hotspot to WebAssembly worth it?
//
// A worker gets data across a boundary for free: postMessage transfers an
// ArrayBuffer's ownership and nothing is copied. wasm has no equivalent. It can
// only address its own linear memory, so every call copies the input in and the
// result back out, and that copy is paid whether or not the routine inside is
// any faster than the JavaScript it replaced. A port is therefore only a
// speedup when the work exceeds the copy.
//
// This measures both halves of that inequality on real files:
//
//   The floor — what it costs to move `in` bytes into a wasm heap, cross the
//   boundary, and copy `out` bytes back. Measured through @gmod/cram's
//   emscripten htscodecs module, running exactly the malloc/HEAPU8.set/call/
//   copy-out/free sequence its `htscodecs-wasm.ts` performs around every codec,
//   with the codec itself replaced by a call that returns immediately. It is a
//   memcpy pair, so it scales with bytes and not with the module: the run
//   records its throughput so that can be checked rather than assumed.
//
//   The candidates — what each routine costs in JavaScript, and how many bytes
//   it would have to marshal. A routine whose JS time sits below the floor for
//   its own byte count cannot be made faster by any wasm implementation, however
//   good; one that sits above it has a ceiling equal to the ratio, and what a
//   port actually collects is somewhere under that.
//
// **Every candidate is a routine JBrowse actually runs, and CALL_SITES names
// where.** That table is not documentation, it is the admission rule: a routine
// with no call site is not measured, and the provenance travels into the JSON so
// a reader of the figure can check it rather than take it on trust.
//
// This mattered. Until 2026-09-02 two of the six were `BamRecord.CIGAR` and
// `BamRecord.seq` — the accessors that build a CIGAR *string* and a base
// *string* — and the alignments renderer calls neither. It reads NUMERIC_CIGAR
// and walks the packed SEQ, deliberately: `readBaseCounts.ts` in
// jbrowse-components says in as many words that asking for the string makes the
// feature "BUILD a string out of the packed ops it already held" and parse it
// straight back. So those two rows measured work the program does not do, and
// measured it generously, since most of what they cost is JS string
// construction — which a wasm port could not remove anyway, the string still
// having to be built on the JS side of the boundary. They are replaced here by
// the two routines the render path actually reaches for.
//
// Two of the candidates are already ported, so the run carries their measured
// wasm time next to their ceiling. That is what turns the figure from an
// argument into a check: the realised speedup has to land between 1 and the
// ceiling the floor predicts.
//
// Usage: node --experimental-strip-types scripts/wasmgate.ts
//   BAMS=a.bam,b.bam   files to measure (default: data/*.bam)
//   GMOD=~/src/gmod    checkouts of bgzf-filehandle, bam-js and cram-js
//   REPS=25            measured repetitions per cell
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus, homedir, loadavg } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const GMOD = process.env.GMOD ?? path.join(homedir(), 'src/gmod')
const REPS = Number(process.env.REPS ?? 25)

/**
 * Where one BGZF block sits — @gmod/bgzf-filehandle's `BgzfBlockInfo`.
 *
 * Restated rather than imported. These modules are loaded by a path computed
 * from GMOD, which no compiler can follow, so every binding below arrives as
 * `any` and every `any` propagates: `blocks.slice(0, n).reduce(...)` was the
 * only thing tsc complained about, and the reason it complained about only that
 * one is that the rest had already gone untyped in silence. The shapes are
 * small and the run records the revision each was read from, so a drift shows
 * up as a failure here rather than as a wrong number.
 */
interface BgzfBlockInfo {
  inputOffset: number
  compressedSize: number
  decompressedSize: number
  filePosition: number
}

/** The subset of @gmod/bam's BamRecord this benchmark reads. */
interface BamRecordFields {
  start: number
  end: number
  flags: number
  mq: number
  seq_length: number
  qual: Uint8Array | null
  NUMERIC_CIGAR: ArrayLike<number>
  NUMERIC_SEQ: Uint8Array
  /** `undefined`, not null, on a record with no MD tag */
  NUMERIC_MD: Uint8Array | undefined
}

/**
 * Where JBrowse runs each routine, by file and symbol rather than by line, since
 * lines move. Recorded into the run so the figure's rows can be checked against
 * the program instead of trusted.
 *
 * `jb2` names jbrowse-components' alignments plugin; the rest are the parser
 * libraries it reads through.
 */
const CALL_SITES: Record<string, { layer: string; callSite: string }> = {
  'BGZF inflate': {
    layer: '@gmod/bgzf-filehandle',
    callSite: '@gmod/bam bamFile.ts › getRecordsForRange → unzipChunkSlice',
  },
  'BGZF block scan': {
    layer: '@gmod/bgzf-filehandle',
    callSite: '@gmod/bam streamBam.ts › streamBamRecords → scanBgzfBlocks',
  },
  'BAM record walk': {
    layer: '@gmod/bam',
    callSite: '@gmod/bam bamFile.ts › readBamFeatures',
  },
  'BAM field decode': {
    layer: '@gmod/bam',
    callSite: 'jb2 BamAdapter.ts › filterReadFlag(record.flags), record.start',
  },
  'BAM CIGAR unpack': {
    layer: '@gmod/bam',
    callSite: 'jb2 BamAdapter.ts › numericCigarHasSkip(record.NUMERIC_CIGAR)',
  },
  'BAM mismatch walk': {
    layer: '@gmod/bam',
    callSite: 'jb2 BamSlightlyLazyFeature.ts › forEachMismatch → forEachMismatchNumeric',
  },
}

/** The subset of an emscripten module `htscodecs-wasm.ts` uses. */
interface HtsCodecsModule {
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
  _rans_uncompress: (inPtr: number, inSize: number, outSizePtr: number) => number
  HEAPU8: Uint8Array
}

const { unzip } = (await import(
  path.join(GMOD, 'bgzf-filehandle/src/unzip.ts')
)) as { unzip: (input: Uint8Array) => Promise<Uint8Array> }
const { scanBgzfBlocks } = (await import(
  path.join(GMOD, 'bgzf-filehandle/src/bgzfBlockScan.ts')
)) as {
  scanBgzfBlocks: (input: Uint8Array, min: number, max: number) => BgzfBlockInfo[]
}
const { inflateRaw } = (await import(
  path.join(GMOD, 'bgzf-filehandle/node_modules/pako-esm2/esm/main.js')
)) as { inflateRaw: (input: Uint8Array) => Uint8Array }
const { forEachMismatchNumeric } = (await import(
  path.join(GMOD, 'bam-js/src/mismatches.ts')
)) as {
  forEachMismatchNumeric: (
    cigar: ArrayLike<number>,
    numericSeq: ArrayLike<number>,
    seqLength: number,
    md: ArrayLike<number> | undefined,
    qual: ArrayLike<number> | null | undefined,
    ref: undefined,
    refStart: number,
    windowStart: number,
    windowEnd: number,
    origin: number,
    callback: (code: number, refPos: number, length: number) => void,
  ) => void
}
const { default: BamRecord } = (await import(
  path.join(GMOD, 'bam-js/src/record.ts')
)) as {
  default: new (
    byteArray: Uint8Array,
    start: number,
    end: number,
    fileOffset: number,
    dataView: DataView,
  ) => BamRecordFields
}
const { default: createHtsCodecsModule } = (await import(
  path.join(GMOD, 'cram-js/src/wasm/htscodecs.js')
)) as { default: () => Promise<HtsCodecsModule> }

function provenance(repo: string) {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', path.join(GMOD, repo), ...args], {
      encoding: 'utf8',
    }).trim()
  return {
    rev: git('rev-parse', '--short', 'HEAD'),
    describe: git('describe', '--tags', '--always'),
    dirty: git('status', '--porcelain').length > 0,
  }
}

function corpus() {
  const named = process.env.BAMS?.split(',').filter(Boolean)
  if (named) {
    return named.map(f => path.resolve(f))
  }
  const dir = path.join(REPO, 'data')
  const found = readdirSync(dir)
    .filter(f => f.endsWith('.bam'))
    .map(f => path.join(dir, f))
  if (found.length === 0) {
    throw new Error(
      `no data/*.bam. Regenerate the corpus with shell/generate_alignments.sh, ` +
        `or name files with BAMS=<paths>.`,
    )
  }
  return found
}

const wasm = await createHtsCodecsModule()

/**
 * The copy-in / cross / copy-out that wraps every wasm call, with nothing in the
 * middle. `_rans_uncompress` with a 4-byte length returns NULL before it reads
 * anything — a real boundary crossing that does no work.
 *
 * The wasm-side buffer is allocated once per cell and reused, so this is the
 * CHEAPEST marshalling a port could arrange: two memcpys, one crossing, and the
 * JS array the result has to arrive in. A port that mallocs per call — which is
 * what @gmod/cram's own wrapper does — pays more, and measuring that instead
 * would flatter the argument by raising the bar every candidate is judged
 * against. The lower bound is the honest one: a routine below it cannot be
 * rescued by a better-written port.
 *
 * The copy out reads back from the input pointer, so the bytes it moves are the
 * input's; `checkFloor` asserts they arrive intact, because emscripten's HEAPU8
 * is a view that a heap growth replaces, and a stale one would silently make
 * this measure a copy that never happened.
 */
function marshaller(input: Uint8Array, outBytes: number) {
  const inPtr = wasm._malloc(input.length)
  const outSizePtr = wasm._malloc(4)
  const cross = () => {
    wasm.HEAPU8.set(input, inPtr)
    wasm._rans_uncompress(inPtr, 4, outSizePtr)
    const result = new Uint8Array(outBytes)
    result.set(wasm.HEAPU8.subarray(inPtr, inPtr + outBytes))
    return result
  }
  const free = () => {
    wasm._free(inPtr)
    wasm._free(outSizePtr)
  }
  return { cross, free }
}

/** {@link marshaller} for one call, allocation included. */
function floor(input: Uint8Array, outBytes: number) {
  const { cross, free } = marshaller(input, outBytes)
  try {
    return cross()
  } finally {
    free()
  }
}

function checkFloor(input: Uint8Array) {
  const back = floor(input, input.length)
  for (let i = 0; i < input.length; i += 4093) {
    if (back[i] !== input[i]) {
      throw new Error(`floor round trip corrupted byte ${i}`)
    }
  }
}

/** The floor for one cell, with the wasm-side buffer out of the timed body. */
function timeFloor(input: Uint8Array, outBytes: number, reps: number) {
  const { cross, free } = marshaller(input, outBytes)
  try {
    return time(cross, reps)
  } finally {
    free()
  }
}

/**
 * Minimum as well as median, because the box this runs on is shared.
 *
 * The figure plots the MINIMUM. Contention only ever adds time, so the fastest
 * repetition is the one least contaminated by whatever else was running, and
 * the median of a run interrupted halfway through is not a middle estimate of
 * anything. The median is kept beside it: a cell whose median sits far above
 * its minimum is a cell that spent most of the run waiting, and the load column
 * says whether to believe any of it.
 */
function summarize(t: number[]) {
  t.sort((a, b) => a - b)
  return { median: t[Math.floor(t.length / 2)]!, min: t[0]!, max: t.at(-1)! }
}

function time(fn: () => unknown, reps: number) {
  for (let i = 0; i < 5; i++) {
    fn()
  }
  const t: number[] = []
  for (let i = 0; i < reps; i++) {
    const start = performance.now()
    fn()
    t.push(performance.now() - start)
  }
  return summarize(t)
}

/**
 * The same, awaiting each repetition.
 *
 * Separate from {@link time} rather than folded into it: `await` on a value
 * that is not a promise still costs a microtask turn, and the cheapest routine
 * measured here runs in single-digit microseconds. Timing the wasm arm without
 * it is worse than imprecise — an unawaited `unzip` leaves the decompression
 * pending, so the arm reads as nothing and the work lands inside whichever cell
 * is being timed when the queue finally drains.
 */
async function timeAsync(fn: () => Promise<unknown>, reps: number) {
  for (let i = 0; i < 5; i++) {
    await fn()
  }
  const t: number[] = []
  for (let i = 0; i < reps; i++) {
    const start = performance.now()
    await fn()
    t.push(performance.now() - start)
  }
  return summarize(t)
}

interface Stat {
  median: number
  min: number
  max: number
}

interface Cell {
  file: string
  candidate: string
  /** which library the routine belongs to */
  layer: string
  /** where JBrowse runs it; see CALL_SITES */
  callSite: string
  /** records or blocks the sweep point covers */
  units: number
  inBytes: number
  outBytes: number
  js: Stat
  /** the shipped wasm implementation, where one exists */
  wasm: Stat | null
  floor: Stat
  /** 1-minute load average when the cell finished */
  load: number
}

const rows: Cell[] = []
/** Per file: how many records carry MD, which decides which mismatch walk runs. */
const mdCoverage: Record<string, { records: number; withMd: number }> = {}

/**
 * What else the box was doing, recorded per cell.
 *
 * `scripts/render/loadavg.ts` does this properly, subtracting the run's own
 * tree so a heavy cell cannot disqualify itself — but it reads /proc and this
 * benchmark also runs on macOS, so it records the load average and nothing
 * more. That is context and not a verdict: a cell here can drive the average by
 * itself. What it is for is the comparison across a run. Every arm of a cell is
 * measured back to back, so contention lands on all of them together and the
 * RATIOS survive it; the absolute times do not, and a run whose load says the
 * box was busy is a run whose milliseconds should not be quoted.
 */
const record = (c: Omit<Cell, 'layer' | 'callSite'>) => {
  const site = CALL_SITES[c.candidate]
  if (!site) {
    throw new Error(
      `no call site for "${c.candidate}". Every routine measured here has to be ` +
        `one JBrowse runs; add it to CALL_SITES or do not measure it.`,
    )
  }
  rows.push({ ...c, ...site })
  const marshalled = c.inBytes + c.outBytes
  console.log(
    `  ${c.candidate.padEnd(22)} ${String(c.units).padStart(6)}u ` +
      `${(marshalled / 1e6).toFixed(2).padStart(6)} MB  ` +
      `js ${c.js.min.toFixed(3).padStart(8)}  floor ${c.floor.min.toFixed(3).padStart(7)}  ` +
      `ceiling ${(c.js.min / c.floor.min).toFixed(1).padStart(6)}x` +
      (c.wasm === null
        ? ''
        : `  wasm ${c.wasm.min.toFixed(3)} (${(c.js.min / c.wasm.min).toFixed(2)}x)`),
  )
}

/** Every BGZF block's raw deflate payload, which is what pako inflates. */
const BGZF_HEADER = 18
const BGZF_TRAILER = 8
const payloadOf = (b: { inputOffset: number; compressedSize: number }) =>
  [b.inputOffset + BGZF_HEADER, b.inputOffset + b.compressedSize - BGZF_TRAILER] as const

/**
 * The unbound mismatch walk, exactly as `BamSlightlyLazyFeature.forEachMismatch`
 * issues it: no reference, an unwindowed span, and read-relative origin.
 *
 * Unbound is what a record carrying MD gets in JBrowse. A record WITHOUT MD gets
 * `withRegionRef(packedRef)` instead and the walk resolves substitutions against
 * a packed reference, which is strictly more work — so on a corpus with no MD
 * this measures a lower bound on the routine, and the run records which corpus
 * that is. See BamAdapter.ts, where the two are chosen between.
 */
function walkMismatches(r: BamRecordFields, onEvent: () => void) {
  forEachMismatchNumeric(
    r.NUMERIC_CIGAR, r.NUMERIC_SEQ, r.seq_length, r.NUMERIC_MD,
    r.qual, undefined, r.start,
    Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, r.start, onEvent,
  )
}

/** Record boundaries in a decompressed BAM, past its header and reference list. */
function bamRecordSpans(plain: Uint8Array) {
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength)
  let p = 8 + dv.getInt32(4, true)
  const nRef = dv.getInt32(p, true)
  p += 4
  for (let i = 0; i < nRef; i++) {
    p += 4 + dv.getInt32(p, true) + 4
  }
  const spans: [number, number][] = []
  for (let q = p; q + 4 < plain.length; ) {
    const end = q + 4 + dv.getInt32(q, true) - 1
    if (end <= q || end >= plain.length) {
      break
    }
    spans.push([q, end])
    q = end + 1
  }
  return { dv, first: p, spans }
}

const files = corpus()
console.log(`floor module: @gmod/cram htscodecs (emscripten)`)
checkFloor(new Uint8Array(readFileSync(files[0]!)).subarray(0, 1 << 20))

for (const file of files) {
  const compressed = new Uint8Array(readFileSync(file))
  const label = path.basename(file)
  const blocks = scanBgzfBlocks(compressed, 0, compressed.length)
  console.log(`\n${label}  ${(compressed.length / 1e6).toFixed(1)} MB, ${blocks.length} blocks`)

  // The BGZF layer, swept over block count: an indexed query resolves to a run
  // of blocks, and how long that run is is the axis a consumer actually moves.
  const counts = [1, 4, 16, 64, 256, blocks.length].filter(
    (n, i, a) => n <= blocks.length && a.indexOf(n) === i,
  )
  for (const n of counts) {
    const span = blocks.slice(0, n)
    const last = span.at(-1)!
    const end = last.inputOffset + last.compressedSize
    const buf = compressed.subarray(0, end)
    const plainBytes = span.reduce((a, b) => a + b.decompressedSize, 0)
    const reps = n < 64 ? REPS * 4 : REPS

    record({
      file: label, candidate: 'BGZF inflate',
      units: n, inBytes: end, outBytes: plainBytes,
      js: time(() => {
        for (const b of span) {
          const [s, e] = payloadOf(b)
          inflateRaw(buf.subarray(s, e))
        }
      }, reps),
      wasm: await timeAsync(() => unzip(buf), reps),
      floor: timeFloor(buf, plainBytes, reps),
      load: loadavg()[0]!,
    })

    record({
      file: label, candidate: 'BGZF block scan',
      units: n, inBytes: end, outBytes: n * 32,
      js: time(() => scanBgzfBlocks(buf, 0, end), reps),
      wasm: null,
      floor: timeFloor(buf, n * 32, reps),
      load: loadavg()[0]!,
    })
  }

  // The record layer, on the bytes the layer above hands it.
  const plain = await unzip(compressed)
  const { dv, first, spans } = bamRecordSpans(plain)
  // Truthiness, which is the test BamAdapter itself makes (`!record.NUMERIC_MD
  // && packedRef`). The getter returns `undefined` for a record with no MD and
  // never null, so `!== null` is true for every record and counts nothing.
  const withMd = spans.filter(
    ([s2, e]) => !!new BamRecord(plain, s2, e, 0, dv).NUMERIC_MD,
  ).length
  mdCoverage[label] = { records: spans.length, withMd }
  console.log(
    `  ${spans.length} records in ${(plain.length / 1e6).toFixed(1)} MB decompressed, ` +
      `${withMd} carrying MD`,
  )

  const fractions = [0.05, 0.2, 0.5, 1]
  for (const fraction of fractions) {
    const take = Math.max(1, Math.round(spans.length * fraction))
    const span = spans.slice(0, take)
    const end = span.at(-1)![1] + 1
    const buf = plain.subarray(first, end)
    // Fresh records inside every timed body, never a set built once outside it.
    // BamRecord is a lazy view that memoizes what it decodes -- length_on_ref,
    // the numeric CIGAR, the sequence start -- so a reused set measures cache
    // hits, and what a wasm port would replace is the decode.
    const records = () => span.map(([s, e]) => new BamRecord(plain, s, e, 0, dv))
    // Sized on a throwaway set, outside every timed body: BamRecord memoizes what
    // it decodes, so the records the timings run on have to be built fresh.
    const sized = records()
    const cigarOps = sized.reduce((a, r) => a + r.NUMERIC_CIGAR.length, 0)
    let mismatchEvents = 0
    for (const r of sized) {
      walkMismatches(r, () => {
        mismatchEvents++
      })
    }
    const reps = fraction < 0.5 ? REPS * 2 : REPS

    const bam = (candidate: string, outBytes: number, js: () => unknown) =>
      record({
        file: label, candidate,
        units: take, inBytes: end - first, outBytes,
        js: time(js, reps),
        wasm: null,
        floor: timeFloor(buf, outBytes, reps),
        load: loadavg()[0]!,
      })

    bam('BAM record walk', take * 8, () => {
      let n = 0
      for (let q = first; q + 4 < end; ) {
        const stop = q + 4 + dv.getInt32(q, true) - 1
        if (stop <= q || stop >= end) {
          break
        }
        n++
        q = stop + 1
      }
      return n
    })

    bam('BAM field decode', take * 16, () => {
      let acc = 0
      for (const r of records()) {
        acc += r.start + r.end + r.flags + r.mq
      }
      return acc
    })

    // The packed CIGAR the render path reads, not the string form. Four bytes an
    // op out, which is what a wasm port would hand back.
    bam('BAM CIGAR unpack', cigarOps * 4, () => {
      let acc = 0
      for (const r of records()) {
        acc += r.NUMERIC_CIGAR.length
      }
      return acc
    })

    // The pileup hot path. Sixteen bytes an event out: a port has to return the
    // mismatches it found, and (code, refPos, length, base) as four int32s is the
    // cheapest packing that carries what the callback yields.
    bam('BAM mismatch walk', mismatchEvents * 16, () => {
      let acc = 0
      for (const r of records()) {
        walkMismatches(r, () => {
          acc++
        })
      }
      return acc
    })
  }
}

const loads = rows.map(r => r.load).sort((a, b) => a - b)
const out = {
  measured: new Date().toISOString().slice(0, 10),
  host: {
    platform: process.platform, arch: process.arch, node: process.version,
    cpus: cpus().length,
  },
  load: {
    median: loads[Math.floor(loads.length / 2)]!,
    min: loads[0]!,
    max: loads.at(-1)!,
  },
  reps: REPS,
  floorModule: '@gmod/cram htscodecs (emscripten)',
  mdCoverage,
  libraries: {
    'bgzf-filehandle': provenance('bgzf-filehandle'),
    'bam-js': provenance('bam-js'),
    'cram-js': provenance('cram-js'),
  },
  files: files.map(f => path.relative(REPO, f)),
  rows,
}
const dest = path.join(REPO, 'results/wasmgate.json')
writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`)
console.log(`\nwrote ${path.relative(REPO, dest)} (${rows.length} rows)`)
console.log(
  `load average ${out.load.min.toFixed(1)}-${out.load.max.toFixed(1)} ` +
    `(median ${out.load.median.toFixed(1)}) over ${out.host.cpus} cpus`,
)
if (out.load.median > out.host.cpus / 2) {
  console.log(
    `The box was busy. The ratios this measures survive that -- every arm of a ` +
      `cell runs back to back -- but the milliseconds are inflated and should ` +
      `not be quoted as this machine's speed.`,
  )
}

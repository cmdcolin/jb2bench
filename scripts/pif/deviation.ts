// Does a coarsened PIF record draw where the alignment it stands for goes?
//
// A coarsened record replaces the CIGAR with kept indels and runs, and a run is
// a straight line: the reader interpolates across it. So every question the
// browser answers by walking an alignment -- where a ribbon edge lands, where a
// location marker's partner sits on the other genome -- is answered off that
// straight line rather than off the real path. `make-pif --coarse` promises the
// two are never more than the bound apart. This measures the gap.
//
// The measurement, per record: walk the full CIGAR, and at every vertex of the
// real path ask where the coarsened path is at the same coordinate on the first
// genome. The answer is a set, not a point, because a kept indel is a vertical
// step -- so a vertex sitting anywhere on that step scores zero, which is what
// makes keeping an indel worth its bytes. Divide by bp-per-pixel and the number
// is what a reader would see.
//
// Two encodings are measured, because the bound is a property of this one and
// not of coarsening in general:
//
//   coarsened   the `cr:Z:` encoding make-pif writes. Indels longer than half
//               the bound keep their letter; between them, one run per stretch,
//               closed before its accumulated lean passes half the bound.
//   split       the alternative: cut the alignment at every indel over the same
//               size and drop the CIGAR, leaving one straight ribbon per piece.
//               This is what `rb break-paf` produces upstream of a CIGAR-less
//               writer, and what PIF's own coarse tier did before 2026-09-02.
//               Nothing bounds what the sub-threshold indels it leaves in place
//               do to the straight line across a piece, which is the point.
//
// Reads the `t` records of a PIF rather than a PAF, so the input is the hosted
// file itself: those records keep the original CIGAR, so the file is its own
// source (agent-docs/reference/HOSTING.md, "PIF inverts losslessly back to
// PAF").
//
//   node --experimental-strip-types scripts/pif/deviation.ts <file.pif.gz>
//
// Needs a jbrowse-components checkout for the coarsener itself, so the figure
// measures the shipped function and not a second copy of it: $JB2, default
// ~/src/jbrowse-components, built (`pnpm --filter @jbrowse/cigar-utils build`).

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

const BOUND = 10_000 // make-pif's default --coarse, in bp
const BP_PER_PX = 10_000 // the adapter's default coarseBpPerPxThreshold
const TRACE_POINTS = 2000 // columns of the featured record's trace

const JB2 = process.env.JB2 ?? `${homedir()}/src/jbrowse-components`
const { coarsenCigar } = await import(
  `${JB2}/packages/cigar-utils/esm/coarseCigar.js`
).catch(() => {
  throw new Error(
    `no coarsener at ${JB2}/packages/cigar-utils/esm/; set JB2 and build it`,
  )
})

const M = 77
const I = 73
const D = 68
const N = 78
const EQ = 61
const X = 88
const ownAdv = (op: number, len: number) =>
  op === M || op === EQ || op === X || op === D || op === N ? len : 0
const mateAdv = (op: number, len: number) =>
  op === M || op === EQ || op === X || op === I ? len : 0

function parseOps(cigar: string) {
  const ops: number[] = []
  let len = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      len = len * 10 + c - 48
    } else {
      ops.push(len, c)
      len = 0
    }
  }
  return ops
}

interface Seg {
  own: number
  mate: number
}

/** The `cr:Z:` grammar as segments: `<own>:<mate>M`, `<n>M`, and kept I/D/N. */
function coarseSegs(cr: string): Seg[] {
  const segs: Seg[] = []
  let len = 0
  let ownBeforeColon: number | undefined
  for (let i = 0; i < cr.length; i++) {
    const c = cr.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      len = len * 10 + c - 48
    } else if (c === 58) {
      ownBeforeColon = len
      len = 0
    } else {
      const op = cr[i]
      segs.push(
        op === 'M'
          ? { own: ownBeforeColon ?? len, mate: len }
          : op === 'I'
            ? { own: 0, mate: len }
            : { own: len, mate: 0 },
      )
      ownBeforeColon = undefined
      len = 0
    }
  }
  return segs
}

/** Cut at every indel over `size`; each gap-free stretch is one straight run. */
function splitSegs(ops: number[], size: number): Seg[] {
  const segs: Seg[] = []
  let own = 0
  let mate = 0
  for (let k = 0; k < ops.length; k += 2) {
    const len = ops[k]!
    const op = ops[k + 1]!
    if (len > size && (op === I || op === D || op === N)) {
      if (own > 0 || mate > 0) {
        segs.push({ own, mate })
        own = 0
        mate = 0
      }
      segs.push(op === I ? { own: 0, mate: len } : { own: len, mate: 0 })
    } else {
      own += ownAdv(op, len)
      mate += mateAdv(op, len)
    }
  }
  if (own > 0 || mate > 0) {
    segs.push({ own, mate })
  }
  return segs
}

/**
 * Signed distance, at every vertex of the real path, from that vertex to the
 * coarse path taken at the same first-genome coordinate. Positive means the
 * coarse path sits further along the second genome than the truth.
 */
function trace(ops: number[], segs: Seg[]) {
  const po = [0]
  const pm = [0]
  let co = 0
  let cm = 0
  for (const s of segs) {
    co += s.own
    cm += s.mate
    po.push(co)
    pm.push(cm)
  }
  const last = po.length - 1
  const xs: number[] = []
  const ys: number[] = []
  let i = 0
  let own = 0
  let mate = 0
  const probe = () => {
    while (i < last && po[i + 1]! < own) {
      i++
    }
    let lo: number
    let hi: number
    if (po[i] === own || (i < last && po[i + 1] === own)) {
      // the coarse path is vertical here -- a kept indel, or the seam between
      // two runs -- so it covers a RANGE of second-genome coordinates, and a
      // vertex anywhere in that range is exactly on it
      let j = po[i] === own ? i : i + 1
      lo = pm[j]!
      while (j < last && po[j + 1] === own) {
        j++
      }
      hi = pm[j]!
    } else if (i < last) {
      const t = (own - po[i]!) / (po[i + 1]! - po[i]!)
      lo = hi = pm[i]! + t * (pm[i + 1]! - pm[i]!)
    } else {
      lo = hi = pm[last]!
    }
    xs.push(own)
    ys.push(mate < lo ? lo - mate : mate > hi ? -(mate - hi) : 0)
  }
  probe()
  for (let k = 0; k < ops.length; k += 2) {
    own += ownAdv(ops[k + 1]!, ops[k]!)
    mate += mateAdv(ops[k + 1]!, ops[k]!)
    probe()
  }
  return { xs, ys }
}

const peak = (ys: number[]) => ys.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** Worst |deviation| per bucket, so a downsampled trace keeps its peaks. */
function downsample(xs: number[], ys: number[], span: number, buckets: number) {
  const best = new Array<number>(buckets).fill(0)
  for (let k = 0; k < xs.length; k++) {
    const b = Math.min(buckets - 1, Math.floor((xs[k]! / span) * buckets))
    if (Math.abs(ys[k]!) > Math.abs(best[b]!)) {
      best[b] = ys[k]!
    }
  }
  return best
}

interface Featured {
  ownSpan: number
  label: string
  traces: Record<string, number[]>
}

async function main() {
  const src = process.argv[2]
  if (!src) {
    throw new Error('usage: deviation.ts <file.pif.gz>')
  }
  const outDir = 'results/paper'
  mkdirSync(outDir, { recursive: true })

  const worst: Record<string, number[]> = { coarsened: [], split: [] }
  let rows = 0
  let featured: Featured | undefined
  let featuredPeak = -1

  const rl = createInterface({
    input: createReadStream(src).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (line.charCodeAt(0) !== 116) {
      continue // `t` records only: one perspective, with the original CIGAR
    }
    // `cg:Z:` is not the last field -- a version-2 writer puts `pi:i:` after
    // it -- and the line can be megabytes, so this finds the tag rather than
    // splitting the whole row to look for it
    const at = line.indexOf('\tcg:Z:')
    if (at < 0) {
      continue
    }
    const end = line.indexOf('\t', at + 6)
    const cigar = end < 0 ? line.slice(at + 6) : line.slice(at + 6, end)
    const cols = line.slice(0, at).split('\t')
    const ops = parseOps(cigar)
    rows++

    const encodings = {
      coarsened: coarseSegs(coarsenCigar(cigar, BOUND).ops),
      split: splitSegs(ops, BOUND),
    }
    const peaks: Record<string, number> = {}
    const traces: Record<string, { xs: number[]; ys: number[] }> = {}
    for (const [name, segs] of Object.entries(encodings)) {
      const t = trace(ops, segs)
      traces[name] = t
      peaks[name] = peak(t.ys)
      worst[name]!.push(peaks[name]!)
    }

    // The record the figure draws is the one where OUR encoding is at its worst.
    // Picking the split's worst instead would flatter us; picking at random
    // would not show the bound being approached at all.
    if (peaks.coarsened! > featuredPeak) {
      featuredPeak = peaks.coarsened!
      const span = +cols[3]! - +cols[2]!
      featured = {
        ownSpan: span,
        label: `${cols[0]!.slice(1)}:${cols[2]}-${cols[3]} vs ${cols[5]}`,
        traces: Object.fromEntries(
          Object.entries(traces).map(([name, t]) => [
            name,
            downsample(t.xs, t.ys, span, TRACE_POINTS),
          ]),
        ),
      }
    }
  }

  if (!featured) {
    throw new Error(`no t records with a CIGAR in ${src}`)
  }

  const step = featured.ownSpan / TRACE_POINTS
  const traceCsv = ['encoding,mb,px']
  for (const [name, ys] of Object.entries(featured.traces)) {
    ys.forEach((y, b) => {
      traceCsv.push(
        `${name},${(((b + 0.5) * step) / 1e6).toFixed(4)},${(y / BP_PER_PX).toFixed(4)}`,
      )
    })
  }
  writeFileSync(`${outDir}/pif-deviation.csv`, `${traceCsv.join('\n')}\n`)

  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))]!
  const summary = ['encoding,records,bound_bp,bp_per_px,p50_px,p99_px,max_px,over_bound']
  for (const [name, list] of Object.entries(worst)) {
    const sorted = [...list].sort((a, b) => a - b)
    summary.push(
      [
        name,
        rows,
        BOUND,
        BP_PER_PX,
        (q(sorted, 0.5) / BP_PER_PX).toFixed(4),
        (q(sorted, 0.99) / BP_PER_PX).toFixed(4),
        (sorted.at(-1)! / BP_PER_PX).toFixed(4),
        sorted.filter(v => v > BOUND).length,
      ].join(','),
    )
  }
  writeFileSync(`${outDir}/pif-deviation-summary.csv`, `${summary.join('\n')}\n`)

  writeFileSync(
    `${outDir}/pif-deviation-featured.csv`,
    `label,own_span_bp\n"${featured.label}",${featured.ownSpan}\n`,
  )

  console.log(`${rows} records from ${src}`)
  console.log(summary.join('\n'))
  console.log(`featured: ${featured.label} (${(featured.ownSpan / 1e6).toFixed(1)} Mb)`)
}

await main()

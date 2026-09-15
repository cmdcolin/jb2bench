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
// genome. Where the coarsened path is a kept insertion it is vertical, so the
// answer is a range and a vertex anywhere in it scores zero. Divide by
// bp-per-pixel and the number is what a reader would see.
//
// Two encodings are measured, because the bound is a property of this one and
// not of coarsening in general:
//
//   coarsened   the fold make-pif writes. Indels longer than half the bound
//               keep their letter; the stretch between two of them is one or
//               more runs, each closed before its lean passes half the bound.
//   split       cut the alignment at every indel of at least the bound and drop
//               the CIGAR, leaving one straight ribbon per piece -- make-pif's
//               coarse tier from 2026-05-28 to 2026-09-02. `rb break-paf` cuts
//               the same way but keeps a CIGAR on each piece, so it gives this
//               shape only in front of a writer or viewer that drops the CIGAR.
//               Nothing bounds what the smaller indels do to the straight line
//               across a piece.
//
// Reads the `t` records of a PIF rather than a PAF, so the input is the hosted
// file itself: those records keep the original CIGAR, so the file is its own
// source (agent-docs/reference/HOSTING.md, "PIF inverts losslessly back to
// PAF").
//
//   node --experimental-strip-types scripts/pif/deviation.ts <file.pif.gz>
//
// The coarsener is the one the pinned @jbrowse/cli depends on, so the figure
// measures the published function and not a second copy of it.

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

import { coarsenCigar } from '@jbrowse/cigar-utils'

import {
  cigarOf,
  coarseSegs,
  parseOps,
  peak,
  splitSegs,
  trace,
} from './geometry.ts'

const BOUND = 10_000 // make-pif's default --coarse, in bp
const BP_PER_PX = 10_000 // the adapter's default coarseBpPerPxThreshold
const TRACE_POINTS = 2000 // columns of the featured record's trace

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
    // it -- and the line can be megabytes
    const found = cigarOf(line)
    if (!found) {
      continue
    }
    const { at, cigar } = found
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

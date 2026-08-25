// The JS reference implementation's two phases, on real 1000 Genomes matrices.
//
// greenelab/hclust is the "before" for the clustering figure: the reference
// JavaScript implementation, vendored under vendor/ with the phase boundary
// timed (see the header there). @gmod/hclust's wasm reports the same split
// through its own onProgress, so both sides are measured the same way.
//
// N is SWEPT rather than run once at full size, because the two phases scale
// differently and the sweep is what says which sizes are reachable at all:
// the distance build is O(N^2 * V), while greenelab's merge loop rescans every
// cluster pair and recomputes averageDistance over the index sets, so it climbs
// far faster than that. A single run at N = 2504 that has not returned tells you
// nothing about which phase you are waiting on; the sweep tells you both, and
// projects the rest.
//
// Usage: node scripts/cluster/jsphases.mjs [matrix.bin] [--ns=200,400,800] [--budget=SECONDS]
//   results/cluster-js-phases.md + .json
import { readFileSync, writeFileSync } from 'node:fs'
import { clusterData as greenelab } from './vendor/greenelab-hclust.js'

const args = process.argv.slice(2)
const binPath = args.find(a => !a.startsWith('--')) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices/1-mb-window-maf-0-05-samples.bin`
const NS = (args.find(a => a.startsWith('--ns='))?.slice(5) ?? '150,300,600,1200')
  .split(',').map(Number)
const BUDGET_MS = Number(args.find(a => a.startsWith('--budget='))?.slice(9) ?? 240) * 1000

// Layout written by hclust's `pnpm bench:real --dump`: uint32 rows, uint32
// columns, then float32 row-major.
const buf = readFileSync(binPath)
const rows = buf.readUInt32LE(0)
const cols = buf.readUInt32LE(4)
const values = new Float32Array(buf.buffer, buf.byteOffset + 8, rows * cols)
console.log(`matrix ${binPath.split('/').pop()}: ${rows} x ${cols}`)

// A prefix of the rows, as plain arrays — the shape greenelab's API takes.
function subsample(n) {
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Array.from(values.subarray(i * cols, (i + 1) * cols))
  }
  return out
}

const results = []
for (const n of NS) {
  if (n > rows) { console.log(`skip N=${n}: matrix has ${rows} rows`); continue }
  const data = subsample(n)
  const t = performance.now()
  const r = greenelab({ data, onProgress: () => {} })
  const totalMs = performance.now() - t
  const row = {
    n, v: cols,
    distanceMs: +r.distanceMs.toFixed(1),
    clusterMs: +r.clusterMs.toFixed(1),
    totalMs: +totalMs.toFixed(1),
    clusterShare: +(r.clusterMs / (r.distanceMs + r.clusterMs)).toFixed(4),
  }
  results.push(row)
  console.log(
    `N=${String(n).padStart(5)}  distance ${row.distanceMs.toFixed(0).padStart(8)} ms   ` +
    `merge ${row.clusterMs.toFixed(0).padStart(9)} ms   merge share ${(row.clusterShare * 100).toFixed(1)}%`)
  if (totalMs > BUDGET_MS) {
    console.log(`stopping: N=${n} took ${(totalMs / 1000).toFixed(0)}s, past the ${BUDGET_MS / 1000}s budget`)
    break
  }
}

// Empirical scaling exponents from the sweep, so the projection to full N is
// the measured growth rather than an assumed complexity.
function exponent(key) {
  if (results.length < 2) return null
  const a = results[0], b = results[results.length - 1]
  return +(Math.log(b[key] / a[key]) / Math.log(b.n / a.n)).toFixed(2)
}
const out = {
  matrix: binPath.split('/').pop(), rows, cols,
  budgetMs: BUDGET_MS,
  results,
  exponents: { distance: exponent('distanceMs'), cluster: exponent('clusterMs') },
}
// Per matrix, not a single slot: these scripts are run once per window, and a
// fixed filename means the second run silently replaces the first — which is
// exactly what happened, leaving a figure built from one matrix reading a file
// written by another.
const slug = binPath.split('/').pop().replace(/\.bin$/, '')
writeFileSync(`results/cluster-js-phases-${slug}.json`, JSON.stringify(out, null, 2))
console.log(`\nmeasured scaling: distance ~ N^${out.exponents.distance}, merge ~ N^${out.exponents.cluster}`)
console.log(`wrote results/cluster-js-phases-${slug}.json`)

// The wasm implementation's two phases, on the same matrix as jsphases.mjs.
//
// @gmod/hclust reports the split itself: its wasm wrapper emits
// ClusterProgress with phase 'distance' then 'clustering', so the boundary is
// the library's own rather than one this script guesses at. That is the same
// boundary the vendored greenelab copy is instrumented at, so the two sides are
// measured comparably.
//
// Usage: node --experimental-strip-types scripts/cluster/wasmphases.mjs [matrix.bin] [N]
import { readFileSync, writeFileSync } from 'node:fs'

const HCLUST = `${process.env.HOME}/src/gmod/hclust/src/index.ts`
const { clusterData } = await import(HCLUST)

const args = process.argv.slice(2)
const binPath = args.find(a => !a.startsWith('--')) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices/100-kb-window-maf-0-samples.bin`
const N = Number(args[1] ?? 2504)

const buf = readFileSync(binPath)
const rows = buf.readUInt32LE(0)
const cols = buf.readUInt32LE(4)
const values = new Float32Array(buf.buffer, buf.byteOffset + 8, rows * cols)
const n = Math.min(N, rows)

const data = new Array(n)
for (let i = 0; i < n; i++) {
  data[i] = Array.from(values.subarray(i * cols, (i + 1) * cols))
}

// First call in a fresh process is the one a user waits on: V8 promotes a wasm
// function out of its baseline tier on call count with no on-stack replacement,
// so a best-of-N in one process hides it (CLUSTERING_WORKFLOW.md).
let firstDistanceEnd = 0
let seenClustering = false
const t0 = performance.now()
// AWAITED: clusterData is async (the wasm module is instantiated inside it).
// Left un-awaited it returns a pending promise in ~2 ms having emitted only
// 'init', which reads as "the library does not report phases" rather than as a
// missing await — the NaN this script first produced.
await clusterData({
  data,
  onProgress: p => {
    if (p.phase === 'clustering' && !seenClustering) {
      seenClustering = true
      firstDistanceEnd = performance.now()
    }
  },
})
const t2 = performance.now()

const distanceMs = seenClustering ? firstDistanceEnd - t0 : NaN
const clusterMs = seenClustering ? t2 - firstDistanceEnd : NaN
const out = {
  matrix: binPath.split('/').pop(), n, v: cols,
  distanceMs: +distanceMs.toFixed(1),
  clusterMs: +clusterMs.toFixed(1),
  totalMs: +(t2 - t0).toFixed(1),
  clusterShare: +(clusterMs / (distanceMs + clusterMs)).toFixed(4),
  note: 'first call in a fresh process, the one a user waits on',
}
console.log(`N=${n} V=${cols}  distance ${out.distanceMs.toFixed(0)} ms   merge ${out.clusterMs.toFixed(0)} ms   merge share ${(out.clusterShare*100).toFixed(2)}%`)
// Per matrix, not a single slot: these scripts are run once per window, and a
// fixed filename means the second run silently replaces the first — which is
// exactly what happened, leaving a figure built from one matrix reading a file
// written by another.
const slug = binPath.split('/').pop().replace(/\.bin$/, '')
writeFileSync(`results/cluster-wasm-phases-${slug}.json`, JSON.stringify(out, null, 2))
console.log(`wrote results/cluster-wasm-phases-${slug}.json`)

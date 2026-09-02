// The three-way clustering comparison at one N, each implementation in its own
// process.
//
// EACH IN ITS OWN PROCESS, because a sweep in one process does not measure what
// it looks like it measures. subsample() allocates ~62MB of plain JS arrays per
// N, so by the time the sweep reaches N = 2504 it is running the distance loop
// against a heap full of the previous sizes' garbage: the same call that takes
// 15.1s cold reports 23.0s at the end of a 150,300,600,1200,2504 sweep. The
// wasm side was already being measured cold by wasmphases.mjs, so comparing the
// two straight across credited wasm with ~1.5x of GC pressure that was an
// artifact of how the JS side was driven. Forking per implementation is what
// makes the three numbers the same kind of number.
//
// Cold is also the number that matters on its own terms: it is the first call
// in a fresh process, which is the one a user waits on.
//
//   naive  greenelab/hclust, the reference JS       -- O(N^2) merge rescans
//   opt    optimized-hclust.mjs, the wasm algorithm ported to plain JS
//   wasm   @gmod/hclust
//
// naive vs opt is what the algorithm bought; opt vs wasm is what the runtime
// bought. Reporting only naive vs wasm conflates them.
//
// Usage: node scripts/cluster/compare.mjs [matrix.bin] [--n=2504] [--impls=naive,opt,wasm]
import { readFileSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const binPath = args.find(a => !a.startsWith('--')) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices/100-kb-window-maf-0-samples.bin`
const N = Number(args.find(a => a.startsWith('--n='))?.slice(4) ?? 2504)
const child = args.find(a => a.startsWith('--child='))?.slice(8)

const loadMatrix = () => {
  const buf = readFileSync(binPath)
  const rows = buf.readUInt32LE(0)
  const cols = buf.readUInt32LE(4)
  const values = new Float32Array(buf.buffer, buf.byteOffset + 8, rows * cols)
  const n = Math.min(N, rows)
  const data = new Array(n)
  for (let i = 0; i < n; i++) {
    data[i] = Array.from(values.subarray(i * cols, (i + 1) * cols))
  }
  return { rows, cols, n, data }
}

if (child) {
  const { cols, n, data } = loadMatrix()
  let phases
  let totalMs
  if (child === 'naive') {
    const { clusterData } = await import('./vendor/greenelab-hclust.js')
    const t0 = performance.now()
    const r = clusterData({ data, onProgress: () => {} })
    totalMs = performance.now() - t0
    phases = { distanceMs: r.distanceMs, clusterMs: r.clusterMs }
  }
  if (child === 'opt') {
    const { hierarchicalCluster } = await import('./optimized-hclust.mjs')
    const t0 = performance.now()
    const r = hierarchicalCluster({ data })
    totalMs = performance.now() - t0
    phases = { distanceMs: r.distanceMs, clusterMs: r.clusterMs }
  }
  if (child === 'wasm') {
    const { clusterData } = await import(`${process.env.HOME}/src/gmod/hclust/src/index.ts`)
    // The wasm module is instantiated inside clusterData, and its 'distance'
    // phase covers the flatten and the copy into the wasm heap, so the clock
    // starts before the call to cover the same work the JS sides count.
    //
    // The split is only available when a 'clustering' report actually fires,
    // and the C side throttles those to one per 100ms -- so below roughly
    // N = 1000 the whole distance phase finishes inside the first interval and
    // no boundary is ever reported. Left ungated that reads as a NEGATIVE
    // distance time (boundary 0 minus t0), which is what this script printed
    // first. The total is always real; the split is null when unobserved.
    let boundary = null
    const t0 = performance.now()
    await clusterData({
      data,
      onProgress: p => {
        if (p.phase === 'clustering' && boundary === null) {
          boundary = performance.now()
        }
      },
    })
    const t2 = performance.now()
    totalMs = t2 - t0
    phases = boundary === null
      ? { distanceMs: null, clusterMs: null }
      : { distanceMs: boundary - t0, clusterMs: t2 - boundary }
  }
  if (!phases) {
    throw new Error(`unknown impl ${child}`)
  }
  process.send({ impl: child, n, v: cols, totalMs, ...phases })
} else {
  const IMPLS = (args.find(a => a.startsWith('--impls='))?.slice(8) ?? 'naive,opt,wasm').split(',')
  const self = fileURLToPath(import.meta.url)
  const runChild = impl => new Promise((resolve, reject) => {
    // --experimental-strip-types for the wasm child, which imports hclust's
    // TypeScript source directly; harmless for the other two.
    const proc = fork(self, [binPath, `--n=${N}`, `--child=${impl}`], {
      execArgv: ['--experimental-strip-types', '--no-warnings'],
    })
    let payload
    proc.on('message', m => { payload = m })
    proc.on('error', reject)
    proc.on('exit', code => {
      if (code === 0 && payload) {
        resolve(payload)
      } else {
        reject(new Error(`${impl} child exited ${code}`))
      }
    })
  })

  const results = []
  for (const impl of IMPLS) {
    const r = await runChild(impl)
    const row = {
      impl: r.impl,
      n: r.n,
      v: r.v,
      distanceMs: r.distanceMs === null ? null : +r.distanceMs.toFixed(1),
      clusterMs: r.clusterMs === null ? null : +r.clusterMs.toFixed(1),
      totalMs: +r.totalMs.toFixed(1),
    }
    results.push(row)
    const ms = value => (value === null ? 'unreported' : value.toFixed(0)).padStart(10)
    console.log(
      `${row.impl.padEnd(6)} distance ${ms(row.distanceMs)} ms   ` +
      `merge ${ms(row.clusterMs)} ms   total ${row.totalMs.toFixed(0).padStart(10)} ms`)
  }

  const by = impl => results.find(r => r.impl === impl)
  const speedup = (from, to) => {
    const a = by(from)
    const b = by(to)
    return a && b ? +(a.totalMs / b.totalMs).toFixed(2) : null
  }
  const out = {
    matrix: binPath.split('/').pop(),
    n: results[0].n,
    v: results[0].v,
    note: 'each implementation in its own process, first call, no warmup',
    results,
    speedups: {
      algorithm: speedup('naive', 'opt'),
      runtime: speedup('opt', 'wasm'),
      combined: speedup('naive', 'wasm'),
    },
  }
  const slug = binPath.split('/').pop().replace(/\.bin$/, '')
  const outPath = `results/cluster-compare-${slug}-n${N}.json`
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nalgorithm (naive -> opt)  ${out.speedups.algorithm}x`)
  console.log(`runtime   (opt -> wasm)   ${out.speedups.runtime}x`)
  console.log(`combined  (naive -> wasm) ${out.speedups.combined}x`)
  console.log(`wrote ${outPath}`)
}

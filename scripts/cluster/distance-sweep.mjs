// The distance build alone, both JavaScript implementations, across the five
// 1000 Genomes windows the clustering speedup figure sweeps.
//
// DISTANCE ONLY, because that is what the figure compares and because the
// whole clustering cannot be run at these sizes: greenelab's merge rescans
// every cluster pair each iteration, which is 104s at N = 2,504 and does not
// finish in any useful time at N = 5,008. The reference arm here is
// euclideanDistance called in the same nested-map pattern clusterData() runs
// it in, which is exactly how jbrowse-components' measurement record timed its
// own JS column.
//
// WHY THIS EXISTS AT ALL: that record's JS column was measured on a different
// machine (node 24, Linux) against synthetic data, and says so -- it
// "establishes the pre-wasm baseline's order of magnitude, not a fifth arm of
// the idle-machine sitting above". Its wasm and WebGPU columns are this
// machine, a 2019 MacBook Pro i9-9980HK. Dividing an optimized-JS time
// measured here by a reference time measured there would produce a speedup
// that is partly the two machines, and the algorithm step is the whole reason
// the optimized arm is on the figure. So both JS arms are re-measured here, on
// the real dosage matrices, and the figure's JS column is this rather than the
// record's.
//
// One process per (implementation, window): a 5,008 x 22,383 run leaves a
// 450MB matrix and a 100MB distance array behind, and the next window should
// not be timed against that.
//
// EVERY CELL RECORDS THE LOAD AVERAGE IT RAN UNDER, because this machine is
// shared and the first run of this sweep proved the point: its last and
// longest cell overlapped another job and came in at 2,267s against the ~720s
// the other four naive cells predict, which would have drawn one window at a
// 5.3x optimization where every other window measured 2.0-2.3x. Nothing in the
// output said so. The measurement record these numbers join notes the same
// hazard on its own arms -- "a run taken under a shared CPU came out 2 to 3x
// slower across the board and was discarded" -- so the load belongs in the
// data, where a reader can see which cells to trust, rather than in whoever
// happened to run it's memory.
//
// Usage: node scripts/cluster/distance-sweep.mjs [--impls=naive,opt] [--matrices=DIR]
//   results/cluster-distance-sweep.json
import { readFileSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadavg, cpus, platform, release } from 'node:os'

const args = process.argv.slice(2)
const MATRIX_DIR = args.find(a => a.startsWith('--matrices='))?.slice(11) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices`
const child = args.find(a => a.startsWith('--child='))?.slice(8)

// The five windows results/paper/cluster.csv carries, named as that file names
// them so the rows join on the window label rather than on a filename.
const WINDOWS = [
  { window: '100 kb, MAF 0, samples', file: '100-kb-window-maf-0-samples.bin' },
  { window: '1 Mb, MAF 0.05, samples', file: '1-mb-window-maf-0-05-samples.bin' },
  { window: '1 Mb, MAF 0.05, haplotypes', file: '1-mb-window-maf-0-05-haplotypes.bin' },
  { window: '1 Mb, MAF 0, samples', file: '1-mb-window-maf-0-samples.bin' },
  { window: '1 Mb, MAF 0, haplotypes', file: '1-mb-window-maf-0-haplotypes.bin' },
]

const readMatrix = file => {
  const buf = readFileSync(`${MATRIX_DIR}/${file}`)
  const rows = buf.readUInt32LE(0)
  const cols = buf.readUInt32LE(4)
  return { rows, cols, values: new Float32Array(buf.buffer, buf.byteOffset + 8, rows * cols) }
}

if (child) {
  const [impl, file] = child.split(':')
  const { rows, cols, values } = readMatrix(file)
  let ms
  if (impl === 'naive') {
    const { euclideanDistance } = await import('./vendor/greenelab-hclust.js')
    // The nested map clusterData() runs, kept verbatim: it is a full N x N,
    // both triangles, over arrays of arrays. Computing one triangle and
    // mirroring it is one of the things the optimized arm is measuring.
    const data = new Array(rows)
    for (let i = 0; i < rows; i++) {
      data[i] = Array.from(values.subarray(i * cols, (i + 1) * cols))
    }
    const t = performance.now()
    data.map(datum => data.map(otherDatum => euclideanDistance(datum, otherDatum)))
    ms = performance.now() - t
  }
  if (impl === 'opt') {
    const { flatten, buildDistanceMatrix } = await import('./optimized-hclust.mjs')
    // Handed the flat Float32Array the file already is, so the 900MB
    // array-of-arrays the reference arm needs is never built. The flatten it
    // skips is ~200ms against a run of several minutes.
    const t = performance.now()
    buildDistanceMatrix(flatten(values, cols), rows, cols)
    ms = performance.now() - t
  }
  if (ms === undefined) {
    throw new Error(`unknown impl ${impl}`)
  }
  // The one-minute average sampled at the END of the cell, which is the window
  // that overlaps the run rather than whatever preceded it.
  process.send({ impl, file, n: rows, v: cols, ms, load: +loadavg()[0].toFixed(1) })
} else {
  const IMPLS = (args.find(a => a.startsWith('--impls='))?.slice(8) ?? 'naive,opt').split(',')
  const self = fileURLToPath(import.meta.url)
  const runChild = (impl, file) => new Promise((resolve, reject) => {
    // The reference arm builds an array-of-arrays of the widest matrix, which
    // is ~900MB of JS heap, over the 4.5GB default limit once the N x N result
    // is beside it.
    const proc = fork(self, [`--matrices=${MATRIX_DIR}`, `--child=${impl}:${file}`], {
      execArgv: ['--max-old-space-size=12288'],
    })
    let payload
    proc.on('message', m => { payload = m })
    proc.on('error', reject)
    proc.on('exit', code => {
      if (code === 0 && payload) {
        resolve(payload)
      } else {
        reject(new Error(`${impl} on ${file} exited ${code}`))
      }
    })
  })

  // One competing single-threaded job is tolerable on 16 hardware threads;
  // these kernels are memory-bound, so what actually hurts is many of them at
  // once. Half the threads busy is where a cell stops being comparable to one
  // taken on an idle machine.
  const BUSY = cpus().length / 2
  const results = []
  for (const w of WINDOWS) {
    for (const impl of IMPLS) {
      const r = await runChild(impl, w.file)
      const row = {
        window: w.window, impl, n: r.n, v: r.v,
        s: +(r.ms / 1000).toFixed(2), load: r.load,
      }
      results.push(row)
      console.log(
        `${w.window.padEnd(28)} ${impl.padEnd(6)} ${String(r.n).padStart(5)} x ` +
        `${String(r.v).padStart(6)}   ${row.s.toFixed(2).padStart(8)} s` +
        `   load ${row.load.toFixed(1).padStart(5)}${row.load > BUSY ? '  BUSY' : ''}`)
    }
  }

  const busy = results.filter(r => r.load > BUSY)
  const out = {
    // Read off the box rather than typed in. The literal that used to sit
    // here named a 2019 MacBook Pro, and a sweep run anywhere else recorded
    // that name -- which is the one thing this file's own header says a reader
    // must be able to check.
    machine: `${cpus()[0].model.trim()}, ${platform()} ${release()}, single threaded`,
    measured: new Date().toISOString().slice(0, 10),
    note: 'distance build only, one process per (implementation, window), first call',
    busyThreshold: BUSY,
    results,
  }
  writeFileSync('results/cluster-distance-sweep.json', JSON.stringify(out, null, 2))
  if (busy.length) {
    console.log(`\n${busy.length} of ${results.length} cells ran over load ${BUSY} ` +
      'and are not comparable to an idle-machine number; re-run them.')
  }
  console.log('\nwrote results/cluster-distance-sweep.json')
}

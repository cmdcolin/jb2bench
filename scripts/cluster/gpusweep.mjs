// The WebGPU distance kernel across the same five windows distance-sweep.mjs
// sweeps, so the figure's GPU curve comes off this box rather than off the
// jbrowse-components measurement record's 2019 MacBook Pro.
//
// Drives jbrowse-web's probe-gpu-distance-matrix.ts, which owns the kernel and
// the correctness check against an f64 reference. --matrix hands it the same
// .bin every other arm reads, and --skip-cpu drops its wasm side: wasmphases.mjs
// measures that here, at the same phase boundary the JS arms are measured at.
//
// HEADED CHROME, so this needs a display. Headless has no WebGPU adapter, and
// on Linux the adapter only appears with --enable-features=Vulkan, which the
// probe passes. scripts/gpucheck.ts reporting `navigator.gpu: false` is a
// separate false negative -- it evaluates on about:blank, which is not a secure
// context -- and says nothing about whether this box has WebGPU. It does.
//
// Usage: node scripts/cluster/gpusweep.mjs [--matrices=DIR] [--windows=a,b]
//   results/cluster-gpu-<slug>.json, one per window
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const MATRIX_DIR =
  args.find(a => a.startsWith('--matrices='))?.slice(11) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices`
const JBWEB =
  process.env.JB2 ?? `${process.env.HOME}/src/jbrowse-components`

const WINDOWS = [
  { window: '100 kb, MAF 0, samples', file: '100-kb-window-maf-0-samples.bin' },
  { window: '1 Mb, MAF 0.05, samples', file: '1-mb-window-maf-0-05-samples.bin' },
  { window: '1 Mb, MAF 0.05, haplotypes', file: '1-mb-window-maf-0-05-haplotypes.bin' },
  { window: '1 Mb, MAF 0, samples', file: '1-mb-window-maf-0-samples.bin' },
  { window: '1 Mb, MAF 0, haplotypes', file: '1-mb-window-maf-0-haplotypes.bin' },
]

const only = args.find(a => a.startsWith('--windows='))?.slice(10).split(',')
const selected = only ? WINDOWS.filter(w => only.includes(w.file)) : WINDOWS

for (const w of selected) {
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'browser-tests/probe-gpu-distance-matrix.ts',
      `--matrix=${MATRIX_DIR}/${w.file}`,
      '--skip-cpu',
    ],
    { cwd: `${JBWEB}/products/jbrowse-web`, encoding: 'utf8', maxBuffer: 1 << 28 },
  )

  // The probe prints rather than writing a file, so parse its two lines. A
  // silent parse failure here would write a record with a missing GPU column,
  // which reads on the figure as a shorter curve rather than as a broken run.
  const shape = /N=(\d+) V=(\d+)/.exec(out)
  const timing =
    /gpu (.+?): compute\+upload ([\d.]+) ms, with readback ([\d.]+) ms, max rel err (\S+) over (\d+) pairs/.exec(out)
  if (!shape || !timing) {
    throw new Error(`could not parse the probe's output for ${w.file}:\n${out}`)
  }

  const row = {
    window: w.window,
    matrix: w.file,
    n: Number(shape[1]),
    v: Number(shape[2]),
    adapter: timing[1],
    // Upload and readback included: the record this replaces defines its GPU
    // column that way, and a kernel time without the transfers is not a time
    // anything waits on.
    computeMs: Number(timing[2]),
    readbackMs: Number(timing[3]),
    maxRelErr: Number(timing[4]),
    checkedPairs: Number(timing[5]),
    note: 'naive kernel, one thread per pair, no tiling — a floor, not a claim',
  }
  const slug = w.file.replace(/\.bin$/, '')
  writeFileSync(`results/cluster-gpu-${slug}.json`, JSON.stringify(row, null, 2))
  console.log(
    `${w.window.padEnd(28)} ${String(row.n).padStart(5)} x ${String(row.v).padStart(6)}   ` +
      `${(row.readbackMs / 1000).toFixed(2).padStart(7)} s   ${row.adapter}   max rel err ${row.maxRelErr}`,
  )
}

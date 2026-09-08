// The WebGPU distance build across the same five windows distance-sweep.mjs
// sweeps, so the figure's GPU curve comes off this box rather than off the
// jbrowse-components measurement record's 2019 MacBook Pro.
//
// Drives jbrowse-web's probe-gpu-distance-matrix.ts, which runs the kernel
// clusterMatrix ships (bundled into the page as is, spot check included),
// checks it against an f64 reference, and then runs @gmod/hclust's merge loop
// on the matrix that came back -- so the row carries the whole GPU path a user
// waits on, not the distance build alone. --matrix hands it the same .bin every
// other arm reads, and --skip-cpu drops its wasm side: wasmphases.mjs measures
// that here, at the same phase boundary the JS arms are measured at.
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

const ALLOW_SOFTWARE = args.includes('--allow-software')

// A software rasterizer answers every WebGPU call correctly and is one to be
// fooled by: it would record a "WebGPU kernel" row that never touched a GPU.
// scripts/ld/ldkernel.ts refuses one on the LD side; this is the same refusal
// on the adapter string the probe prints.
const SOFTWARE_MARKERS = [
  'swiftshader',
  'lavapipe',
  'llvmpipe',
  'software',
  'warp',
  'microsoft basic',
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
    /gpu (.+?): distance matrix ([\d.]+) ms \(upload, dispatch, readback, spot check\), max rel err (\S+) over (\d+) pairs/.exec(out)
  const merge = /merge on the gpu matrix \(hclust wasm\): ([\d.]+) ms/.exec(out)
  if (!shape || !timing || !merge) {
    throw new Error(`could not parse the probe's output for ${w.file}:\n${out}`)
  }

  const marker = SOFTWARE_MARKERS.find(m => timing[1].toLowerCase().includes(m))
  if (marker && !ALLOW_SOFTWARE) {
    throw new Error(
      `refusing to report GPU timings from a software adapter (${marker}: ${timing[1]}).\n` +
        'Re-run headed, or pass --allow-software to record it deliberately.',
    )
  }

  const row = {
    window: w.window,
    matrix: w.file,
    n: Number(shape[1]),
    v: Number(shape[2]),
    adapter: timing[1],
    // Upload, readback and the spot check included: a kernel time without the
    // transfers is not a time anything waits on.
    distanceMs: Number(timing[2]),
    // hclust's merge loop on the matrix the GPU returned, first call in a
    // fresh process, so distanceMs + mergeMs is the path end to end.
    mergeMs: Number(merge[1]),
    maxRelErr: Number(timing[3]),
    checkedPairs: Number(timing[4]),
    note: 'the shipped kernel: one thread per pair, no tiling, blocked Kahan sum',
  }
  const slug = w.file.replace(/\.bin$/, '')
  writeFileSync(`results/cluster-gpu-${slug}.json`, JSON.stringify(row, null, 2))
  console.log(
    `${w.window.padEnd(28)} ${String(row.n).padStart(5)} x ${String(row.v).padStart(6)}   ` +
      `distance ${(row.distanceMs / 1000).toFixed(2).padStart(6)} s + merge ${(row.mergeMs / 1000).toFixed(2)} s   ${row.adapter}   max rel err ${row.maxRelErr}`,
  )
}

// Assembles the wasm and WebGPU columns measured on THIS box into the record
// shape cluster-data.R reads, so a run can regenerate every arm of the
// clustering figure on one machine.
//
// WHY NOT THE jbrowse-components RECORD: its wasm and WebGPU columns are a 2019
// MacBook Pro and its JS column is a different Linux box, and it says so. That
// was tolerable while the JS column only had to establish an order of
// magnitude. It is not once the figure draws an optimized JS curve beside the
// reference, because the gap between them is the algorithm claim and half of it
// would be the two machines. cluster-data.R takes CLUSTER_RECORD so this file
// can stand in without editing that repo's measurement store.
//
// THE WASM COLUMNS ARE THE WHOLE clusterData CALL, NOT ITS DISTANCE PHASE, and
// that is forced rather than chosen. hclust reports the distance/merge boundary
// through its progress callback, and the C side throttles those reports to one
// per 100 ms with the timer reset as the merge begins (src/wasm/distance.c). So
// a merge under 100 ms emits no 'clustering' report at all -- three of the ten
// cells here, which come back NaN -- and when one does fire it lands 100 ms
// into the merge, putting that 100 ms on the distance side. Every split this
// instrument produces is wrong in the same direction; the total never is.
//
// Including the merge overstates the wasm arm, which is the safe direction: it
// can only understate wasm's margin over the JS arms, never inflate it. The
// merge is 0.04% to 4.8% of the call in the cells where it was observed at all,
// so on the figure's log axis it sits inside the line. The record this replaces
// took its wasm column the same way, so the column still means what it meant.
//
// The other difference is deliberate: every arm here is the first call in a
// fresh process, where the record timed wasm warm. That is the call a user
// waits on, and V8 promotes a wasm function out of its baseline tier on call
// count with no on-stack replacement, so a warm number hides it.
//
// Usage: node scripts/cluster/localrecord.mjs
//   reads  results/cluster-wasm-phases-<slug>-{v500,v510}.json
//          results/cluster-gpu-<slug>.json
//   writes results/cluster-distance-local.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { cpus, platform, release } from 'node:os'

const WINDOWS = [
  { window: '100 kb, MAF 0, samples', slug: '100-kb-window-maf-0-samples' },
  { window: '1 Mb, MAF 0.05, samples', slug: '1-mb-window-maf-0-05-samples' },
  { window: '1 Mb, MAF 0.05, haplotypes', slug: '1-mb-window-maf-0-05-haplotypes' },
  { window: '1 Mb, MAF 0, samples', slug: '1-mb-window-maf-0-samples' },
  { window: '1 Mb, MAF 0, haplotypes', slug: '1-mb-window-maf-0-haplotypes' },
]

const read = path => {
  if (!existsSync(path)) {
    throw new Error(`no ${path}; that arm has not been measured on this box`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

const rev = dir => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

const rows = WINDOWS.map(w => {
  const v500 = read(`results/cluster-wasm-phases-${w.slug}-v500.json`)
  const v510 = read(`results/cluster-wasm-phases-${w.slug}-v510.json`)
  const gpu = read(`results/cluster-gpu-${w.slug}.json`)
  // The three arms must have seen the same matrix. They read the same .bin, so
  // a shape mismatch means one of them was measured against a stale dump --
  // which would land on the figure as a curve at the wrong x.
  for (const [name, r] of [['5.0.0', v500], ['5.1.0', v510], ['gpu', gpu]]) {
    if (r.n !== gpu.n || r.v !== gpu.v) {
      throw new Error(
        `${w.window}: the ${name} arm is ${r.n} x ${r.v}, the gpu arm ${gpu.n} x ${gpu.v}`,
      )
    }
  }
  return {
    values: {
      window: w.window,
      n: gpu.n,
      v: gpu.v,
      hclust500: +(v500.totalMs / 1000).toFixed(2),
      hclustNew: +(v510.totalMs / 1000).toFixed(2),
      gpu: +(gpu.readbackMs / 1000).toFixed(2),
    },
  }
})

const out = {
  id: 'cluster-distance-local',
  measured: new Date().toISOString().slice(0, 10),
  published: false,
  machine: `${cpus()[0].model.trim()}, ${platform()} ${release()}`,
  source: {
    kind: 'hand',
    repro:
      'wasm columns: HCLUST=<checkout>/src/index.ts node --experimental-strip-types ' +
      'scripts/cluster/wasmphases.mjs <matrix.bin> <N>, once per window per library ' +
      'version, each the first call in a fresh process, taken as that file\'s totalMs -- ' +
      'the whole clusterData call, for the reason in this script\'s header. Cross-checked ' +
      'against `pnpm bench:real` in the hclust checkout, which agrees within 1% on the ' +
      'windows it shares. GPU column: node scripts/cluster/gpusweep.mjs, ' +
      'which drives jbrowse-web browser-tests/probe-gpu-distance-matrix.ts on the same ' +
      '.bin, headed Chrome, upload and readback included. JS columns come from ' +
      'results/cluster-distance-sweep.json, swept on this same box.',
    notes:
      'Every arm on one machine, which is the point: the jbrowse-components record ' +
      'this stands in for mixes a 2019 MacBook Pro (wasm, WebGPU) with a different ' +
      'Linux box (JS). Every arm is also the first call in a fresh process, where that ' +
      'record timed wasm warm. The JS and WebGPU arms are the distance build alone and ' +
      'the wasm arms carry their merge with them, which overstates wasm by under 5%. ' +
      'Matrices are ' +
      '1000 Genomes phase 3 chr22:20-21 Mb dumped by `pnpm bench:real --dump` in ' +
      `@gmod/hclust (${rev(`${process.env.HOME}/src/gmod/hclust`)}), byte-identical across all four arms. ` +
      'The kernel is naive -- one thread per pair, no tiling -- so the GPU column is a floor.',
  },
  rows,
}

writeFileSync('results/cluster-distance-local.json', JSON.stringify(out, null, 2))
for (const r of rows) {
  const v = r.values
  console.log(
    `${v.window.padEnd(28)} ${String(v.n).padStart(5)} x ${String(v.v).padStart(6)}   ` +
      `5.0.0 ${v.hclust500.toFixed(2).padStart(7)} s   5.1.0 ${v.hclustNew.toFixed(2).padStart(7)} s   ` +
      `gpu ${v.gpu.toFixed(2).padStart(6)} s`,
  )
}
console.log('\nwrote results/cluster-distance-local.json')

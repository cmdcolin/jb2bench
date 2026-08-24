/// <reference types="@webgpu/types" />
// The banded LD matrix (plugins/variants `maxVariantSeparation`, plink's
// `--ld-window`), GPU and plain CPU side by side, at a scale the full triangle
// cannot reach.
//
// Why the band exists: the LD matrix is materialized in full and transferred to
// the renderer, so the cost is n(n-1)/2 cells. At 50,000 variants that is
// 1.25e9 cells = 4.66 GiB, which no adapter will allocate — `planDispatch`
// refuses it and the CPU fallback takes tens of minutes. Restricting pairs to a
// separation of at most k makes the matrix n*k cells, i.e. LINEAR in the
// variant count, which is what brings 1000-Genomes-scale windows into range.
//
// The row worth reading is `window = 0` (the full triangle) against the rest:
// it is the one that declines, and every banded row is the same kernel on the
// same data with only the window changed.
//
// The CPU column is the same statistic computed by the shipped CPU path's inner
// loop (@jbrowse/ld-core calculateLDStatsPhasedBits — bit-packed haplotype
// popcounts), banded identically. Rows whose predicted CPU time exceeds
// --cpu-budget are extrapolated from a measured per-cell rate rather than run,
// and are marked so in the output; nothing is silently capped.
//
// The output-buffer ceiling that decides which rows run at all is a property of
// the BROWSER BUILD as much as the GPU: on one machine (amd rdna-1, macOS) the
// Chrome puppeteer pins reports maxStorageBufferBindingSize = 128 MiB, the WebGPU
// spec floor, while the system Chrome reports 2 GiB. Same hardware, 16x apart and
// a different set of windows admitted. Record which browser a row came from —
// PUPPETEER_EXECUTABLE_PATH picks one, --label names the output.
//
// Usage: node --experimental-strip-types scripts/ld/ldband.ts [numSamples] [numSnps]
//          [--cpu-budget=SECONDS] [--label=NAME] [--headless] [--allow-software]
//   results/ld-band[-LABEL].md + .json
import { writeFileSync } from 'node:fs'

import { tablemark } from 'tablemark'

import {
  LD_PHASED_COMPUTE_WGSL,
  assertHardwareAdapter,
  launchGpuPage,
  loadUniformOffsets,
  loadUniformsSize,
  loadWgsl,
} from './ldkernel.ts'

const NUM_SAMPLES = Number(process.argv[2] ?? 2000)
const NUM_SNPS = Number(process.argv[3] ?? 50_000)
const labelArg = process.argv.find(a => a.startsWith('--label='))
const LABEL = labelArg ? `-${labelArg.split('=')[1]}` : ''
const budgetArg = process.argv.find(a => a.startsWith('--cpu-budget='))
const CPU_BUDGET_MS = Number(budgetArg?.split('=')[1] ?? 45) * 1000

// 0 means the full triangle — the control this whole table is against.
const WINDOWS = [0, 2000, 1000, 500, 200]
// Small enough to always run, big enough to time honestly.
const CALIBRATION_N = 1200

const code = loadWgsl(LD_PHASED_COMPUTE_WGSL)
const offsets = loadUniformOffsets(LD_PHASED_COMPUTE_WGSL)
const uniformsSize = loadUniformsSize(LD_PHASED_COMPUTE_WGSL)
for (const field of ['numSnps', 'numWords', 'band', 'dispatchRowStride']) {
  if (!(field in offsets)) {
    throw new Error(
      `${LD_PHASED_COMPUTE_WGSL} has no '${field}' uniform — regenerate shaders, or this kernel predates the band`,
    )
  }
}

// Headed by default: a GPU timing off a headless software adapter is a CPU
// timing wearing a GPU's name. --headless is available for a machine with no
// display, and is checked by assertHardwareAdapter all the same.
const HEADED = !process.argv.includes('--headless')
const ALLOW_SOFTWARE = process.argv.includes('--allow-software')

const { page, close } = await launchGpuPage({ headed: HEADED })

const out = await page.evaluate(
  async ({
    code,
    NUM_SAMPLES,
    NUM_SNPS,
    WINDOWS,
    CALIBRATION_N,
    CPU_BUDGET_MS,
    offsets,
    uniformsSize,
  }) => {
    const adapter = (await navigator.gpu.requestAdapter())!
    // Field by field: GPUAdapterInfo exposes getters on the prototype, so a
    // spread of it is `{}` and the software check below would see nothing.
    const ai = adapter.info
    const info = {
      vendor: ai?.vendor ?? '',
      architecture: ai?.architecture ?? '',
      device: ai?.device ?? '',
      description: ai?.description ?? '',
      isFallbackAdapter: Boolean(
        (ai as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter ??
          (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter,
      ),
    }
    const device = await adapter.requestDevice()
    const MAXD = device.limits.maxComputeWorkgroupsPerDimension
    const MAXBIND = device.limits.maxStorageBufferBindingSize
    const MAXBUF = device.limits.maxBufferSize
    const WG = 64
    const WORDS = Math.ceil(NUM_SAMPLES / 32)

    // The banded layout, mirroring plugins/variants/src/VariantRPC/ldBand.ts.
    // Ragged rows: row i holds min(i, k) entries, so at k >= n-1 it collapses to
    // the triangular i*(i-1)/2 and an unbanded run indexes identically.
    const rowStart = (i: number, k: number) => {
      const m = i < k ? i : k
      return (m * (m - 1)) / 2 + (i - m) * k
    }
    const firstCol = (i: number, k: number) => (i > k ? i - k : 0)
    const cellCount = (n: number, k: number) => (n < 2 ? 0 : rowStart(n, k))
    const resolveBand = (n: number, sep: number) => {
      const full = n > 0 ? n - 1 : 0
      return sep > 0 && sep < full ? sep : full
    }

    // Distinct SNPs cycled to fill n. Every pair still reads two real haplotype
    // planes, so the popcount work per cell is exactly what a real callset costs;
    // this only keeps generating 50,000 x 2000 genotypes from dominating the run.
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    interface Packed {
      altH1: Uint32Array
      validH1: Uint32Array
      altH2: Uint32Array
      validH2: Uint32Array
    }
    const POOL: Packed[] = []
    for (let p = 0; p < 512; p++) {
      const altH1 = new Uint32Array(WORDS)
      const validH1 = new Uint32Array(WORDS)
      const altH2 = new Uint32Array(WORDS)
      const validH2 = new Uint32Array(WORDS)
      const maf = 0.2 + rnd() * 0.3
      for (let s = 0; s < NUM_SAMPLES; s++) {
        const w = s >>> 5
        const bit = 1 << (s & 31)
        validH1[w]! |= bit
        validH2[w]! |= bit
        if (rnd() < maf) altH1[w]! |= bit
        if (rnd() < maf) altH2[w]! |= bit
      }
      POOL.push({ altH1, validH1, altH2, validH2 })
    }
    const snp = (i: number) => POOL[i % POOL.length]!

    function popcount32(v: number) {
      v = v | 0
      v -= (v >>> 1) & 0x55555555
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
      v = (v + (v >>> 4)) & 0x0f0f0f0f
      return Math.imul(v, 0x01010101) >>> 24
    }

    // calculateLDStatsPhasedBits' inner loop, r2 only.
    function cpuPair(a: Packed, b: Packed) {
      let n01 = 0
      let n10 = 0
      let n11 = 0
      let total = 0
      for (let w = 0; w < WORDS; w++) {
        const ai1 = a.altH1[w]!
        const vi1 = a.validH1[w]!
        const aj1 = b.altH1[w]!
        const vj1 = b.validH1[w]!
        n11 += popcount32(ai1 & aj1)
        n10 += popcount32(ai1 & ~aj1 & vj1)
        n01 += popcount32(vi1 & ~ai1 & aj1)
        total += popcount32(vi1 & vj1)
        const ai2 = a.altH2[w]!
        const vi2 = a.validH2[w]!
        const aj2 = b.altH2[w]!
        const vj2 = b.validH2[w]!
        n11 += popcount32(ai2 & aj2)
        n10 += popcount32(ai2 & ~aj2 & vj2)
        n01 += popcount32(vi2 & ~ai2 & aj2)
        total += popcount32(vi2 & vj2)
      }
      if (total < 4) return 0
      const p01 = n01 / total
      const p10 = n10 / total
      const p11 = n11 / total
      const pA = p10 + p11
      const pB = p01 + p11
      if (pA <= 0 || pA >= 1 || pB <= 0 || pB >= 1) return 0
      const D = p11 - pA * pB
      const denom = pA * (1 - pA) * pB * (1 - pB)
      const r = denom > 0 ? D / Math.sqrt(denom) : 0
      return Math.min(1, Math.max(0, r * r))
    }

    function cpuBand(n: number, k: number) {
      const vals = new Float32Array(cellCount(n, k))
      let idx = 0
      for (let i = 1; i < n; i++) {
        const a = snp(i)
        for (let j = firstCol(i, k); j < i; j++) vals[idx++] = cpuPair(a, snp(j))
      }
      return vals
    }

    // --- CPU per-cell rate, measured, for the rows too big to run ---
    const calN = CALIBRATION_N
    const calK = resolveBand(calN, 0)
    let calMs = Infinity
    for (let r = 0; r < 3; r++) {
      const t = performance.now()
      cpuBand(calN, calK)
      calMs = Math.min(calMs, performance.now() - t)
    }
    const nsPerCell = (calMs * 1e6) / cellCount(calN, calK)

    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
              { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
              { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
          }),
        ],
      }),
      compute: { module: device.createShaderModule({ code }), entryPoint: 'computeLDPhased' },
    })
    const bgl = pipeline.getBindGroupLayout(0)

    async function gpuBand(n: number, k: number) {
      const cells = cellCount(n, k)
      const groups = Math.ceil(cells / WG)
      const width = Math.min(groups, MAXD)
      const height = Math.ceil(groups / width)
      const outBytes = cells * 4
      // planDispatch's refusal, restated: past these the dispatch cannot be
      // issued at all, which is the whole point of the window.
      if (height > MAXD || outBytes > MAXBIND || outBytes > MAXBUF) {
        return { declined: true as const, cells, outBytes }
      }
      const haps = new Uint32Array(n * 4 * WORDS)
      for (let i = 0; i < n; i++) {
        const s = snp(i)
        const base = i * 4 * WORDS
        haps.set(s.altH1, base)
        haps.set(s.validH1, base + WORDS)
        haps.set(s.altH2, base + WORDS * 2)
        haps.set(s.validH2, base + WORDS * 3)
      }
      const inB = device.createBuffer({ size: haps.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      const outB = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
      const uB = device.createBuffer({ size: uniformsSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const readB = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      const uni = new Uint32Array(uniformsSize / 4)
      uni[offsets.numSnps!] = n
      uni[offsets.numWords!] = WORDS
      uni[offsets.band!] = k
      uni[offsets.dispatchRowStride!] = width * WG
      const bind = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: inB } },
          { binding: 1, resource: { buffer: outB } },
          { binding: 2, resource: { buffer: uB } },
        ],
      })
      device.queue.writeBuffer(inB, 0, haps)
      device.queue.writeBuffer(uB, 0, uni)
      // An over-limit dispatch fails ASYNCHRONOUSLY: mapAsync still resolves and
      // the readback is a plausible all-zero matrix. Without this scope the row
      // would report a fast, wrong success. See ldlimits.ts.
      device.pushErrorScope('validation')
      const t0 = performance.now()
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.dispatchWorkgroups(width, height)
      pass.end()
      enc.copyBufferToBuffer(outB, 0, readB, 0, outBytes)
      device.queue.submit([enc.finish()])
      const err = await device.popErrorScope()
      let ms = 0
      let values: Float32Array | null = null
      if (!err) {
        await readB.mapAsync(GPUMapMode.READ)
        ms = performance.now() - t0
        values = new Float32Array(readB.getMappedRange()).slice()
      }
      inB.destroy()
      outB.destroy()
      uB.destroy()
      readB.destroy()
      return { declined: false as const, cells, outBytes, ms, values, error: err?.message ?? null }
    }

    const rows = []
    for (const sep of WINDOWS) {
      const k = resolveBand(NUM_SNPS, sep)
      const cells = cellCount(NUM_SNPS, k)
      const g = await gpuBand(NUM_SNPS, k)
      const cpuPredictedMs = (nsPerCell * cells) / 1e6
      const runCpu = cpuPredictedMs <= CPU_BUDGET_MS
      let cpuMs = cpuPredictedMs
      let cpuValues: Float32Array | null = null
      if (runCpu) {
        const t = performance.now()
        cpuValues = cpuBand(NUM_SNPS, k)
        cpuMs = performance.now() - t
      }
      let maxDiff: number | null = null
      if (cpuValues && !g.declined && g.values) {
        let m = 0
        for (let x = 0; x < cpuValues.length; x++) m = Math.max(m, Math.abs(cpuValues[x]! - g.values[x]!))
        maxDiff = m
      }
      rows.push({
        window: sep === 0 ? 'full triangle' : String(sep),
        band: k,
        cells,
        outputMiB: +(g.outBytes / 2 ** 20).toFixed(1),
        gpuMs: g.declined ? null : Math.round(g.ms!),
        declined: g.declined,
        gpuError: g.declined ? null : g.error,
        cpuMs: Math.round(cpuMs),
        cpuMeasured: runCpu,
        speedup: g.declined || !g.ms ? null : +(cpuMs / g.ms).toFixed(1),
        maxAbsDiff: maxDiff,
      })
    }

    return {
      adapter: info,
      limits: { maxStorageBufferBindingSize: MAXBIND, maxBufferSize: MAXBUF, maxComputeWorkgroupsPerDimension: MAXD },
      calibration: { n: calN, cells: cellCount(calN, calK), ms: +calMs.toFixed(1), nsPerCell: +nsPerCell.toFixed(1) },
      rows,
    }
  },
  { code, NUM_SAMPLES, NUM_SNPS, WINDOWS, CALIBRATION_N, CPU_BUDGET_MS, offsets, uniformsSize },
)

await close()

assertHardwareAdapter(out.adapter, ALLOW_SOFTWARE)

const table = out.rows.map(r => ({
  window: r.window,
  band: r.band,
  cells: r.cells.toExponential(2),
  output: `${r.outputMiB} MiB`,
  gpu: r.declined ? 'DECLINED' : `${r.gpuMs} ms`,
  cpu: r.cpuMeasured ? `${r.cpuMs} ms` : `~${r.cpuMs} ms (est)`,
  speedup: r.speedup === null ? '—' : `${r.speedup}x`,
  parity: r.maxAbsDiff === null ? '—' : r.maxAbsDiff.toExponential(1),
}))
const COLUMNS = [
  { name: 'window' },
  { name: 'band k' },
  { name: 'cells' },
  { name: 'output' },
  { name: 'GPU' },
  { name: 'CPU' },
  { name: 'CPU/GPU' },
  { name: 'max|gpu-cpu|' },
]

const md = [
  '# LD matrix: banded vs full triangle, GPU vs CPU',
  '',
  `${NUM_SNPS.toLocaleString()} variants, ${NUM_SAMPLES.toLocaleString()} samples, phased (haplotype popcount kernel), r².`,
  '',
  `Adapter: ${out.adapter.vendor} ${out.adapter.architecture} ${out.adapter.device} ${out.adapter.description}`.trim(),
  `Headed: ${HEADED} (a headless run can substitute a software adapter; see assertHardwareAdapter)`,
  `maxStorageBufferBindingSize: ${out.limits.maxStorageBufferBindingSize.toLocaleString()} bytes`,
  '',
  tablemark(table, { columns: COLUMNS }),
  '',
  '- **window** is `maxVariantSeparation` (plink `--ld-window`); "full triangle" is the slot default, 0.',
  `- **cpu ms** marked \`(est)\` exceeded the ${CPU_BUDGET_MS / 1000}s budget and is extrapolated from a measured rate of ` +
    `${out.calibration.nsPerCell} ns/cell (${out.calibration.cells.toLocaleString()} cells in ${out.calibration.ms} ms at n=${out.calibration.n}). ` +
    'Nothing is capped silently.',
  '- **DECLINED** means `planDispatch` refuses the output buffer, so the app falls back to the CPU column.',
  '- **max|gpu-cpu|** is f32-vs-f64 only; it is the parity check that the banded decode addresses the same cells on both sides.',
  '',
  `Generated by \`scripts/ld/ldband.ts\` on ${new Date().toISOString()}`,
  '',
].join('\n')

writeFileSync(`results/ld-band${LABEL}.md`, md)
writeFileSync(
  `results/ld-band${LABEL}.json`,
  JSON.stringify({ numSamples: NUM_SAMPLES, numSnps: NUM_SNPS, cpuBudgetMs: CPU_BUDGET_MS, ...out }, null, 2),
)
console.log(md)

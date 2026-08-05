/// <reference types="@webgpu/types" />
// Reproduces the LD compute dispatch ceiling, and checks the shipped kernel
// against a float64 CPU reference on both sides of it.
//
// Background: one GPU thread per lower-triangular cell, 64 per workgroup. A 1D
// dispatch is capped at maxComputeWorkgroupsPerDimension (65535) workgroups =
// 4,194,240 cells, which n(n-1)/2 crosses at n = 2897 variants.
//
// The failure mode is the interesting part: exceeding it is an ASYNC validation
// error, not a thrown exception. The output buffer is never written, mapAsync
// still resolves, and the readback is a plausible all-zero matrix — so a caller
// that only try/catches (as getLDMatrix.ts did) never sees a failure and never
// falls back to the CPU. Silent wrong data, not an error.
//
// The fix is a 2D dispatch (`k = gid.y * dispatchRowStride + gid.x`); --1d
// forces the old single-row indexing to demonstrate the bug on the same kernel.
//
// Usage: node --experimental-strip-types scripts/ld/ldlimits.ts [--1d]
//   results/ld-dispatch-limit.md
import { writeFileSync } from 'node:fs'

import { tablemark } from 'tablemark'

import { LD_COMPUTE_WGSL, launchGpuPage, loadWgsl } from './ldkernel.ts'

const FORCE_1D = process.argv.includes('--1d')
const SIZES = [2000, 2896, 2897, 4000]

const code = loadWgsl(LD_COMPUTE_WGSL)
const { page, close } = await launchGpuPage()

const out = await page.evaluate(
  async ({ code, sizes, force1d, NUM_SAMPLES }) => {
    const adapter = (await navigator.gpu.requestAdapter())!
    const device = await adapter.requestDevice()
    const MAXD = device.limits.maxComputeWorkgroupsPerDimension
    const WG = 64

    function makeData(nSnps: number) {
      let seed = 7
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
      const rows: Int8Array[] = []
      for (let i = 0; i < nSnps; i++) {
        const row = new Int8Array(NUM_SAMPLES)
        // Dosages MUST vary within a SNP: a constant row has zero variance and
        // the kernel legitimately returns 0, which would be indistinguishable
        // from a dispatch that never ran.
        for (let s = 0; s < NUM_SAMPLES; s++) {
          row[s] = rnd() < 0.04 ? -1 : Math.floor(rnd() * 3)
        }
        rows.push(row)
      }
      const nsp = Math.ceil(NUM_SAMPLES / 4)
      const packed = new Uint32Array(nSnps * nsp)
      for (let snp = 0; snp < nSnps; snp++) {
        for (let s = 0; s < NUM_SAMPLES; s++) {
          const v = rows[snp]![s]! < 0 ? 0xff : rows[snp]![s]!
          packed[snp * nsp + (s >> 2)]! |= v << ((s & 3) * 8)
        }
      }
      return { rows, packed, nsp }
    }
    function decodeTri(k: number): [number, number] {
      let i = Math.floor((1 + Math.sqrt(1 + 8 * k)) / 2)
      while ((i * (i - 1)) / 2 > k) { i-- }
      while (((i + 1) * i) / 2 <= k) { i++ }
      return [i, k - (i * (i - 1)) / 2]
    }
    function cpuCell(rows: Int8Array[], i: number, j: number) {
      let count = 0, s1 = 0, s2 = 0, s1sq = 0, s2sq = 0, sprod = 0
      const a = rows[i]!, b = rows[j]!
      for (let s = 0; s < NUM_SAMPLES; s++) {
        const g1 = a[s]!, g2 = b[s]!
        if (g1 >= 0 && g2 >= 0) {
          count++; s1 += g1; s2 += g2
          s1sq += g1 * g1; s2sq += g2 * g2; sprod += g1 * g2
        }
      }
      if (count < 2) { return 0 }
      const pA = s1 / (2 * count), pB = s2 / (2 * count)
      if (pA <= 0 || pA >= 1 || pB <= 0 || pB >= 1) { return 0 }
      const m1 = s1 / count, m2 = s2 / count
      const v1 = s1sq / count - m1 * m1, v2 = s2sq / count - m2 * m2
      if (!(v1 > 0 && v2 > 0)) { return 0 }
      const r = (sprod / count - m1 * m2) / Math.sqrt(v1 * v2)
      return Math.min(Math.max(r * r, 0), 1)
    }

    const module = device.createShaderModule({ code })
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module, entryPoint: 'computeLD' },
    })

    const results: unknown[] = []
    for (const n of sizes) {
      const { rows, packed, nsp } = makeData(n)
      const numCells = (n * (n - 1)) / 2
      const groups = Math.ceil(numCells / WG)
      // force1d: rowStride 0 collapses `gid.y * rowStride + gid.x` to `gid.x`,
      // i.e. exactly the pre-fix kernel, dispatched as one long row.
      const width = force1d ? groups : Math.min(groups, MAXD)
      const height = force1d ? 1 : Math.ceil(groups / width)
      const rowStride = force1d ? 0 : width * WG
      const uni = new Uint32Array([n, NUM_SAMPLES, nsp, 0, 0, rowStride, 0, 0])

      const inB = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      const outB = device.createBuffer({ size: numCells * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
      const uB = device.createBuffer({ size: uni.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const rb = device.createBuffer({ size: numCells * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(inB, 0, packed)
      device.queue.writeBuffer(uB, 0, uni)
      const bg = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: inB } },
          { binding: 1, resource: { buffer: outB } },
          { binding: 2, resource: { buffer: uB } },
        ],
      })

      device.pushErrorScope('validation')
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bg)
      pass.dispatchWorkgroups(width, height)
      pass.end()
      enc.copyBufferToBuffer(outB, 0, rb, 0, numCells * 4)
      device.queue.submit([enc.finish()])
      const verr = await device.popErrorScope()

      // NB: mapAsync resolves even when the dispatch was rejected.
      await rb.mapAsync(GPUMapMode.READ)
      const vals = new Float32Array(rb.getMappedRange())
      let nonZero = 0
      for (let i = 0; i < vals.length; i++) { if (vals[i] !== 0) { nonZero++ } }
      let maxDiff = 0
      let rowsUsed = 1
      const step = Math.max(1, Math.floor(numCells / 2000))
      for (let k = 0; k < numCells; k += step) {
        const [i, j] = decodeTri(k)
        maxDiff = Math.max(maxDiff, Math.abs(cpuCell(rows, i, j) - vals[k]!))
        if (rowStride > 0) { rowsUsed = Math.max(rowsUsed, Math.floor(k / rowStride) + 1) }
      }
      rb.unmap()
      for (const b of [inB, outB, uB, rb]) { b.destroy() }

      results.push({
        n, numCells, groups, grid: `${width}x${height}`, rowsUsed,
        threw: false,
        validationError: verr ? verr.message.split('\n')[0] : null,
        nonZero, maxDiffVsCpu: maxDiff,
      })
    }
    return {
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture },
      maxComputeWorkgroupsPerDimension: MAXD,
      cellCeiling1d: MAXD * WG,
      results,
    }
  },
  { code, sizes: SIZES, force1d: FORCE_1D, NUM_SAMPLES: 32 },
)

await close()

interface Res {
  n: number; numCells: number; groups: number; grid: string; rowsUsed: number
  validationError: string | null; nonZero: number; maxDiffVsCpu: number
}
const results = out.results as Res[]
const table = results.map(r => ({
  variants: r.n,
  cells: r.numCells.toLocaleString(),
  workgroups: r.groups.toLocaleString(),
  grid: r.grid,
  'dispatch rows': r.rowsUsed,
  'validation error': r.validationError ? 'YES' : 'no',
  'non-zero cells': r.nonZero.toLocaleString(),
  'max diff vs CPU': r.maxDiffVsCpu.toExponential(1),
}))

const md = `# LD compute: dispatch ceiling

GPU: \`${out.adapter.vendor}\` \`${out.adapter.architecture}\`,
\`maxComputeWorkgroupsPerDimension\` = ${out.maxComputeWorkgroupsPerDimension}
=> a 1D dispatch tops out at ${out.cellCeiling1d.toLocaleString()} cells, i.e. **n = 2896 variants**.

Mode: **${FORCE_1D ? '1D (pre-fix indexing)' : '2D (shipped)'}**

${tablemark(table)}

Nothing throws in either mode: an over-limit dispatch is an async validation
error, the output buffer is never written, and \`mapAsync\` still resolves — so
the readback is an all-zero matrix that looks like real "no LD here" data. That
is why \`getLDMatrix.ts\`'s \`catch -> computeLDMatrixCPU\` fallback could not
fire, and why \`runGPUCompute\` now wraps the dispatch in an error scope and
throws.

Run \`ldlimits.ts --1d\` to see the pre-fix behaviour (zeros past n=2896) and
without it to see the 2D dispatch stay correct against the CPU reference.

Generated by \`scripts/ld/ldlimits.ts\`.
`
writeFileSync(new URL('../../results/ld-dispatch-limit.md', import.meta.url), md)
console.log(md)

/// <reference types="@webgpu/types" />
// GPU vs CPU for the LD matrix (plugins/variants), measuring the crossover that
// getLDMatrixGPU.ts's MIN_WORK = 500_000 gate encodes, and the speedup past it.
//
// The kernel is the shipped ldCompute.slang output; the CPU side mirrors
// computeLDMatrixCPU's inner loop. GPU timing is upload -> dispatch -> readback
// (what the caller actually waits on), best of 3 after a warm-up, with the
// pipeline cached as getLDMatrixGPU does.
//
// Also reports kernel wall time per n: getLDMatrixGPU gates the LOW end
// (MIN_WORK) but nothing bounds the high end, and a long enough kernel risks the
// driver watchdog killing the device — which is shared with the render HAL
// (getGpuDevice is a singleton), so it would blank every GPU track, not just LD.
//
// Usage: node --experimental-strip-types scripts/ldbench.ts [numSamples] [maxN]
//   results/ld-gpu-vs-cpu.md + .json
import { writeFileSync } from 'node:fs'

import { tablemark } from 'tablemark'

import { LD_COMPUTE_WGSL, launchGpuPage, loadWgsl } from './ldkernel.ts'

const NUM_SAMPLES = Number(process.argv[2] ?? 1000)
const MAX_N = Number(process.argv[3] ?? 2000)
const SIZES = [100, 250, 500, 1000, 2000, 2897, 4000].filter(n => n <= MAX_N)

const code = loadWgsl(LD_COMPUTE_WGSL)
const { page, close } = await launchGpuPage()

const out = await page.evaluate(
  async ({ code, NUM_SAMPLES, sizes }) => {
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

    // Mirrors computeLDMatrixCPU: r2, unsigned, over the lower triangle.
    function cpuAll(rows: Int8Array[], n: number) {
      const res = new Float32Array((n * (n - 1)) / 2)
      let k = 0
      for (let i = 1; i < n; i++) {
        const a = rows[i]!
        for (let j = 0; j < i; j++) {
          const b = rows[j]!
          let count = 0, s1 = 0, s2 = 0, s1sq = 0, s2sq = 0, sprod = 0
          for (let s = 0; s < NUM_SAMPLES; s++) {
            const g1 = a[s]!, g2 = b[s]!
            if (g1 >= 0 && g2 >= 0) {
              count++; s1 += g1; s2 += g2
              s1sq += g1 * g1; s2sq += g2 * g2; sprod += g1 * g2
            }
          }
          let v = 0
          if (count >= 2) {
            const pA = s1 / (2 * count), pB = s2 / (2 * count)
            if (pA > 0 && pA < 1 && pB > 0 && pB < 1) {
              const m1 = s1 / count, m2 = s2 / count
              const v1 = s1sq / count - m1 * m1, v2 = s2sq / count - m2 * m2
              if (v1 > 0 && v2 > 0) {
                const r = (sprod / count - m1 * m2) / Math.sqrt(v1 * v2)
                v = Math.min(Math.max(r * r, 0), 1)
              }
            }
          }
          res[k++] = v
        }
      }
      return res
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

    async function gpuRun(packed: Uint32Array, n: number, nsp: number) {
      const numCells = (n * (n - 1)) / 2
      const groups = Math.ceil(numCells / WG)
      const width = Math.min(groups, MAXD)
      const height = Math.ceil(groups / width)
      const uni = new Uint32Array([n, NUM_SAMPLES, nsp, 0, 0, width * WG, 0, 0])
      const inB = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      const outB = device.createBuffer({ size: numCells * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
      const uB = device.createBuffer({ size: uni.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const rb = device.createBuffer({ size: numCells * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      const t0 = performance.now()
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
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bg)
      pass.dispatchWorkgroups(width, height)
      pass.end()
      enc.copyBufferToBuffer(outB, 0, rb, 0, numCells * 4)
      device.queue.submit([enc.finish()])
      await rb.mapAsync(GPUMapMode.READ)
      const first = new Float32Array(rb.getMappedRange())[0]!
      const ms = performance.now() - t0
      rb.unmap()
      for (const b of [inB, outB, uB, rb]) { b.destroy() }
      return { ms, first }
    }

    const rows: unknown[] = []
    for (const n of sizes) {
      const { rows: geno, packed, nsp } = makeData(n)
      await gpuRun(packed, n, nsp)
      let gpuMs = Infinity
      for (let r = 0; r < 3; r++) {
        gpuMs = Math.min(gpuMs, (await gpuRun(packed, n, nsp)).ms)
      }
      const t = performance.now()
      cpuAll(geno, n)
      const cpuMs = performance.now() - t
      rows.push({ n, numCells: (n * (n - 1)) / 2, workUnits: ((n * (n - 1)) / 2) * NUM_SAMPLES, gpuMs, cpuMs })
    }
    return {
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description },
      maxComputeWorkgroupsPerDimension: MAXD,
      rows,
    }
  },
  { code, NUM_SAMPLES, sizes: SIZES },
)

await close()

interface Row { n: number; numCells: number; workUnits: number; gpuMs: number; cpuMs: number }
const rows = out.rows as Row[]
const table = rows.map(r => ({
  variants: r.n,
  cells: r.numCells.toLocaleString(),
  'work units': r.workUnits.toLocaleString(),
  'GPU ms': r.gpuMs.toFixed(1),
  'CPU ms': r.cpuMs.toFixed(0),
  speedup: `${(r.cpuMs / r.gpuMs).toFixed(1)}x`,
}))

const { vendor, architecture, description } = out.adapter
const md = `# LD matrix: GPU vs CPU

GPU: \`${vendor}\` \`${architecture}\` ${description || ''}
Samples per variant: ${NUM_SAMPLES}. Work units = cells x samples.
GPU time is upload -> dispatch -> readback, best of 3 (pipeline cached).
CPU mirrors \`computeLDMatrixCPU\`'s inner loop.

${tablemark(table)}

\`getLDMatrixGPU.ts\` gates the GPU path at \`MIN_WORK = 500_000\` work units.
That gate is **conservative, not break-even**: measured right at it
(\`ldbench.ts 100 500\` => 100 variants x 100 samples = 495,000 work units) the
GPU still wins ~4x, so the real crossover sits below the gate. Any tuning
headroom is in lowering it, not raising it. Below ~10^5 work units the GPU's
fixed overhead (buffer alloc + submit + readback, a few ms) dominates and the
CPU should win, but that end is not measured here.

Nothing gates the HIGH end, and kernel wall time grows quadratically in variants
(watch the GPU ms column). In principle a long enough single dispatch risks the
driver watchdog resetting the GPU — and \`getGpuDevice\` is a singleton shared
with the render HAL, so a reset would blank every GPU track, not just LD.

Measured, that risk is smaller than it looks. Both GPUs on this box run n=3000
(4.5e9 work units) in ~1.5s with no device loss, and the integrated Intel UHD
630 is roughly as fast as the discrete Radeon PRO WX 3200 here — so "it'll be
much worse on integrated graphics" does not hold, at least on this pair:

| n    | Intel UHD 630 (\`low-power\`) | AMD WX 3200 (\`high-performance\`) |
| ---- | --------------------------- | -------------------------------- |
| 1000 | 172 ms                      | 105 ms                           |
| 2000 | 699 ms                      | 419 ms                           |
| 3000 | 1534 ms                     | 1469 ms                          |

A device loss was observed once, but only under this benchmark's sustained
back-to-back load, and never reproduced from a single dispatch — so it is not
characterised. Chunking the dispatch would bound duration structurally (and buy
progress + cancellation), but the measurements do not currently justify it.

Aside worth knowing: \`gpuDevice.ts\` calls \`requestAdapter()\` with no
\`powerPreference\`, and this box exposes a different adapter per preference
(intel gen-9 vs amd gcn-4). Which one the default picks is worth pinning down —
it affects the render HAL too, not just LD.

Generated by \`scripts/ldbench.ts\`.
`
writeFileSync(new URL('../results/ld-gpu-vs-cpu.md', import.meta.url), md)
writeFileSync(
  new URL('../results/ld-gpu-vs-cpu.json', import.meta.url),
  `${JSON.stringify({ numSamples: NUM_SAMPLES, ...out }, null, 2)}\n`,
)
console.log(md)

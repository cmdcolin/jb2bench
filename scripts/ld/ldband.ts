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
// loop (@jbrowse/ld-core calculateLDStatsPhasedBits / calculateLDStatsDosageBits
// — bit-packed popcounts either way), banded identically. Rows whose predicted
// CPU time exceeds --cpu-budget are extrapolated from a measured per-cell rate
// rather than run, and are marked so in the output; nothing is silently capped.
//
// --- the second axis: what a phased file is read AS -------------------------
//
// Every row runs under both LD methods the app implements, against ONE cohort
// packed two ways, so the pair differs in the estimator and nothing else:
//
//   phased    haplotypic r2 over 2*numSamples haplotypes (ldPhasedCompute)
//   composite Weir (1979) r2 over numSamples genotype dosages (ldCompute)
//
// This is the LD twin of the clustering benchmark's 2,504-samples against
// 5,008-haplotypes pair, and it is worth measuring because the same modelling
// choice lands somewhere completely different here. Clustering builds a
// samples-by-samples matrix, so phasing doubles n and QUADRUPLES the work. LD
// builds a variants-by-variants matrix: phasing doubles the depth of each
// cell's reduction and leaves the output matrix byte-for-byte the same size, so
// none of the binding-limit story above moves. Bit-packed, it barely costs
// anything at all — the phased kernel spends 8 popcounts per 32-sample word and
// the composite one 9, because the two haplotype planes ride through the same
// word loop.
//
// Dosages here are the haplotype pair collapsed, g = altH1 + altH2, which is
// what composite LD does with a phased file — so this measures the choice a
// reader of ONE file faces, not two different files.
//
// The output-buffer ceiling that decides which rows run at all is a DEVICE
// limit, and a device does not inherit its adapter's. A bare requestDevice()
// gets the spec default of 128 MiB even on an adapter advertising 2 GiB, so a
// benchmark written that way reports DECLINED for matrices the app dispatches
// happily. This one raises the limits the way getGpuDevice() does; see
// requestAppLikeDevice in ldkernel.ts.
//
// Usage: node --experimental-strip-types scripts/ld/ldband.ts [numSamples] [numSnps]
//          [--cpu-budget=SECONDS] [--method=phased|composite|both] [--label=NAME]
//          [--headless] [--allow-software]
//   results/ld-band[-LABEL].md + .json
import { writeFileSync } from 'node:fs'

import { tablemark } from 'tablemark'

import {
  LD_COMPUTE_WGSL,
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
const methodArg = process.argv.find(a => a.startsWith('--method='))?.split('=')[1]
if (methodArg && !['phased', 'composite', 'both'].includes(methodArg)) {
  throw new Error(`--method must be phased, composite or both, got '${methodArg}'`)
}
const METHODS =
  methodArg === 'phased' || methodArg === 'composite'
    ? [methodArg]
    : ['phased', 'composite']

// 0 means the full triangle — the control this whole table is against.
// Ascending, so each row's prediction can be anchored on the largest row
// actually measured before it. Presentation order is restored in the figure.
const WINDOWS = [200, 500, 1000, 2000, 0]
// Small enough to always run, big enough to time honestly.
const CALIBRATION_N = 1200

// One descriptor per method, each carrying the shader the app ships and the
// uniform layout read out of its generated iface. Both kernels now take three
// or four bit planes and the same uniforms, differing only in how many planes
// and what they mean; `requires` is what keeps that assumption honest, throwing
// before the dispatch if a kernel's genotype layout moves out from under the
// packing below rather than letting the run report a fast wrong number. It has
// already earned itself once: the composite kernel used to be byte-packed.
const KERNELS = {
  phased: {
    path: LD_PHASED_COMPUTE_WGSL,
    entry: 'computeLDPhased',
    requires: ['numSnps', 'numWords', 'band', 'dispatchRowStride'],
  },
  composite: {
    path: LD_COMPUTE_WGSL,
    entry: 'computeLD',
    requires: ['numSnps', 'numWords', 'band', 'dispatchRowStride'],
  },
} as const

const KERNEL_SPECS = Object.fromEntries(
  METHODS.map(m => {
    const k = KERNELS[m as keyof typeof KERNELS]
    const offsets = loadUniformOffsets(k.path)
    for (const field of k.requires) {
      if (!(field in offsets)) {
        throw new Error(
          `${k.path} has no '${field}' uniform — regenerate shaders, or this kernel's genotype layout changed and the packing in this script no longer matches it`,
        )
      }
    }
    return [
      m,
      {
        code: loadWgsl(k.path),
        entry: k.entry,
        offsets,
        uniformsSize: loadUniformsSize(k.path),
      },
    ]
  }),
)

// Headed by default: a GPU timing off a headless software adapter is a CPU
// timing wearing a GPU's name. --headless is available for a machine with no
// display, and is checked by assertHardwareAdapter all the same.
const HEADED = !process.argv.includes('--headless')
const ALLOW_SOFTWARE = process.argv.includes('--allow-software')

const { page, close } = await launchGpuPage({ headed: HEADED })

const out = await page.evaluate(
  async ({
    KERNEL_SPECS,
    METHODS,
    NUM_SAMPLES,
    NUM_SNPS,
    WINDOWS,
    CALIBRATION_N,
    CPU_BUDGET_MS,
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
    // NOT a bare requestDevice(): that yields the spec's default 128 MiB
    // maxStorageBufferBindingSize regardless of hardware, which is not the
    // device getGpuDevice() builds. See requestAppLikeDevice in ldkernel.ts.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    })
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

    // The same cohort read as unphased genotypes: dosage is the haplotype pair
    // collapsed, which is the whole content of "compute composite LD on a
    // phased file". Three planes rather than four, and disjoint the way
    // packDosages builds them — het and homAlt are subsets of valid, and dosage
    // 0 is a sample in valid and in neither.
    interface Dosed {
      het: Uint32Array
      homAlt: Uint32Array
      valid: Uint32Array
    }
    const DOSED: Dosed[] = POOL.map(h => {
      const het = new Uint32Array(WORDS)
      const homAlt = new Uint32Array(WORDS)
      const valid = new Uint32Array(WORDS)
      for (let w = 0; w < WORDS; w++) {
        const v = h.validH1[w]! & h.validH2[w]!
        valid[w] = v
        het[w] = (h.altH1[w]! ^ h.altH2[w]!) & v
        homAlt[w] = h.altH1[w]! & h.altH2[w]! & v
      }
      return { het, homAlt, valid }
    })
    const dosed = (i: number) => DOSED[i % DOSED.length]!

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

    // calculateLDStatsDosageBits' inner loop, r2 only: the composite (Weir 1979)
    // estimator as nine popcounts per word against the phased path's eight,
    // which is the whole per-cell cost difference between the two methods once
    // both are bit-packed.
    function cpuPairDosage(a: Dosed, b: Dosed) {
      let n = 0
      let het1 = 0
      let homAlt1 = 0
      let het2 = 0
      let homAlt2 = 0
      let hetHet = 0
      let hetHom = 0
      let homHet = 0
      let homHom = 0
      for (let w = 0; w < WORDS; w++) {
        const h1 = a.het[w]!
        const m1 = a.homAlt[w]!
        const v1 = a.valid[w]!
        const h2 = b.het[w]!
        const m2 = b.homAlt[w]!
        const v2 = b.valid[w]!
        n += popcount32(v1 & v2)
        het1 += popcount32(h1 & v2)
        homAlt1 += popcount32(m1 & v2)
        het2 += popcount32(h2 & v1)
        homAlt2 += popcount32(m2 & v1)
        hetHet += popcount32(h1 & h2)
        hetHom += popcount32(h1 & m2)
        homHet += popcount32(m1 & h2)
        homHom += popcount32(m1 & m2)
      }
      if (n < 2) return 0
      const s1 = het1 + 2 * homAlt1
      const s2 = het2 + 2 * homAlt2
      const s1sq = het1 + 4 * homAlt1
      const s2sq = het2 + 4 * homAlt2
      const sprod = hetHet + 2 * hetHom + 2 * homHet + 4 * homHom
      const pA = s1 / (2 * n)
      const pB = s2 / (2 * n)
      if (pA <= 0 || pA >= 1 || pB <= 0 || pB >= 1) return 0
      const mean1 = s1 / n
      const mean2 = s2 / n
      const var1 = s1sq / n - mean1 * mean1
      const var2 = s2sq / n - mean2 * mean2
      if (!(var1 > 0 && var2 > 0)) return 0
      const cov = sprod / n - mean1 * mean2
      const r = cov / Math.sqrt(var1 * var2)
      return Math.min(1, Math.max(0, r * r))
    }

    function cpuBand(method: string, n: number, k: number) {
      const vals = new Float32Array(cellCount(n, k))
      let idx = 0
      if (method === 'phased') {
        for (let i = 1; i < n; i++) {
          const a = snp(i)
          for (let j = firstCol(i, k); j < i; j++) vals[idx++] = cpuPair(a, snp(j))
        }
      } else {
        for (let i = 1; i < n; i++) {
          const a = dosed(i)
          for (let j = firstCol(i, k); j < i; j++) {
            vals[idx++] = cpuPairDosage(a, dosed(j))
          }
        }
      }
      return vals
    }

    // --- CPU per-cell rate, measured, for the rows too big to run ---
    const calN = CALIBRATION_N
    const calK = resolveBand(calN, 0)
    const calibration: Record<string, { ms: number; nsPerCell: number }> = {}
    for (const method of METHODS) {
      let calMs = Infinity
      for (let r = 0; r < 3; r++) {
        const t = performance.now()
        cpuBand(method, calN, calK)
        calMs = Math.min(calMs, performance.now() - t)
      }
      calibration[method] = {
        ms: +calMs.toFixed(1),
        nsPerCell: (calMs * 1e6) / cellCount(calN, calK),
      }
    }

    // Both kernels take the same three bindings — genotypes in, matrix out,
    // uniforms — so only the module, the entry point and the uniform layout
    // vary by method.
    const pipelines: Record<string, GPUComputePipeline> = {}
    for (const method of METHODS) {
      const spec = KERNEL_SPECS[method]!
      pipelines[method] = await device.createComputePipelineAsync({
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
        compute: {
          module: device.createShaderModule({ code: spec.code }),
          entryPoint: spec.entry,
        },
      })
    }

    // The genotype buffer depends only on the method and the variant count, not
    // on the window, so it is built once per method rather than once per row —
    // at 50,000 variants and 2,504 samples it is 63 MB as four haplotype planes
    // and 47 MB as three dosage planes, which is enough to dominate the timing
    // if rebuilt five times.
    const inputs: Record<string, Uint32Array<ArrayBuffer>> = {}
    const inputFor = (method: string, n: number) => {
      const cached = inputs[method]
      if (cached) return cached
      let buf: Uint32Array<ArrayBuffer>
      if (method === 'phased') {
        // Layout per SNP: [altH1, validH1, altH2, validH2], each numWords long.
        buf = new Uint32Array(n * 4 * WORDS)
        for (let i = 0; i < n; i++) {
          const h = snp(i)
          const base = i * 4 * WORDS
          buf.set(h.altH1, base)
          buf.set(h.validH1, base + WORDS)
          buf.set(h.altH2, base + WORDS * 2)
          buf.set(h.validH2, base + WORDS * 3)
        }
      } else {
        // Layout per SNP: [het, homAlt, valid], each numWords long, matching
        // getWord in ldCompute.slang. The same planes the CPU twin reads, so
        // both sides of the parity check are provably the same genotypes.
        buf = new Uint32Array(n * 3 * WORDS)
        for (let i = 0; i < n; i++) {
          const d = dosed(i)
          const base = i * 3 * WORDS
          buf.set(d.het, base)
          buf.set(d.homAlt, base + WORDS)
          buf.set(d.valid, base + WORDS * 2)
        }
      }
      inputs[method] = buf
      return buf
    }

    async function gpuBand(method: string, n: number, k: number) {
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
      const spec = KERNEL_SPECS[method]!
      const pipeline = pipelines[method]!
      const bgl = pipeline.getBindGroupLayout(0)
      const input = inputFor(method, n)
      const inB = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      const outB = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
      const uB = device.createBuffer({ size: spec.uniformsSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const readB = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      // Left zeroed: ldMetric 0 with signedLD 0 is r2 in ldFinalize, which is
      // what both kernels are being measured on.
      const uni = new Uint32Array(spec.uniformsSize / 4)
      const o = spec.offsets
      uni[o.numSnps!] = n
      uni[o.numWords!] = WORDS
      uni[o.band!] = k
      uni[o.dispatchRowStride!] = width * WG
      const bind = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: inB } },
          { binding: 1, resource: { buffer: outB } },
          { binding: 2, resource: { buffer: uB } },
        ],
      })
      device.queue.writeBuffer(inB, 0, input)
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

    // The window sweep, run once per method. Methods outer so each one's CPU
    // rate re-anchors within its own column: the two do different work per
    // cell, so a prediction for a composite row must not be anchored on a
    // measured phased one.
    // Written out rather than inferred from the pushes below: `anchor` reads
    // back out of this array to re-anchor the CPU rate, so an inferred element
    // type would be defined in terms of itself.
    interface Row {
      method: string
      units: number
      unitName: string
      window: string
      band: number
      cells: number
      outputMiB: number
      gpuMs: number | null
      declined: boolean
      gpuError: string | null
      cpuMs: number
      cpuMeasured: boolean
      cpuRateNsPerCell: number
      speedup: number | null
      maxAbsDiff: number | null
    }
    const rows: Row[] = []
    // r2 for the narrowest window under each method, kept so the two estimators
    // can be compared to each other at the end. Narrowest because it is the one
    // window certain to have been RUN on the CPU under any budget, and because
    // holding two of the wide ones would be 400 MB of f32.
    const narrowest = Math.min(...WINDOWS.filter(w => w > 0))
    const agreement: Record<string, Float32Array> = {}
    for (const method of METHODS) {
    for (const sep of WINDOWS) {
      const k = resolveBand(NUM_SNPS, sep)
      const cells = cellCount(NUM_SNPS, k)
      const g = await gpuBand(method, NUM_SNPS, k)
      // Predict from the LARGEST row already measured, not from the small
      // calibration matrix. The calibration fits in cache and the real ones do
      // not, so its rate ran ~2x optimistic — which put an estimated row to the
      // LEFT of a measured row for a narrower window, i.e. visibly out of order
      // on the chart. Rows measured here re-anchor the rate as they complete.
      const anchor = rows.filter(r => r.cpuMeasured && r.method === method).pop()
      const rate = anchor
        ? (anchor.cpuMs * 1e6) / anchor.cells
        : calibration[method]!.nsPerCell
      const cpuPredictedMs = (rate * cells) / 1e6
      const runCpu = cpuPredictedMs <= CPU_BUDGET_MS
      let cpuMs = cpuPredictedMs
      let cpuValues: Float32Array | null = null
      if (runCpu) {
        const t = performance.now()
        cpuValues = cpuBand(method, NUM_SNPS, k)
        cpuMs = performance.now() - t
      }
      if (cpuValues && sep === narrowest) {
        agreement[method] = cpuValues
      }
      let maxDiff: number | null = null
      if (cpuValues && !g.declined && g.values) {
        let m = 0
        for (let x = 0; x < cpuValues.length; x++) m = Math.max(m, Math.abs(cpuValues[x]! - g.values[x]!))
        maxDiff = m
      }
      rows.push({
        method,
        // What the estimator reduces over per cell, and the number the figure
        // names: phasing splits every sample into two haplotypes, which is the
        // same 2,504-into-5,008 step the clustering benchmark takes.
        units: method === 'phased' ? NUM_SAMPLES * 2 : NUM_SAMPLES,
        unitName: method === 'phased' ? 'haplotypes' : 'genotypes',
        window: sep === 0 ? 'full triangle' : String(sep),
        band: k,
        cells,
        outputMiB: +(g.outBytes / 2 ** 20).toFixed(1),
        gpuMs: g.declined ? null : Math.round(g.ms!),
        declined: g.declined,
        gpuError: g.declined ? null : g.error,
        cpuMs: Math.round(cpuMs),
        cpuMeasured: runCpu,
        cpuRateNsPerCell: +rate.toFixed(1),
        speedup: g.declined || !g.ms ? null : +(cpuMs / g.ms).toFixed(1),
        maxAbsDiff: maxDiff,
      })
    }
    }

    // How far apart the two estimators are on identical genotypes. This is NOT
    // a parity check — haplotypic and composite r2 are different statistics and
    // are only expected to coincide under Hardy-Weinberg, which the synthetic
    // cohort satisfies exactly because its two haplotype planes are drawn
    // independently. On real data they diverge, so this number is a floor on
    // the difference rather than a bound.
    let methodAgreement = null
    const [mA, mB] = Object.keys(agreement)
    if (mA && mB) {
      const a = agreement[mA]!
      const b = agreement[mB]!
      let maxDiff = 0
      let sumDiff = 0
      for (let i = 0; i < a.length; i++) {
        const dd = Math.abs(a[i]! - b[i]!)
        if (dd > maxDiff) maxDiff = dd
        sumDiff += dd
      }
      methodAgreement = {
        between: [mA, mB],
        window: narrowest,
        cells: a.length,
        maxAbsDiff: maxDiff,
        meanAbsDiff: sumDiff / a.length,
      }
    }

    return {
      adapter: info,
      limits: { maxStorageBufferBindingSize: MAXBIND, maxBufferSize: MAXBUF, maxComputeWorkgroupsPerDimension: MAXD },
      calibration: { n: calN, cells: cellCount(calN, calK), perMethod: calibration },
      methodAgreement,
      rows,
    }
  },
  { KERNEL_SPECS, METHODS, NUM_SAMPLES, NUM_SNPS, WINDOWS, CALIBRATION_N, CPU_BUDGET_MS },
)

await close()

assertHardwareAdapter(out.adapter, ALLOW_SOFTWARE)

const table = out.rows.map(r => ({
  method: r.method,
  units: `${r.units.toLocaleString()} ${r.unitName}`,
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
  { name: 'method' },
  { name: 'reduces over' },
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
  `${NUM_SNPS.toLocaleString()} variants, ${NUM_SAMPLES.toLocaleString()} samples, r².`,
  '',
  'One cohort, read two ways: `phased` is haplotypic LD over the 2n haplotypes ' +
    '(ldPhasedCompute), `composite` is the Weir (1979) estimator over the n ' +
    'genotype dosages (ldCompute), the dosages being the same haplotypes ' +
    'collapsed. The output matrix is the same size either way — phasing changes ' +
    'the depth of each cell\'s reduction, not the number of cells.',
  '',
  `Adapter: ${out.adapter.vendor} ${out.adapter.architecture} ${out.adapter.device} ${out.adapter.description}`.trim(),
  `Headed: ${HEADED} (a headless run can substitute a software adapter; see assertHardwareAdapter)`,
  `maxStorageBufferBindingSize: ${out.limits.maxStorageBufferBindingSize.toLocaleString()} bytes`,
  '',
  tablemark(table, { columns: COLUMNS }),
  '',
  '- **window** is `maxVariantSeparation` (plink `--ld-window`); "full triangle" is the slot default, 0.',
  `- **cpu ms** marked \`(est)\` exceeded the ${CPU_BUDGET_MS / 1000}s budget and is extrapolated from a rate measured ` +
    `per method at n=${out.calibration.n} (${out.calibration.cells.toLocaleString()} cells): ` +
    Object.entries(out.calibration.perMethod)
      .map(([m, c]) => `${m} ${c.nsPerCell.toFixed(1)} ns/cell in ${c.ms} ms`)
      .join(', ') +
    '. Nothing is capped silently.',
  '- **DECLINED** means `planDispatch` refuses the output buffer, so the app falls back to the CPU column.',
  '- **max|gpu-cpu|** is f32-vs-f64 only; it is the parity check that the banded decode addresses the same cells on both sides. It compares a kernel against ITS OWN CPU twin, never one method against the other.',
  out.methodAgreement
    ? `- **phased vs composite** on identical genotypes at window ${out.methodAgreement.window}: ` +
      `max |diff| ${out.methodAgreement.maxAbsDiff.toExponential(1)}, mean ${out.methodAgreement.meanAbsDiff.toExponential(1)} ` +
      `over ${out.methodAgreement.cells.toLocaleString()} cells. Not a parity check — these are different estimators, ` +
      'equal only under Hardy-Weinberg, which this synthetic cohort satisfies exactly. Real data diverges further.'
    : '',
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

// What one window of a 2,504-sample copy-number track costs over HTTP, read
// three ways from the same host: one BigWig per sample, one samples-by-bins
// Zarr store, and one multi-column bedGraph with a value column per sample.
//
// Every arm reads through a fetch wrapper that counts requests and bytes, so
// the counts include each header, index and data read the library makes. Each
// round opens every file cold, with fresh reader objects, and the arms rotate
// order across rounds. WARMUP unrecorded rounds come first, so that every file
// sits in the CDN's cache before any round is recorded.
//
// The readers are the libraries JBrowse 2 v5 uses: @gmod/bbi for BigWig and
// @gmod/tabix for the bedGraph. The Zarr arm makes the requests
// MultiWiggleZarrAdapter (jbrowse-plugin-zarr) makes. It picks the coarsest
// level whose bins are no wider than a pixel, and at a level that keeps the
// minimum and maximum of its finer bins it reads those two arrays beside the
// mean, as the adapter does unless a display asks for the mean alone. The
// bedGraph has one level, so at a wide window it returns every row in view.
//
//   node scripts/cohort-signal/measure.ts
//     ROUNDS=3  WARMUP=1  CONCURRENCY=24  PIXELS=1500
//     HOST_LABEL=<machine>   recorded in the results file
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { BigWig } from '@gmod/bbi'
import { TabixIndexedFile } from '@gmod/tabix'
import { RemoteFile } from 'generic-filehandle2'

const here = (p: string) => new URL(p, import.meta.url)

const ROUNDS = Number(process.env.ROUNDS ?? 3)
const WARMUP = Number(process.env.WARMUP ?? 1)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 24)
const PIXELS = Number(process.env.PIXELS ?? 1500)

const DEMOS = 'https://jbrowse.org/demos/1000g'
const WINDOWED = {
  zarr: `${DEMOS}/qm2_cn_1kb.zarr`,
  bedgraph: `${DEMOS}/qm2_cn_1kb.bedgraph.gz`,
}
const WHOLE_GENOME = {
  zarr: `${DEMOS}/qm2_cn_wg_10kb.zarr`,
  bedgraph: `${DEMOS}/qm2_cn_wg_10kb.bedgraph.gz`,
}

interface Window {
  label: string
  refName: string
  start: number
  end: number
  zarr: string
  bedgraph: string
}

const WINDOWS: Window[] = [
  {
    label: 'population_cnv tutorial',
    refName: 'chr17',
    start: 36_080_000,
    end: 36_270_000,
    ...WINDOWED,
  },
  {
    label: 'Figure 2, nested deletion',
    refName: 'chr3',
    start: 162_650_000,
    end: 163_050_000,
    ...WINDOWED,
  },
  {
    label: 'whole chromosome 17',
    refName: 'chr17',
    start: 0,
    end: 83_257_441,
    ...WHOLE_GENOME,
  },
]

const samples = readFileSync(here('samples.tsv'), 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))
  .map(line => {
    const cols = line.split('\t')
    return { name: cols[0]!, url: cols.at(-1)! }
  })

interface Interval {
  start: number
  end: number
  score: number
}

interface Measurement {
  requests: number
  bytes: number
  ms: number
  firstSample: Interval[]
  detail: string
}

function countingFetch() {
  const count = { requests: 0, bytes: 0 }
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    count.requests++
    const res = await globalThis.fetch(input, init)
    const buf = await res.arrayBuffer()
    count.bytes += buf.byteLength
    return new Response(buf, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
  return { wrapped, count }
}

async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        await fn(items[index]!, index)
      }
    }),
  )
}

const bpPerPx = (w: Window) => (w.end - w.start) / PIXELS

async function bigwigArm(w: Window): Promise<Measurement> {
  const { wrapped, count } = countingFetch()
  const basesPerSpan = Math.max(1, Math.round(bpPerPx(w)))
  let firstSample: Interval[] = []
  const t0 = performance.now()
  await pool(samples, CONCURRENCY, async (sample, index) => {
    const bw = new BigWig({ filehandle: new RemoteFile(sample.url, { fetch: wrapped }) })
    await bw.getHeader()
    const features = await bw.getFeatures(w.refName, w.start, w.end, { basesPerSpan })
    if (index === 0) {
      firstSample = features.map(f => ({
        start: f.start,
        end: f.end,
        score: f.score ?? Number.NaN,
      }))
    }
  })
  const ms = performance.now() - t0
  return { ...count, ms, firstSample, detail: `basesPerSpan ${basesPerSpan}` }
}

interface ZarrLevel {
  path: string
  binSize: number
  minPath?: string
  maxPath?: string
  refs: Record<string, { start: number; binOffset: number; numBins: number }>
}

async function zarrArm(w: Window): Promise<Measurement> {
  const { wrapped, count } = countingFetch()
  const base = w.zarr.replace(/\/$/, '')
  const t0 = performance.now()
  const group = (await (await wrapped(`${base}/zarr.json`)).json()) as {
    attributes: { jbrowse_signal_matrix: { levels: ZarrLevel[] } }
  }
  const levels = group.attributes.jbrowse_signal_matrix.levels
  const finest = levels[0]!
  const level =
    levels.filter(l => l.binSize <= Math.max(bpPerPx(w), finest.binSize)).at(-1) ?? finest
  const paths = [
    level.path,
    ...(level.minPath && level.maxPath ? [level.minPath, level.maxPath] : []),
  ]
  const metas = await Promise.all(
    paths.map(async p => {
      const meta = (await (await wrapped(`${base}/${p}/zarr.json`)).json()) as {
        chunk_grid: { configuration: { chunk_shape: [number, number] } }
      }
      return meta.chunk_grid.configuration.chunk_shape[1]
    }),
  )
  const chunkBins = metas[0]!
  const ref = level.refs[w.refName]!
  const firstBin = ref.binOffset + Math.floor((w.start - ref.start) / level.binSize)
  const lastBin = Math.min(
    ref.binOffset + ref.numBins - 1,
    ref.binOffset + Math.floor((w.end - 1 - ref.start) / level.binSize),
  )
  const chunkIds: number[] = []
  for (let c = Math.floor(firstBin / chunkBins); c <= Math.floor(lastBin / chunkBins); c++) {
    chunkIds.push(c)
  }
  const arrays = await Promise.all(
    paths.map(p =>
      Promise.all(
        chunkIds.map(async c => {
          const raw = gunzipSync(
            Buffer.from(await (await wrapped(`${base}/${p}/c/0/${c}`)).arrayBuffer()),
          )
          return { c, values: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) }
        }),
      ),
    ),
  )
  const ms = performance.now() - t0
  const means = arrays[0]!
  const firstSample: Interval[] = []
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const chunk = means.find(ch => ch.c === Math.floor(bin / chunkBins))!
    const start = ref.start + (bin - ref.binOffset) * level.binSize
    firstSample.push({ start, end: start + level.binSize, score: chunk.values[bin % chunkBins]! })
  }
  return {
    ...count,
    ms,
    firstSample,
    detail: `${level.path}, ${paths.length} arrays x ${chunkIds.length} chunks`,
  }
}

async function bedgraphArm(w: Window): Promise<Measurement> {
  const { wrapped, count } = countingFetch()
  const t0 = performance.now()
  const file = new TabixIndexedFile({
    filehandle: new RemoteFile(w.bedgraph, { fetch: wrapped }),
    tbiFilehandle: new RemoteFile(`${w.bedgraph}.tbi`, { fetch: wrapped }),
  })
  const header = await file.getHeaderLines()
  const nSamples = header.at(-1)!.split('\t').length - 3
  const firstSample: Interval[] = []
  let cells = 0
  await file.getLines(w.refName, w.start, w.end, {
    lineCallback: line => {
      const cols = line.split('\t')
      const values = cols.slice(3).map(Number)
      cells += values.length
      firstSample.push({ start: Number(cols[1]), end: Number(cols[2]), score: values[0]! })
    },
  })
  const ms = performance.now() - t0
  if (cells !== firstSample.length * nSamples) {
    throw new Error(`bedGraph rows hold ${cells} cells, expected ${firstSample.length * nSamples}`)
  }
  return { ...count, ms, firstSample, detail: `${firstSample.length} rows` }
}

const ARMS = [
  { name: 'bigwigs', run: bigwigArm },
  { name: 'zarr', run: zarrArm },
  { name: 'bedgraph', run: bedgraphArm },
] as const

const median = (xs: number[]) => [...xs].toSorted((a, b) => a - b)[xs.length >> 1]!

// The length-weighted mean of a sample's intervals over each of the given bins.
// BigWig segments, bedGraph rows and Zarr bins all reduce to this, so the check
// compares every arm over the Zarr arm's bins.
function meansOver(intervals: Interval[], bins: Interval[]) {
  return bins.map(bin => {
    let sum = 0
    let covered = 0
    for (const f of intervals) {
      const overlap = Math.min(f.end, bin.end) - Math.max(f.start, bin.start)
      if (overlap > 0 && !Number.isNaN(f.score)) {
        sum += f.score * overlap
        covered += overlap
      }
    }
    return covered ? sum / covered : Number.NaN
  })
}

function maxDifference(a: number[], b: number[]) {
  return a.reduce((m, x, i) => {
    const y = b[i]!
    return Number.isNaN(x) || Number.isNaN(y) ? m : Math.max(m, Math.abs(x - y))
  }, 0)
}

for (let r = 0; r < WARMUP; r++) {
  for (const w of WINDOWS) {
    for (const arm of ARMS) {
      await arm.run(w)
    }
  }
  console.log(`warm-up round ${r + 1} done`)
}

const results = []
for (const w of WINDOWS) {
  const runs: Record<string, Measurement[]> = { bigwigs: [], zarr: [], bedgraph: [] }
  for (let r = 0; r < ROUNDS; r++) {
    for (let k = 0; k < ARMS.length; k++) {
      const arm = ARMS[(k + r) % ARMS.length]!
      const m = await arm.run(w)
      runs[arm.name]!.push(m)
      console.log(
        `${w.label.padEnd(26)} round ${r + 1} ${arm.name.padEnd(9)} ${String(m.requests).padStart(6)} requests ` +
          `${(m.bytes / 1e6).toFixed(2).padStart(7)} MB ${(m.ms / 1000).toFixed(2).padStart(7)} s  ${m.detail}`,
      )
    }
  }
  const zarrBins = runs.zarr![0]!.firstSample
  const zarrValues = zarrBins.map(b => b.score)
  const maxDiff = {
    bedgraph: maxDifference(zarrValues, meansOver(runs.bedgraph![0]!.firstSample, zarrBins)),
    bigwigs: maxDifference(zarrValues, meansOver(runs.bigwigs![0]!.firstSample, zarrBins)),
  }
  console.log(`${w.label}: first sample, largest difference from the Zarr arm's bins`, maxDiff)
  results.push({
    ...w,
    bpPerPx: bpPerPx(w),
    firstSampleMaxDifference: maxDiff,
    arms: Object.fromEntries(
      ARMS.map(({ name }) => {
        const ms = runs[name]!
        return [
          name,
          {
            detail: ms[0]!.detail,
            requests: ms.map(m => m.requests),
            megabytes: ms.map(m => Number((m.bytes / 1e6).toFixed(2))),
            seconds: ms.map(m => Number((m.ms / 1000).toFixed(2))),
            medianSeconds: Number((median(ms.map(m => m.ms)) / 1000).toFixed(1)),
          },
        ]
      }),
    ),
  })
}

const out = {
  measured: new Date().toISOString(),
  host: process.env.HOST_LABEL ?? 'unlabelled',
  samples: samples.length,
  rounds: ROUNDS,
  warmup: WARMUP,
  concurrency: CONCURRENCY,
  pixels: PIXELS,
  windows: results,
}
mkdirSync(here('../../results/cohort-signal/'), { recursive: true })
const stamp = out.measured.slice(0, 16).replace(':', '')
writeFileSync(here(`../../results/cohort-signal/${stamp}.json`), JSON.stringify(out, null, 2))
console.log(`wrote results/cohort-signal/${stamp}.json`)

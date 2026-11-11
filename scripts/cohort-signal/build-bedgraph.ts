// Write one level of a published copy-number Zarr store as one multi-column
// bedGraph: a row per bin, a value column per sample, bgzipped and
// Tabix-indexed. The values come out of the store, so the two files hold the
// same numbers over the same regions and differ only in layout.
//
//   node scripts/cohort-signal/build-bedgraph.ts <zarr-url> <out.bedgraph.gz> [level-path]
//     MERGE=1   join adjacent bins whose every sample holds the same value into
//               one row, as a bedGraph written from per-base signal would be
//
// The level defaults to the store's finest, which is the only one a bedGraph
// user would have: the format has no coarser levels to fall back on. Each
// float32 is written with the fewest significant digits that parse back to the
// same float32, so the text is not padded with the digits of a float64
// expansion. Rows stream through bgzip, so a whole-genome level fits in memory.
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { gunzipSync } from 'node:zlib'

const [zarrArg, outPath, levelArg] = process.argv.slice(2)
if (!zarrArg || !outPath?.endsWith('.gz')) {
  console.error('usage: build-bedgraph.ts <zarr-url> <out.bedgraph.gz> [level-path]')
  process.exit(1)
}
const zarrUrl = zarrArg.replace(/\/$/, '')

interface Level {
  path: string
  binSize: number
  refs: Record<string, { start: number; binOffset: number; numBins: number }>
}

interface Group {
  attributes: {
    jbrowse_signal_matrix: { samples: { name: string }[]; levels: Level[] }
  }
}

interface ArrayMeta {
  shape: [number, number]
  chunk_grid: { configuration: { chunk_shape: [number, number] } }
  codecs: { name: string }[]
}

async function fetchJson<T>(url: string) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

async function fetchChunk(url: string, length: number) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`)
  }
  const raw = gunzipSync(Buffer.from(await res.arrayBuffer()))
  const values = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  if (values.length !== length) {
    throw new Error(`${url}: ${values.length} values, expected ${length}`)
  }
  return values
}

function shortestFloat32(v: number) {
  if (Number.isNaN(v)) {
    return 'NaN'
  }
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(v.toPrecision(digits)))
    if (Math.fround(Number(text)) === v) {
      return text
    }
  }
  return String(v)
}

const group = await fetchJson<Group>(`${zarrUrl}/zarr.json`)
const { samples, levels } = group.attributes.jbrowse_signal_matrix
const level = levelArg
  ? levels.find(l => l.path === levelArg)
  : levels.reduce((a, b) => (a.binSize <= b.binSize ? a : b))
if (!level) {
  throw new Error(`no level ${levelArg}; the store has ${levels.map(l => l.path).join(', ')}`)
}
const meta = await fetchJson<ArrayMeta>(`${zarrUrl}/${level.path}/zarr.json`)
const [nSamples, chunkBins] = meta.chunk_grid.configuration.chunk_shape
if (nSamples !== samples.length) {
  throw new Error(`chunk holds ${nSamples} samples, metadata lists ${samples.length}`)
}
const codecs = meta.codecs.map(c => c.name).join(',')
if (codecs !== 'bytes,gzip') {
  throw new Error(`expected bytes,gzip codecs, found ${codecs}`)
}

// Chunks are fetched a few ahead of the one being written, in order.
const PREFETCH = 8
const nChunks = Math.ceil(meta.shape[1] / chunkBins)
const pending = new Map<number, Promise<Float32Array>>()
const chunkAt = (c: number) => {
  for (let k = c; k < Math.min(c + PREFETCH, nChunks); k++) {
    if (!pending.has(k)) {
      pending.set(k, fetchChunk(`${zarrUrl}/${level.path}/c/0/${k}`, nSamples * chunkBins))
    }
  }
  for (const k of pending.keys()) {
    if (k < c) {
      pending.delete(k)
    }
  }
  return pending.get(c)!
}

mkdirSync(dirname(outPath), { recursive: true })
const bgzip = spawn('bgzip', ['-c', '-@', '4'], { stdio: ['pipe', 'pipe', 'inherit'] })
bgzip.stdout.pipe(createWriteStream(outPath))
const finished = new Promise<void>((resolve, reject) => {
  bgzip.on('close', code => {
    if (code === 0) {
      resolve()
    } else {
      reject(new Error(`bgzip exited ${code}`))
    }
  })
})
const write = (text: string) =>
  bgzip.stdin.write(text) ? Promise.resolve() : new Promise<void>(r => bgzip.stdin.once('drain', r))

await write(`#chrom\tstart\tend\t${samples.map(s => s.name).join('\t')}\n`)
const merge = process.env.MERGE === '1'
const refs = Object.entries(level.refs).toSorted(([, a], [, b]) => a.binOffset - b.binOffset)
let rows = 0
let nanCells = 0
for (const [refName, ref] of refs) {
  const lines: string[] = []
  let open: { start: number; end: number; text: string } | undefined
  const flush = async () => {
    if (open) {
      lines.push(`${refName}\t${open.start}\t${open.end}\t${open.text}\n`)
      rows++
      if (lines.length === 256) {
        await write(lines.join(''))
        lines.length = 0
      }
    }
  }
  for (let i = 0; i < ref.numBins; i++) {
    const bin = ref.binOffset + i
    const chunk = await chunkAt(Math.floor(bin / chunkBins))
    const within = bin % chunkBins
    const cells: string[] = []
    for (let s = 0; s < nSamples; s++) {
      cells[s] = shortestFloat32(chunk[s * chunkBins + within]!)
      if (cells[s] === 'NaN') {
        nanCells++
      }
    }
    const start = ref.start + i * level.binSize
    const text = cells.join('\t')
    if (merge && open?.end === start && open.text === text) {
      open.end = start + level.binSize
    } else {
      await flush()
      open = { start, end: start + level.binSize, text }
    }
  }
  await flush()
  await write(lines.join(''))
}
bgzip.stdin.end()
await finished
execFileSync('tabix', ['-f', '-p', 'bed', outPath])

console.log(
  `${outPath}: ${rows} rows x ${nSamples} samples at ${level.binSize} bp${merge ? ', equal runs merged,' : ''} from ` +
    `${refs.length} sequences; ${nanCells} NaN cells`,
)

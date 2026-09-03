/**
 * The same query the end-to-end panel makes, with nothing above it: @gmod/bam
 * and @gmod/tabix straight, pool on vs off, over real HTTP range requests.
 *
 * This is the ceiling the end-to-end figure is read against. Both panels time
 * the same windows over the same files with the same four-worker pool, so the
 * difference between them is jbrowse's own serial work — RPC hop, feature
 * conversion, layout, paint — and not a different benchmark.
 *
 *   node --experimental-strip-types scripts/bgzfpool/standalone.ts [rounds]
 *
 * The libraries are bundled out of jbrowse-components' node_modules rather than
 * this repo's, so the two panels are the same code. The versions bundled are
 * recorded in the output; a figure drawn from a run where they do not match the
 * staged build is comparing two different libraries.
 *
 * Traps this is written around, from bgzf-filehandle's worker-pool doc:
 *   - node cannot measure the pool at all, so this needs a browser
 *   - the HTTP cache warms for several rounds, so it is min over enough of them
 *   - the arms interleave, so drift hits both alike
 *   - a fresh reader per round, so the chunk cache starts cold
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import puppeteer from 'puppeteer'
import { DEFAULT_TRACKS, REF, TIMED } from './windows.ts'

const ROUNDS = Number(process.argv[2] ?? process.env.ROUNDS ?? 9)
const TRACKS = (process.env.TRACKS ?? DEFAULT_TRACKS.join(',')).split(',')
const JBROWSE = process.env.JBROWSE ?? path.resolve('../jbrowse-components')
const PORT = Number(process.env.PORT ?? 8021)

const libs = {
  '@gmod/bam': 'plugins/alignments/node_modules/@gmod/bam',
  '@gmod/tabix': 'plugins/variants/node_modules/@gmod/tabix',
  '@gmod/bgzf-filehandle': 'packages/core/node_modules/@gmod/bgzf-filehandle',
}
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bgzfpool-')), 'bench.js')
const versions: Record<string, string> = {}
for (const [name, rel] of Object.entries(libs)) {
  const pkg = path.join(JBROWSE, rel, 'package.json')
  if (!fs.existsSync(pkg)) {
    throw new Error(
      `${pkg} not found — set JBROWSE to a jbrowse-components checkout with its ` +
        `dependencies installed, so this measures the same libraries the build does`,
    )
  }
  versions[name] = JSON.parse(fs.readFileSync(pkg, 'utf8')).version
}
console.log(
  'bundling ' +
    Object.entries(versions)
      .map(([n, v]) => `${n}@${v}`)
      .join(' '),
)

// Aliased to the exact ESM entry rather than resolved by node paths: the alias
// pins which copy is bundled, and the version assertion above is then about the
// bytes that actually got in.
execFileSync(
  'npx',
  [
    'esbuild',
    'scripts/bgzfpool/page.ts',
    '--bundle',
    '--format=esm',
    '--target=es2022',
    ...Object.entries(libs).map(
      ([name, rel]) => `--alias:${name}=${path.join(JBROWSE, rel, 'esm/index.js')}`,
    ),
    `--outfile=${OUT}`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)
const js = fs.readFileSync(OUT, 'utf8')

const INDEX = `<!doctype html><meta charset=utf8><title>bgzf pool standalone</title>
<script type="module" src="/bench.js"></script>`

// Range support is not optional: tabix and BAI both read by byte range off the
// index, and a server that ignores Range makes this a measurement of the
// network rather than of the inflate.
const VERBOSE = process.env.VERBOSE === '1'
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (VERBOSE) {
    console.log(`  ${req.method} ${url.pathname} range=${req.headers.range ?? '-'}`)
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(INDEX)
  } else if (url.pathname === '/bench.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(js)
  } else {
    const file = path.join(path.resolve('data'), path.normalize(url.pathname))
    if (!file.startsWith(path.resolve('data')) || !fs.existsSync(file)) {
      if (VERBOSE) {
        console.log(`  404 ${file}`)
      }
      res.writeHead(404)
      res.end()
    } else {
      const size = fs.statSync(file).size
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      if (range) {
        const start = range[1] ? Number(range[1]) : 0
        // Clamped, because a reader asks for the range its index named and
        // that routinely runs past the end of the file: BAI and tabix chunk
        // ends are virtual offsets into the last block, and bam-js reads a
        // generous tail. An unclamped end makes content-length disagree with
        // the bytes actually sent, and the fetch fails with nothing but
        // "Failed to fetch" to say so.
        const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1)
        res.writeHead(206, {
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        })
        fs.createReadStream(file, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'accept-ranges': 'bytes', 'content-length': size })
        fs.createReadStream(file).pipe(res)
      }
    }
  }
})
await new Promise<void>(resolve => {
  server.listen(PORT, resolve)
})

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.on('pageerror', e => {
  console.log(`  page error: ${String(e)}`)
})
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
await page.waitForFunction('window.bgzfBench !== undefined', { timeout: 60000 })

const available = await page.evaluate(
  () => (window as unknown as { bgzfBench: { poolAvailable: boolean } }).bgzfBench.poolAvailable,
)
if (!available) {
  throw new Error(
    'getSharedWorkerPool resolved to undefined — no Worker or no Blob URL in ' +
      'this browser, so both arms would inflate in process and report parity',
  )
}

interface Timing {
  ms: number
  count: number
}

const min = (xs: number[]) => Math.min(...xs)
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

const results: Record<string, unknown> = {}
for (const track of TRACKS) {
  process.stdout.write(`${track}: `)
  const rounds: { pooled: Timing[]; plain: Timing[] }[] = []
  for (let r = 0; r < ROUNDS; r++) {
    const out = await page.evaluate(
      (url: string, refName: string, windows: number[][]) =>
        (
          window as unknown as {
            bgzfBench: {
              round: (
                u: string,
                rn: string,
                w: number[][],
              ) => Promise<{ pooled: Timing[]; plain: Timing[] }>
            }
          }
        ).bgzfBench.round(url, refName, windows),
      `http://localhost:${PORT}/${track}`,
      REF,
      TIMED,
    )
    rounds.push(out)
    process.stdout.write('.')
  }
  // Both arms must have found the same records. An arm that silently returned
  // nothing is the fastest arm there is.
  const counts = new Set(
    rounds.flatMap(r => [...r.pooled, ...r.plain]).map(t => t.count),
  )
  const perWindow = TIMED.map((_, i) => ({
    pooled: min(rounds.map(r => r.pooled[i]!.ms)),
    plain: min(rounds.map(r => r.plain[i]!.ms)),
    count: rounds[0]!.pooled[i]!.count,
  }))
  const ratios = perWindow.map(w => w.plain / w.pooled)
  const mismatched = TIMED.some(
    (_, i) =>
      new Set(rounds.flatMap(r => [r.pooled[i]!.count, r.plain[i]!.count]))
        .size > 1,
  )
  results[track] = { rounds, perWindow, ratios, median: med(ratios), mismatched }
  process.stdout.write(
    ` => ${med(ratios).toFixed(2)}x  (per window ${ratios.map(r => r.toFixed(2)).join(' ')})` +
      `  records ${[...counts].sort((a, b) => a - b).join('/')}\n`,
  )
  if (mismatched) {
    console.log(`  !! ${track}: the two arms did not return the same record count`)
  }
}

await browser.close()
server.close()

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/bgzfpool-standalone.json',
  JSON.stringify(
    { rounds: ROUNDS, windows: TIMED, ref: REF, versions, results },
    null,
    2,
  ),
)
console.log('\nWrote results/bgzfpool-standalone.json')

/**
 * Where more BGZF speedup is available, if anywhere: worker count against query
 * concurrency, on the heaviest cells in the corpus.
 *
 * The standalone arm measures 1.65x with four workers and one query in flight.
 * Two things could be leaving speedup on the table, and they are separable:
 *
 *   workers      `@gmod/bgzf-filehandle`'s worker-pool doc says four is not the
 *                ceiling. This box has 16 cores.
 *   concurrency  one query hands the pool only the blocks of its own chunk. A
 *                pan has several queries in flight at once, so it can keep more
 *                of the pool busy than this arm ever does.
 *
 * Both arms of every ratio run in the same page with the same reader
 * construction, so what changes between rows is only the lever named.
 *
 *   node --experimental-strip-types scripts/bgzfpool/levers.ts [rounds]
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import puppeteer from 'puppeteer'
import { REF, TIMED } from './windows.ts'

const ROUNDS = Number(process.argv[2] ?? process.env.ROUNDS ?? 5)
const TRACKS = (
  process.env.TRACKS ??
  '1000x.longread.bam,200x.longread.bam,1000x.shortread.bam,variants.pool.3000.wide.vcf.gz'
).split(',')
const WORKER_COUNTS = (process.env.WORKERS ?? '2,4,8,12').split(',').map(Number)
const JBROWSE = process.env.JBROWSE ?? path.resolve('../jbrowse-components')
const PORT = Number(process.env.PORT ?? 8022)
const HEAP_MB = Number(process.env.HEAP_MB ?? 24576)

const libs = {
  '@gmod/bam': 'plugins/alignments/node_modules/@gmod/bam',
  '@gmod/tabix': 'plugins/variants/node_modules/@gmod/tabix',
  '@gmod/bgzf-filehandle': 'packages/core/node_modules/@gmod/bgzf-filehandle',
}
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bgzflevers-')), 'bench.js')
const versions: Record<string, string> = {}
for (const [name, rel] of Object.entries(libs)) {
  versions[name] = JSON.parse(
    fs.readFileSync(path.join(JBROWSE, rel, 'package.json'), 'utf8'),
  ).version
}
console.log(
  'bundling ' + Object.entries(versions).map(([n, v]) => `${n}@${v}`).join(' '),
)
execFileSync(
  'npx',
  [
    'esbuild', 'scripts/bgzfpool/page.ts', '--bundle', '--format=esm',
    '--target=es2022',
    ...Object.entries(libs).map(
      ([name, rel]) => `--alias:${name}=${path.join(JBROWSE, rel, 'esm/index.js')}`,
    ),
    `--outfile=${OUT}`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)
const js = fs.readFileSync(OUT, 'utf8')
const INDEX = `<!doctype html><meta charset=utf8><title>bgzf levers</title>
<script type="module" src="/bench.js"></script>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(INDEX)
  } else if (url.pathname === '/bench.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(js)
  } else {
    const file = path.join(path.resolve('data'), path.normalize(url.pathname))
    if (!file.startsWith(path.resolve('data')) || !fs.existsSync(file)) {
      res.writeHead(404)
      res.end()
    } else {
      const size = fs.statSync(file).size
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      if (range) {
        const start = range[1] ? Number(range[1]) : 0
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
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--js-flags=--max-old-space-size=${HEAP_MB}`,
  ],
})

const min = (xs: number[]) => Math.min(...xs)

interface Row {
  track: string
  workers: number
  mode: 'sequential' | 'concurrent'
  pooled: number
  plain: number
  speedup: number
  counts: string
}
const rows: Row[] = []

for (const workers of WORKER_COUNTS) {
  const page = await browser.newPage()
  page.on('pageerror', e => {
    console.log(`  page error: ${String(e)}`)
  })
  await page.goto(`http://localhost:${PORT}/?workers=${workers}`, {
    waitUntil: 'load',
  })
  await page.waitForFunction('window.bgzfBench !== undefined', { timeout: 60000 })
  const got = await page.evaluate(
    () => (window as unknown as { bgzfBench: { workers: number } }).bgzfBench.workers,
  )
  if (got !== workers) {
    throw new Error(`asked for ${workers} workers, page reports ${got}`)
  }

  for (const track of TRACKS) {
    for (const mode of ['sequential', 'concurrent'] as const) {
      const pooled: number[] = []
      const plain: number[] = []
      const counts = new Set<number>()
      let failed = ''
      for (let r = 0; r < ROUNDS && !failed; r++) {
        const out = await page
          .evaluate(
            (url: string, refName: string, windows: number[][], seq: boolean) => {
              const b = (
                window as unknown as {
                  bgzfBench: {
                    round: (u: string, rn: string, w: number[][]) => Promise<{
                      pooled: { ms: number; count: number }[]
                      plain: { ms: number; count: number }[]
                    }>
                    roundConcurrent: (
                      u: string, rn: string, w: number[][],
                    ) => Promise<Record<string, number>>
                  }
                }
              ).bgzfBench
              return seq
                ? b.round(url, refName, windows).then(o => ({
                    pooled: o.pooled.reduce((a, t) => a + t.ms, 0),
                    plain: o.plain.reduce((a, t) => a + t.ms, 0),
                    pooledCount: o.pooled.reduce((a, t) => a + t.count, 0),
                    plainCount: o.plain.reduce((a, t) => a + t.count, 0),
                  }))
                : b.roundConcurrent(url, refName, windows)
            },
            `http://localhost:${PORT}/${track}`,
            REF,
            TIMED,
            mode === 'sequential',
          )
          .catch((e: unknown) => {
            failed = String(e).split('\n')[0]!
            return undefined
          })
        if (out) {
          pooled.push(out.pooled!)
          plain.push(out.plain!)
          counts.add(out.pooledCount!)
          counts.add(out.plainCount!)
        }
      }
      if (failed) {
        console.log(`  ${track} w=${workers} ${mode}: FAILED (${failed})`)
      } else {
        const row = {
          track,
          workers,
          mode,
          pooled: min(pooled),
          plain: min(plain),
          speedup: min(plain) / min(pooled),
          counts: [...counts].join('/'),
        }
        rows.push(row)
        console.log(
          `  ${track.padEnd(30)} w=${String(workers).padStart(2)} ${mode.padEnd(10)} ` +
            `${row.plain.toFixed(0).padStart(6)}ms -> ${row.pooled.toFixed(0).padStart(6)}ms ` +
            `= ${row.speedup.toFixed(2)}x  records ${row.counts}`,
        )
      }
      fs.mkdirSync('results', { recursive: true })
      fs.writeFileSync(
        'results/bgzfpool-levers.json',
        JSON.stringify(
          { rounds: ROUNDS, windows: TIMED, ref: REF, versions, cores: os.cpus().length, rows },
          null,
          2,
        ),
      )
    }
  }
  await page.close()
}

await browser.close()
server.close()
console.log('\nWrote results/bgzfpool-levers.json')

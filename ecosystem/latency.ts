// What a parser library costs on a server that is not localhost.
//
// Every HTTP number in this repo until now came off `localhost`, where a round
// trip is about 0.05 ms. That makes a request free, and it makes every
// optimization about the SHAPE of a request unmeasurable -- fewer reads, reads
// issued together rather than one after another, a cache shared across files.
// `results/cohort-bw.md` recorded that @gmod/bbi 11.2.2 issues one MORE read per
// file than 3.0.0 for identical bytes, and on localhost that cost nothing; the
// interesting question was always what it costs on a link with latency, and the
// answer was never measured.
//
// This measures it. `latency-server.ts` serves the same corpus with a chosen
// round trip; `browser/bench.html` opens the files through it in a real browser
// and times the query. Both halves matter:
//
//   The latency, because a read count is a proxy for round trips and this reports
//   the round trips as time.
//
//   The browser, because that is where the 2023 arms resolve their `browser`
//   field and inflate with pako. Under node they get native zlib, so the node
//   comparison pits C against the current arms' wasm -- a matchup that exists in
//   no deployment. See browser/build.ts.
//
// Usage: node --experimental-strip-types ecosystem/latency.ts
//   RTTS=0,25,100   round trips in ms
//   NS=1,10,100     panel sizes for the cohort case
//   ITERS=5         measured iterations per cell
//   LIB=bbi-js      which library's arms
import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import puppeteer from 'puppeteer'

const ROOT = path.resolve(import.meta.dirname)
const REPO = path.resolve(ROOT, '..')

const RTTS = (process.env.RTTS ?? '0,25,100').split(',').map(Number)
const NS = (process.env.NS ?? '1,10,100').split(',').map(Number)
const ITERS = Number(process.env.ITERS ?? 5)
const LIB = process.env.LIB ?? 'bbi-js'
const CORPUS_PORT = Number(process.env.CORPUS_PORT ?? 9000)
const PAGE_PORT = Number(process.env.PAGE_PORT ?? 9001)

const BUNDLES = path.join(ROOT, 'browser/bundles')
if (!fs.existsSync(path.join(BUNDLES, `${LIB}-old.js`))) {
  throw new Error(
    `no bundles for ${LIB}. Run: node --experimental-strip-types ecosystem/browser/build.ts ${LIB}`,
  )
}

// The cohort corpus is one BigWig per sample; a single-file case reads the
// benchmark corpus directly. Named here rather than in the page so the page stays
// a pure instrument.
const COHORT_PATTERN = process.env.COHORT_PATTERN ?? 'cohort/sample%d.bw'
const SINGLE = process.env.SINGLE ?? '20x.shortread.bw'

const cohortDir = path.join(REPO, 'data/cohort')
const haveCohort = fs.existsSync(cohortDir)
if (!haveCohort) {
  console.log(
    `data/cohort is missing, so only the single-file case will run. shell/generate_cohort_bw.sh builds it.`,
  )
}

interface Cell {
  arm: string
  side: 'old' | 'new'
  rtt: number
  n: number
  median: number
  min: number
  ms: number[]
  requests: number | null
  bytes: number | null
  error?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Serve browser/ so the page and its bundles are same-origin. */
const pageServer = spawn(
  'npx',
  ['http-server', path.join(ROOT, 'browser'), '-p', String(PAGE_PORT), '-s', '--cors'],
  { stdio: 'ignore', detached: true },
)

const rows: Cell[] = []
const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  await sleep(1500)
  for (const rtt of RTTS) {
    // One corpus server per RTT rather than one server told to change: a delay
    // that changes under a live connection pool is a delay two cells disagree
    // about.
    const corpus = spawn(
      'node',
      [
        '--experimental-strip-types',
        path.join(ROOT, 'latency-server.ts'),
        '--root',
        path.join(REPO, 'data'),
        '--port',
        String(CORPUS_PORT),
        '--rtt',
        String(rtt),
      ],
      { stdio: 'ignore' },
    )
    await sleep(1200)

    try {
      for (const n of NS) {
        if (n > 1 && !haveCohort) {
          continue
        }
        const file = n > 1 ? COHORT_PATTERN : SINGLE
        // Interleaved within a cell: old and new back to back at the same RTT,
        // so any drift in the machine or the server lands on both.
        for (const side of ['old', 'new'] as const) {
          const arm = `${LIB}-${side}`
          const url =
            `http://localhost:${PAGE_PORT}/bench.html` +
            `?arm=${arm}&file=${encodeURIComponent(file)}&n=${n}` +
            `&iters=${ITERS}&corpus=http://localhost:${CORPUS_PORT}`
          const page = await browser.newPage()
          let cell: Cell
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded' })
            await page.waitForFunction('window.__benchDone === true', {
              timeout: 600000,
              polling: 200,
            })
            const got = (await page.evaluate('window.__benchResult')) as any
            cell = { arm, side, rtt, n, ...got }
          } catch (e) {
            cell = {
              arm, side, rtt, n,
              median: Number.NaN, min: Number.NaN, ms: [],
              requests: null, bytes: null,
              error: e instanceof Error ? e.message : String(e),
            }
          }
          await page.close()
          rows.push(cell)
          console.log(
            `rtt ${String(rtt).padStart(3)} ms  n=${String(n).padStart(3)}  ${side.padEnd(3)}  ` +
              (Number.isFinite(cell.median)
                ? `${cell.median.toFixed(0).padStart(7)} ms  ${cell.requests ?? '?'} reqs`
                : `FAIL ${cell.error}`),
          )
        }
      }
    } finally {
      corpus.kill()
      await sleep(300)
    }
  }
} finally {
  await browser.close()
  try {
    process.kill(-pageServer.pid!)
  } catch {
    pageServer.kill()
  }
}

const today = new Date().toISOString().slice(0, 10)
const out = {
  lib: LIB,
  measured: today,
  iters: ITERS,
  window: 'chr22_mask:124000-143000',
  runtime: 'chromium via puppeteer, browser-resolved bundles',
  rows,
}
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true })
fs.writeFileSync(
  path.join(ROOT, 'results/latency.json'),
  JSON.stringify(out, null, 2),
)

// ---- report ---------------------------------------------------------------

const pick = (side: string, rtt: number, n: number) =>
  rows.find(r => r.side === side && r.rtt === rtt && r.n === n)
const fmt = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)} ms`

const lines: string[] = [
  `# ${LIB} on a server with latency`,
  '',
  `Generated by \`ecosystem/latency.ts\`. Window \`chr22_mask:124000-143000\`, median of ${ITERS} iterations after a warmup, measured ${today}.`,
  '',
  '## Why this is not the node benchmark',
  '',
  'Two changes from `results/bench.md`, and each one alone would change the answer.',
  '',
  '**The corpus is served over HTTP with a round trip.** On localhost a round trip',
  'is about 0.05 ms, so the number of reads a library issues is free and every',
  'optimization about request shape is invisible. That is why `cohort-bw.md` could',
  'record the current release issuing one MORE read per file for identical bytes and',
  'have it cost nothing measurable. A read count was only ever a proxy for round',
  'trips; here they are time.',
  '',
  '**It runs in a browser, on browser-resolved bundles.** @gmod/bbi 3.0.0 ships',
  '`"browser": {"./esm/unzip.js": "./esm/unzip-pako.js"}`, so under node it inflates',
  'with native zlib and in a browser with pako, pure JavaScript. 11.2.2 has no',
  'browser field and inflates through wasm either way. The node benchmark therefore',
  'compares C against wasm, which is a matchup no deployment has; this compares pako',
  'against wasm, which is the one JBrowse ships.',
  '',
  '## Time to open a panel',
  '',
  `| round trip | files | 2023 | current | ratio |`,
  '| ---: | ---: | ---: | ---: | ---: |',
]

for (const rtt of RTTS) {
  for (const n of NS) {
    const o = pick('old', rtt, n)
    const w = pick('new', rtt, n)
    if (!o && !w) {
      continue
    }
    const ratio =
      o && w && Number.isFinite(o.median) && Number.isFinite(w.median)
        ? `${(o.median / w.median).toFixed(2)}x`
        : '—'
    lines.push(
      `| ${rtt} ms | ${n} | ${fmt(o?.median)} | ${fmt(w?.median)} | ${ratio} |`,
    )
  }
}

lines.push(
  '',
  '`ratio` is 2023 ÷ current: above 1.0 means the current release is faster.',
  '',
  'The `0 ms` rows are the localhost case, kept deliberately as the control. They',
  'are what the node benchmark measures, and the distance between them and the',
  'rows below is the part of a library\'s behaviour that only a network can price.',
  '',
)

fs.writeFileSync(path.join(ROOT, 'results/latency.md'), lines.join('\n'))
console.log(`\nwrote ecosystem/results/latency.{md,json}`)

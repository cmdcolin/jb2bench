// Row-count sweep for the many-sample matrix display: how do upload cost and
// per-frame redraw cost scale as rows are added, holding the region, the
// variant count and the machine fixed?
//
// The paper's row-scaling claim ("upload is linear in rows and paid once,
// redraw stays inside a frame") rests on cost structure plus the existence of
// the shipped displays, not on a measurement. This is the measurement.
//
// Two quantities per row count:
//   ready   nav -> render-complete, the once-paid upload+layout cost
//   frame   rAF gaps during a sustained pan that stays WITHIN loaded data,
//           so no refetch occurs and the number is pure re-project/redraw
//
// Same instrument as the CPU-throttling table (interaction-profile.ts): the
// interval between consecutive animation-frame callbacks, vsync-paced, so
// ~16.7 ms is the floor on a 60 Hz display and means "inside one frame".
//
// Usage: node scripts/render/rowsweep.ts [--port=8000] [--runs=3] [--frames=240]
import fs from 'node:fs'

import { launch } from 'puppeteer'

const arg = (name: string, fallback: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const PORT = Number(arg('port', '8000'))
const RUNS = Number(arg('runs', '3'))
const FRAMES = Number(arg('frames', '240'))
const LOC = arg('loc', '17:45,800,000-46,000,000')
const ASSEMBLY = arg('assembly', 'hg19')
const ROWS = arg('rows', '100,250,500,1000,2000,2504')
  .split(',')
  .map(Number)

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!
}

function urlFor(n: number) {
  const session = {
    views: [
      {
        type: 'LinearGenomeView',
        assembly: ASSEMBLY,
        loc: LOC,
        tracks: [
          {
            trackId: `mapt_${n}`,
            type: 'LinearMultiSampleVariantDisplay',
            height: 600,
            forceLoad: true,
          },
        ],
      },
    ],
  }
  return `http://localhost:${PORT}/?session=spec-${encodeURIComponent(
    JSON.stringify(session),
  )}&sessionName=rowsweep`
}

// quiescence detector, identical to profile.ts: a render-complete marker, no
// loading overlay, and a stable marker count across several polls. Renderer-
// agnostic on purpose — the two architectures produce different DOM.
async function waitReady(page: import('puppeteer').Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __stable?: number; __last?: number }
      const done = document.querySelectorAll(
        '[data-testid$="-done"],[data-testid$="_done"]',
      ).length
      const loading =
        document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
      const ready = done > 0 && !loading
      if (ready && done === w.__last) {
        w.__stable = (w.__stable ?? 0) + 1
      } else {
        w.__stable = 0
        w.__last = done
      }
      return ready && (w.__stable ?? 0) >= 5
    },
    { timeout: 180000, polling: 100 },
  )
}

// Oscillating pan: offsetPx changes every animation frame, but the view never
// walks off the loaded region, so nothing refetches.
async function panFrames(page: import('puppeteer').Page, frames: number) {
  return page.evaluate(async n => {
    const w = window as unknown as {
      JBrowseSession: { views: { horizontalScroll: (n: number) => void }[] }
    }
    const view = w.JBrowseSession.views[0]!
    const ts: number[] = []
    await new Promise<void>(resolve => {
      let i = 0
      const step = () => {
        ts.push(performance.now())
        view.horizontalScroll((Math.floor(i / 30) % 2 === 0 ? 1 : -1) * 10)
        i++
        if (i >= n) {
          resolve()
        } else {
          requestAnimationFrame(step)
        }
      }
      requestAnimationFrame(step)
    })
    const gaps: number[] = []
    for (let k = 1; k < ts.length; k++) {
      gaps.push(ts[k]! - ts[k - 1]!)
    }
    return gaps
  }, frames)
}

const browser = await launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})

interface Row {
  rows: number
  ready: number[]
  frameMedian: number[]
  framesOver20: number[]
  gaps: number[]
}
const out: Row[] = []

for (const n of ROWS) {
  const row: Row = {
    rows: n,
    ready: [],
    frameMedian: [],
    framesOver20: [],
    gaps: [],
  }
  process.stdout.write(`${n} rows: `)
  for (let r = 0; r < RUNS; r++) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    const t0 = Date.now()
    await page.goto(urlFor(n), { waitUntil: 'load' })
    try {
      await waitReady(page)
    } catch {
      process.stdout.write('TIMEOUT ')
      await page.close()
      continue
    }
    const ready = Date.now() - t0
    const gaps = await panFrames(page, FRAMES)
    row.ready.push(ready)
    row.frameMedian.push(median(gaps))
    row.framesOver20.push((gaps.filter(g => g > 20).length / gaps.length) * 100)
    row.gaps.push(...gaps)
    process.stdout.write(`${ready}ms/${median(gaps).toFixed(1)}f `)
    await page.close()
  }
  out.push(row)
  process.stdout.write('\n')
}

await browser.close()

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/rowsweep.json',
  JSON.stringify({ loc: LOC, runs: RUNS, frames: FRAMES, out }, null, 2),
)

let md = '# Row-count sweep\n\n'
md += `Multi-sample variant matrix, 1000 Genomes phase 3 chr17 (\`${LOC}\`), `
md += `same variants and same window at every row count; only the number of `
md += `sample rows changes. Ready = nav→render-complete, median of ${RUNS}. `
md += `Frame = interval between consecutive animation-frame callbacks during a `
md += `${FRAMES}-frame pan that stays within loaded data (no refetch). The `
md += `instrument is vsync-paced, so 16.7 ms is its floor on a 60 Hz display.\n\n`
md += '| rows | ready (ms) | frame median (ms) | frame p90 | frame p99 | frames >20 ms |\n'
md += '|---:|---:|---:|---:|---:|---:|\n'
for (const r of out) {
  if (!r.ready.length) {
    md += `| ${r.rows} | — | — | — | — | — |\n`
    continue
  }
  md += `| ${r.rows} | ${median(r.ready).toFixed(0)} | ${median(r.frameMedian).toFixed(1)} | ${pct(r.gaps, 90).toFixed(1)} | ${pct(r.gaps, 99).toFixed(1)} | ${median(r.framesOver20).toFixed(0)}% |\n`
}
fs.writeFileSync('results/rowsweep.md', md)
console.log('\n' + md)

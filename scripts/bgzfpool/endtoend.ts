/**
 * Pan latency in jbrowse with the BGZF inflate pool on vs off, for BAM and for
 * tabix VCF.
 *
 * Setup, because this needs a build carrying both arms:
 *
 *   1. build jbrowse-web from a tree with the `useBgzfWorkerPool` config slot
 *      (BamAdapter, VcfTabixAdapter, Gff3TabixAdapter), stage it in builds/
 *   2. shell/load_alignments.sh, then shell/load_bgzf_tracks.sh <build>
 *      to add the indexed VCFs and the `.nopool` twins
 *   3. serve it on :8010, then
 *      `node --experimental-strip-types scripts/bgzfpool/endtoend.ts [reps]`,
 *      or a subset of the corpus with `TRACKS=1000x.longread.bam,...`
 *
 * Pan rather than cold load, for the reason crampool.ts records: a page load
 * re-pays app boot, chunk fetch and assembly resolution every run, ~2 s of
 * constant work the inflate is a slice of, and the cold-load instrument
 * measured 0.99x on the CRAM pool saying so.
 *
 * The pooled arm is verified rather than assumed. `getSharedWorkerPool()`
 * returns undefined wherever a Worker cannot be created and every read then
 * quietly inflates in process — no error, no failing test, just the speedup
 * gone. So each arm counts the `blob:` worker targets Chrome creates, and a
 * pooled arm that spawns none is a harness failure rather than a slow result.
 *
 * Linux only, through scripts/render/loadavg.ts, which reads /proc.
 */
import fs from 'fs'
import puppeteer from 'puppeteer'
import {
  FOREIGN_CORE_CEILING,
  loadavg,
  waitForQuiet,
  watchForeignCpu,
  type LoadWindow,
} from '../render/loadavg.ts'
import { DEFAULT_TRACKS, REF, TIMED, WINDOWS } from './windows.ts'

import type { Browser, Page, Target } from 'puppeteer'

const BASE = process.env.BASE ?? 'http://localhost:8010'
const REPS = Number(process.argv[2] ?? process.env.REPS ?? 5)
const TRACKS = (process.env.TRACKS ?? DEFAULT_TRACKS.join(',')).split(',')

function waitReady(page: Page, timeout = 120000) {
  return page.evaluate(async (timeoutMs: number) => {
    const deadline = performance.now() + timeoutMs
    let stable = 0
    for (;;) {
      const displays = document.querySelectorAll('[data-display-phase]').length
      const ready =
        displays > 0 &&
        document.querySelector('[data-display-phase="loading"]') === null &&
        document.querySelector('[data-display-drawn="false"]') === null
      stable = ready ? stable + 1 : 0
      if (stable >= 3) {
        return true
      }
      if (performance.now() > deadline) {
        return false
      }
      await new Promise(r => setTimeout(r, 40))
    }
  }, timeout)
}

interface ArmRun {
  times: number[]
  blobWorkers: number
}

async function panSeries(browser: Browser, trackId: string): Promise<ArmRun> {
  // Counted at the browser rather than the page: a pool worker is spawned by
  // the RPC worker, so it is a target nested one level below the page.
  let blobWorkers = 0
  const onTarget = (t: Target) => {
    if (t.url().startsWith('blob:')) {
      blobWorkers++
    }
  }
  browser.on('targetcreated', onTarget)
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  try {
    const [s0, e0] = WINDOWS[0]!
    await page.goto(
      `${BASE}/?loc=${REF}:${s0}-${e0}&assembly=hg19mod&tracks=${trackId}`,
      { waitUntil: 'domcontentloaded', timeout: 120000 },
    )
    if (!(await waitReady(page))) {
      throw new Error(`${trackId}: initial render never settled`)
    }
    const times: number[] = []
    for (const [start, end] of TIMED) {
      const ms = await page.evaluate(
        async (loc: string) => {
          const w = window as unknown as {
            JBrowseSession: {
              views: { navToLocString: (s: string) => void }[]
            }
          }
          const t0 = performance.now()
          w.JBrowseSession.views[0]!.navToLocString(loc)
          const deadline = t0 + 120000
          let stable = 0
          for (;;) {
            const displays =
              document.querySelectorAll('[data-display-phase]').length
            const ready =
              displays > 0 &&
              document.querySelector('[data-display-phase="loading"]') ===
                null &&
              document.querySelector('[data-display-drawn="false"]') === null
            stable = ready ? stable + 1 : 0
            if (stable >= 3) {
              return performance.now() - t0
            }
            if (performance.now() > deadline) {
              return -1
            }
            await new Promise(r => setTimeout(r, 20))
          }
        },
        `${REF}:${start}-${end}`,
      )
      times.push(ms as number)
    }
    // A failed pan stays in the series as -1 rather than being filtered out.
    // Dropping it shortens one arm and every later window then pairs with its
    // neighbour, so one timeout would quietly corrupt the ratios after it
    // instead of costing one pair.
    return { times, blobWorkers }
  } finally {
    browser.off('targetcreated', onTarget)
    await page.close()
  }
}

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]!
}

interface TrackResult {
  pooled: number[][]
  plain: number[][]
  ratios: number[]
  median: number
  p25: number
  p75: number
  blobWorkers: { pooled: number; plain: number }
  load: LoadWindow
}

const prior: { results?: Record<string, TrackResult>; measuredAt?: Record<string, string> } =
  fs.existsSync('results/bgzfpool.json')
    ? JSON.parse(fs.readFileSync('results/bgzfpool.json', 'utf8'))
    : {}

const results: Record<string, TrackResult> = { ...prior.results }
const measuredAt: Record<string, string> = { ...prior.measuredAt }
const stamp = new Date().toISOString().slice(0, 10)

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--window-size=1280,900'],
})

for (const track of TRACKS) {
  const quiet = waitForQuiet()
  if (quiet.waitedMs > 1500) {
    process.stdout.write(`[settled ${(quiet.waitedMs / 1000).toFixed(1)}s] `)
  }
  const before = loadavg()
  const cpu = watchForeignCpu()
  const pooled: number[][] = []
  const plain: number[][] = []
  const blobWorkers = { pooled: 0, plain: 0 }
  process.stdout.write(`${track}: `)
  for (let rep = 0; rep < REPS; rep++) {
    // ABBA rather than ABAB. Alternating cancels a constant difference between
    // the arms' conditions; it does not cancel a machine getting steadily
    // busier, which biases whichever arm runs second in every pair.
    const order = rep % 2 === 0 ? ['pooled', 'plain'] : ['plain', 'pooled']
    for (const arm of order) {
      const run = await panSeries(
        browser,
        arm === 'pooled' ? track : `${track}.nopool`,
      )
      if (arm === 'pooled') {
        pooled.push(run.times)
        blobWorkers.pooled = Math.max(blobWorkers.pooled, run.blobWorkers)
      } else {
        plain.push(run.times)
        blobWorkers.plain = Math.max(blobWorkers.plain, run.blobWorkers)
      }
      process.stdout.write(arm === 'pooled' ? 'P' : 'p')
    }
  }
  const { cores, top } = await cpu.done()
  const load = { before, after: loadavg(), foreignCores: cores, foreignTop: top }

  // Per-pair ratios, not a ratio of aggregates: the two arms of one rep ran
  // adjacent in time under the same conditions, and the same window index in
  // each arm is the same amount of work.
  const ratios: number[] = []
  for (let rep = 0; rep < Math.min(pooled.length, plain.length); rep++) {
    const a = pooled[rep]!
    const b = plain[rep]!
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i]! > 0 && b[i]! > 0) {
        ratios.push(b[i]! / a[i]!)
      }
    }
  }
  results[track] = {
    pooled,
    plain,
    ratios,
    median: med(ratios),
    p25: quantile(ratios, 0.25),
    p75: quantile(ratios, 0.75),
    blobWorkers,
    load,
  }
  measuredAt[track] = stamp
  process.stdout.write(
    ` => ${med(ratios).toFixed(2)}x [${quantile(ratios, 0.25).toFixed(2)}, ` +
      `${quantile(ratios, 0.75).toFixed(2)}] n=${ratios.length}, ` +
      `blob workers ${blobWorkers.pooled}/${blobWorkers.plain}, ` +
      `foreign ${cores.toFixed(2)} cores${top ? `: ${top}` : ''}\n`,
  )
  const failed = [...pooled, ...plain].flat().filter(t => t <= 0).length
  if (failed) {
    console.log(
      `  !! ${track}: ${failed} pan(s) never settled within 120 s and their ` +
        `pairs are dropped. On this corpus that is usually 1000x-longread on a ` +
        `box that is not idle.`,
    )
  }
  if (blobWorkers.pooled === 0) {
    console.log(
      `  !! ${track} pooled arm spawned NO blob: workers — the pool fell back ` +
        `to inflating in process and this row compares nothing. Check that ` +
        `the build has the useBgzfWorkerPool slot and that nested workers are ` +
        `available.`,
    )
  }
  if (blobWorkers.plain > 0) {
    console.log(
      `  !! ${track}.nopool spawned ${blobWorkers.plain} blob: workers — the ` +
        `twin did not disable the pool. Check the .nopool track's adapter.`,
    )
  }
}
await browser.close()

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/bgzfpool.json',
  JSON.stringify({ base: BASE, reps: REPS, windows: WINDOWS, measuredAt, results }, null, 2),
)

let md = `# BGZF worker pool, on vs off, end to end in jbrowse\n\n`
md += `Generated by \`scripts/bgzfpool/endtoend.ts\` — edit the script, not this file.\n\n`
md += `Paired pan latency over ${TIMED.length} non-overlapping 19 kb windows on `
md += `\`${REF}\`, ${REPS} reps per track alternated ABBA, ratio taken per pair `
md += `rather than between aggregates. Speedup above 1.0 means the pool is faster.\n\n`
md += `Two things invalidate a row and neither shows up in the ratio. **Foreign `
md += `cores** above ${FOREIGN_CORE_CEILING} means something else was using the machine. `
md += `**Blob workers** is how many \`blob:\` worker targets each arm spawned: `
md += `4/0 is the pool engaged in the pooled arm and off in the twin, and anything `
md += `else means the two arms were not different — \`getSharedWorkerPool()\` `
md += `returns undefined wherever a Worker cannot be created and every read then `
md += `quietly inflates in process, with no error and nothing failing.\n\n`
md += `What the pool can reach is measured separately by `
md += `\`scripts/bgzfpool/standalone.ts\`, which runs the same query over the same `
md += `windows with nothing above it. That is the ceiling this table is read `
md += `against; \`scripts/paperfigs/bgzfpool.R\` draws the two together.\n\n`
md += `| track | pooled median | in-process median | paired speedup | blob workers P/p | foreign cores |\n`
md += `| --- | ---: | ---: | --- | ---: | ---: |\n`
for (const track of Object.keys(results)) {
  const r = results[track]!
  const flat = (xss: number[][]) => xss.flat().filter(t => t > 0)
  const dirty = (r.load.foreignCores ?? Number.NaN) > FOREIGN_CORE_CEILING
  const sp = dirty
    ? '**unusable**'
    : `**${r.median.toFixed(2)}x** [${r.p25.toFixed(2)}, ${r.p75.toFixed(2)}] n=${r.ratios.length}`
  md += `| ${track} | ${med(flat(r.pooled)).toFixed(0)} ms | ${med(flat(r.plain)).toFixed(0)} ms | ${sp} `
  md += `| ${r.blobWorkers.pooled}/${r.blobWorkers.plain} `
  md += `| ${(r.load.foreignCores ?? Number.NaN).toFixed(2)} |\n`
}
fs.writeFileSync('results/bgzfpool.md', md)
console.log('\n' + md)
console.log('Wrote results/bgzfpool.json and results/bgzfpool.md')

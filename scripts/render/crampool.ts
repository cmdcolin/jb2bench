/**
 * Pan latency for a CRAM track, @gmod/cram's slice worker pool on vs off.
 *
 * Setup, because this one needs a build carrying both arms:
 *
 *   1. build jbrowse-web from a tree with the `useSliceWorkerPool` config slot
 *      (jbrowse-components >= the commit that added it), stage it in builds/
 *   2. load the assembly and the CRAM tracks into it (shell/load_alignments.sh,
 *      or `jbrowse add-track` for the few you want)
 *   3. add a `<trackId>.nopool` twin of each CRAM track to that build's
 *      config.json, identical except `"useSliceWorkerPool": false` on the
 *      adapter
 *   4. serve it on :8010, then
 *      `node --experimental-strip-types scripts/render/crampool.ts <track> [reps]`
 *
 * The twin is how the arms are isolated. The decode runs inside an RPC worker,
 * so nothing on the page can reach in and toggle it, and without the config slot
 * an A/B costs two full builds of jbrowse-web.
 *
 * The cold-load benchmark is the WRONG instrument for this and measured 0.99x
 * saying so: a page load re-pays app boot, chunk fetch and assembly resolution
 * every run, ~2 s of constant work that the decode is a slice of. A pan pays
 * none of it — the app is up, the assembly is resolved, the worker is warm and
 * its wasm is instantiated — so what is left is fetch + decode + convert +
 * draw, which is where a decode speedup can actually show.
 *
 * Each pan goes somewhere not yet visited. jbrowse caches decoded records per
 * region and raw bytes per 256 KiB chunk, so panning back over a window
 * measures a cache hit rather than a decode.
 */
import puppeteer from 'puppeteer'

import type { Browser, Page } from 'puppeteer'

const BASE = process.env.BASE ?? 'http://localhost:8010'
const TRACK = process.argv[2] ?? '1000x.shortread.cram'
const REPS = Number(process.argv[3] ?? 5)

// 19 kb windows marching along chr22_mask, none overlapping, so no pan is
// served from the previous one's cache
const WINDOWS = [
  [30000, 49000],
  [60000, 79000],
  [90000, 109000],
  [124000, 143000],
  [155000, 174000],
  [185000, 204000],
]

/** wait until every display is ready and stays that way */
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

async function panSeries(browser: Browser, trackId: string) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  try {
    const [s0, e0] = WINDOWS[0]!
    await page.goto(
      `${BASE}/?loc=chr22_mask:${s0}-${e0}&assembly=hg19mod&tracks=${trackId}`,
      { waitUntil: 'domcontentloaded', timeout: 120000 },
    )
    if (!(await waitReady(page))) {
      throw new Error('initial render never settled')
    }

    const times: number[] = []
    for (const [start, end] of WINDOWS.slice(1)) {
      const ms = await page.evaluate(
        async (loc: string) => {
          const w = window as unknown as {
            JBrowseSession: {
              views: { navToLocString: (s: string) => void }[]
            }
          }
          const t0 = performance.now()
          w.JBrowseSession.views[0]!.navToLocString(loc)
          // the display goes back to loading, then returns; wait for the return
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
        `chr22_mask:${start}-${end}`,
      )
      times.push(ms as number)
    }
    return times.filter(t => t > 0)
  } finally {
    await page.close()
  }
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--window-size=1280,900'],
})

const acc: Record<string, number[]> = { pooled: [], plain: [] }
for (let rep = 0; rep < REPS; rep++) {
  // interleaved, so machine drift lands in both arms and not in the ratio
  acc.pooled!.push(...(await panSeries(browser, TRACK)))
  acc.plain!.push(...(await panSeries(browser, `${TRACK}.nopool`)))
}
await browser.close()

const best = (xs: number[]) => Math.min(...xs)
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}
console.log(`${TRACK}  ${REPS} reps x ${WINDOWS.length - 1} pans each\n`)
console.log(
  `pooled      best ${best(acc.pooled!).toFixed(0)}ms  median ${med(acc.pooled!).toFixed(0)}ms  n=${acc.pooled!.length}`,
)
console.log(
  `in-process  best ${best(acc.plain!).toFixed(0)}ms  median ${med(acc.plain!).toFixed(0)}ms  n=${acc.plain!.length}`,
)
console.log(
  `\nspeedup  best ${(best(acc.plain!) / best(acc.pooled!)).toFixed(2)}x   median ${(
    med(acc.plain!) / med(acc.pooled!)
  ).toFixed(2)}x`,
)

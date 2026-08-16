// Calibrate the completion detectors against each other, on real pages.
//
// Every timing here is an answer to "when is it finished", and the detector has
// broken more often than the thing being measured. `quiescence.ts` lists the
// three strategies and how each fails; this measures the disagreement between
// them so a report can state it instead of a method section asserting that one
// is right.
//
// What it reports per page:
//
//   screenshot cost  — what one `page.screenshot()` costs on this page right
//                      now, and the `paint` floor that follows. This is the
//                      number that disqualifies paint for interactions: 43 to
//                      161 ms observed, a floor of 450 to 1100 ms, against
//                      interactions of about that length. It is a property of
//                      the machine rather than of the page — the two harnesses
//                      have swapped places between runs — so it is measured
//                      every time rather than assumed from a previous run.
//   cold load        — draws vs paint on the initial render, where both apply.
//                      The gap is the compositor plus the detector's floor, and
//                      it is the thing `results/crosstool.md` calls "a
//                      consistent offset, applied to both columns".
//   one interaction  — draws vs paint on a single pan, where paint is expected
//                      to be at or near its floor and therefore meaningless.
//
// Usage:
//   node scripts/crosstool/quiescheck.ts            # both harnesses
//   TOOLS=igv node scripts/crosstool/quiescheck.ts
//   RUNS=3 node scripts/crosstool/quiescheck.ts
import fs from 'fs'
import puppeteer from 'puppeteer'

import { loadavg } from '../render/loadavg.ts'
import { attachQuiescence, paintFloorMs, type Settled } from './quiescence.ts'

const RUNS = Number(process.env.RUNS ?? 2)
const LOC = 'chr22_mask:124000-143000'
const TRACK = process.env.TRACK ?? '20x.shortread.bam'
const JBROWSE_PORT = Number(process.env.JBROWSE_PORT ?? 8000)
const IGV_PORT = Number(process.env.IGV_PORT ?? 8003)
const WIDTH = 19000
const START = 124000

interface Harness {
  id: string
  url: string
  ready: string
  pan: (target: string) => string
}

const allHarnesses: Harness[] = [
  {
    id: 'jbrowse',
    url: `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACK}&renderer=webgl`,
    ready:
      'window.JBrowseSession && window.JBrowseSession.views && window.JBrowseSession.views.length > 0',
    pan: () =>
      'const v = window.JBrowseSession.views[0]; v.horizontalScroll(-v.width); true',
  },
  {
    id: 'igv',
    url: `http://localhost:${IGV_PORT}/index.html?track=${TRACK}&loc=${LOC}`,
    ready: 'window.__igvState && (window.__igvState.ready || window.__igvState.error)',
    pan: target => `window.igvBrowser.search(${JSON.stringify(target)}); true`,
  },
]

const filter = process.env.TOOLS?.split(',')
const harnesses = filter ? allHarnesses.filter(h => filter.includes(h.id)) : allHarnesses

interface Observation {
  harness: string
  phase: 'load' | 'pan'
  strategy: string
  ms: number
  events: number
  atFloor: boolean
}

const observations: Observation[] = []
const shotCosts: Record<string, number[]> = {}

/**
 * One page load, measured with one strategy.
 *
 * Each strategy gets its own page load rather than sharing one, because `paint`
 * is an active detector: its screenshots cost CPU and would perturb whatever ran
 * alongside it. That is the same reason the detectors cannot simply be run
 * simultaneously and diffed.
 */
async function measure(h: Harness, strategy: 'draws' | 'paint') {
  const browser = await puppeteer.launch({
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
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    const q = await attachQuiescence(page)

    // No mark before the first navigation: the draw clock stamps its own start
    // when the document is created, which for a cold load is what we want.
    const t0 = Date.now()
    await page.goto(h.url, { waitUntil: 'domcontentloaded' })
    const blank = strategy === 'paint' ? await q.reference() : ''
    await page.waitForFunction(h.ready, { timeout: 180000, polling: 200 })

    const load = await q.settle(strategy, t0, blank)
    observations.push({
      harness: h.id,
      phase: 'load',
      strategy,
      ms: load.ms,
      events: load.events,
      atFloor: load.atFloor,
    })

    // Screenshot cost is a property of the page once it has drawn, so measure it
    // here rather than on a blank page.
    ;(shotCosts[h.id] ??= []).push(await q.screenshotCost())

    const ref = strategy === 'paint' ? await q.reference() : ''
    const target = `chr22_mask:${START - WIDTH}-${START}`
    const t1 = await q.mark()
    await page.evaluate(h.pan(target))
    const pan = await q.settle(strategy, t1, ref)
    observations.push({
      harness: h.id,
      phase: 'pan',
      strategy,
      ms: pan.ms,
      events: pan.events,
      atFloor: pan.atFloor,
    })
  } finally {
    await browser.close()
  }
}

const loads: number[] = [loadavg()]
for (let r = 0; r < RUNS; r++) {
  for (const h of harnesses) {
    for (const strategy of ['draws', 'paint'] as const) {
      loads.push(loadavg())
      try {
        await measure(h, strategy)
        console.log(`${h.id} ${strategy} run ${r + 1}: ok`)
      } catch (e) {
        console.log(`${h.id} ${strategy} run ${r + 1}: ${String(e).split('\n')[0]}`)
      }
    }
  }
}

const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1]! : Number.NaN

const pick = (harness: string, phase: string, strategy: string) =>
  median(
    observations
      .filter(o => o.harness === harness && o.phase === phase && o.strategy === strategy)
      .map(o => o.ms),
  )

const peakLoad = Math.max(...loads)

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/quiescence.json',
  JSON.stringify(
    {
      runs: RUNS,
      track: TRACK,
      measured: new Date().toISOString().slice(0, 10),
      loadPeak: peakLoad,
      screenshotCostMs: Object.fromEntries(
        Object.entries(shotCosts).map(([k, v]) => [k, median(v)]),
      ),
      observations,
    },
    null,
    2,
  ),
)

const md: string[] = [
  '# Which completion detector, and what it costs to be wrong',
  '',
  `Generated by \`scripts/crosstool/quiescheck.ts\`, ${RUNS} runs, track`,
  `\`${TRACK}\`, window \`${LOC}\`.`,
  '',
  'Every timing in this repository answers "when is it finished", and the',
  'detector has broken more often than the thing being measured — see the',
  'zoom-out benchmark that scored a refusal to draw as its best result, and the',
  'release-2.4.0 column that read 0 ms on every case because its loading',
  'indicator says `Loading` where the pattern looked for `Downloading`. This',
  'measures the detectors against each other rather than asserting one is right.',
  '',
  '## What a screenshot costs, per page',
  '',
  'This is the number that disqualifies screenshot polling for interactions. The',
  '`paint` detector needs `stablePolls + 1` samples at best, so its floor is',
  'roughly `6 x (pollMs + screenshot)` minus the settle window it subtracts.',
  '',
  '| harness | screenshot | paint floor |',
  '| --- | ---: | ---: |',
  ...Object.entries(shotCosts).map(([id, v]) => {
    const c = median(v)
    return `| ${id} | ${c.toFixed(0)} ms | ${paintFloorMs(c).toFixed(0)} ms |`
  }),
  '',
  'These figures move between runs and the two harnesses have swapped places, so',
  'read this as a property of the machine rather than of either page. Either way',
  'a floor in the hundreds of milliseconds is a small share of a multi-second',
  'cold load and most of a pan, which is the whole point.',
  '',
  '## draws against paint',
  '',
  '`draws` times the last canvas draw call before the page goes quiet with',
  'nothing in flight. `paint` waits for the screen to stop changing.',
  '',
  '**The obvious story about the sign of the gap is wrong.** A draw call precedes',
  'the compositor, so draws ought to read early — and on a JBrowse cold load it',
  'does not, because the page goes on issuing draw calls after the visible result',
  'has settled. That row is the reason this harness exists: both detectors are',
  'defensible and they disagree by seconds, so the disagreement has to be',
  'measured rather than reasoned about.',
  '',
  '| harness | phase | draws | paint | gap |',
  '| --- | --- | ---: | ---: | ---: |',
]

for (const h of harnesses) {
  for (const phase of ['load', 'pan'] as const) {
    const d = pick(h.id, phase, 'draws')
    const p = pick(h.id, phase, 'paint')
    const atFloor = observations.some(
      o => o.harness === h.id && o.phase === phase && o.strategy === 'paint' && o.atFloor,
    )
    const gap = Number.isFinite(d) && Number.isFinite(p) ? `${(p - d).toFixed(0)} ms` : '—'
    md.push(
      `| ${h.id} | ${phase} | ${Number.isFinite(d) ? `${d.toFixed(0)} ms` : '—'} | ` +
        `${Number.isFinite(p) ? `${p.toFixed(0)} ms${atFloor ? ' \\*' : ''}` : '—'} | ${gap} |`,
    )
  }
}

md.push(
  '',
  '`\\*` marks a `paint` figure that resolved in the detector\'s minimum number of',
  'polls. Those are not measurements of the page; they are measurements of the',
  'detector, and the pan rows are where that shows up.',
  '',
  'The `pan` rows here are **one step from the benchmark locus**, which for',
  'JBrowse is usually served from the 256 KiB block it already holds — hence a',
  'draws figure in single-digit milliseconds. That is a real property and not an',
  'error, but it makes these rows a detector comparison rather than a tool',
  'comparison. `results/crosstool-pan.md` is the tool comparison, and it counts',
  'requests per step so it can exclude the cached ones.',
  '',
  peakLoad > 4
    ? `> Peak 1-minute load during this run was ${peakLoad.toFixed(1)}, above the 4.0 ` +
      'ceiling. The screenshot-cost column and the *direction* of the gap survive ' +
      'that; the individual milliseconds do not.'
    : `Peak 1-minute load during this run: ${peakLoad.toFixed(1)}.`,
  '',
  '## What follows for the rest of this repository',
  '',
  '- Cold-load comparisons may keep using `paint`: the floor is a small share of',
  '  a multi-second load, and `results/crosstool.md` already treats the offset as',
  '  a constant applied to both columns.',
  '- **Interaction comparisons must not.** `results/crosstool-pan.md` uses',
  '  `draws` plus a network gate for this reason.',
  '- Anything measuring an interaction by screenshot polling inherits the bias,',
  '  and `results/crosstool-zoom.md` is the standing example of what that looks',
  '  like from the outside.',
  '',
)

fs.writeFileSync('results/quiescence.md', md.join('\n'))
console.log('\nwrote results/quiescence.md and results/quiescence.json')

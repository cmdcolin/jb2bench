// Does the 500 ms coarse tick actually change the coverage stats?
//
// agent-docs/reference/INTERACTION_PERF.md leaves one count open, and it decides
// whether a value-equality memo on `coverageStats` is worth writing: during a
// pan, how often do two consecutive coarse ticks produce EQUAL stats? If they
// usually differ, the memo never fires and the chain repaints anyway.
//
// Samples per animation frame rather than hooking MobX, and compares VALUES
// rather than object identity — a MobX computed read from outside a reactive
// context re-evaluates on every access, so an identity test from here would
// report "always changed" whatever the truth is.
//
//   PORT=8020 TRACKS=... node scripts/render/coarsetick.probe.ts
//
// WHAT IT SAYS, 6 tracks at chr22_mask:124000-143000, 360 frames, 2026-08-14:
//
//   4 coarse ticks over the gesture, 6 displays
//   at a tick the stats were EQUAL 0 of 24, changed 24 of 24 (100%)
//   every display took exactly 5 distinct stat values = initial + 4 changes
//
// So the memo is dead: it has no case to fire in. That is not a near miss, it is
// zero, and in hindsight it is what the tick IS — the coarse blocks update only
// once the view has moved far enough to warrant it, so a new coarse window covers
// different data and min/max/mean move with it. A stationary view does not tick
// at all (MobX caches the computed), so there is no third state where the values
// repeat.
//
// Two other things it confirms in passing: 4 ticks over ~2.2 s of frames is the
// ~500 ms period again, arrived at by a completely different route than the
// frame-gap analysis in INTERACTION_PERF.md; and the per-tick recompute is
// therefore WARRANTED work rather than redundant work, so anything that wants to
// make the tick cheaper has to stagger it or make the repaint cheaper, not
// suppress it.
import puppeteer from 'puppeteer'

const PORT = Number(process.env.PORT ?? 8020)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const FRAMES = Number(process.env.FRAMES ?? 360)
const TRACKS = (
  process.env.TRACKS ??
  [
    '20x.shortread.bam',
    '200x.shortread.bam',
    '20x.longread.bam',
    '200x.longread.bam',
    '20x.longread.mod.bam',
    '200x.longread.mod.bam',
  ].join(',')
).split(',')

// Same launch options multibam.ts uses — the GPU flags are not optional here,
// a bare launch crashes on this box.
const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
const errors: string[] = []
page.on('pageerror', (e: unknown) =>
  errors.push(e instanceof Error ? e.message : String(e)),
)

await page.goto(
  `http://localhost:${PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACKS.join(',')}&renderer=webgl`,
  { waitUntil: 'load' },
)

await page.waitForFunction(
  (n: number) => {
    const s = (globalThis as any).JBrowseSession
    if (!s) {
      return false
    }
    const v = s.views?.[0]
    if (!v?.tracks || v.tracks.length < n) {
      return false
    }
    return v.tracks.every((t: any) => {
      const d = t.displays?.[0]
      return d && (d.rpcDataMap?.size > 0 || d.error)
    })
  },
  { timeout: 180000, polling: 200 },
  TRACKS.length,
)

const samples = await page.evaluate(async (frames: number) => {
  const w = globalThis as any
  const v = w.JBrowseSession.views[0]
  const displays = v.tracks
    .map((t: any) => t.displays?.[0])
    .filter((d: any) => d && 'coverageStats' in d)

  const out: { coarse: string; stats: string[] }[] = []
  const PAN_PX = 10
  await new Promise<void>(resolve => {
    let i = 0
    const step = () => {
      const dir = Math.floor(i / 30) % 2 === 0 ? 1 : -1
      v.horizontalScroll(dir * PAN_PX)
      // The coarse block set the stats getter reads. Recorded as a value so a
      // tick is detectable without hooking MobX.
      const coarse = (v.coarseDynamicBlocks ?? [])
        .map((b: any) => `${b.refName}:${b.start}-${b.end}`)
        .join('|')
      const stats = displays.map((d: any) => {
        const s = d.coverageStats
        return s
          ? `${s.scoreMin},${s.scoreMax},${s.scoreMean.toFixed(6)},${s.scoreStdDev.toFixed(6)}`
          : 'none'
      })
      out.push({ coarse, stats })
      i++
      if (i >= frames) {
        resolve()
      } else {
        requestAnimationFrame(step)
      }
    }
    requestAnimationFrame(step)
  })
  return { out, nDisplays: displays.length }
}, FRAMES)

await browser.close()

const { out, nDisplays } = samples
// A tick is a frame where the coarse block set changed.
const tickFrames: number[] = []
for (let i = 1; i < out.length; i++) {
  if (out[i]!.coarse !== out[i - 1]!.coarse) {
    tickFrames.push(i)
  }
}

let equalAtTick = 0
let changedAtTick = 0
const perDisplayEqual = new Array(nDisplays).fill(0)
const perDisplayChanged = new Array(nDisplays).fill(0)
for (const f of tickFrames) {
  for (let d = 0; d < nDisplays; d++) {
    const before = out[f - 1]!.stats[d]
    const after = out[f]!.stats[d]
    if (before === after) {
      equalAtTick++
      perDisplayEqual[d]++
    } else {
      changedAtTick++
      perDisplayChanged[d]++
    }
  }
}

// How many DISTINCT stat values each display took across the whole gesture —
// the ceiling on how much a memo could ever suppress.
const distinct = new Array(nDisplays).fill(0).map((_, d) => {
  const seen = new Set(out.map(o => o.stats[d]))
  return seen.size
})

const total = equalAtTick + changedAtTick
console.log(
  `coarse-tick coverage stats, ${TRACKS.length} tracks at ${LOC}\n` +
    `  ${out.length} frames sampled, ${nDisplays} displays with coverageStats\n` +
    `  ${tickFrames.length} coarse ticks (frames where coarseDynamicBlocks changed)\n\n` +
    `  at a tick, the stats were:\n` +
    `    EQUAL to the previous frame    ${equalAtTick} of ${total}  ` +
    `(${total ? ((100 * equalAtTick) / total).toFixed(0) : '-'}%)  <- a value-equality memo suppresses these\n` +
    `    changed                        ${changedAtTick} of ${total}  ` +
    `(${total ? ((100 * changedAtTick) / total).toFixed(0) : '-'}%)\n\n` +
    `  per display, equal/changed at ticks, and distinct stat values over the gesture:\n` +
    perDisplayEqual
      .map(
        (e, d) =>
          `    display ${d}: ${e}/${perDisplayChanged[d]}  ` +
          `${distinct[d]} distinct values across ${out.length} frames`,
      )
      .join('\n') +
    (errors.length ? `\n\n  page errors: ${errors.slice(0, 3).join(' | ')}` : ''),
)

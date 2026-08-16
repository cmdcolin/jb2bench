// Multi-track interaction benchmark: how much slower does the app feel when a
// user has SEVERAL bam tracks open at once, rather than the one track every
// other benchmark here opens?
//
// This is the workload the rest of the repo does not cover. runner.ts and
// runner-interaction.ts both open exactly one track, so every number they
// produce is a per-track cost measured in isolation. A real session has a
// stack: normal + one or two long-read + a modBAM, all reacting to the same
// gesture. Whether that is N times one track's cost or worse than N times is
// the question, and it is answerable only by sweeping N with everything else
// held fixed.
//
// The metric is the rAF frame gap during a sustained, rAF-paced gesture that
// stays WITHIN already-loaded data, so no step refetches and what is measured
// is re-render/re-project cost rather than network. Reported as median/p90/p99
// plus the share of frames over 20 ms, which is the number a user feels.
//
// Held fixed across the sweep: region, zoom, viewport, gesture, frame count.
// The only thing that varies is how many tracks are open.
//
// Usage:
//   node scripts/render/multibam.ts
//   MODE=zoom node scripts/render/multibam.ts
//   COUNTS=1,4 TRACKS=... node scripts/render/multibam.ts
import puppeteer from 'puppeteer'
import type { Browser, CDPSession, Page } from 'puppeteer'
import fs from 'fs'
import { loadavg, peak } from './loadavg.ts'
import { resolveBuild } from './servedbuild.ts'

// One or two builds. Two ports turns the sweep into an A/B, and the arms are
// interleaved WITHIN a pass rather than run one after the other — on this box
// the load moves by more between two consecutive runs than most optimizations
// are worth, so a before/after taken minutes apart is not evidence. Same
// reasoning as runner.ts, which measures every build inside each case.
const PORTS = (process.env.PORTS ?? process.env.PORT ?? '8020')
  .split(',')
  .map(Number)
const PORT = PORTS[0]!
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const MODE = process.env.MODE ?? 'pan'
const FRAMES = Number(process.env.FRAMES ?? 240)
const PASSES = Number(process.env.PASSES ?? 3)
const THROTTLE = Number(process.env.THROTTLE ?? 1)

// The stack a heavy user actually has open, ordered so that a prefix of length
// n is a sensible session in its own right: the two everyday short-read tracks
// first, then long reads, then the modification track. COUNTS indexes into
// this, so counts=1,2,4,6 all describe real sessions rather than arbitrary
// subsets.
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

const COUNTS = (process.env.COUNTS ?? '1,2,4,6')
  .split(',')
  .map(Number)
  .filter(n => n > 0 && n <= TRACKS.length)

const WAIT_TIMEOUT = 120000

interface FrameStats {
  frames: number
  median: number
  p90: number
  p99: number
  max: number
  overBudgetPct: number
}

function stats(gaps: number[]): FrameStats {
  const sorted = [...gaps].sort((a, b) => a - b)
  const pct = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? NaN
  const over = gaps.filter(g => g > 20).length
  return {
    frames: gaps.length,
    median: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
    max: gaps.length ? Math.max(...gaps) : NaN,
    overBudgetPct: gaps.length ? (100 * over) / gaps.length : NaN,
  }
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

// The same dual-contract wait profile.ts uses. A build from current main
// publishes data-display-phase and NO legacy -done markers, so a marker-only
// wait finds nothing and times out at 120 s; guessing the other way returns
// immediately and reports a perfect score for a page that drew nothing.
async function waitForRender(page: Page, expected: number) {
  await page.waitForFunction(
    () => {
      const session = (
        globalThis as { JBrowseSession?: { views?: { initialized?: boolean }[] } }
      ).JBrowseSession
      const views = session?.views
      return !!views?.length && !views.some(v => v.initialized === false)
    },
    { timeout: WAIT_TIMEOUT, polling: 100 },
  )
  await page.waitForFunction(
    ({ stableNeeded, expected }: { stableNeeded: number; expected: number }) => {
      const w = window as unknown as { __stable?: number; __last?: number }
      const phaseNodes = document.querySelectorAll('[data-display-phase]').length
      const legacyNodes = document.querySelectorAll(
        '[data-testid$="-done"],[data-testid$="_done"]',
      ).length
      let ready: boolean
      let count: number
      if (phaseNodes > 0) {
        count = phaseNodes
        ready =
          document.querySelector('[data-display-phase="loading"]') === null &&
          document.querySelector('[data-display-drawn="false"]') === null
      } else if (legacyNodes > 0) {
        count = legacyNodes
        ready = true
      } else {
        w.__stable = 0
        w.__last = -1
        return false
      }
      // Every requested track must have mounted a display, not just one of
      // them: with N tracks opening at once the first to finish would
      // otherwise satisfy a bare "nothing is loading" check while the rest are
      // still between phases, and the gesture would then be measured against a
      // partly-empty stack.
      if (count < expected) {
        w.__stable = 0
        w.__last = count
        return false
      }
      ready =
        ready &&
        document.querySelectorAll('[data-testid="loading-overlay"]').length === 0
      if (ready && count === w.__last) {
        w.__stable = (w.__stable ?? 0) + 1
      } else {
        w.__stable = 0
        w.__last = count
      }
      return ready && (w.__stable ?? 0) >= stableNeeded
    },
    { timeout: WAIT_TIMEOUT, polling: 100 },
    { stableNeeded: 5, expected },
  )
}

// Drives the gesture from inside the page across animation frames and returns
// the rAF timestamps' gaps. Oscillates so the view stays inside loaded data:
// a step that walked off it would measure a fetch, which is what
// runner-interaction.ts measures and this deliberately does not.
async function gesture(page: Page, mode: string, frames: number) {
  return page.evaluate(
    async ({ mode, frames }) => {
      const w = window as unknown as {
        JBrowseSession: {
          views: {
            horizontalScroll: (n: number) => void
            bpPerPx: number
            zoomTo: (n: number) => void
            tracks?: { displays: { setScrollTop?: (n: number) => void }[] }[]
          }[]
        }
      }
      const v = w.JBrowseSession.views[0]!
      const ts: number[] = []
      const PAN_PX = 10
      const SCROLL_PX = 12
      const bp0 = v.bpPerPx
      const ZOOM_PERIOD = 60
      const scrollTops = new Map<number, number>()
      await new Promise<void>(resolve => {
        let i = 0
        const step = () => {
          ts.push(performance.now())
          const dir = Math.floor(i / 30) % 2 === 0 ? 1 : -1
          if (mode === 'pan' || mode === 'both') {
            v.horizontalScroll(dir * PAN_PX)
          }
          if (mode === 'zoom') {
            const phase = (i % ZOOM_PERIOD) / ZOOM_PERIOD
            const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2
            v.zoomTo(bp0 * (1 - 0.75 * tri))
          }
          if (mode === 'scroll' || mode === 'both') {
            // scroll EVERY open display, not just the first: a user dragging
            // the pileup scrollbar moves one, but the point of this benchmark
            // is what N tracks cost, and only touching track 0 would make the
            // sweep flat by construction.
            v.tracks?.forEach((t, k) => {
              const d = t.displays[0]
              if (d?.setScrollTop) {
                const next = Math.max(0, (scrollTops.get(k) ?? 0) + dir * SCROLL_PX)
                scrollTops.set(k, next)
                d.setScrollTop(next)
              }
            })
          }
          i++
          if (i >= frames) {
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
    },
    { mode, frames },
  )
}

// PROFILE=<label> captures a V8 CPU profile of the *same* gesture this
// benchmark times, rather than of a separately-driven one. Keeping them the
// same run matters: a trace taken from a differently-paced gesture attributes
// time to whatever that gesture did, and the frame numbers above would then be
// evidence for a hotspot they never saw. Workers are attached too, so a pan
// that turns out to refetch is visible as worker time rather than silently
// inflating the main thread's neighbours.
async function armProfilers(page: Page) {
  const client = await page.target().createCDPSession()
  const connection = client.connection()!
  const profilers: { id: string; session: CDPSession }[] = []
  await client.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  })
  client.on('Target.attachedToTarget', event => {
    const { sessionId, targetInfo } = event
    const session = connection.session(sessionId)
    void (async () => {
      if (
        session &&
        (targetInfo.type === 'worker' || targetInfo.type === 'shared_worker')
      ) {
        try {
          await session.send('Profiler.enable')
          await session.send('Profiler.setSamplingInterval', { interval: 200 })
          // `Profiler.start`, not just enable+interval. Without it `stop` fails
          // with "No recording profiles found" and the thread reports nothing —
          // which looks exactly like a thread that is cheap. Every worker
          // number this repo has for an interaction was that.
          await session.send('Profiler.start')
          const tag = (targetInfo.url || 'worker').split('/').pop()
          profilers.push({ id: `worker${profilers.length}-${tag}`, session })
        } catch {
          // a worker that went away between attach and arm is not an error
        }
      }
      await session?.send('Runtime.runIfWaitingForDebugger').catch(() => {})
    })()
  })
  return { client, profilers }
}

async function measure(
  browser: Browser,
  n: number,
  port: number,
  profileLabel?: string,
) {
  const tracks = TRACKS.slice(0, n)
  const url =
    `http://localhost:${port}/?loc=${LOC}&assembly=hg19mod` +
    `&tracks=${tracks.join(',')}&renderer=webgl`
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const errors: string[] = []
  page.on('pageerror', (e: unknown) =>
    errors.push(e instanceof Error ? e.message : String(e)),
  )

  const armed = profileLabel ? await armProfilers(page) : undefined

  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await waitForRender(page, n)
  const readyMs = Date.now() - t0 - 500
  const client = armed?.client ?? (await page.target().createCDPSession())
  if (THROTTLE > 1) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
  }
  // Arm the main thread AFTER the cold render, so the profile is the
  // interaction window and not the load.
  //
  // The workers have been recording since they attached, because a worker
  // spawned mid-load cannot be armed after it. Their cold-load window is worth
  // keeping — it is the fetch and extract path — so it is stopped and saved
  // under `.load.`, and each worker is restarted so its second window lines up
  // with the main thread's.
  if (armed) {
    for (const p of armed.profilers) {
      try {
        const { profile } = (await p.session.send('Profiler.stop')) as {
          profile: { samples?: unknown[] }
        }
        fs.mkdirSync('flame', { recursive: true })
        fs.writeFileSync(
          `flame/${profileLabel}.load.${p.id}.cpuprofile`,
          JSON.stringify(profile),
        )
        await p.session.send('Profiler.start')
      } catch {
        // a worker that finished its work and exited has nothing to restart
      }
    }
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 200 })
    await client.send('Profiler.start')
    armed.profilers.push({ id: 'main', session: client })
  }

  const gaps = await gesture(page, MODE, FRAMES)

  if (armed && profileLabel) {
    fs.mkdirSync('flame', { recursive: true })
    for (const p of armed.profilers) {
      try {
        const { profile } = (await p.session.send('Profiler.stop')) as {
          profile: { samples?: unknown[] }
        }
        const file = `flame/${profileLabel}.${p.id}.cpuprofile`
        fs.writeFileSync(file, JSON.stringify(profile))
        console.log(`  saved ${file} (${profile.samples?.length ?? 0} samples)`)
      } catch (e) {
        console.error(`  stop failed ${p.id}:`, e instanceof Error ? e.message : e)
      }
    }
  }
  await page.close()
  return { url, readyMs, gaps, errors }
}

// Unpaced by default. With vsync on, the rAF gap floors at 16.7 ms, so a row
// that finishes its frame in 4 ms and one that finishes in 16 ms both read
// 16.7 and the light end of the sweep is flat by construction — which
// *understates* the multi-track penalty rather than inventing it. VSYNC=1
// restores the paced instrument, which is the one that answers "what does the
// user see" once the cost is already over budget. rowsweep.ts made the same
// choice for the same reason.
const vsyncArgs =
  process.env.VSYNC === '1'
    ? ['--vsync=on']
    : ['--disable-gpu-vsync', '--disable-frame-rate-limit']

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
    ...vsyncArgs,
  ],
})

interface Row {
  n: number
  port: number
  build: string
  tracks: string[]
  readyMs: number[]
  frame: FrameStats
  passes: FrameStats[]
  /** raw per-frame gaps, one array per pass, rounded to 0.1 ms */
  gaps: number[][]
  load: { before: number; after: number }
  errors: string[]
}
const rows: Row[] = []

// Name each port by the build it is actually serving, rather than by the order
// the ports were listed. servedbuild.ts matches the served index.html's
// content-hashed bundle against builds/*/index.html and aborts on one it does
// not recognize — the alternative is a table whose column headers are a guess,
// which has already produced a result attributed to the wrong build here once.
const buildOf = new Map<number, string>()
for (const port of PORTS) {
  buildOf.set(port, await resolveBuild(port))
  console.log(`port ${port} is serving builds/${buildOf.get(port)}`)
}

// Passes are interleaved across track counts AND across builds, and the track
// order alternates pass to pass, so a load spike on this shared box cannot line
// up with one column. Same reasoning as rowsweep.ts; the box is shared with
// other agents and contention is the dominant error term on any per-frame
// number measured here.
const order: { n: number; port: number }[] = []
for (let p = 0; p < PASSES; p++) {
  for (const n of p % 2 === 0 ? COUNTS : [...COUNTS].reverse()) {
    for (const port of PORTS) {
      order.push({ n, port })
    }
  }
}

interface Slot {
  readyMs: number[]
  gaps: number[][]
  errors: string[]
  load: { before: number; after: number }
}
const key = (n: number, port: number) => `${port}:${n}`
const slots = new Map<string, Slot>()
for (const port of PORTS) {
  for (const n of COUNTS) {
    slots.set(key(n, port), {
      readyMs: [],
      gaps: [],
      errors: [],
      load: { before: 0, after: 0 },
    })
  }
}

// PROFILE=<label> traces only the LAST pass, so the earlier passes stay
// untraced and the frame numbers are not the profiler's.
const profileLabel = process.env.PROFILE
const lastPassStart = order.length - COUNTS.length * PORTS.length

let step = 0
for (const { n, port } of order) {
  const slot = slots.get(key(n, port))!
  const before = loadavg()
  process.stdout.write(`${buildOf.get(port)} n=${n}: `)
  const label =
    profileLabel && step >= lastPassStart
      ? `${profileLabel}-${buildOf.get(port)}-n${n}`
      : undefined
  step++
  const r = await measure(browser, n, port, label)
  slot.readyMs.push(r.readyMs)
  slot.gaps.push(r.gaps)
  slot.errors.push(...r.errors)
  slot.load = {
    before: slot.load.before ? Math.min(slot.load.before, before) : before,
    after: Math.max(slot.load.after, loadavg()),
  }
  const s = stats(r.gaps)
  process.stdout.write(
    `ready ${r.readyMs}ms  frame median ${s.median.toFixed(1)}ms ` +
      `p90 ${s.p90.toFixed(1)}ms  over-budget ${s.overBudgetPct.toFixed(0)}%\n`,
  )
}

for (const port of PORTS) {
  for (const n of COUNTS) {
    const slot = slots.get(key(n, port))!
    rows.push({
      n,
      port,
      build: buildOf.get(port)!,
      tracks: TRACKS.slice(0, n),
      readyMs: slot.readyMs,
      // Pool the passes for the headline figure, but keep each pass so one
      // contended pass is visible instead of averaged in.
      frame: stats(slot.gaps.flat()),
      passes: slot.gaps.map(stats),
      // The raw per-frame gaps, one array per pass, rounded to 0.1 ms. The
      // summaries above cannot say WHEN a spike happened, and "is the p99 a
      // thundering herd?" — do the over-budget frames recur on the 500 ms
      // coarse-update grid, or are they scattered? — is entirely a question
      // about that. A pass is ~240 numbers, so keeping them costs a few KB and
      // saves re-running the sweep to ask.
      gaps: slot.gaps.map(g => g.map(v => Math.round(v * 10) / 10)),
      load: slot.load,
      errors: [...new Set(slot.errors)],
    })
  }
}

await browser.close()

const out = {
  mode: MODE,
  loc: LOC,
  frames: FRAMES,
  passes: PASSES,
  throttle: THROTTLE,
  vsync: process.env.VSYNC === '1',
  ports: PORTS,
  builds: Object.fromEntries(buildOf),
  measuredAt: new Date().toISOString(),
  rows,
}
fs.mkdirSync('results', { recursive: true })
const suffix = MODE + (THROTTLE > 1 ? `-t${THROTTLE}` : '')
fs.writeFileSync(
  `results/multibam-${suffix}.json`,
  JSON.stringify(out, null, 2),
)

const base = rows[0]
let md = `# Multi-track interaction cost (${MODE}${THROTTLE > 1 ? `, ${THROTTLE}x CPU throttle` : ''})\n\n`
md += `Region \`${LOC}\`, ${FRAMES} rAF-paced frames x ${PASSES} passes per row, `
md += `viewport 1280x900. The gesture stays inside already-loaded data, so no row refetches: `
md += `this is re-render cost, not network. \`over budget\` is the share of frames whose gap exceeded 20 ms.\n\n`
md += process.env.VSYNC === '1'
  ? `Frames are **vsync-paced**, so the gap floors at 16.7 ms and any row at or near it is reporting the display, not the app.\n\n`
  : `Frames are **unpaced** (\`--disable-gpu-vsync --disable-frame-rate-limit\`), so a gap below 16.7 ms is real and the light rows are not floored.\n\n`
if (profileLabel) {
  md += `> **This run was profiled** (\`PROFILE=${profileLabel}\`): the last pass of each row ran with the V8 sampling profiler attached to the page and its workers, which inflates that pass. Take the timings from an unprofiled run and this one only for the traces.\n\n`
}
const rowFor = (n: number, port: number) =>
  rows.find(r => r.n === n && r.port === port)

if (PORTS.length > 1) {
  // A/B: one row per track count, one frame-median column per build. The arms
  // were measured back to back inside each cell, so the ratio survives a load
  // spike even where the absolute milliseconds do not.
  const [a, b] = PORTS as [number, number]
  md += `Two builds, **interleaved within each pass** so both arms see the same machine.\n\n`
  md += `| tracks open | ${buildOf.get(a)} | ${buildOf.get(b)} | speedup | over budget ${buildOf.get(a)} → ${buildOf.get(b)} | load |\n`
  md += `|---|---:|---:|---:|---:|---:|\n`
  for (const n of COUNTS) {
    const ra = rowFor(n, a)
    const rb = rowFor(n, b)
    if (!ra || !rb) {
      continue
    }
    const sp = ra.frame.median / rb.frame.median
    md += `| ${n} | ${ra.frame.median.toFixed(1)} ms | ${rb.frame.median.toFixed(1)} ms | ${sp.toFixed(2)}× | ${ra.frame.overBudgetPct.toFixed(0)}% → ${rb.frame.overBudgetPct.toFixed(0)}% | ${Math.max(peak(ra.load), peak(rb.load)).toFixed(1)} |\n`
  }
  md += `\nPer-pass frame medians, so one contended pass is visible rather than pooled away:\n\n`
  md += `| build | tracks open | ${rows[0]?.passes.map((_, i) => `pass ${i + 1}`).join(' | ') ?? ''} |\n`
  md += `|---|---|${rows[0]?.passes.map(() => '---:').join('|') ?? ''}|\n`
  for (const r of rows) {
    md += `| ${r.build} | ${r.n} | ${r.passes.map(p => p.median.toFixed(1)).join(' | ')} |\n`
  }
} else {
  md += `| tracks open | ready (ms) | frame median | p90 | p99 | over budget | vs 1 track |\n`
  md += `|---|---:|---:|---:|---:|---:|---:|\n`
  for (const r of rows) {
    const ratio = base ? r.frame.median / base.frame.median : NaN
    md += `| ${r.n} | ${median(r.readyMs).toFixed(0)} | ${r.frame.median.toFixed(1)} ms | ${r.frame.p90.toFixed(1)} ms | ${r.frame.p99.toFixed(1)} ms | ${r.frame.overBudgetPct.toFixed(0)}% | ${Number.isFinite(ratio) ? `${ratio.toFixed(2)}×` : '—'} |\n`
  }
  md += `\nPer-pass frame medians, so one contended pass is visible rather than pooled away:\n\n`
  md += `| tracks open | ${rows[0]?.passes.map((_, i) => `pass ${i + 1}`).join(' | ') ?? ''} | load |\n`
  md += `|---|${rows[0]?.passes.map(() => '---:').join('|') ?? ''}|---:|\n`
  for (const r of rows) {
    md += `| ${r.n} | ${r.passes.map(p => `${p.median.toFixed(1)}`).join(' | ')} | ${peak(r.load).toFixed(1)} |\n`
  }
}
const withErrors = rows.filter(r => r.errors.length)
if (withErrors.length) {
  md += `\n> Page errors were recorded and the rows are not clean:\n`
  for (const r of withErrors) {
    md += `> - ${r.build} n=${r.n}: ${r.errors.join('; ')}\n`
  }
}
md += `\nTracks, in the order they are added: ${TRACKS.map(t => `\`${t}\``).join(', ')}\n`
fs.writeFileSync(`results/multibam-${suffix}.md`, md)
console.log('\n' + md)
console.log(`Wrote results/multibam-${suffix}.{json,md}`)

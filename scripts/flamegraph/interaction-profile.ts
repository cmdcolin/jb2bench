// Capture a MAIN-thread (+ worker) V8 CPU profile DURING a sustained pan (and
// optional vertical pileup scroll), to measure the per-frame React/MobX cost of
// interaction — the "death by a thousand cuts" that the initial-render and zoom
// benchmarks don't show. Unlike interaction.ts (which measures time-to-content
// on zoom), this drives a continuous rAF-paced pan that stays WITHIN already-
// loaded data (no refetch), so the profile is pure re-render/recompute cost.
//
// Pans by oscillating horizontalScroll so offsetPx changes every animation
// frame (each change triggers the observer overlays' reactions) without walking
// off the loaded region into a fetch. Records the CPU profile plus the rAF frame
// gaps (jank) over the interaction window.
//
// Same headless + hardware-GPU (--use-angle=gl) setup as flameprofile.ts.
//
// Usage: interaction-profile.ts <url> <label> [mode=pan|scroll|both]
// Writes flame/<label>.<target>.cpuprofile and prints frame-gap stats.
import puppeteer from 'puppeteer'
import type { CDPSession } from 'puppeteer'
import fs from 'fs'

const url = process.argv[2]
const label = process.argv[3] ?? 'interaction'
const mode = process.argv[4] ?? 'pan'
if (!url) {
  throw new Error('usage: interaction-profile.ts <url> <label> [pan|scroll|both]')
}

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
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const client = await page.target().createCDPSession()
const connection = client.connection()!
const profilers: { id: string; session: CDPSession }[] = []

async function arm(session: CDPSession) {
  await session.send('Profiler.enable')
  await session.send('Profiler.setSamplingInterval', { interval: 200 }) // µs
  await session.send('Profiler.start')
}

// attach workers too, so we can confirm the pan does NOT refetch (worker should
// be ~idle during a within-loaded-data pan)
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
        const tag = (targetInfo.url || 'worker').split('/').pop()
        profilers.push({ id: `worker${profilers.length}-${tag}`, session })
      } catch (e) {
        console.error('worker arm failed:', e instanceof Error ? e.message : e)
      }
    }
    await session?.send('Runtime.runIfWaitingForDebugger').catch(() => {})
  })()
})

await page.goto(url, { waitUntil: 'load' })

// wait for initial render-complete (same quiescence detector as profile.ts)
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
  { timeout: 120000, polling: 100 },
)

// Optional: hover the pileup so a tooltip is active during the interaction —
// reproduces real scroll-zoom with the cursor over a read (HOVER=1). Moves the
// OS cursor over the pileup center so the display's onMouseMove hit-test sets the
// mouseover/tooltip state, then leaves it there (wheel-zoom doesn't move it).
if (process.env.HOVER === '1') {
  const rect = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pileup-display-done"]')
    if (!el) {
      return null
    }
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, top: r.y, height: r.height }
  })
  const modelHasHover = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        JBrowseSession: {
          views: { tracks: { displays: { mouseoverExtraInformation?: unknown }[] }[] }[]
        }
      }
      const d = w.JBrowseSession.views[0]?.tracks[0]?.displays[0]
      return d?.mouseoverExtraInformation !== undefined
    })
  let set = false
  if (rect) {
    // scan down through the pileup rows until a read hit-test sets the tooltip
    for (let frac = 0.2; frac <= 0.9 && !set; frac += 0.1) {
      const y = rect.top + rect.height * frac
      await page.mouse.move(rect.x, y)
      await new Promise(r => setTimeout(r, 60))
      set = await modelHasHover()
      if (set) {
        console.error(`hover set at ${Math.round(rect.x)},${Math.round(y)} (frac ${frac.toFixed(1)})`)
      }
    }
  }
  if (!set) {
    console.error('HOVER: could not activate a tooltip (no read hit)')
  }
}

// Optional CPU throttling to emulate a slower machine / unplugged laptop, where
// the ~50%-idle headroom on a fast desktop disappears and per-frame React/MobX
// cost starts dropping frames. THROTTLE=4 ≈ a mid-tier laptop under load.
const throttle = Number(process.env.THROTTLE ?? 1)
if (throttle > 1) {
  await client.send('Emulation.setCPUThrottlingRate', { rate: throttle })
}

// Arm the main-thread profiler AFTER initial render so the profile is the
// interaction window only, not the cold render.
await arm(client)
profilers.push({ id: 'main', session: client })

// Drive the interaction in-page across animation frames. Oscillate so we stay
// within loaded data (no refetch). Returns rAF frame timestamps for jank stats.
const frameGaps = await page.evaluate(
  async ({ mode, frames }) => {
    const w = window as unknown as {
      JBrowseSession: {
        views: {
          horizontalScroll: (n: number) => void
          bpPerPx: number
          zoomTo: (n: number) => void
        }[]
      }
    }
    const v = w.JBrowseSession.views[0]!
    const model = v as unknown as {
      horizontalScroll: (n: number) => void
      bpPerPx: number
      zoomTo: (n: number) => void
      tracks?: { displays: { setScrollTop?: (n: number) => void }[] }[]
    }
    const display = model.tracks?.[0]?.displays?.[0]
    const ts: number[] = []
    const PAN_PX = 10 // per-frame horizontal pan
    const SCROLL_PX = 12 // per-frame vertical scroll
    // Zoom oscillates bpPerPx between the start value (bp0) and 4x zoomed-in
    // (bp0/4) and back, so every step is a strict subset of the initially
    // loaded data — no refetch, so the profile is pure re-project/re-render.
    const bp0 = model.bpPerPx
    const ZOOM_PERIOD = 60 // frames for a full in→out cycle
    let scrollTop = 0
    await new Promise<void>(resolve => {
      let i = 0
      const step = () => {
        ts.push(performance.now())
        const dir = Math.floor(i / 30) % 2 === 0 ? 1 : -1
        if (mode === 'pan' || mode === 'both') {
          model.horizontalScroll(dir * PAN_PX)
        }
        if (mode === 'zoom') {
          // triangle wave in [0,1]: 0 = start zoom, 1 = 4x zoomed in
          const phase = (i % ZOOM_PERIOD) / ZOOM_PERIOD
          const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2
          model.zoomTo(bp0 * (1 - 0.75 * tri))
        }
        if ((mode === 'scroll' || mode === 'both') && display?.setScrollTop) {
          scrollTop = Math.max(0, scrollTop + dir * SCROLL_PX)
          display.setScrollTop(scrollTop)
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
  { mode, frames: 240 }, // ~4s at 60fps
)

fs.mkdirSync('flame', { recursive: true })
for (const p of profilers) {
  try {
    const { profile } = (await p.session.send('Profiler.stop')) as {
      profile: unknown
    }
    const samples = (profile as { samples?: unknown[] }).samples?.length ?? 0
    fs.writeFileSync(`flame/${label}.${p.id}.cpuprofile`, JSON.stringify(profile))
    console.log(`saved flame/${label}.${p.id}.cpuprofile  (${samples} samples)`)
  } catch (e) {
    console.error(`stop failed ${p.id}:`, e instanceof Error ? e.message : e)
  }
}

const sorted = [...frameGaps].sort((a, b) => a - b)
const pct = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? NaN
const dropped = frameGaps.filter(g => g > 20).length // > ~1.2 frames @60fps
console.log(
  JSON.stringify({
    mode,
    frames: frameGaps.length,
    frameGapMs: {
      median: pct(0.5),
      p90: pct(0.9),
      p99: pct(0.99),
      max: Math.max(...frameGaps),
    },
    droppedFrames: dropped, // frames whose gap exceeded ~20ms
    droppedPct: Math.round((100 * dropped) / frameGaps.length),
  }),
)
await browser.close()

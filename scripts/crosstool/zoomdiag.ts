// Localize the ~0.8 s zoom settle that zoomprofile.ts measures.
//
// zoomprofile.ts says the rendered image keeps changing for ~0.8 s after a 2x
// zoom-in, and says it equally at 20x and 1000x coverage, so whatever it is does
// not scale with the data. This asks *what* is still changing, on three
// independent channels recorded against the same clock:
//
//   1. GPU draws — drawArraysInstanced / drawElementsInstanced timestamps, so a
//      repeatedly-redrawing canvas is visible as such.
//   2. DOM mutations — every record the observer sees, with the target's tag,
//      testid and class, so chrome churn is attributable to a component.
//   3. Track pixels — a screenshot clipped to the canvas, polled, so a canvas
//      that redraws without a JS-visible event is still caught.
//
// A canvas redraw produces no DOM mutation and a React re-render produces no
// draw call, so neither channel alone can localize this.
//
// Usage: zoomdiag.ts <url>
import crypto from 'crypto'
import puppeteer from 'puppeteer'

const url = process.argv[2]
if (!url) {
  throw new Error('usage: zoomdiag.ts <url>')
}
const WATCH_MS = Number(process.env.WATCH_MS ?? 2500)
const POLL_MS = Number(process.env.POLL_MS ?? 100)

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

// Timer tracing has to be installed before the app's own scripts run, or the
// intervals registered at startup — the ones that would still be firing at rest
// — are invisible to it.
if (process.env.TRACE_TIMERS === '1') {
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as {
      __timers: Record<string, { delay: number; fired: number; stack: string }>
    }
    w.__timers = {}
    const origInterval = window.setInterval.bind(window)
    let n = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).setInterval = (fn: () => void, delay?: number, ...rest: unknown[]) => {
      const key = `i${n++}`
      const stack = (new Error().stack ?? '').split('\n').slice(2, 6).join(' | ')
      w.__timers[key] = { delay: delay ?? 0, fired: 0, stack }
      return origInterval(
        () => {
          w.__timers[key]!.fired++
          fn()
        },
        delay,
        ...rest,
      )
    }
  })
}

await page.goto(url, { waitUntil: 'domcontentloaded' })

const hash = (b: Uint8Array) =>
  crypto.createHash('sha1').update(b).digest('hex').slice(0, 12)

// settle the initial render the same way zoomprofile.ts does
{
  let last = ''
  let stable = 0
  const deadline = Date.now() + 120000
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('initial render did not settle')
    }
    const h = hash(await page.screenshot({ type: 'png', optimizeForSpeed: true }))
    if (h === last) {
      stable++
    } else {
      stable = 0
      last = h
    }
    if (stable >= 3) {
      break
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

// the biggest canvas on the page is the track
const box = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')]
  let best: HTMLCanvasElement | undefined
  let area = 0
  for (const c of canvases) {
    const r = c.getBoundingClientRect()
    if (r.width * r.height > area) {
      area = r.width * r.height
      best = c
    }
  }
  const r = best?.getBoundingClientRect()
  return r
    ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    : undefined
})
// A view with no track has no canvas, which is a useful control rather than an
// error: the DOM-mutation channel still answers whether the churn is the display
// or the chrome around it.
console.log(box ? `track canvas: ${JSON.stringify(box)}` : 'no canvas on the page')

interface Mutation {
  t: number
  type: string
  target: string
  attr: string | null
}

await page.evaluate(() => {
  const w = window as unknown as {
    __diag: { t0: number; draws: number[]; muts: Mutation[] }
  }
  type Mutation = { t: number; type: string; target: string; attr: string | null }
  w.__diag = { t0: 0, draws: [], muts: [] }

  for (const name of ['drawArraysInstanced', 'drawElementsInstanced', 'drawArrays'] as const) {
    const proto = WebGL2RenderingContext.prototype as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >
    const orig = proto[name]
    if (orig) {
      proto[name] = function (this: unknown, ...args: unknown[]) {
        w.__diag.draws.push(performance.now())
        return orig.apply(this, args)
      }
    }
  }

  const describe = (n: Node) => {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement
    if (!el) {
      return String(n.nodeName)
    }
    const testid = el.getAttribute('data-testid')
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    return [
      el.tagName.toLowerCase(),
      testid ? `[${testid}]` : '',
      cls ? `.${cls}` : '',
    ].join('')
  }

  new MutationObserver(records => {
    const t = performance.now()
    for (const r of records) {
      if (w.__diag.muts.length < 4000) {
        // An attribute rewritten to the value it already had still fires a
        // record, so old -> new is what separates a feedback loop (two values
        // alternating) from an idempotent write by a re-render.
        let attr = r.attributeName
        if (attr && r.target.nodeType === 1) {
          const now = (r.target as Element).getAttribute(attr)
          attr = `${attr}: ${r.oldValue ?? '?'} -> ${now ?? '?'}`
        }
        w.__diag.muts.push({
          t,
          type: r.type,
          target: describe(r.target),
          attr,
        })
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
  })
})

// zoom, and start the clock inside the page so every channel shares it.
// NO_ZOOM=1 is the control: same window, same channels, no interaction. If the
// page churns identically without a zoom then the settle time is not the zoom's,
// and zoomprofile.ts is measuring an ambient repaint cycle.
const noZoom = process.env.NO_ZOOM === '1'
await page.evaluate(zoom => {
  const w = window as unknown as {
    __diag: { t0: number; draws: number[]; muts: unknown[] }
    JBrowseSession: { views: { bpPerPx: number; zoomTo: (n: number) => void }[] }
  }
  w.__diag.draws = []
  w.__diag.muts = []
  w.__diag.t0 = performance.now()
  if (zoom) {
    const v = w.JBrowseSession.views[0]!
    v.zoomTo(v.bpPerPx * 0.5)
  }
}, !noZoom)
console.log(noZoom ? '\n(control: no zoom applied)' : '\n(zoomed 2x)')

const started = Date.now()
const frames: { t: number; track: string }[] = []
while (Date.now() - started < WATCH_MS) {
  if (box) {
    frames.push({
      t: Date.now() - started,
      track: hash(await page.screenshot({ type: 'png', clip: box, optimizeForSpeed: true })),
    })
  }
  await new Promise(r => setTimeout(r, POLL_MS))
}

const diag = await page.evaluate(() => {
  const w = window as unknown as {
    __diag: { t0: number; draws: number[]; muts: Mutation[] }
  }
  type Mutation = { t: number; type: string; target: string; attr: string | null }
  const d = w.__diag
  return {
    draws: d.draws.map(t => Math.round(t - d.t0)),
    muts: d.muts.map(m => ({ ...m, t: Math.round(m.t - d.t0) })),
  }
})

console.log('\n--- track canvas pixels (clipped screenshot) ---')
let prev = ''
const changes: number[] = []
for (const f of frames) {
  if (f.track !== prev) {
    changes.push(f.t)
    prev = f.track
  }
}
console.log(`changed at ${JSON.stringify(changes)} ms; last change ${changes.at(-1)} ms`)

console.log('\n--- GPU draw calls ---')
console.log(
  diag.draws.length
    ? `${diag.draws.length} draws, first ${diag.draws[0]} ms, last ${diag.draws.at(-1)} ms`
    : 'none',
)

console.log('\n--- DOM mutations by 100 ms bucket ---')
const buckets = new Map<number, number>()
for (const m of diag.muts) {
  const b = Math.floor(m.t / 100) * 100
  buckets.set(b, (buckets.get(b) ?? 0) + 1)
}
for (const [b, n] of [...buckets].sort((a, x) => a[0] - x[0])) {
  console.log(`${String(b).padStart(5)} ms  ${'#'.repeat(Math.min(60, n))} ${n}`)
}

console.log('\n--- canvas attribute writes ---')
for (const m of diag.muts.filter(x => x.target.startsWith('canvas')).slice(0, 14)) {
  console.log(`${String(m.t).padStart(5)} ms  ${m.attr}`)
}

console.log('\n--- DOM mutations by target, after 300 ms ---')
const late = new Map<string, { n: number; first: number; last: number; attrs: Set<string> }>()
for (const m of diag.muts) {
  if (m.t < 300) {
    continue
  }
  const key = `${m.type} ${m.target}`
  const e = late.get(key) ?? { n: 0, first: m.t, last: m.t, attrs: new Set<string>() }
  e.n++
  e.last = m.t
  if (m.attr) {
    e.attrs.add(m.attr)
  }
  late.set(key, e)
}
for (const [k, e] of [...late].sort((a, x) => x[1].n - a[1].n).slice(0, 20)) {
  console.log(
    `${String(e.n).padStart(5)}x  ${e.first}-${e.last} ms  ${k}${e.attrs.size ? ` {${[...e.attrs].join(',')}}` : ''}`,
  )
}

if (process.env.TRACE_TIMERS === '1') {
  const timers = await page.evaluate(() => {
    const w = window as unknown as {
      __timers: Record<string, { delay: number; fired: number; stack: string }>
    }
    return Object.values(w.__timers).filter(t => t.fired > 0)
  })
  console.log('\n--- setInterval handlers that fired ---')
  for (const t of timers.sort((a, b) => b.fired - a.fired).slice(0, 12)) {
    console.log(`${String(t.fired).padStart(4)}x  every ${t.delay} ms  ${t.stack}`)
  }
}

await browser.close()

// Cross-tool zoom benchmark: how long after a 2x zoom-in until the picture is
// right again, measured the same way in both tools.
//
// This is the interaction the architecture is about. `scripts/render/
// interaction.ts` measures it between JBrowse builds by watching JBrowse's own
// loading indicator, which does not exist in another tool; this measures the
// pixels instead (see paintprofile.ts for why that is the only shared
// instrument available). The floor is one poll interval, so a redraw that
// finishes inside a frame reports as POLL_MS and should be read as "at most one
// poll", not as a measured duration.
//
// Both tools hold the surrounding data client-side after the initial load —
// that is what makes the comparison interesting. Neither should refetch on a
// 2x zoom-in; what differs is what each has to do to redraw.
//
// Usage: zoomprofile.ts <url> <jbrowse|igv>
// Prints JSON: {steps: [ms, ...]}
import crypto from 'crypto'
import puppeteer from 'puppeteer'

const WAIT_TIMEOUT = Number(process.env.MAX_WAIT ?? 120000)
const POLL_MS = Number(process.env.POLL_MS ?? 100)
const STABLE_POLLS = Number(process.env.STABLE_POLLS ?? 3)
const STEPS = Number(process.env.STEPS ?? 5)

const url = process.argv[2]
const tool = process.argv[3]
if (!url || (tool !== 'jbrowse' && tool !== 'igv')) {
  throw new Error('usage: zoomprofile.ts <url> <jbrowse|igv>')
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

const hash = (b: Uint8Array) =>
  crypto.createHash('sha1').update(b).digest('hex')
const shot = async () =>
  hash(await page.screenshot({ type: 'png', optimizeForSpeed: true }))

/** wait until the frame has repeated `stable` times and differs from `from` */
async function settle(from: string, deadline: number) {
  let last = ''
  let stable = 0
  for (;;) {
    if (Date.now() > deadline) {
      return { ms: Number.NaN, censored: true, frame: last }
    }
    const h = await shot()
    if (h === last && h !== from) {
      stable++
    } else {
      stable = 0
      last = h
    }
    if (stable >= STABLE_POLLS) {
      return { ms: 0, censored: false, frame: last }
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

await page.goto(url, { waitUntil: 'domcontentloaded' })
const blank = await shot()
const initial = await settle(blank, Date.now() + WAIT_TIMEOUT)
if (initial.censored) {
  console.log(JSON.stringify({ error: 'initial render did not settle' }))
  await browser.close()
  process.exit(1)
}

const zoom = async () =>
  page.evaluate(async t => {
    if (t === 'igv') {
      const b = (window as unknown as { igvBrowser: { zoomIn: () => unknown } })
        .igvBrowser
      await b.zoomIn()
    } else {
      const v = (
        window as unknown as {
          JBrowseSession: { views: { bpPerPx: number; zoomTo: (n: number) => void }[] }
        }
      ).JBrowseSession.views[0]!
      v.zoomTo(v.bpPerPx * 0.5)
    }
  }, tool)

const steps: number[] = []
let prev = initial.frame
for (let i = 0; i < STEPS; i++) {
  const t0 = Date.now()
  await zoom()
  const r = await settle(prev, t0 + WAIT_TIMEOUT)
  if (r.censored) {
    steps.push(Number.NaN)
    break
  }
  // subtract the settle window: the detector needs STABLE_POLLS repeats to be
  // sure, and those cost real time that the redraw did not
  steps.push(Math.max(0, Date.now() - t0 - STABLE_POLLS * POLL_MS))
  prev = r.frame
}

console.log(JSON.stringify({ tool, steps }))
await browser.close()

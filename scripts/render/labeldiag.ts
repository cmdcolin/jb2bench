// What is the pileup's label pass actually walking, and what does it produce?
//
// `computeVisibleLabels` is a MobX computed that re-runs on every pan frame, per
// open display, and it walks the per-feature arrays the RPC worker returned. A
// profile says it is expensive; it does not say whether the expense buys any
// labels. This asks the live model directly:
//
//   - how many gap / interbase / mismatch entries each display's data holds
//   - how long one recompute of `visibleLabels` takes
//   - how many labels come out, by type
//   - the LENGTH distribution of the features, since a size label survives only
//     if its feature is wide enough on screen and that is a test on bp length
//
// The pairing is the point. A row with hundreds of thousands of entries and an
// empty `byType` is work that cannot produce anything at this zoom.
//
// Usage: node scripts/render/labeldiag.ts   (PORT/LOC/TRACKS override)
import puppeteer from 'puppeteer'

const PORT = Number(process.env.PORT ?? 8020)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
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

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
await page.goto(
  `http://localhost:${PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACKS.join(',')}&renderer=webgl`,
  { waitUntil: 'load' },
)
await page.waitForFunction(
  (expected: number) => {
    const s = (globalThis as any).JBrowseSession
    return (
      s?.views?.length &&
      !s.views.some((v: any) => v.initialized === false) &&
      document.querySelectorAll('[data-display-phase]').length >= expected &&
      !document.querySelector('[data-display-phase="loading"]') &&
      !document.querySelector('[data-display-drawn="false"]')
    )
  },
  { timeout: 120000, polling: 200 },
  TRACKS.length,
)
await new Promise(r => setTimeout(r, 1500))

const out = await page.evaluate(() => {
  const s = (globalThis as any).JBrowseSession
  const view = s.views[0]
  const quant = (a: number[]) => {
    a.sort((x, y) => x - y)
    const q = (p: number) => a[Math.floor((a.length - 1) * p)]
    return { n: a.length, p50: q(0.5), p99: q(0.99), max: a[a.length - 1] }
  }
  const rows: any[] = []
  for (const track of view.tracks) {
    const d = track.displays[0]
    if (!d) {
      continue
    }
    let gaps = 0
    let interbase = 0
    let mismatch = 0
    let softclipBases = 0
    const deletionLengths: number[] = []
    const interbaseLengths: number[] = []
    const sections = d.renderSections ?? []
    for (const sec of sections) {
      for (const [, rpc] of sec.laidOutPileupMap ?? []) {
        gaps += (rpc.gapPositions?.length ?? 0) / 2
        interbase += rpc.interbasePositions?.length ?? 0
        mismatch += rpc.mismatchPositions?.length ?? 0
        softclipBases += rpc.softclipBasePositions?.length ?? 0
        for (let i = 0; i < rpc.gapLengths.length; i++) {
          if (rpc.gapTypes[i] === 0) {
            deletionLengths.push(rpc.gapLengths[i])
          }
        }
        for (let i = 0; i < rpc.interbaseLengths.length; i++) {
          interbaseLengths.push(rpc.interbaseLengths[i])
        }
      }
    }
    // Nudge the view between reads so the computed genuinely re-runs rather
    // than returning MobX's cached value — which would time nothing.
    const N = 20
    const t0 = performance.now()
    let labels: any[] = []
    for (let i = 0; i < N; i++) {
      view.horizontalScroll(i % 2 === 0 ? 1 : -1)
      labels = d.visibleLabels
    }
    const ms = (performance.now() - t0) / N
    const byType: Record<string, number> = {}
    for (const l of labels) {
      byType[l.type] = (byType[l.type] ?? 0) + 1
    }
    rows.push({
      track: track.configuration.trackId,
      sections: sections.length,
      entries: { gaps, interbase, mismatch, softclipBases },
      deletionLengths: quant(deletionLengths),
      interbaseLengths: quant(interbaseLengths),
      labels: labels.length,
      byType,
      msPerRecompute: +ms.toFixed(2),
      featureHeight: d.featureHeight,
      height: d.height,
    })
  }
  return {
    bpPerPx: view.bpPerPx,
    pxPerBp: 1 / view.bpPerPx,
    width: view.width,
    totalMsPerFrame: +rows
      .reduce((a, r) => a + r.msPerRecompute, 0)
      .toFixed(2),
    rows,
  }
})

console.log(JSON.stringify(out, null, 2))
await browser.close()

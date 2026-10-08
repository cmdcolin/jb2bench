import puppeteer from 'puppeteer'
// node walk-trace.mjs <8|all> <refName> <start> <end> [walkStepBudget|''] [layoutMode]
// Opens a GraphGenomeView on the HPRC demo's walk-indexed track from a
// cold cache, with the track's eight haplotypes or every one, and counts the
// range requests to its walk, node and link files and their indexes until the
// graph is cut and drawn. A budget runs a session copy of the track with
// walkStepBudget raised to it; a layout mode replaces the view's default,
// force, whose 20,000-node limit a 1 Mb cut passes.
const [haplotypes, refName, start, end, budget, layoutMode] = process.argv.slice(2)
// TRACK_ID and DATA_PREFIX pick the track and the files it reads; the default
// is the whole-genome track, and the chr22-only track that the first runs
// measured is TRACK_ID=hprc_v2_1_chr22_walks DATA_PREFIX=hprc-v2.1-mc-grch38.chr22.
const trackId = process.env.TRACK_ID ?? 'hprc_v2_1_walks'
const dataPrefix = process.env.DATA_PREFIX ?? 'hprc-v2.1-mc-grch38.'
const build = 'https://jbrowse.org/code/jb2/main/'
const config = 'https://jbrowse.org/demos/hprc/config.json'
const url = `${build}?config=${encodeURIComponent(config)}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const net = { req: 0, bytes: 0, urls: {} }
const isData = u => u.startsWith(`https://jbrowse.org/demos/hprc/${dataPrefix}`) && !u.includes('.anchored.') && !u.includes('.tier') && /\.bed\.gz(\.tbi)?$/.test(u)
const watch = c => {
  const ids = new Map()
  c.on('Network.requestWillBeSent', e => {
    if (isData(e.request.url)) {
      ids.set(e.requestId, e.request.url)
      net.req++
      const name = e.request.url.split('/').pop()
      net.urls[name] = (net.urls[name] ?? 0) + 1
    }
  })
  c.on('Network.loadingFinished', e => {
    if (ids.has(e.requestId)) net.bytes += e.encodedDataLength
  })
}
const pc = await page.createCDPSession()
await pc.send('Network.enable')
watch(pc)
page.on('workercreated', async w => {
  try {
    await w.client.send('Network.enable')
    watch(w.client)
  } catch {}
})
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 120000 })
await page.waitForFunction(
  () => window.JBrowseRootModel.pluginManager.viewTypes.has('GraphGenomeView'),
  { timeout: 120000 },
)
const version = (await (await fetch(`${build}version.txt`)).text()).trim()
const t0 = Date.now()
const viewId = await page.evaluate(
  ({ trackId, haplotypes, budget, layoutMode, region }) => {
    const session = window.JBrowseSession
    const snap = JSON.parse(JSON.stringify(session.tracks.find(t => t.trackId === trackId)))
    const lanes = snap.adapter.defaultHaplotypes ?? snap.assemblyNames.slice(1)
    let loadedTrackId = trackId
    if (budget) {
      loadedTrackId = `${trackId}_budget`
      session.addTrackConf({ ...snap, trackId: loadedTrackId, adapter: { ...snap.adapter, walkStepBudget: +budget } })
    }
    return session.addView('GraphGenomeView', {
      loadedTrackId,
      loadedRegion: region,
      // [] is the display's "every haplotype" state; unset would follow defaultHaplotypes
      subgraphHaplotypes: haplotypes === 'all' ? [] : lanes,
      ...(layoutMode ? { layoutMode } : {}),
    }).id
  },
  { trackId, haplotypes, budget, layoutMode, region: { assemblyName: 'hg38', refName, start: +start, end: +end } },
)
const state = id => {
  const v = window.JBrowseSession.views.find(v => v.id === id)
  return { cut: !!v?.hasGraph, drawn: !!v?.hasGraph && !!(v.layoutResult || v.walkRowBars) && v.geometryPainted, error: v?.error !== undefined }
}
await page.waitForFunction(id => {
  const v = window.JBrowseSession.views.find(v => v.id === id)
  return !!v && (v.hasGraph || v.error !== undefined)
}, { timeout: 300000 }, viewId)
const cutMs = Date.now() - t0
const netAtCut = { requests: net.req, MB: +(net.bytes / 1e6).toFixed(2) }
let drawnMs = null
try {
  await page.waitForFunction(id => {
    const v = window.JBrowseSession.views.find(v => v.id === id)
    return (v.hasGraph && (v.layoutResult || v.walkRowBars) && v.geometryPainted) || v.error !== undefined
  }, { timeout: 300000 }, viewId)
  if ((await page.evaluate(state, viewId)).drawn) drawnMs = Date.now() - t0
} catch {}
const view = await page.evaluate(id => {
  const v = window.JBrowseSession.views.find(v => v.id === id)
  return {
    layoutMode: v.chosenLayoutMode,
    nodes: v.nodeCount,
    walks: v.pathCount,
    fetchMs: v.lastFetchMs === undefined ? null : Math.round(v.lastFetchMs),
    layoutMs: v.lastLayoutMs === undefined ? null : Math.round(v.lastLayoutMs),
    error: v.error === undefined ? null : String(v.error).slice(0, 200),
  }
}, viewId)
await new Promise(r => setTimeout(r, 3000))
await browser.close()
console.log(JSON.stringify({ layout: 'walks', haplotypes, ...(budget ? { walkStepBudget: +budget } : {}), refName, start: +start, end: +end, cutMs, drawnMs, ...view, ...netAtCut, requestsTotal: net.req, MBTotal: +(net.bytes / 1e6).toFixed(2), urls: net.urls, build, version }))

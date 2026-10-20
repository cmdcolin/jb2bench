import fs from 'node:fs'
import puppeteer from 'puppeteer'
// node walk-trace-hs1.mjs <8|all> <refName> <start> <end> [walkStepBudget|''] [layoutMode]
// walk-trace.mjs on T2T-CHM13: opens a GraphGenomeView on the hs1 walk-indexed
// track of test_data/graphgenomeview/hprc.json, served by the main build, and
// counts the range requests to the CHM13 walk file and its index
// until the graph is cut and drawn. SCREENSHOT=<png> saves the page
// once drawn. TRACK_JSON=<file> adds that track config to the session first,
// for checking a track before the config carrying it deploys.
const [haplotypes, refName, start, end, budget, layoutMode] = process.argv.slice(2)
const trackId = process.env.TRACK_ID ?? 'hprc_v2_1_walks_hs1'
const dataPrefix = process.env.DATA_PREFIX ?? 'hprc-v2.1-mc-grch38-f4.CHM13.'
const screenshot = process.env.SCREENSHOT
const trackJson = process.env.TRACK_JSON ? fs.readFileSync(process.env.TRACK_JSON, 'utf8') : undefined
const build = 'https://jbrowse.org/code/jb2/main/'
const config = 'test_data/graphgenomeview/hprc.json'
const url = `${build}?config=${encodeURIComponent(config)}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const net = { req: 0, bytes: 0, urls: {} }
const isData = u => u.startsWith(`https://jbrowse.org/demos/hprc/${dataPrefix}`) && /\.bed\.gz(\.tbi)?$/.test(u)
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
  ({ trackId, trackJson, haplotypes, budget, layoutMode, region }) => {
    const session = window.JBrowseSession
    if (trackJson && !session.tracks.some(t => t.trackId === trackId)) {
      session.addTrackConf(JSON.parse(trackJson))
    }
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
      subgraphHaplotypes: haplotypes === 'all' ? [] : lanes,
      ...(layoutMode ? { layoutMode } : {}),
    }).id
  },
  { trackId, trackJson, haplotypes, budget, layoutMode, region: { assemblyName: 'hs1', refName, start: +start, end: +end } },
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
if (screenshot) await page.screenshot({ path: screenshot })
await browser.close()
console.log(JSON.stringify({ layout: 'walks', assembly: 'hs1', trackId, haplotypes, ...(budget ? { walkStepBudget: +budget } : {}), refName, start: +start, end: +end, cutMs, drawnMs, ...view, ...netAtCut, requestsTotal: net.req, MBTotal: +(net.bytes / 1e6).toFixed(2), urls: net.urls, build, version }))

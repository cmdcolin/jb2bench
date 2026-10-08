import puppeteer from 'puppeteer'
// node graph-trace.mjs <anchored|contig> <refName> <start> <end>
// Opens a GraphGenomeView on the HPRC graph track from a cold cache and counts
// the range requests to the graph's BED files and indexes until the graph is cut.
const [layout, refName, start, end] = process.argv.slice(2)
const prefix = `https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38${layout === 'anchored' ? '.anchored' : ''}`
const config = 'https://jbrowse.org/demos/hprc/config.json'
const url = `https://jbrowse.org/code/jb2/main/?config=${encodeURIComponent(config)}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const net = { req: 0, bytes: 0, urls: {} }
const isData = u => u.startsWith('https://jbrowse.org/demos/hprc/') && /\.bed\.gz(\.tbi)?$/.test(u)
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
const t0 = Date.now()
const viewId = await page.evaluate(
  ({ prefix, region }) => {
    window.JBrowseSession.addTrackConf({
      type: 'GraphTrack',
      trackId: 'graph_trace',
      name: 'graph trace',
      assemblyNames: ['hg38'],
      adapter: { type: 'RgfaTabixAdapter', uri: prefix, assemblyNameToPanSN: { hg38: 'GRCh38' } },
    })
    return window.JBrowseSession.addView('GraphGenomeView', { loadedTrackId: 'graph_trace', loadedRegion: region }).id
  },
  { prefix, region: { assemblyName: 'hg38', refName, start: +start, end: +end } },
)
await page.waitForFunction(
  id => {
    const v = window.JBrowseSession.views.find(v => v.id === id)
    return !!v && (v.hasGraph || v.error !== undefined)
  },
  { timeout: 300000 },
  viewId,
)
const cutMs = Date.now() - t0
const view = await page.evaluate(id => {
  const v = window.JBrowseSession.views.find(v => v.id === id)
  return { nodes: v.nodeCount, error: v.error && String(v.error) }
}, viewId)
await new Promise(r => setTimeout(r, 3000))
await browser.close()
console.log(JSON.stringify({ layout, refName, start: +start, end: +end, cutMs, ...view, requests: net.req, MB: +(net.bytes / 1e6).toFixed(2), urls: net.urls }))

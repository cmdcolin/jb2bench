import { launch } from 'puppeteer'
import { loadavg } from 'node:os'
// node graph-trace.mjs <trackId> <refName> <start> <end>
// Opens a GraphGenomeView on a graph track of the hosted HPRC config from a cold
// cache and counts the range requests to the graph's BED files and indexes
// until the graph is cut.
const [trackId, refName, start, end] = process.argv.slice(2)
const load = loadavg()[0]
const config = 'https://jbrowse.org/demos/hprc/config.json'
const url = `https://jbrowse.org/code/jb2/main/?config=${encodeURIComponent(config)}`
const browser = await launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
})
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
page.on('workercreated', w => {
  w.client
    .send('Network.enable')
    .then(() => {
      watch(w.client)
    })
    .catch(() => {})
})
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 120000 })
await page.waitForFunction(
  () => window.JBrowseRootModel.pluginManager.viewTypes.has('GraphGenomeView'),
  { timeout: 120000 },
)
const t0 = Date.now()
const viewId = await page.evaluate(
  ({ trackId: id, region }) =>
    window.JBrowseSession.addView('GraphGenomeView', { loadedTrackId: id, loadedRegion: region })
      .id,
  { trackId, region: { assemblyName: 'hg38', refName, start: +start, end: +end } },
)
await page.waitForFunction(
  id => {
    const v = window.JBrowseSession.views.find(x => x.id === id)
    return !!v && (!!v.hasGraph || v.error !== undefined)
  },
  { timeout: 300000 },
  viewId,
)
const cutMs = Date.now() - t0
const view = await page.evaluate(id => {
  const v = window.JBrowseSession.views.find(x => x.id === id)
  const plugin = window.JBrowseRootModel.pluginManager.plugins.find(
    p => p.name === 'GraphGenomeView',
  )
  return { nodes: v.nodeCount, error: v.error && String(v.error), plugin: plugin?.version }
}, viewId)
await new Promise(r => setTimeout(r, +(process.env.SETTLE_MS ?? 3000)))
await browser.close()
console.log(
  JSON.stringify({
    date: new Date().toISOString(),
    load,
    trackId,
    refName,
    start: +start,
    end: +end,
    cutMs,
    ...view,
    requests: net.req,
    MB: +(net.bytes / 1e6).toFixed(2),
    urls: net.urls,
  }),
)

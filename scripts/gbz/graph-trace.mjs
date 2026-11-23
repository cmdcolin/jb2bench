import { launch } from 'puppeteer'
import { writeFileSync } from 'node:fs'
import { hostname, loadavg } from 'node:os'
// node graph-trace.mjs <trackId> <refName> <start> <end>
// Opens a GraphGenomeView on a graph track from a cold cache and counts the
// range requests to the graph's BED files and indexes until SETTLE_MS after
// the drawing. cutMs stops when the view holds the cut graph; drawnMs when its
// layout is in place, its status line is clear and two frames have painted.
// CONFIG, APP and DATA default to the hosted HPRC demo; SHOT saves a
// screenshot and NODES writes the ids of the graph's nodes, one per line.
const [trackId, refName, start, end] = process.argv.slice(2)
const load = loadavg()[0]
const config = process.env.CONFIG ?? 'https://jbrowse.org/demos/hprc/config.json'
const app = process.env.APP ?? 'https://jbrowse.org/code/jb2/main'
const data = process.env.DATA ?? 'https://jbrowse.org/demos/hprc/'
const appVersion = await fetch(`${app}/version.txt`)
  .then(r => (r.ok ? r.text() : undefined))
  .then(t => t?.trim())
  .catch(() => undefined)
const url = `${app}/?config=${encodeURIComponent(config)}`
const browser = await launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const net = { req: 0, bytes: 0, urls: {} }
const isData = u => u.startsWith(data) && /\.bed\.gz(\.tbi)?$/.test(u)
const pluginBuilds = new Set()
const watch = c => {
  const ids = new Map()
  c.on('Network.requestWillBeSent', e => {
    const build = /\/jbrowse-plugin-graphgenomeviewer\/([^/]+)\//.exec(e.request.url)?.[1]
    if (build) pluginBuilds.add(build)
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
await page.waitForFunction(
  id => {
    const v = window.JBrowseSession.views.find(x => x.id === id)
    return (
      v.error !== undefined ||
      v.nodeCount === 0 ||
      (v.layoutResult !== undefined && !v.statusMessage)
    )
  },
  { timeout: 300000 },
  viewId,
)
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const drawnMs = Date.now() - t0
const { nodeIds, ...view } = await page.evaluate(id => {
  const v = window.JBrowseSession.views.find(x => x.id === id)
  const plugin = window.JBrowseRootModel.pluginManager.plugins.find(
    p => p.name === 'GraphGenomeView',
  )
  return {
    nodes: v.nodeCount,
    links: v.edgeCount,
    error: v.error && String(v.error),
    plugin: plugin?.version,
    nodeIds: (v.graph?.nodes ?? []).map(n => n.id),
  }
}, viewId)
if (process.env.NODES) {
  writeFileSync(process.env.NODES, nodeIds.map(id => `${id}\n`).join(''))
}
await new Promise(r => setTimeout(r, +(process.env.SETTLE_MS ?? 3000)))
if (process.env.SHOT) {
  await page.screenshot({ path: process.env.SHOT })
}
await browser.close()
console.log(
  JSON.stringify({
    date: new Date().toISOString(),
    host: hostname(),
    load,
    loadAfter: loadavg()[0],
    app,
    appVersion,
    trackId,
    refName,
    start: +start,
    end: +end,
    cutMs,
    drawnMs,
    ...view,
    pluginBuilds: [...pluginBuilds],
    requests: net.req,
    MB: +(net.bytes / 1e6).toFixed(2),
    urls: net.urls,
  }),
)

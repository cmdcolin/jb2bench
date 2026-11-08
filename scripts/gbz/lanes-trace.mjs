import { readFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { launch } from 'puppeteer'
// node lanes-trace.mjs <trackId> <loc> [trackConf.json]
// Opens a linear genome view on the HPRC demo with one lanes track as a
// MultiWaySyntenyDisplay, from a cold cache, and counts the requests and bytes
// to that track's files until the network has been quiet for 8 s. A track the
// hosted config no longer carries is added from trackConf.json.
const [trackId, loc, confPath] = process.argv.slice(2)
const trackConf = confPath ? JSON.parse(readFileSync(confPath, 'utf8')) : undefined
const load = loadavg()[0]
const match = {
  hprc_v2_1_walk_lanes: u => u.includes('/demos/hprc/hprc-v2.1-mc-grch38-f5s.GRCh38'),
  hprc_v2_1_gbz_lanes: u => /gbz\.db|haplotype-index/.test(u),
  hprc_v2_1_pif_lanes: u => u.includes('hprc_multiway_gfa.pif.gz'),
}[trackId]
const build = 'https://jbrowse.org/code/jb2/main/'
const config = 'https://jbrowse.org/demos/hprc/config.json'
const browser = await launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const net = { req: 0, bytes: 0, last: 0, first: 0, urls: {} }
const watch = c => {
  const ids = new Set()
  c.on('Network.requestWillBeSent', e => {
    if (match(e.request.url)) {
      ids.add(e.requestId)
      net.req++
      net.last = Date.now()
      const name = e.request.url.split('/').pop()
      net.urls[name] = (net.urls[name] ?? 0) + 1
    }
  })
  c.on('Network.loadingFinished', e => {
    if (ids.has(e.requestId)) {
      net.bytes += e.encodedDataLength
      net.last = Date.now()
    }
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
await page.goto(`${build}?config=${encodeURIComponent(config)}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 120000 })
await page
  .waitForFunction(
    () =>
      window.JBrowseRootModel.pluginManager.displayTypes?.has?.('MultiWaySyntenyDisplay') ?? true,
    { timeout: 120000 },
  )
  .catch(() => {})
await new Promise(r => setTimeout(r, 3000))
const t0 = Date.now()
await page.evaluate(
  async ({ trackId: id, loc: locString, trackConf: conf }) => {
    if (conf) {
      window.JBrowseSession.addTrackConf(conf)
    }
    const view = window.JBrowseSession.addView('LinearGenomeView', {})
    await view.navToLocString(locString, 'hg38')
    view.showTrack(id, {}, { type: 'MultiWaySyntenyDisplay' })
  },
  { trackId, loc, trackConf },
)
while (net.req === 0 || Date.now() - net.last < 8000) {
  if (Date.now() - t0 > 180000) break
  await new Promise(r => setTimeout(r, 250))
}
const version = await page
  .evaluate(async b => (await (await fetch(`${b}version.txt`)).text()).trim(), build)
  .catch(() => null)
const plugin = await page.evaluate(
  () =>
    window.JBrowseRootModel.pluginManager.plugins.find(p => p.name === 'GraphGenomeView')?.version,
)
await browser.close()
console.log(
  JSON.stringify({
    date: new Date().toISOString(),
    load,
    plugin,
    trackId,
    loc,
    requests: net.req,
    MB: +(net.bytes / 1e6).toFixed(2),
    lastMs: net.last - t0,
    urls: net.urls,
    version,
  }),
)

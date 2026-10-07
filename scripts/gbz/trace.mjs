import puppeteer from 'puppeteer'
// node trace.mjs <track> <loc> [pan=button|drag|none] [extraJSON]
const [track, loc, pan = 'none', extraArg = '{}'] = process.argv.slice(2)
const extra = JSON.parse(extraArg)
const config = extra.config ?? 'https://jbrowse.org/demos/hprc_multiway/config.json'
const trackEntry = extra.display ? { trackId: track, type: 'MultiWaySyntenyDisplay', ...extra.display } : track
const session = { views: [{ type: 'LinearGenomeView', assembly: 'hg38', loc, tracks: ['hg38_ncbiRefSeq_ucsc', trackEntry] }] }
if (extra.sessionTracks) session.sessionTracks = extra.sessionTracks
const url = `https://jbrowse.org/code/jb2/main/?config=${encodeURIComponent(config)}&session=spec-${encodeURIComponent(JSON.stringify(session))}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
let t0 = Date.now()
const net = { req: 0, bytes: 0, inflight: 0, last: 0 }
const isData = u => /\.gbz\.db|haplotype-index|\.pif\.gz/.test(u)
const watch = c => { const ids = new Set(); c.on('Network.requestWillBeSent', e => { if (isData(e.request.url)) { ids.add(e.requestId); net.req++; net.inflight++ } }); const d = e => { if (ids.delete(e.requestId)) { net.inflight--; net.bytes += e.encodedDataLength ?? 0; net.last = Date.now() - t0 } }; c.on('Network.loadingFinished', d); c.on('Network.loadingFailed', d) }
const pc = await page.createCDPSession(); await pc.send('Network.enable'); watch(pc)
page.on('workercreated', async w => { try { await w.client.send('Network.enable'); watch(w.client) } catch {} })
const log = []
const snap = () => page.evaluate(() => {
  const out = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const s = n.textContent.trim(); if (/Reading|Opening|Downloading|Loading|lane pair|Zoom in|Error/i.test(s) && n.parentElement.closest('[data-testid="multiway-synteny-display"],[data-testid="loading-overlay"]')) out.push(s.slice(0, 90)) }
  const d = document.querySelector('[data-testid="multiway-synteny-display"]')
  return `${d?.getAttribute('data-display-phase')} | ${[...new Set(out)].join(' || ')}`
})
async function run(name, maxMs = 200000) {
  let last = '', readyAt = null, lastChange = 0
  const t = () => Date.now() - t0
  while (t() < maxMs) {
    await new Promise(r => setTimeout(r, 100))
    const s = await snap()
    if (s !== last) { log.push([name, t(), s, net.req]); last = s; lastChange = t() }
    if (s.startsWith('ready |') && s.trim() === 'ready |') { readyAt ??= t() } else readyAt = null
    if (readyAt !== null && t() - readyAt > 4000 && net.inflight === 0) break
  }
  return { name, readyMs: readyAt, lastNetMs: net.last, req: net.req, MB: +(net.bytes / 1e6).toFixed(2) }
}
const res = []
await page.goto(url, { waitUntil: 'domcontentloaded' })
res.push(await run('load'))
if (pan !== 'none') {
  const r = await page.evaluate(() => { const b = document.querySelector('[data-testid="multiway-synteny-display"]').getBoundingClientRect(); return [b.x, b.y] })
  t0 = Date.now(); Object.assign(net, { req: 0, bytes: 0, last: 0 })
  if (pan === 'button') await page.click('[aria-label="Pan right"]')
  else { const y = r[1] + 40, x0 = 1100; await page.mouse.move(x0, y); await page.mouse.down(); for (let i = 1; i <= 20; i++) { await page.mouse.move(x0 - (530 * i) / 20, y); await new Promise(q => setTimeout(q, 16)) } await page.mouse.up() }
  res.push(await run('pan-' + pan))
}
await page.screenshot({ path: `trace-${track}-${extra.tag ?? ''}.png` })
await browser.close()
console.log(JSON.stringify({ track, loc, tag: extra.tag, res, log }))

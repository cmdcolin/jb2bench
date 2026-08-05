// Capture a main-thread CPU profile of a page that is doing NOTHING.
//
// flameprofile.ts profiles one render and interaction-profile.ts profiles a
// gesture; neither answers "what is this page spending CPU on while nobody
// touches it", which is the question flame/ZOOM_SETTLE.md leaves open. Settle
// the initial render, then profile a window of pure idle.
//
// Usage: restprofile.ts <url> <label> [idleMs]
// Writes flame/<label>.main.cpuprofile — feed it to cpuprofile2collapsed.ts and
// hotfns.ts the same way as the other profiles.
import crypto from 'crypto'
import fs from 'fs'
import puppeteer from 'puppeteer'

const url = process.argv[2]
const label = process.argv[3] ?? 'rest'
const idleMs = Number(process.argv[4] ?? 5000)
if (!url) {
  throw new Error('usage: restprofile.ts <url> <label> [idleMs]')
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
await page.goto(url, { waitUntil: 'domcontentloaded' })

// same settle as zoomprofile.ts, so "at rest" means what it means there
{
  let last = ''
  let stable = 0
  const deadline = Date.now() + 120000
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('initial render did not settle')
    }
    const h = crypto
      .createHash('sha1')
      .update(await page.screenshot({ type: 'png', optimizeForSpeed: true }))
      .digest('hex')
    if (h === last) {
      stable++
    } else {
      stable = 0
      last = h
    }
    if (stable >= 3) {
      break
    }
    await new Promise(r => setTimeout(r, 100))
  }
}

const client = await page.createCDPSession()
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 100 })
await client.send('Profiler.start')
await new Promise(r => setTimeout(r, idleMs))
const { profile } = await client.send('Profiler.stop')

fs.mkdirSync('flame', { recursive: true })
const out = `flame/${label}.main.cpuprofile`
fs.writeFileSync(out, JSON.stringify(profile))
console.log(`wrote ${out} (${idleMs} ms of idle, ${profile.samples?.length ?? 0} samples)`)

await browser.close()

import puppeteer from 'puppeteer'

const url = process.argv[2]
const shot = process.argv[3]
if (!url) {
  throw new Error('usage: probe.ts <url> [screenshot]')
}

const browser = await puppeteer.launch({
  headless: false,
  args: ['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--enable-features=Vulkan','--window-size=1280,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const logs: string[] = []
page.on('console', m => {
  const t = m.text()
  if (/GPU|backend|WebGPU|WebGL|VALIDATION|fall/i.test(t)) {
    logs.push(t.slice(0, 140))
  }
})
await page.goto(url, { waitUntil: 'load' })
await new Promise(r => setTimeout(r, 12000))
const info = await page.evaluate(() => {
  const counts: Record<string, number> = {}
  for (const e of document.querySelectorAll('[data-testid]')) {
    const id = e.getAttribute('data-testid')!
    counts[id] = (counts[id] || 0) + 1
  }
  const interesting = Object.fromEntries(
    Object.entries(counts).filter(([k]) =>
      /pileup|wiggle|snpcov|display|overlay|drawn|loading|done/i.test(k),
    ),
  )
  return { hasWebGPU: !!(navigator as any).gpu, canvases: document.querySelectorAll('canvas').length, interesting }
})
if (shot) {
  await page.screenshot({ path: shot })
}
console.log('URL:', url)
console.log('gpu:', info.hasWebGPU, 'canvas:', info.canvases)
console.log('logs:', logs.length ? logs.slice(0, 4) : '(none)')
console.log('testids:', JSON.stringify(info.interesting))
await browser.close()

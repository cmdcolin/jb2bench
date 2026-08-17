// Why does this box have no WebGPU? scripts/gpucheck.ts reports
// navigator.gpu: false under every flag set tried, headless and headful alike,
// so read Chrome's own answer out of chrome://gpu rather than guessing.
import puppeteer from 'puppeteer'

const BASE = ['--no-sandbox', '--ignore-gpu-blocklist', '--window-size=1280,900']

const combos: {
  name: string
  args: string[]
  headless: boolean
  channel?: 'chrome'
}[] = [
  {
    name: 'bundled chrome, headless, unsafe-webgpu + Vulkan',
    args: [...BASE, '--enable-unsafe-webgpu', '--enable-features=Vulkan'],
    headless: true,
  },
  {
    name: 'bundled chrome, headless, --enable-features=Vulkan,WebGPU',
    args: [...BASE, '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
    headless: true,
  },
  {
    name: 'system google-chrome, headless, unsafe-webgpu + Vulkan',
    args: [...BASE, '--enable-unsafe-webgpu', '--enable-features=Vulkan'],
    headless: true,
    channel: 'chrome',
  },
]

for (const c of combos) {
  let browser
  try {
    browser = await puppeteer.launch({
      headless: c.headless,
      args: c.args,
      ...(c.channel ? { channel: c.channel } : {}),
    })
    const page = await browser.newPage()
    const has = await page.evaluate(
      () => !!(navigator as unknown as { gpu?: unknown }).gpu,
    )
    console.log(`\n=== ${c.name}`)
    console.log(`navigator.gpu: ${has}`)
    await page.goto('chrome://gpu', { waitUntil: 'domcontentloaded' })
    const lines = await page.evaluate(() =>
      (document.body.innerText || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => /webgpu|vulkan|dawn/i.test(l))
        .slice(0, 12),
    )
    for (const l of lines) {
      console.log(`   ${l}`)
    }
  } catch (e) {
    console.log(`\n=== ${c.name}\nERR ${String(e).split('\n')[0]}`)
  } finally {
    await browser?.close()
  }
}

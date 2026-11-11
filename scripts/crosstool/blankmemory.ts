// The browser's own cost: a scoped Chrome on about:blank, with the same flags
// and the same cgroup reading as a MEMORY_PEAK=1 cold load. Prints one JSON line.
import { executablePath, launch } from 'puppeteer'
import { ANGLE_ARGS } from '../angleargs.ts'
import { dropCaches, scopedChrome, watchScope } from './cgroupmemory.ts'

const cachesDropped = dropCaches()
const browser = await launch({
  executablePath: scopedChrome,
  env: { ...process.env, SCOPED_CHROME: executablePath() },
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    ...ANGLE_ARGS,
    '--window-size=1280,900',
  ],
})
const scope = watchScope(browser.process()?.pid ?? 0)
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
await page.goto('about:blank')
await new Promise(r => setTimeout(r, 3000))
console.log(JSON.stringify({ ...scope.stop(), cachesDropped }))
await browser.close()

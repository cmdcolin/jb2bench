// Which Chrome flags reach a hardware adapter here, headless, the way the panel
// launches it: one JSON line per flag set with the WebGL2 renderer, the WebGPU
// adapter and whether each is hardware. Exits 1 if the configured set
// (CHROME_ANGLE, see scripts/angleargs.ts) has a software WebGL2, since every
// webgl number would then be a SwiftShader number.
//
// Usage: node --experimental-strip-types ec2mac/gpuprobe.ts
import http from 'node:http'
import { launch } from 'puppeteer'
import { ANGLE_ARGS } from '../scripts/angleargs.ts'
import { gpuInfo } from '../scripts/crosstool/gpuinfo.ts'

const base = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-features=Vulkan']
const SETS: Record<string, string[]> = {
  configured: [...base, ...ANGLE_ARGS],
  'configured+unsafe-webgpu': [...base, ...ANGLE_ARGS, '--enable-unsafe-webgpu'],
  ...(process.platform === 'darwin'
    ? { 'chrome-default': ['--no-sandbox'], metal: [...base, '--use-angle=metal'] }
    : { 'angle-gl-egl': [...base, '--use-angle=gl-egl', '--use-gl=angle'] }),
}

const server = http.createServer((_, res) => res.end('<!doctype html><title>probe</title>'))
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const url = `http://localhost:${(server.address() as { port: number }).port}/`

let configuredHardware = false
for (const [set, args] of Object.entries(SETS)) {
  const browser = await launch({ headless: true, args })
  const page = await browser.newPage()
  await page.goto(url)
  const g = await gpuInfo(page)
  if (set === 'configured') {
    configuredHardware = g.glHardware
  }
  console.log(
    JSON.stringify({
      set,
      version: await browser.version(),
      glRenderer: g.glRenderer,
      glHardware: g.glHardware,
      webgpuAdapter: g.webgpuAdapter,
      webgpuHardware: g.webgpuHardware,
      hardwareConcurrency: g.hardwareConcurrency,
    }),
  )
  await browser.close()
}
server.close()
process.exit(configuredHardware ? 0 : 1)

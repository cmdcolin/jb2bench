// Which Chrome launch flags reach the instance's GPU in headless mode.
//
// The harness launches every page with ANGLE_ARGS (scripts/angleargs.ts). On
// the workstation the default reaches the Mesa Intel GPU; on the T4 with no X
// server it gets no WebGL2 at all. Each set is tried in turn and printed as one
// JSON line: the WebGL renderer, the WebGPU adapter, and `hardware`, which is
// true only when WebGL2 runs on a real GPU. The paper's numbers are WebGL2, so
// a software WebGPU adapter does not fail the set.
//
// Usage: node --experimental-strip-types ec2/gpuprobe.ts
import http from 'node:http'
import puppeteer from 'puppeteer'
import { ANGLE_ARGS } from '../scripts/angleargs.ts'

const SETS: Record<string, string[]> = {
  configured: ['--ignore-gpu-blocklist', '--enable-features=Vulkan', ...ANGLE_ARGS],
  'workstation-default': ['--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-angle=gl', '--use-gl=angle'],
  'angle-vulkan': ['--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-angle=vulkan', '--enable-unsafe-webgpu'],
  'angle-gl-egl': ['--ignore-gpu-blocklist', '--use-angle=gl-egl', '--use-gl=angle', '--enable-unsafe-webgpu'],
}

// navigator.gpu exists only in a secure context, and about:blank is not one, so
// the probe page is served from localhost.
const server = http.createServer((_, res) => res.end('<!doctype html><title>probe</title>'))
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const url = `http://localhost:${(server.address() as { port: number }).port}/`

for (const [name, flags] of Object.entries(SETS)) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', ...flags] })
  const page = await browser.newPage()
  await page.goto(url)
  const info = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no-webgl2'
    let webgpu = 'no navigator.gpu'
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ info?: { vendor: string; architecture: string } } | null> } }).gpu
    if (gpu) {
      const a = await gpu.requestAdapter().catch(() => null)
      webgpu = a ? `${a.info?.vendor ?? '?'} ${a.info?.architecture ?? ''}`.trim() : 'no adapter'
    }
    return { renderer: String(renderer), webgpu }
  })
  const hardware = info.renderer !== 'no-webgl2' && !/swiftshader|llvmpipe|software/i.test(info.renderer)
  console.log(JSON.stringify({ set: name, ...info, hardware }))
  await browser.close()
}
server.close()

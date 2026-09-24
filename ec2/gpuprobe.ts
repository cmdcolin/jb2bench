// Which Chrome launch flags reach the instance's GPU in headless mode.
//
// The harness launches every page with the flags in HARNESS below. On the
// workstation they reach the Mesa Intel GPU; on a cloud NVIDIA GPU with no X
// server they may land on SwiftShader instead, which would time a software
// rasterizer. Each set is tried in turn, and the WebGL renderer string and
// WebGPU adapter it gets are printed as one JSON line.
//
// Usage: node --experimental-strip-types ec2/gpuprobe.ts
import http from 'node:http'
import puppeteer from 'puppeteer'

const HARNESS = ['--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-angle=gl', '--use-gl=angle']

const SETS: Record<string, string[]> = {
  harness: HARNESS,
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
  const software = /swiftshader|llvmpipe|software/i.test(info.renderer + ' ' + info.webgpu)
  console.log(JSON.stringify({ set: name, ...info, software }))
  await browser.close()
}
server.close()

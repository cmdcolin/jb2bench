import http from 'node:http'
import { launch } from 'puppeteer'
const base = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']
const SETS = {
  'vk-native': [...base, '--enable-features=Vulkan', '--use-vulkan=native', '--use-angle=vulkan'],
  'vk-full': [...base, '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--use-angle=vulkan'],
  'gl-egl+vk': [...base, '--enable-features=Vulkan', '--use-angle=gl-egl', '--use-gl=angle'],
  'webgpu-only': [...base, '--enable-features=Vulkan'],
}
const server = http.createServer((_, r) => r.end('<!doctype html><title>p</title>'))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `http://localhost:${server.address().port}/`
const modes = process.env.DISPLAY ? [false, true] : [true]
for (const headless of modes) for (const [name, args] of Object.entries(SETS)) {
  let out
  try {
    const b = await launch({ headless, args, dumpio: false })
    const p = await b.newPage(); await p.goto(url)
    out = await p.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      const renderer = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no-webgl2'
      let webgpu = 'no navigator.gpu', canvas = ''
      if (navigator.gpu) {
        const a = await navigator.gpu.requestAdapter().catch(e => String(e))
        if (a && typeof a === 'object') {
          webgpu = `${a.info?.vendor} | ${a.info?.architecture} | ${a.info?.device} | ${a.info?.description}`
          try {
            const d = await a.requestDevice()
            const c = document.createElement('canvas'); c.width = c.height = 4
            const ctx = c.getContext('webgpu'); ctx.configure({ device: d, format: navigator.gpu.getPreferredCanvasFormat() })
            const enc = d.createCommandEncoder()
            enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [1, 0, 0, 1], storeOp: 'store' }] }).end()
            d.queue.submit([enc.finish()]); await d.queue.onSubmittedWorkDone()
            canvas = 'render ok'
          } catch (e) { canvas = 'device/canvas error: ' + e }
        } else webgpu = 'no adapter ' + (a ?? '')
      }
      return { renderer, webgpu, canvas }
    })
    out.chrome = await b.version(); await b.close()
  } catch (e) { out = { error: String(e).slice(0, 200) } }
  console.log(JSON.stringify({ set: name, headless, ...out }))
}
server.close()

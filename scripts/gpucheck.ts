// Reports the WebGL UNMASKED_RENDERER string and WebGPU availability under a
// given puppeteer launch mode, to decide whether headless keeps hardware accel
// on this box. "Mesa Intel..." => real GPU; "SwiftShader"/"llvmpipe" => software
// fallback (would make the GPU-branch benchmark unfair).
//
// Usage: gpucheck.ts [headless|headful]
import puppeteer from 'puppeteer'

const mode = process.argv[2] ?? 'headless'
const headless = mode !== 'headful'

const browser = await puppeteer.launch({
  headless,
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
  ],
})
const page = await browser.newPage()
const info = await page.evaluate(() => {
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2') ?? c.getContext('webgl')
  let renderer = 'no-webgl'
  let vendor = ''
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    renderer = ext
      ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string)
    vendor = ext
      ? (gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string)
      : (gl.getParameter(gl.VENDOR) as string)
  }
  return { renderer, vendor, hasWebGPU: !!(navigator as any).gpu }
})
console.log(`mode: ${headless ? 'headless' : 'headful'}`)
console.log(`webgl vendor:   ${info.vendor}`)
console.log(`webgl renderer: ${info.renderer}`)
console.log(`navigator.gpu:  ${info.hasWebGPU}`)
const software = /swiftshader|llvmpipe|software/i.test(info.renderer)
console.log(`=> ${software ? 'SOFTWARE fallback (unfair for GPU bench)' : 'HARDWARE GPU'}`)
await browser.close()

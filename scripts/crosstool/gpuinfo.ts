// What the page ran on, read after the clock stops: the WebGL2 renderer string,
// the WebGPU adapter, which context type the page's own canvases hold, and the
// core count the page sees. Printed by paintprofile.ts and panprofile.ts as a
// `GPU {json}` line when GPU_PROBE=1, so ec2mac/panel.ts can refuse to count a
// run whose pinned backend landed on a software adapter (SwiftShader, llvmpipe)
// or on a different rung than the one asked for.
import type { Page } from 'puppeteer'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i

interface AdapterInfo {
  vendor?: string
  architecture?: string
  description?: string
  isFallbackAdapter?: boolean
}
interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<{ info?: AdapterInfo } | null> }
}

export async function gpuInfo(page: Page) {
  const seen = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const glRenderer = gl
      ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
      : 'no-webgl2'
    const gpu = (navigator as GpuNavigator).gpu
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
    const info = adapter?.info
    const canvases = { webgpu: 0, webgl2: 0, canvas2d: 0, offscreen: 0 }
    for (const c of document.querySelectorAll('canvas')) {
      if (c.width > 0 && c.height > 0) {
        try {
          if (c.getContext('webgpu')) {
            canvases.webgpu++
          } else if (c.getContext('webgl2')) {
            canvases.webgl2++
          } else {
            canvases.canvas2d++
          }
        } catch {
          canvases.offscreen++
        }
      }
    }
    return {
      glRenderer,
      webgpuAdapter: !gpu
        ? 'no navigator.gpu'
        : info
          ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' ')
          : 'no adapter',
      webgpuFallback: info?.isFallbackAdapter ?? null,
      canvases,
      hardwareConcurrency: navigator.hardwareConcurrency,
    }
  })
  const rung =
    seen.canvases.webgpu > 0
      ? 'webgpu'
      : seen.canvases.webgl2 > 0
        ? 'webgl2'
        : seen.canvases.canvas2d > 0
          ? 'canvas2d'
          : 'unknown'
  const glHardware = seen.glRenderer !== 'no-webgl2' && !SOFTWARE.test(seen.glRenderer)
  const webgpuHardware =
    !seen.webgpuAdapter.startsWith('no ') &&
    seen.webgpuFallback !== true &&
    !SOFTWARE.test(seen.webgpuAdapter)
  return {
    ...seen,
    rung,
    glHardware,
    webgpuHardware,
    hardware: rung === 'webgpu' ? webgpuHardware : rung === 'webgl2' ? glHardware : null,
  }
}

export type GpuInfo = Awaited<ReturnType<typeof gpuInfo>>

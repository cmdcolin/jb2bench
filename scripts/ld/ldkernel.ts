// Shared plumbing for the LD compute-shader benchmarks (ldbench.ts, ldlimits.ts).
//
// Two things here are load-bearing and easy to get wrong:
//
// 1. **WebGPU needs a secure context.** `page.goto('about:blank')` is NOT one, and
//    `navigator.gpu` is simply `undefined` there — it looks exactly like "this
//    browser has no WebGPU". Serving a blank page over http://localhost fixes it.
//    (scripts/gpucheck.ts evaluates on the default about:blank page and so reports
//    `navigator.gpu: false` on machines that do support it.)
// 2. **Chrome resolution.** chromePath() resolves the browser puppeteer pins,
//    so these run on the same Chrome as the render benchmarks; it falls back to
//    scanning the puppeteer cache, then to a system Chrome.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import puppeteer from 'puppeteer'

import type { Browser, Page } from 'puppeteer'

export const JBROWSE =
  process.env.JBROWSE ?? path.join(os.homedir(), 'src/jbrowse-components')

// WebGPU in headless Chrome needs a backend the platform actually has.
//
// On Linux that means forcing Vulkan: the default (--use-angle=gl, as
// scripts/gpucheck.ts uses for WebGL) does not expose WebGPU at all.
//
// On macOS it means NOT forcing it. WebGPU there is Metal, and passing
// --use-angle=vulkan makes `requestAdapter()` resolve to **null** while
// `navigator.gpu` stays truthy — so the page looks WebGPU-capable right up
// until the adapter is missing, and the failure reads as "no GPU on this
// machine" rather than "wrong flags".
export const GPU_ARGS =
  os.platform() === 'darwin'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']
    : [
        '--no-sandbox',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=vulkan',
      ]

export function chromePath(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH
  }
  // Prefer the browser this repo's puppeteer pins, so these benchmarks run on
  // the same Chrome as the render benchmarks (which launch puppeteer with no
  // executablePath and therefore always get that one).
  try {
    const pinned = puppeteer.executablePath()
    if (existsSync(pinned)) {
      return pinned
    }
  } catch {
    // no browser configured for this puppeteer install; fall through
  }
  // Fallback for a checkout whose puppeteer browser was never downloaded. Note
  // this orders version directories as strings, which is only approximately a
  // version order ("linux-99" sorts above "linux-100"), so it can pick an older
  // build than intended — it is a last resort, not the normal path.
  const cache = path.join(os.homedir(), '.cache/puppeteer/chrome')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      const p = path.join(cache, dir, 'chrome-linux64', 'chrome')
      if (existsSync(p)) {
        return p
      }
    }
  }
  try {
    return execSync('which google-chrome || which chromium', {
      encoding: 'utf8',
    }).trim()
  } catch {
    throw new Error(
      'no Chrome found; set PUPPETEER_EXECUTABLE_PATH or run `npx puppeteer browsers install chrome`',
    )
  }
}

// Reads WGSL out of a committed *.generated.ts in the jbrowse checkout, so these
// benchmarks always measure the shader the app actually ships.
export function loadWgsl(generatedRelPath: string): string {
  const src = readFileSync(path.join(JBROWSE, generatedRelPath), 'utf8')
  const m = /export const WGSL_SOURCE = ("(?:[^"\\]|\\.)*")/.exec(src)
  if (!m) {
    throw new Error(`no WGSL_SOURCE in ${generatedRelPath}`)
  }
  return JSON.parse(m[1]!) as string
}

export const LD_COMPUTE_WGSL =
  'plugins/variants/src/LDDisplay/components/shaders/ldCompute.generated.ts'

export const LD_PHASED_COMPUTE_WGSL =
  'plugins/variants/src/LDDisplay/components/shaders/ldPhasedCompute.generated.ts'

/**
 * Word indices of a compute kernel's uniform fields, read out of the generated
 * `.iface` file rather than restated here.
 *
 * Worth the parse: a benchmark that hardcodes the field order keeps running
 * after someone reorders the struct, and reports a plausible number computed
 * from a band written into the ldMetric slot. There is no error to notice —
 * which is the same failure shape ldlimits.ts exists to document.
 */
export function loadUniformOffsets(
  generatedRelPath: string,
): Record<string, number> {
  const ifacePath = generatedRelPath.replace(
    /\.generated\.ts$/,
    '.iface.generated.ts',
  )
  const src = readFileSync(path.join(JBROWSE, ifacePath), 'utf8')
  const block = /UNIFORM_OFFSET_U32 = \{([^}]*)\}/.exec(src)
  if (!block) {
    throw new Error(`no UNIFORM_OFFSET_U32 in ${ifacePath}`)
  }
  const offsets: Record<string, number> = {}
  for (const m of block[1]!.matchAll(/(\w+):\s*(\d+)/g)) {
    offsets[m[1]!] = Number(m[2]!)
  }
  return offsets
}

/** Uniform buffer size in bytes, likewise read from the generated iface. */
export function loadUniformsSize(generatedRelPath: string): number {
  const ifacePath = generatedRelPath.replace(
    /\.generated\.ts$/,
    '.iface.generated.ts',
  )
  const src = readFileSync(path.join(JBROWSE, ifacePath), 'utf8')
  const m = /UNIFORMS_SIZE_BYTES = (\d+)/.exec(src)
  if (!m) {
    throw new Error(`no UNIFORMS_SIZE_BYTES in ${ifacePath}`)
  }
  return Number(m[1]!)
}

/**
 * Device-creation options matching what the app does, and the reason a
 * benchmark must not call `requestDevice()` bare.
 *
 * A WebGPU DEVICE gets the spec's DEFAULT limits — maxStorageBufferBindingSize
 * 128 MiB — no matter what the adapter supports. Raising them is opt-in, and
 * `getGpuDevice()` in packages/render-core opts in:
 *
 *   requiredLimits: {
 *     maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
 *     maxBufferSize: adapter.limits.maxBufferSize,
 *   }
 *
 * Measured on amd rdna-1: the adapter reports 2 GiB, a bare device reports
 * 128 MiB, and a device asking for the adapter's maximum gets 2 GiB. So a
 * benchmark that skips this is measuring a device the app never creates, with a
 * ceiling 16x too low — and its symptom is rows that report DECLINED where the
 * app would have dispatched. Nothing errors; the table is just wrong.
 */
export async function requestAppLikeDevice(adapter: GPUAdapter) {
  return adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  })
}

export interface AdapterInfo {
  vendor: string
  architecture: string
  device: string
  description: string
  isFallbackAdapter: boolean
}

/** Substrings that mark a software rasterizer standing in for a GPU. */
const SOFTWARE_MARKERS = [
  'swiftshader',
  'lavapipe',
  'llvmpipe',
  'software',
  'warp',
  'microsoft basic',
]

/**
 * Refuse to report a GPU timing measured on a software adapter.
 *
 * This is not hypothetical: headless Chrome without a usable hardware backend
 * silently substitutes SwiftShader, and every WebGPU call keeps working. The
 * benchmark then prints a GPU column that is a CPU, and it looks like a slow
 * GPU rather than like a mistake.
 */
export function assertHardwareAdapter(info: AdapterInfo, allowSoftware = false) {
  const hay = `${info.vendor} ${info.architecture} ${info.device} ${info.description}`.toLowerCase()
  const marker = SOFTWARE_MARKERS.find(m => hay.includes(m))
  if ((marker || info.isFallbackAdapter) && !allowSoftware) {
    throw new Error(
      `refusing to report GPU timings from a software adapter (${marker ?? 'isFallbackAdapter'}: ${JSON.stringify(info)}).\n` +
        'Re-run headed, or pass --allow-software to record it deliberately.',
    )
  }
}

export interface GpuSession {
  page: Page
  browser: Browser
  close: () => Promise<void>
}

/**
 * `headed: true` runs a real browser window. Prefer it for anything whose number
 * is a GPU timing: headless Chrome can hand back a SOFTWARE adapter
 * (SwiftShader / lavapipe) that answers every WebGPU call correctly and is one
 * to two orders of magnitude slower, so the run succeeds and the figure is of a
 * CPU emulating a GPU. `assertHardwareAdapter` below is the other half of not
 * being fooled by it.
 */
export async function launchGpuPage(
  opts: { headed?: boolean } = {},
): Promise<GpuSession> {
  const srv = http.createServer((_q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html' })
    s.end('<html></html>')
  })
  await new Promise<void>(r => {
    srv.listen(0, '127.0.0.1', r)
  })
  const { port } = srv.address() as { port: number }
  const browser = await puppeteer.launch({
    headless: !opts.headed,
    executablePath: chromePath(),
    args: GPU_ARGS,
  })
  const page = await browser.newPage()
  // puppeteer types this payload as `unknown`, and rightly so: a page can throw
  // a non-Error value, in which case reading `.message` would log `undefined`
  // and swallow the actual failure.
  page.on('pageerror', err => {
    console.error(
      '  [pageerror]',
      err instanceof Error ? err.message : String(err),
    )
  })
  await page.goto(`http://localhost:${port}/`)
  // Both halves are checked, because they fail for different reasons and a
  // script that only asks the first one reports the wrong cause: `navigator.gpu`
  // absent is "WebGPU not enabled in this Chrome", while an adapter of null past
  // that is almost always the wrong backend flags for this platform (see
  // GPU_ARGS).
  const probe = await page.evaluate(async () => ({
    hasGpu: !!navigator.gpu,
    hasAdapter: !!(await navigator.gpu?.requestAdapter()),
  }))
  if (!probe.hasGpu || !probe.hasAdapter) {
    await browser.close()
    srv.close()
    throw new Error(
      probe.hasGpu
        ? `navigator.gpu present but requestAdapter() returned null on ${os.platform()} — check GPU_ARGS for this platform`
        : 'navigator.gpu unavailable — WebGPU not enabled in this Chrome',
    )
  }
  return {
    page,
    browser,
    close: async () => {
      await browser.close()
      srv.close()
    },
  }
}

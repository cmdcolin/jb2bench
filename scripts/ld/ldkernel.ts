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

// WebGPU in headless Chrome on this box needs the Vulkan backend; the default
// (--use-angle=gl, as scripts/gpucheck.ts uses for WebGL) does not expose it.
export const GPU_ARGS = [
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

export interface GpuSession {
  page: Page
  browser: Browser
  close: () => Promise<void>
}

export async function launchGpuPage(): Promise<GpuSession> {
  const srv = http.createServer((_q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html' })
    s.end('<html></html>')
  })
  await new Promise<void>(r => {
    srv.listen(0, '127.0.0.1', r)
  })
  const { port } = srv.address() as { port: number }
  const browser = await puppeteer.launch({
    headless: true,
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
  const ok = await page.evaluate(() => !!navigator.gpu)
  if (!ok) {
    await browser.close()
    srv.close()
    throw new Error('navigator.gpu unavailable — WebGPU not enabled in this Chrome')
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

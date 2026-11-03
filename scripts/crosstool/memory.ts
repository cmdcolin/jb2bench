// Memory at the end of a cold load, from three sources that answer different
// questions:
//
//   jsHeap    Runtime.getHeapUsage on the page and on every dedicated worker,
//             summed. The V8 heaps the tool's own JavaScript lives in.
//             Performance.getMetrics' JSHeapUsedSize is the page's alone and
//             would miss JBrowse's worker pool entirely.
//   process   Linux /proc for every process under the launched Chrome, grouped
//             by Chrome's --type. `pss` shares each shared page among the
//             processes mapping it, so the per-type sums add up to the whole
//             browser without double counting; `peakRss` is VmHWM, each
//             process's own high-water mark, so its sum is an upper bound on
//             the simultaneous peak.
//   gpuDevice nvidia-smi's memory.used for the whole device at the end, minus
//             the same reading taken before Chrome launched. One browser runs
//             at a time, so the difference is this page's device allocations
//             (textures, buffers, the swap chain). Null where there is no
//             NVIDIA driver, as on the workstation.
import { execFileSync } from 'child_process'
import fs from 'fs'
import type { Browser, Page } from 'puppeteer'

const MB = 1024 * 1024

export function gpuDeviceUsedMB() {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const v = Number.parseFloat(out.trim().split('\n')[0] ?? '')
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function descendants(root: number) {
  const parent = new Map<number, number>()
  for (const d of fs.readdirSync('/proc')) {
    if (/^\d+$/.test(d)) {
      try {
        const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8')
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
        parent.set(Number(d), ppid)
      } catch {}
    }
  }
  const out = [root]
  for (let i = 0; i < out.length; i++) {
    for (const [pid, ppid] of parent) {
      if (ppid === out[i]) {
        out.push(pid)
      }
    }
  }
  return out
}

function kbField(text: string, name: string) {
  const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text)
  return m ? Number(m[1]) : 0
}

function processMemory(root: number) {
  const byType: Record<string, { count: number; pssMB: number; rssMB: number; peakRssMB: number }> = {}
  for (const pid of descendants(root)) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      const type = /--type=([\w-]+)/.exec(cmd)?.[1] ?? (pid === root ? 'browser' : 'other')
      const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      const t = (byType[type] ??= { count: 0, pssMB: 0, rssMB: 0, peakRssMB: 0 })
      t.count++
      t.pssMB += kbField(rollup, 'Pss') / 1024
      t.rssMB += kbField(rollup, 'Rss') / 1024
      t.peakRssMB += kbField(status, 'VmHWM') / 1024
    } catch {}
  }
  const totalPssMB = Object.values(byType).reduce((n, t) => n + t.pssMB, 0)
  return { byType, totalPssMB }
}

async function jsHeap(page: Page) {
  const sessions = [
    await page.createCDPSession(),
    ...page.workers().map(w => w.client),
  ]
  const usage = await Promise.all(
    sessions.map(s =>
      s
        .send('Runtime.getHeapUsage')
        .then(u => ({ used: u.usedSize, total: u.totalSize }))
        .catch(() => null),
    ),
  )
  const ok = usage.filter(u => u !== null)
  return {
    isolates: ok.length,
    usedMB: ok.reduce((n, u) => n + u.used, 0) / MB,
    totalMB: ok.reduce((n, u) => n + u.total, 0) / MB,
  }
}

export async function sampleMemory(browser: Browser, page: Page, gpuBaselineMB: number | null) {
  const pid = browser.process()?.pid
  const gpuNow = gpuDeviceUsedMB()
  return {
    jsHeap: await jsHeap(page),
    process: pid ? processMemory(pid) : null,
    gpuDevice:
      gpuNow !== null && gpuBaselineMB !== null
        ? { usedMB: gpuNow, baselineMB: gpuBaselineMB, deltaMB: gpuNow - gpuBaselineMB }
        : null,
  }
}

export type MemorySample = Awaited<ReturnType<typeof sampleMemory>>

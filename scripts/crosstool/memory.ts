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
//             On macOS there is no /proc: `ps -axo pid=,ppid=,rss=,command=`
//             gives each process's resident set, grouped the same way. RSS
//             counts a shared page once per process mapping it, so the macOS
//             sum overstates the browser's footprint where the Linux PSS sum
//             does not, and macOS has no per-process high-water mark to read.
//             Apple silicon has unified memory, so GPU allocations land in the
//             GPU process's RSS rather than in a separate device counter.
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

export function descendants(root: number) {
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
  const byType: Record<string, { count: number; pssMB: number; rssMB: number; peakRssMB: number }> =
    {}
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
  return { source: 'proc' as const, byType, totalPssMB }
}

interface PsRow {
  pid: number
  ppid: number
  rssKB: number
  command: string
}

export function parsePs(text: string) {
  const rows: PsRow[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) {
      rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKB: Number(m[3]), command: m[4]! })
    }
  }
  return rows
}

export function psMemory(rows: PsRow[], root: number) {
  const tree = [root]
  for (let i = 0; i < tree.length; i++) {
    for (const r of rows) {
      if (r.ppid === tree[i]) {
        tree.push(r.pid)
      }
    }
  }
  const byType: Record<string, { count: number; rssMB: number }> = {}
  for (const r of rows.filter(row => tree.includes(row.pid))) {
    const type = /--type=([\w-]+)/.exec(r.command)?.[1] ?? (r.pid === root ? 'browser' : 'other')
    const t = (byType[type] ??= { count: 0, rssMB: 0 })
    t.count++
    t.rssMB += r.rssKB / 1024
  }
  const totalRssMB = Object.values(byType).reduce((n, t) => n + t.rssMB, 0)
  return { source: 'ps-rss' as const, byType, totalRssMB }
}

function darwinProcessMemory(root: number) {
  const out = execFileSync('ps', ['-ww', '-axo', 'pid=,ppid=,rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  })
  return psMemory(parsePs(out), root)
}

async function jsHeap(page: Page) {
  const sessions = [await page.createCDPSession(), ...page.workers().map(w => w.client)]
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
    process: pid
      ? process.platform === 'darwin'
        ? darwinProcessMemory(pid)
        : processMemory(pid)
      : null,
    gpuDevice:
      gpuNow !== null && gpuBaselineMB !== null
        ? { usedMB: gpuNow, baselineMB: gpuBaselineMB, deltaMB: gpuNow - gpuBaselineMB }
        : null,
  }
}

export type MemorySample = Awaited<ReturnType<typeof sampleMemory>>

export const procMemory = (m: MemorySample) =>
  m.process?.source === 'proc' ? m.process : undefined

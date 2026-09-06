// CPU and memory of a process and everything under it, from /proc.
//
// Read from /proc rather than asked of the page. Two reasons, and the first is
// the one that matters: the case this exists for is a browser that has stopped
// answering, and anything that goes through CDP inherits the hang it is trying
// to measure. The second is that a Chrome tab's cost is spread across processes
// — browser, GPU, renderers, utility — and `page.metrics()` sees only the JS
// heap of one of them. At the 1 Mb window that is the difference between
// reporting 400 MB and reporting the 5.5 GB release 2.4.0 actually takes.
import fs from 'node:fs'

export interface TreeStats {
  /** CPU seconds burned by the tree since it started */
  cpuSeconds: number
  /** resident bytes summed across the tree, right now */
  rssBytes: number
  /** how many processes were counted, so an empty tree is visible as one */
  procs: number
}

const CLK_TCK = Number(process.env.CLK_TCK ?? 100)
const PAGE_SIZE = 4096

export function treeStats(root: number): TreeStats {
  const children = new Map<number, number[]>()
  const own = new Map<number, { cpu: number; rss: number }>()
  for (const entry of fs.readdirSync('/proc')) {
    const pid = Number(entry)
    if (!pid) {
      continue
    }
    let stat: string
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    } catch {
      continue // exited between readdir and read
    }
    // The comm field is parenthesised and can contain spaces, so fields are
    // counted from after the LAST ')' rather than by splitting the whole line.
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const ppid = Number(f[1])
    own.set(pid, {
      cpu: (Number(f[11]) + Number(f[12])) / CLK_TCK,
      rss: Number(f[21]) * PAGE_SIZE,
    })
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  let cpuSeconds = 0
  let rssBytes = 0
  let procs = 0
  const stack = [root]
  while (stack.length) {
    const pid = stack.pop()!
    const s = own.get(pid)
    if (s) {
      cpuSeconds += s.cpu
      rssBytes += s.rss
      procs++
    }
    stack.push(...(children.get(pid) ?? []))
  }
  return { cpuSeconds, rssBytes, procs }
}

/**
 * Samples a tree's resident memory and keeps the high-water mark.
 *
 * Peak and not final, because the number worth having is what the render cost
 * at its worst — a tab that peaks at 5.5 GB and settles at 2 GB will fail on a
 * machine with 4 GB free, and the settled figure would not say so.
 */
export function watchPeakRss(root: number, everyMs = 1000) {
  let peak = 0
  const sample = () => {
    const { rssBytes } = treeStats(root)
    peak = Math.max(peak, rssBytes)
  }
  sample()
  const timer = setInterval(sample, everyMs)
  timer.unref()
  return {
    stop: () => {
      sample()
      clearInterval(timer)
      return peak
    },
  }
}

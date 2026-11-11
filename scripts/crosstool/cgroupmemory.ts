// Peak memory of the whole browser over a cold load (MEMORY_PEAK=1): Chrome runs
// in a transient scope of its own, polled every 50 ms for its non-file charge,
// memory.current - file + shmem. memory.peak, which counts page cache, is the
// upper bound.
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { descendants } from './memory.ts'

const MB = 1024 * 1024
const POLL_MS = 50

export const peakMemoryWanted = process.env.MEMORY_PEAK === '1'
export const scopedChrome = path.join(import.meta.dirname, 'cgroup-chrome.sh')

export function dropCaches() {
  try {
    execFileSync('sudo', ['-n', 'sh', '-c', 'sync; echo 3 > /proc/sys/vm/drop_caches'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const cgroupOf = (pid: number) => {
  const entry = fs
    .readFileSync(`/proc/${pid}/cgroup`, 'utf8')
    .split('\n')
    .find(line => line.startsWith('0::'))
  return entry ? path.join('/sys/fs/cgroup', entry.slice(3)) : ''
}

function scopeDir(pid: number) {
  const dir = cgroupOf(pid)
  if (!/\/run-[^/]+\.scope$/.test(dir) || !fs.existsSync(path.join(dir, 'memory.peak'))) {
    throw new Error(
      `Chrome (pid ${pid}) is not in a transient scope with memory.peak: ${dir || 'no cgroup v2 entry'}`,
    )
  }
  return dir
}

const statBytes = (stat: string, key: string) =>
  Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(stat)?.[1] ?? Number.NaN)

export function watchScope(pid: number) {
  const dir = scopeDir(pid)
  const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8')
  const t0 = Date.now()
  let peakBytes = 0
  let peakAtMs = 0
  let samples = 0
  let lastAt = t0
  let maxGapMs = 0
  const sample = () => {
    const now = Date.now()
    const stat = read('memory.stat')
    const nonFile =
      Number(read('memory.current')) - statBytes(stat, 'file') + statBytes(stat, 'shmem')
    if (nonFile > peakBytes) {
      peakBytes = nonFile
      peakAtMs = now - t0
    }
    maxGapMs = Math.max(maxGapMs, now - lastAt)
    lastAt = now
    samples++
  }
  sample()
  const timer = setInterval(sample, POLL_MS)
  return {
    stop() {
      sample()
      clearInterval(timer)
      const strays = descendants(pid).filter(p => {
        try {
          return cgroupOf(p) !== dir
        } catch {
          return false
        }
      })
      if (strays.length) {
        throw new Error(`Chrome processes ${strays.join(', ')} are outside ${path.basename(dir)}`)
      }
      return {
        scope: path.basename(dir),
        peakNonFileMB: peakBytes / MB,
        peakNonFileAtMs: peakAtMs,
        memoryPeakMB: Number(read('memory.peak')) / MB,
        samples,
        maxGapMs,
      }
    },
  }
}

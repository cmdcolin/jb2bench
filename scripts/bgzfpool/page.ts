/**
 * Browser entry for the standalone arm: the same query jbrowse's adapters make,
 * with nothing above it. Bundled and driven by standalone.ts.
 */
import { BamFile } from '@gmod/bam'
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'
import { TabixIndexedFile } from '@gmod/tabix'

import type { BgzfWorkerPool } from '@gmod/bgzf-filehandle'

interface Reader {
  count: (refName: string, start: number, end: number) => Promise<number>
}

async function openBam(url: string, pool: BgzfWorkerPool | undefined) {
  const bam = new BamFile({ bamUrl: url, bgzfWorkerPool: pool })
  await bam.getHeader()
  return {
    count: async (refName: string, start: number, end: number) =>
      (await bam.getRecordsForRange(refName, start, end)).length,
  }
}

async function openTabix(url: string, pool: BgzfWorkerPool | undefined) {
  const tbi = new TabixIndexedFile({ url, bgzfWorkerPool: pool })
  await tbi.getHeader()
  return {
    count: async (refName: string, start: number, end: number) => {
      let n = 0
      await tbi.getLines(refName, start, end, () => {
        n++
      })
      return n
    },
  }
}

// Four workers is what the default gives jbrowse on this box, so both panels
// of the figure use the same pool size; idleTimeoutMs 0 so a reap cannot land
// inside a timed region.
const pool = await getSharedWorkerPool(4, 0)

const open = (url: string, withPool: boolean): Promise<Reader> =>
  url.endsWith('.bam')
    ? openBam(url, withPool ? pool : undefined)
    : openTabix(url, withPool ? pool : undefined)

interface Timing {
  ms: number
  count: number
}

Object.assign(window, {
  bgzfBench: {
    poolAvailable: pool !== undefined,
    /**
     * One round: a fresh reader per arm so the chunk cache starts cold, header
     * and index fetched before the clock starts, then every window timed.
     */
    round: async (url: string, refName: string, windows: number[][]) => {
      const out: Record<string, Timing[]> = { pooled: [], plain: [] }
      for (const arm of ['pooled', 'plain']) {
        const reader = await open(url, arm === 'pooled')
        for (const [start, end] of windows) {
          const t0 = performance.now()
          const count = await reader.count(refName, start!, end!)
          out[arm]!.push({ ms: performance.now() - t0, count })
        }
      }
      return out
    },
  },
})

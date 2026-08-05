// A speed comparison only means something if both sides answer the same
// question. This runs before the benchmarks and checks, per library and per
// case, what changed between the 2023 release and the current one.
//
// The three libraries do not agree with each other about what "overlaps this
// window" means for a record that straddles an edge — a read starting before
// the window, a BigWig bin ending exactly on it. Those disagreements are real
// but they are a boundary convention, not lost data, so they are classified
// apart and reported.
//
// The gate proper: no record that lies wholly *inside* the window may disappear
// between the 2023 release and the current one. That is the failure that would
// invalidate a timing comparison.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { BamFile as OldBam } from './.libs/bam-js/old/esm/index.js'
import { BamFile as NewBam } from './.libs/bam-js/new/esm/index.js'
import {
  CraiIndex as OldCraiIndex,
  IndexedCramFile as OldCram,
} from './.libs/cram-js/old/esm/index.js'
import {
  CraiIndex as NewCraiIndex,
  IndexedCramFile as NewCram,
} from './.libs/cram-js/new/esm/index.js'
import { BigWig as OldBigWig } from './.libs/bbi-js/old/esm/index.js'
import { BigWig as NewBigWig } from './.libs/bbi-js/new/esm/index.js'
import {
  pakoUnzip as oldBrowserUnzip,
  unzip as oldNodeUnzip,
} from './.libs/bgzf-filehandle/old/esm/unzip.js'
import { unzip as newUnzip } from './.libs/bgzf-filehandle/new/esm/unzip.js'

import {
  BAM_CASES,
  BW_CASES,
  CRAM_CASES,
  END,
  OLD_CRAM_OPTS,
  REF,
  ROOT,
  START,
  seqFetch,
} from './lib/corpus.ts'

interface Item {
  key: string
  start: number
  end: number
}

const deltas: Record<string, unknown>[] = []

/** does this record hang over an edge of the query window? */
const straddles = (i: Item) => i.start < START || i.end > END

function compare(kind: string, label: string, oldItems: Item[], newItems: Item[]) {
  const os = new Map(oldItems.map(i => [i.key, i]))
  const ns = new Map(newItems.map(i => [i.key, i]))
  const lost = [...os.values()].filter(i => !ns.has(i.key))
  const gained = [...ns.values()].filter(i => !os.has(i.key))

  const lostInterior = lost.filter(i => !straddles(i))
  const lostBoundary = lost.filter(straddles)

  deltas.push({
    kind,
    case: label,
    old: oldItems.length,
    new: newItems.length,
    gained: gained.length,
    lostBoundary: lostBoundary.length,
    lostInterior: lostInterior.length,
    exampleGained: gained.slice(0, 2).map(i => i.key),
    exampleLostBoundary: lostBoundary.slice(0, 2).map(i => i.key),
  })

  const parts = [`old=${oldItems.length}`, `new=${newItems.length}`]
  if (gained.length) parts.push(`gained=${gained.length}`)
  if (lostBoundary.length) parts.push(`lost-at-edge=${lostBoundary.length}`)
  if (lostInterior.length) parts.push(`LOST-INTERIOR=${lostInterior.length}`)
  if (!gained.length && !lost.length) parts.push('identical')
  console.log(`${kind} ${label}: ${parts.join(' ')}`)

  expect(oldItems.length).toBeGreaterThan(0)
  // The gate. Records that straddle an edge are a convention difference;
  // anything lost from the interior of the window is data loss.
  expect(lostInterior.map(i => i.key)).toEqual([])
}

test.each(BAM_CASES)('bam $label agrees', async ({ label, file }) => {
  const read = async (Ctor: any) => {
    const f = new Ctor({ bamPath: file })
    await f.getHeader()
    return f.getRecordsForRange(REF, START, END)
  }
  const o = await read(OldBam)
  const n = await read(NewBam)
  compare(
    'bam',
    label,
    o.map((r: any) => {
      const start = r.get('start')
      return { key: `${r.name()}|${start}|${r.end()}|${r.flags}`, start, end: r.end() }
    }),
    n.map((r: any) => ({
      key: `${r.name}|${r.start}|${r.end}|${r.flags}`,
      start: r.start,
      end: r.end,
    })),
  )
})

test.each(CRAM_CASES)('cram $label agrees', async ({ label, file }) => {
  const read = async (File: any, Index: any, extra: object = {}) => {
    const c = new File({
      cramPath: file,
      index: new Index({ path: `${file}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
      ...extra,
    })
    return c.getRecordsForRange(0, START, END)
  }
  const o = await read(OldCram, OldCraiIndex, OLD_CRAM_OPTS)
  const n = await read(NewCram, NewCraiIndex)
  // v1.7.1 exposes a 1-based alignmentStart; the current release exposes a
  // 0-based start, so the old value is shifted to match before comparing.
  //
  // The key is identity — read name, start, flags — and deliberately excludes
  // lengthOnRef, which legitimately changed: v1.7.1 derives a long read's
  // reference span wrongly, and `cram lengthOnRef` below adjudicates that
  // against the BAM holding the same alignments rather than assuming it.
  compare(
    'cram',
    label,
    o.map((r: any) => {
      const start = r.alignmentStart - 1
      return {
        key: `${r.readName}|${start}|${r.flags}`,
        start,
        end: start + r.lengthOnRef,
      }
    }),
    n.map((r: any) => ({
      key: `${r.readName}|${r.start}|${r.flags}`,
      start: r.start,
      end: r.start + r.lengthOnRef,
    })),
  )
})

// The BAM and the CRAM in each pair hold the same alignments, so the BAM's
// reference span is the answer the CRAM reader has to reproduce. v1.7.1 does not
// reproduce it for long reads; the current release does, exactly.
test.each(CRAM_CASES)('cram $label lengthOnRef matches the BAM', async ({ label, file }) => {
  const read = async (File: any, Index: any, extra: object = {}) =>
    new File({
      cramPath: file,
      index: new Index({ path: `${file}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
      ...extra,
    }).getRecordsForRange(0, START, END)

  // Keyed on name+start+flags, not name alone: the two mates of a short-read
  // pair share a read name, so a name-keyed map silently keeps one of each pair
  // and every read whose mate won the collision then looks like a mismatch.
  const bam = new (NewBam as any)({ bamPath: file.replace(/\.cram$/, '.bam') })
  await bam.getHeader()
  const truth = new Map<string, number>(
    (await bam.getRecordsForRange(REF, START, END)).map((r: any) => [
      `${r.name}|${r.start}|${r.flags}`,
      r.end - r.start,
    ]),
  )

  const oldRecs = await read(OldCram, OldCraiIndex, OLD_CRAM_OPTS)
  const newRecs = await read(NewCram, NewCraiIndex)

  // Score both sides over the reads they both returned. Without this the reads
  // one side omits at the window edge would show up as a lengthOnRef
  // disagreement, which is the boundary difference counted twice.
  const oldKey = (r: any) => `${r.readName}|${r.alignmentStart - 1}|${r.flags}`
  const newKey = (r: any) => `${r.readName}|${r.start}|${r.flags}`
  const oldKeys = new Set(oldRecs.map(oldKey))
  const shared = new Set(newRecs.map(newKey).filter((k: string) => oldKeys.has(k)))

  const score = (recs: any[], key: (r: any) => string) => {
    let compared = 0
    let agree = 0
    for (const r of recs) {
      const k = key(r)
      const t = truth.get(k)
      if (t === undefined || !shared.has(k)) continue
      compared++
      if (t === r.lengthOnRef) agree++
    }
    return { compared, agree }
  }

  const o = score(oldRecs, oldKey)
  const n = score(newRecs, newKey)
  console.log(
    `cram lengthOnRef ${label}: v1.7.1 ${o.agree}/${o.compared} match BAM, ` +
      `current ${n.agree}/${n.compared}`,
  )
  deltas.push({
    kind: 'cram-lengthOnRef',
    case: label,
    old: o.agree,
    new: n.agree,
    compared: n.compared,
  })
  expect(n.compared).toBeGreaterThan(0)
  // Long reads go from near-zero agreement to exact. Short reads keep a residual
  // ~2% disagreement that both releases share, so it predates the upgrade and is
  // not what this benchmark is measuring; the invariant that matters is that the
  // current release never agrees with the BAM *less* often than v1.7.1 did.
  expect(n.agree).toBeGreaterThanOrEqual(o.agree)
})

test.each(BW_CASES)('bigwig $label agrees', async ({ label, file }) => {
  const read = async (Ctor: any) => new Ctor({ path: file }).getFeatures(REF, START, END)
  const o = await read(OldBigWig)
  const n = await read(NewBigWig)
  const item = (f: any) => ({
    key: `${f.start}|${f.end}|${Math.fround(f.score)}`,
    start: f.start,
    end: f.end,
  })
  compare('bigwig', label, o.map(item), n.map(item))
})

test('bgzf decompresses to the same bytes', async () => {
  for (const name of ['20x.shortread.bam', '20x.longread.bam']) {
    const data = new Uint8Array(readFileSync(`${ROOT}${name}`))
    const [browser, node, current] = await Promise.all([
      oldBrowserUnzip(data),
      oldNodeUnzip(data),
      newUnzip(data),
    ])
    console.log(
      `bgzf ${name}: v1.4.3 pako=${browser.length} v1.4.3 zlib=${node.length} v6.3.2=${current.length}`,
    )
    expect(current.length).toBe(browser.length)
    expect(current.length).toBe(node.length)
    expect(Buffer.from(current).equals(Buffer.from(browser))).toBe(true)
    deltas.push({
      kind: 'bgzf',
      case: name,
      old: browser.length,
      new: current.length,
      gained: 0,
      lostBoundary: 0,
      lostInterior: 0,
    })
  }
})

test('write the equivalence report last', () => {
  mkdirSync(new URL('results/', import.meta.url), { recursive: true })
  writeFileSync(
    new URL('results/equivalence.json', import.meta.url),
    JSON.stringify({ region: `${REF}:${START}-${END}`, deltas }, null, 2),
  )
})

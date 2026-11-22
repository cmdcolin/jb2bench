import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'

import { CUT_PRESETS, WalkReader, walksKept } from '@jbrowse/graph-walks'

import { leftoverAligner } from './leftover.mjs'
import {
  anchorAligner,
  departureSpans,
  lanePairAligner,
  stepsInWindow,
} from './src/WalkTabixSyntenyAdapter/walkLanes.ts'

const WALKS =
  'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38-f8.GRCh38.walks.gz'
const PIF = 'hprc_multiway_gfa.pif.gz'
const EIGHT = [
  'HG01109#1',
  'HG01123#1',
  'HG01960#1',
  'HG02055#1',
  'HG00097#1',
  'HG00099#1',
  'HG00128#1',
  'HG00133#1',
]
const LOCI = [
  ['CFH', 'chr1', 196_770_000],
  ['amylase', 'chr1', 103_650_000],
  ['MHC', 'chr6', 32_500_000],
  ['17q21.31', 'chr17', 46_000_000],
  ['GSTT1', 'chr22', 23_990_000],
  ['FLNA-EMD', 'chrX', 154_350_000],
  ['plain-chr2', 'chr2', 100_000_000],
  ['plain-chr12', 'chr12', 50_000_000],
]
const WIDTHS = [10_000, 100_000, 1_000_000, 5_000_000]
const mode = process.argv[2] ?? 'time'
const plant = process.env.PLANT
const proto = process.env.ALIGNER === 'proto'
const out = process.argv[3] ?? `${mode}.jsonl`
writeFileSync(out, '')
const emit = row => {
  appendFileSync(out, `${JSON.stringify(row)}\n`)
  console.log(JSON.stringify(row))
}

const net = { requests: 0, bytes: 0 }
const realFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  const response = await realFetch(...args)
  net.requests++
  net.bytes += Number(response.headers.get('content-length') ?? 0)
  return response
}
const netSince = mark => ({
  requests: net.requests - mark.requests,
  bytes: net.bytes - mark.bytes,
})
const ms = t => Math.round(performance.now() - t)

const haplotypeOf = name => name.split('#').slice(0, 2).join('#')

async function lanes(reader, refName, region, prefixes, pairs) {
  const keep = walksKept(prefixes, refName)
  const mark = { ...net }
  const t0 = performance.now()
  const cut = await reader
    .cut(refName, region, {
      ...CUT_PRESETS.browser,
      keep,
      expand: keep,
      links: 'none',
    })
    .catch(error => ({ error }))
  const cutMs = ms(t0)
  const fetched = netSince(mark)
  if (cut.error) {
    return {
      cutMs,
      ...fetched,
      refused: cut.error.name,
      fitsBp: cut.error.fitsBp,
      message: String(cut.error.message).slice(0, 160),
    }
  }
  const { graph, fragments, departures } = cut
  const references = fragments.filter(f => f.name === refName)
  const queries = fragments.filter(f => f.name !== refName)
  const t1 = performance.now()
  const align = proto ? leftoverAligner(graph.nodes) : anchorAligner(graph.nodes)
  const star = queries.map(query => ({
    query,
    chains: references.flatMap(reference =>
      align(query, reference).map(chain => ({ chain, reference })),
    ),
  }))
  const starMs = ms(t1)
  const t2 = performance.now()
  let pairRecords = 0
  let pairCount = 0
  if (pairs) {
    const pairAlign = proto
      ? leftoverAligner(graph.nodes)
      : lanePairAligner(graph.nodes)
    const byHap = new Map()
    for (const f of queries) {
      const hap = haplotypeOf(f.name)
      byHap.set(hap, [...(byHap.get(hap) ?? []), f])
    }
    const order = [...byHap.keys()]
    for (let i = 0; i + 1 < order.length; i++) {
      pairCount++
      for (const target of byHap.get(order[i])) {
        for (const query of byHap.get(order[i + 1])) {
          pairRecords += pairAlign(query, target).length
        }
      }
    }
  }
  const pairMs = ms(t2)
  const walking = new Set(
    fragments
      .filter(f => stepsInWindow(f, graph.nodes, refName, region))
      .map(f => haplotypeOf(f.name)),
  )
  const spanning = departures.filter(
    d => !walking.has(haplotypeOf(d.name)) && departureSpans(d, region),
  )
  let steps = 0
  for (const f of fragments) {
    steps += f.ids.length
  }
  return {
    cutMs,
    starMs,
    pairMs,
    ...fetched,
    nodes: graph.nodes.size,
    steps,
    fragments: queries.length,
    haplotypes: new Set(queries.map(f => haplotypeOf(f.name))).size,
    starRecords: star.reduce((n, s) => n + s.chains.length, 0),
    pairCount,
    pairRecords,
    departures: departures.length,
    spanning: spanning.length,
    star,
  }
}

// A run of matched bases as its reference start, its length, and the key of
// the diagonal it lies on
function matchRuns({ tStart, qStart, qEnd, strand, edits, qName, window }) {
  const runs = []
  let t = tStart
  let q = strand === '+' ? qStart : qEnd
  const step = strand === '+' ? 1 : -1
  for (const [op, len] of edits) {
    if (op === '=') {
      const from = Math.max(t, window.start)
      const to = Math.min(t + len, window.end)
      if (to > from) {
        const diagonal = strand === '+' ? q - t : q - 1 + t
        runs.push({ key: `${qName}|${strand}|${diagonal}`, from, to })
      }
    }
    if (op === '=' || op === 'X' || op === 'D') {
      t += len
    }
    if (op === '=' || op === 'X' || op === 'I') {
      q += step * len
    }
  }
  return runs
}

function byKey(runs) {
  const map = new Map()
  for (const { key, from, to } of runs) {
    const list = map.get(key)
    if (list) {
      list.push([from, to])
    } else {
      map.set(key, [[from, to]])
    }
  }
  for (const [key, list] of map) {
    list.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const [from, to] of list) {
      const last = merged.at(-1)
      if (last && from <= last[1]) {
        last[1] = Math.max(last[1], to)
      } else {
        merged.push([from, to])
      }
    }
    map.set(key, merged)
  }
  return map
}

const total = map => {
  let bp = 0
  for (const list of map.values()) {
    for (const [from, to] of list) {
      bp += to - from
    }
  }
  return bp
}

function shared(a, b) {
  let bp = 0
  for (const [key, listA] of a) {
    const listB = b.get(key)
    if (listB) {
      let i = 0
      let j = 0
      while (i < listA.length && j < listB.length) {
        const from = Math.max(listA[i][0], listB[j][0])
        const to = Math.min(listA[i][1], listB[j][1])
        bp += Math.max(0, to - from)
        if (listA[i][1] < listB[j][1]) {
          i++
        } else {
          j++
        }
      }
    }
  }
  return bp
}

// Bases of the reference window that some run covers, whatever its diagonal
function covered(runs, window) {
  const spans = runs.map(r => [r.from, r.to]).sort((a, b) => a[0] - b[0])
  let bp = 0
  let reach = window.start
  for (const [from, to] of spans) {
    bp += Math.max(0, to - Math.max(from, reach))
    reach = Math.max(reach, to)
  }
  return bp
}

function parseCigar(text) {
  const edits = []
  const pattern = /(\d+)([=XIDM])/g
  let match = pattern.exec(text)
  while (match) {
    edits.push([match[2], Number(match[1])])
    match = pattern.exec(text)
  }
  return edits
}

function pafRuns(refName, window, wanted) {
  const text = execFileSync(
    'tabix',
    [PIF, `t${refName}:${window.start + 1}-${window.end}`],
    { maxBuffer: 4e9, encoding: 'utf8' },
  )
  const runs = new Map(wanted.map(prefix => [prefix, []]))
  let rows = 0
  for (const line of text.split('\n')) {
    if (line) {
      const cols = line.split('\t')
      const qName = cols[5]
      const hap = haplotypeOf(qName)
      const list = runs.get(hap)
      const cigar = cols.find(c => c.startsWith('cg:Z:'))
      if (list && cigar) {
        rows++
        const raw = parseCigar(cigar.slice(5))
        const tSpan = Number(cols[3]) - Number(cols[2])
        const sum = ops =>
          raw.reduce((n, [op, len]) => n + (ops.includes(op) ? len : 0), 0)
        const dConsumesTarget = sum('=XD') === tSpan
        const iConsumesTarget = sum('=XI') === tSpan
        if (!dConsumesTarget && !iConsumesTarget) {
          throw new Error(`CIGAR spans neither axis: ${line.slice(0, 200)}`)
        }
        const edits = dConsumesTarget
          ? raw
          : raw.map(([op, len]) => [
              op === 'I' ? 'D' : op === 'D' ? 'I' : op,
              len,
            ])
        list.push(
          ...matchRuns({
            tStart: Number(cols[2]),
            qStart: Number(cols[7]),
            qEnd: Number(cols[8]),
            strand: cols[4],
            edits,
            qName,
            window,
          }),
        )
      }
    }
  }
  return { runs, rows }
}

function walkRuns(star, window) {
  const runs = new Map()
  for (const { query, chains } of star) {
    const hap = haplotypeOf(query.name)
    const list = runs.get(hap) ?? []
    runs.set(hap, list)
    for (const { chain, reference } of chains) {
      list.push(
        ...matchRuns({
          tStart: reference.hapStart + chain.targetStart,
          qStart: query.hapStart + chain.queryStart + (plant === 'shift' ? 1 : 0),
          qEnd: query.hapStart + chain.queryEnd + (plant === 'shift' ? 1 : 0),
          strand: chain.strand,
          edits:
            plant === 'swapindel'
              ? chain.edits.map(([op, len]) => [
                  op === 'I' ? 'D' : op === 'D' ? 'I' : op,
                  len,
                ])
              : chain.edits,
          qName: query.name,
          window,
        }),
      )
    }
  }
  return runs
}

const t0 = performance.now()
const reader = WalkReader.open(WALKS)
const header = await reader.header()
const sequences = await reader.referenceSequences()
emit({
  kind: 'open',
  ms: ms(t0),
  ...net,
  haplotypes: header.haplotypes.length,
  tile: header.tile,
  sequences: sequences.length,
})
const refNameOf = chr => sequences.find(name => name.endsWith(`#${chr}`))
const forty = header.haplotypes
  .filter(h => !h.startsWith('GRCh38') && !h.startsWith('CHM13'))
  .slice(0, 40)

if (mode === 'time') {
  for (const [locus, chr, centre] of LOCI) {
    const refName = refNameOf(chr)
    for (const width of WIDTHS) {
      const region = { start: centre - width / 2, end: centre + width / 2 }
      for (const [label, prefixes] of [
        ['8', EIGHT],
        ['40', forty],
        ['all', undefined],
      ]) {
        const { star, ...row } = await lanes(
          reader,
          refName,
          region,
          prefixes,
          true,
        )
        emit({ kind: 'time', locus, chr, width, lanes: label, ...row })
      }
    }
  }
}

if (mode === 'parity') {
  const windows = [
    ...LOCI.flatMap(([locus, chr, centre]) =>
      [100_000, 1_000_000].map(width => ({
        locus,
        chr,
        start: centre - width / 2,
        end: centre + width / 2,
      })),
    ),
    ...Array.from({ length: process.env.LOCI_ONLY ? 0 : 24 }, (_, i) => ({
      locus: `chr22-sweep-${i}`,
      chr: 'chr22',
      start: 16_000_000 + i * 1_400_000,
      end: 16_000_000 + i * 1_400_000 + 200_000,
    })),
  ]
  const chosen = plant ? windows.slice(0, 2) : windows
  for (const { locus, chr, start, end } of chosen) {
    const refName = refNameOf(chr)
    const window = { start, end }
    const result = await lanes(reader, refName, window, EIGHT, false)
    if (result.refused) {
      emit({ kind: 'parity', locus, chr, start, end, refused: result.refused })
    } else {
      const fromWalks = walkRuns(result.star, window)
      const paf = pafRuns(refName, window, EIGHT)
      for (const hap of EIGHT) {
        const a = fromWalks.get(hap) ?? []
        const b = paf.runs.get(hap) ?? []
        const mapA = byKey(a)
        const mapB = byKey(b)
        emit({
          kind: 'parity',
          locus,
          chr,
          start,
          end,
          hap,
          walkBp: total(mapA),
          pafBp: total(mapB),
          sameDiagonalBp: shared(mapA, mapB),
          walkCoveredRef: covered(a, window),
          pafCoveredRef: covered(b, window),
        })
      }
    }
  }
}

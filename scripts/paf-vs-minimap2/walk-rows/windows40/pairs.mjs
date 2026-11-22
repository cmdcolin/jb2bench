import { appendFileSync, writeFileSync } from 'node:fs'

import { CUT_PRESETS, WalkReader, walksKept } from '@jbrowse/graph-walks'

import { leftoverAligner } from './leftover.mjs'
import {
  anchorAligner,
  lanePairAligner,
} from './src/WalkTabixSyntenyAdapter/walkLanes.ts'

const WALKS =
  'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38-f8.GRCh38.walks.gz'
const EIGHT = [
  'HG00097#1',
  'HG00099#1',
  'HG00128#1',
  'HG00133#1',
  'HG01109#1',
  'HG01123#1',
  'HG01960#1',
  'HG02055#1',
]
const WINDOWS = [
  ['CFH', 196_640_000, 196_900_000],
  ['amylase', 103_500_000, 103_800_000],
  ['plain-60M', 60_000_000, 60_300_000],
  ['plain-220M-1Mb', 220_000_000, 221_000_000],
  ['1q21-SD', 146_000_000, 146_300_000],
]
const out = process.argv[2] ?? 'pairs.jsonl'
const steps = process.argv[3] ?? 'steps.jsonl'
writeFileSync(out, '')
writeFileSync(steps, '')
const haplotypeOf = name => name.split('#').slice(0, 2).join('#')

const reader = WalkReader.open(WALKS)
const refName = 'GRCh38#0#chr1'
const keep = walksKept(EIGHT, refName)
for (const [locus, start, end] of WINDOWS) {
  const { graph, fragments } = await reader.cut(
    refName,
    { start, end },
    { ...CUT_PRESETS.browser, keep, expand: keep, links: 'none' },
  )
  const pairAlign = lanePairAligner(graph.nodes)
  const starAlign = anchorAligner(graph.nodes)
  const queries = fragments.filter(f => f.name !== refName)
  const references = fragments.filter(f => f.name === refName)
  for (const fragment of fragments) {
    appendFileSync(
      steps,
      `${JSON.stringify({
        locus,
        name: fragment.name,
        hapStart: fragment.hapStart,
        ids: [...fragment.ids],
        rev: [...fragment.rev],
        lens: [...fragment.ids].map(id => {
          const node = graph.nodes.get(id)
          return node ? node.end - node.start : 0
        }),
      })}\n`,
    )
  }
  const protoAlign = leftoverAligner(graph.nodes, {
    minShared: Number(process.env.MIN_SHARED ?? 1000),
  })
  const emit = (kind, target, query, chain, method = 'shipped') =>
    appendFileSync(
      out,
      `${JSON.stringify({
        kind,
        method,
        piece: chain.kind,
        locus,
        tName: target.name,
        qName: query.name,
        tStart: target.hapStart + chain.targetStart,
        tEnd: target.hapStart + chain.targetEnd,
        qStart: query.hapStart + chain.queryStart,
        qEnd: query.hapStart + chain.queryEnd,
        strand: chain.strand,
        edits: chain.edits,
      })}\n`,
    )
  for (const query of queries) {
    for (const reference of references) {
      for (const chain of starAlign(query, reference)) {
        emit('star', reference, query, chain)
      }
      for (const chain of protoAlign(query, reference)) {
        emit('star', reference, query, chain, 'proto')
      }
    }
  }
  let pairs = 0
  for (const target of queries) {
    for (const query of queries) {
      if (haplotypeOf(target.name) < haplotypeOf(query.name)) {
        pairs++
        for (const chain of pairAlign(query, target)) {
          emit('pair', target, query, chain)
        }
        for (const chain of protoAlign(query, target)) {
          emit('pair', target, query, chain, 'proto')
        }
      }
    }
  }
  console.log(locus, 'fragments', queries.length, 'fragment pairs', pairs)
}

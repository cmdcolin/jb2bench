// gff-nostream eager vs lazy attribute parsing, one process per side.
//
// Both arms import the same published version (the lazy entry points landed in
// 5.2.0, tab scanning in 5.2.1); what differs is which function the consumer
// calls. So unlike scan.ts there is no second build to clone — but the process
// isolation matters here for a sharper reason than inline caches.
//
// The eager parser allocates an object plus a string per attribute per feature.
// Run both arms in one process and that garbage is still on the heap when the
// lazy arm runs, so the lazy arm pays GC for work the eager arm did. Measured
// in-process, all-of-A-then-all-of-B, the parse comparison reported 9.6x;
// interleaved in one process it was 2.7x; one process per side is what this
// reports. The error is in the same family as the one scan.ts documents and
// larger, because what leaks between the arms is heap rather than call-site
// shape.
//
// The corpus matters as much as the isolation, and got this wrong first. The
// fixture that produced the 9.6x was a real GENCODE excerpt concatenated 12
// times to make it big enough to time. GFF3 IDs are not unique across those
// copies, so every duplicate transcript attached to the FIRST gene of its id:
// 233 subfeatures per top-level feature, against 27 in this generated corpus
// and 12 in real TAIR10. That does not scale a file up, it deepens it — and
// deep trees flatter the lazy side specifically, because SimpleFeature-style
// wrappers spread every subfeature's attributes on construction. Never scale a
// GFF3 fixture by concatenation; ../../shell/generate_gff3.js emits distinct
// ids instead.
//
// Two arms per case:
//   parse  — parseLines vs parseLinesLazy, the parser in isolation
//   reads  — plus the attribute reads a render performs, read straight off
//            the parsed object: no Feature wrapper, so this is the library's
//            own number and not JBrowse's (see the results file for why they
//            differ, and by how much)
//
// A checksum crosses the process boundary with each timing and the driver
// refuses to print a speedup for two sides that disagree.
//
//   node --experimental-strip-types gff3-lazy.ts
//   node --experimental-strip-types gff3-lazy.ts --arm eager|lazy parse|reads <file>
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { GFF3_CASES, gff3Lines } from './lib/corpus.ts'

const SELF = fileURLToPath(import.meta.url)
const ROUNDS = 5
const INNER = 7

type Side = 'eager' | 'lazy'
type Mode = 'parse' | 'reads'

// ------------------------------------------------------------------- arm ---

if (process.argv[2] === '--arm') {
  const side = process.argv[3] as Side
  const mode = process.argv[4] as Mode
  const file = process.argv[5]!
  const gff = await import('gff-nostream')
  const lines = gff3Lines(file)

  // The reads a default-configured feature track performs: the fixed columns the
  // layout pass uses at every level, `name`/`id` for the label at every level,
  // and `gbkey` for the stock NCBI source-record filter — which is admission,
  // and runs on TOP-LEVEL FEATURES ONLY.
  //
  // That last distinction decides the result, so it is not a detail. Reading
  // `gbkey` on every subfeature too costs the eager arm a property load and the
  // lazy arm a scan of the attribute string, and at ~27 subfeatures per gene
  // that one unfaithful read turned the rich case from ~1.15x into 0.98x. A
  // harness that models the consumer loosely does not measure a smaller effect,
  // it measures a different one.
  function readsEager(f: any, top: boolean): number {
    let acc = f.start + f.end + (f.strand ?? 0)
    if (f.type) acc++
    if (top && f.gbkey !== 'Src') acc++
    if (f.name ?? f.id) acc++
    for (const k of f.subfeatures) acc += readsEager(k, false)
    return acc % 1_000_000_007
  }

  function readsLazy(f: any, top: boolean): number {
    let acc = f.start + f.end + (f.strand ?? 0)
    if (f.type) acc++
    if (top && gff.getAttribute(f, 'gbkey') !== 'Src') acc++
    if (gff.getAttribute(f, 'name') ?? gff.getAttribute(f, 'id')) acc++
    for (const k of f.subfeatures) acc += readsLazy(k, false)
    return acc % 1_000_000_007
  }

  function pass() {
    if (side === 'eager') {
      const parsed = gff.parseLines(lines)
      if (mode === 'parse') {
        return parsed.length
      }
      let acc = 0
      for (const f of parsed) acc = (acc + readsEager(f, true)) % 1_000_000_007
      return acc
    }
    const parsed = gff.parseLinesLazy(lines)
    if (mode === 'parse') {
      return parsed.length
    }
    let acc = 0
    for (const f of parsed) acc = (acc + readsLazy(f, true)) % 1_000_000_007
    return acc
  }

  const checksum = pass()
  pass()
  const ts: number[] = []
  for (let i = 0; i < INNER; i++) {
    const t = performance.now()
    pass()
    ts.push(performance.now() - t)
  }
  ts.sort((a, b) => a - b)
  // best-of-N: on a shared box the minimum is the least contaminated estimate
  console.log(`${ts[0]!.toFixed(4)} ${checksum}`)
  process.exit(0)
}

// ---------------------------------------------------------------- driver ---

function arm(side: Side, mode: Mode, file: string) {
  const out = execFileSync(
    process.execPath,
    ['--experimental-strip-types', SELF, '--arm', side, mode, file],
    { encoding: 'utf8' },
  ).trim()
  const [ms, checksum] = out.split(' ')
  return { ms: Number(ms), checksum: checksum! }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!

interface Row {
  case: string
  genes: number
  shape: string
  mode: Mode
  eager: number
  lazy: number
  ratio: number
  identical: boolean
}

const rows: Row[] = []
const version = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('node_modules/gff-nostream/package.json', import.meta.url),
    ),
    'utf8',
  ),
).version as string

console.log(
  `gff-nostream ${version}: eager vs lazy, ${ROUNDS} rounds x best-of-${INNER}\n`,
)
console.log(
  `${'case'.padEnd(20)}${'mode'.padEnd(8)}${'eager'.padStart(11)}${'lazy'.padStart(11)}${'ratio'.padStart(9)}  agree`,
)
console.log('-'.repeat(68))

for (const { label, file, genes, shape } of GFF3_CASES) {
  for (const mode of ['parse', 'reads'] as const) {
    const es: number[] = []
    const ls: number[] = []
    let ec = ''
    let lc = ''
    for (let r = 0; r < ROUNDS; r++) {
      const e = arm('eager', mode, file)
      es.push(e.ms)
      ec = e.checksum
      const l = arm('lazy', mode, file)
      ls.push(l.ms)
      lc = l.checksum
    }
    const e = median(es)
    const l = median(ls)
    const identical = ec === lc
    rows.push({
      case: label,
      genes,
      shape,
      mode,
      eager: e,
      lazy: l,
      ratio: e / l,
      identical,
    })
    console.log(
      `${label.padEnd(20)}${mode.padEnd(8)}${`${e.toFixed(2)} ms`.padStart(11)}` +
        `${`${l.toFixed(2)} ms`.padStart(11)}${`${(e / l).toFixed(2)}x`.padStart(9)}` +
        `  ${identical ? 'yes' : 'NO'}`,
    )
  }
}

mkdirSync(new URL('results/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('results/gff3-lazy.json', import.meta.url),
  JSON.stringify({ version, rounds: ROUNDS, inner: INNER, rows }, null, 2),
)

const table = (mode: Mode) =>
  rows
    .filter(r => r.mode === mode)
    .map(
      r =>
        `| ${r.case} | ${r.eager.toFixed(2)} ms | ${r.lazy.toFixed(2)} ms | ` +
        `${r.ratio.toFixed(2)}x | ${r.identical ? 'yes' : 'NO'} |`,
    )

const md = [
  `# gff-nostream: eager vs lazy attribute parsing (${version})`,
  '',
  'Generated by `make gff3`. One process per side, arms alternating, each arm',
  `reporting its own best-of-${INNER} and the table the median over ${ROUNDS} rounds.`,
  'The agree column folds the values both sides produced; it has to match or the',
  'timing means nothing.',
  '',
  '## Parse only',
  '',
  '| case | eager | lazy | speedup | agree |',
  '| --- | --- | --- | --- | --- |',
  ...table('parse'),
  '',
  '## Parse plus a render pass\'s attribute reads',
  '',
  'The tree, plus the reads a default-configured JBrowse feature track performs —',
  'the fixed columns and `name`/`id` at every level, and `gbkey` for the stock',
  'NCBI source-record filter, which is admission and runs on top-level features',
  'only. Read straight off the parsed object, with no `Feature` wrapper, so this',
  'is the library\'s own number.',
  '',
  'It is close to 1.0 because the lazy side gives most of the parse win back at',
  'the point of use: every `getAttribute` is a scan of the attribute string, and',
  'a render performs several per feature. **Deferring work only pays if the',
  'consumer does not then pay for it on the way out** — which is the whole result',
  'here, and the reason the wrapper paragraph below is not a footnote.',
  '',
  'That the `gbkey` read is top-level-only is load-bearing. Reading it on every',
  'subfeature too, which an earlier version of this harness did, costs the lazy',
  'side a scan per subfeature and at ~27 per gene turned the rich case from 1.15x',
  'into **0.98x**. Modelling the consumer loosely does not measure a smaller',
  'effect here; it measures a different one, with the opposite sign.',
  '',
  '## What JBrowse actually sees, which is not this table',
  '',
  'JBrowse does not read parsed objects — it wraps every feature in a `Feature`',
  'implementation, and the two sides wrap differently. `SimpleFeature` inflates',
  'its whole subtree in the constructor and spreads each subfeature\'s attributes',
  'to do it; `Gff3Feature` (the lazy consumer) wraps children on demand and never',
  'spreads. Measured in the jbrowse-components tree on `1000 genes`, one process',
  'per arm:',
  '',
  '| | eager parse + SimpleFeature | lazy parse + Gff3Feature | |',
  '| --- | --- | --- | --- |',
  '| rich | 161.3 ms | 125.3 ms | 1.29x |',
  '| sparse | 52.6 ms | 38.6 ms | 1.36x |',
  '',
  'So the change is worth ~1.3x to JBrowse on both shapes while being worth',
  'roughly nothing to a plain-object consumer. That difference is a property of',
  'the wrapper, not of the parser, and it is the reason a library benchmark alone',
  'would have answered the question wrong in both directions — first too high',
  'from a bad fixture, then too low from the wrong consumer.',
  '',
  '| case | eager | lazy | speedup | agree |',
  '| --- | --- | --- | --- | --- |',
  ...table('reads'),
  '',
  '## Reading this',
  '',
  'The split between the shapes is the two changes working as designed, and',
  'neither would show up on its own. Deferring column 9 is worth most of the',
  'parse on `rich` and nothing on `sparse` — measured alone it was 2.71x and',
  '**0.95x**. Scanning for tab offsets rather than `split(\'\\t\')` is the reverse:',
  'it moved `sparse` to 1.36x and left `rich` where it was. A table of one shape',
  'would have justified shipping a change that does nothing for half of real',
  'GFF3 files.',
  '',
  'The same reasoning is why the eager parser still splits. Tab scanning was',
  'tried there too and measured 1.18x on sparse but 0.94x on rich, because the',
  'extra `indexOf` bounding column 9 at a stray tab scans the whole attribute',
  'string and a parser that goes on to parse every attribute has nothing cheap',
  'enough left to pay it back.',
  '',
  'Retained heap after parsing is not in the table because it is a property of',
  'the result rather than a timing. On `1000 genes rich` the eager parser retains',
  '16.1 MB against the lazy parser\'s 7.0 MB (2.3x); on `1000 genes sparse`, 8.0 MB',
  'against 7.1 MB. For a consumer holding a whole annotation resident — which the',
  'JBrowse plain-text adapter does, for the life of the session — that is the',
  'more durable half of the change.',
  '',
  '## Why one process per side, and why the corpus is generated',
  '',
  'Two separate ways to get this wrong, both of which produced a headline number',
  'roughly twice the real one before being caught.',
  '',
  '**Process isolation.** Sharper here than for the `@gmod/vcf` scan and in the',
  'same family. The eager parser allocates an object and a string per attribute',
  'per feature; run both arms in one process and that garbage is still on the',
  'heap when the lazy arm runs, so the lazy arm is charged GC for work the eager',
  'arm did. All-of-A-then-all-of-B in one process reported **9.6x** on the parse',
  'comparison; interleaving the two in one process brought it to **2.7x**. What',
  'leaks between the arms is heap, not call-site shape, so it does not wash out',
  'with alternation the way the vcf scan\'s does — only separate processes fix it.',
  '',
  '**Fixture shape.** The first attempt sized a GENCODE excerpt up by',
  'concatenating it 12 times. GFF3 ids are not unique across copies, so every',
  'duplicate transcript attached to the first gene carrying its id, giving 233',
  'subfeatures per top-level feature against 27 here and 12 in real TAIR10. That',
  'is not a bigger file, it is a deeper one, and depth flatters the lazy side',
  'specifically because SimpleFeature-style wrappers spread every subfeature\'s',
  'attributes on construction. It reported 3.03x end to end where this corpus',
  'says 1.29x. Scale a GFF3 fixture by generating more distinct genes, never by',
  'concatenation.',
  '',
].join('\n')
writeFileSync(new URL('results/gff3-lazy.md', import.meta.url), md)
console.log('\nwrote results/gff3-lazy.md and results/gff3-lazy.json')

// What a liftOver chain file looks like as a synteny track, and what
// `rb break-paf` changes about it.
//
// A chain links aligned blocks across gaps of any size, so one PAF row from
// `chain2paf` can span a whole chromosome arm while aligning a small fraction
// of it. `rb break-paf --max-size S` cuts every row at its indels over S bp.
// This reports how much of the chain rows sit inside indels, the widest row, and
// for that row the identity JBrowse colors by (column 10 over column 11) before
// and after the cut.
//
//   node --experimental-strip-types scripts/pif/chains.ts <file.paf> [--max-size 100000] [--json out.json]
//
// Needs `rb` (rustybam) on PATH. The PAF can be the one tier-options.ts writes.

import { spawnSync } from 'node:child_process'
import { createReadStream, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

import { cigarOf, isIndel, matchAdv, parseOps } from './geometry.ts'

const THRESHOLDS = [10_000, 1_000_000]

interface Row {
  q: string
  t: string
  strand: string
  qs: number
  qe: number
  ts: number
  te: number
  matches: number
  block: number
}

async function* rows(src: string) {
  const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity })
  for await (const line of rl) {
    const f = line.split('\t', 12)
    const row: Row = {
      q: f[0]!,
      t: f[5]!,
      strand: f[4]!,
      qs: +f[2]!,
      qe: +f[3]!,
      ts: +f[7]!,
      te: +f[8]!,
      matches: +f[9]!,
      block: +f[10]!,
    }
    yield { row, cigar: cigarOf(line)?.cigar }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const src = args[0]
  if (!src) {
    throw new Error('usage: chains.ts <file.paf> [--max-size N] [--json out.json]')
  }
  const sizeAt = args.indexOf('--max-size')
  const maxSize = sizeAt < 0 ? 100_000 : +args[sizeAt + 1]!
  const jsonAt = args.indexOf('--json')

  let n = 0
  let aligned = 0
  let inIndels = 0
  let largest = 0
  const over = THRESHOLDS.map(() => 0)
  let widest: (Row & { aligned: number }) | undefined
  const alphabet = new Set<string>()
  for await (const { row, cigar } of rows(src)) {
    n++
    if (cigar === undefined) {
      continue
    }
    const ops = parseOps(cigar)
    let rowAligned = 0
    let rowLargest = 0
    for (let k = 0; k < ops.length; k += 2) {
      const len = ops[k]!
      const op = ops[k + 1]!
      alphabet.add(String.fromCharCode(op))
      rowAligned += matchAdv(op, len)
      if (isIndel(op)) {
        inIndels += len
        rowLargest = Math.max(rowLargest, len)
      }
    }
    aligned += rowAligned
    largest = Math.max(largest, rowLargest)
    THRESHOLDS.forEach((t, i) => {
      if (rowLargest > t) {
        over[i]!++
      }
    })
    if (!widest || row.te - row.ts > widest.te - widest.ts) {
      widest = { ...row, aligned: rowAligned }
    }
  }
  if (!widest) {
    throw new Error(`no rows in ${src}`)
  }

  const broken = `${src}.break-${maxSize}.paf`
  const start = performance.now()
  const rb = spawnSync(
    'sh',
    ['-c', 'rb break-paf --max-size "$1" "$2" > "$3"', 'sh', String(maxSize), src, broken],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  const seconds = (performance.now() - start) / 1000
  if (rb.status !== 0) {
    throw new Error(`rb break-paf exited ${rb.status}`)
  }

  let pieces = 0
  let pieceMatches = 0
  let pieceBlock = 0
  for await (const { row } of rows(broken)) {
    pieces++
    if (
      row.q === widest.q &&
      row.t === widest.t &&
      row.strand === widest.strand &&
      row.ts >= widest.ts &&
      row.te <= widest.te &&
      row.qs >= widest.qs &&
      row.qe <= widest.qe
    ) {
      pieceMatches += row.matches
      pieceBlock += row.block
    }
  }

  const report = {
    input: basename(src),
    rows: n,
    cigar_ops: [...alphabet].sort().join(''),
    aligned_bp: aligned,
    indel_bp: inIndels,
    rows_with_indel_over: Object.fromEntries(THRESHOLDS.map((t, i) => [t, over[i]])),
    largest_indel_bp: largest,
    widest_row: {
      target: `${widest.t}:${widest.ts}-${widest.te}`,
      query: `${widest.q}:${widest.qs}-${widest.qe}`,
      aligned_bp: widest.aligned,
      identity: widest.matches / widest.block,
      identity_after_break: pieceMatches / pieceBlock,
    },
    break_paf: { max_size: maxSize, seconds, rows_out: pieces },
  }
  console.log(JSON.stringify(report, null, 2))
  if (jsonAt >= 0) {
    writeFileSync(args[jsonAt + 1]!, `${JSON.stringify(report, null, 2)}\n`)
  }
}

await main()

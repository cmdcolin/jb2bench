// What would make a PIF's coarse tier smaller, and what each option costs.
//
// The input is a version-2 PIF built with the coarse tier at the default bound.
// Two kinds of variant are measured against it:
//
//   --coarse N    rebuilt by the pinned `jbrowse make-pif` from the PAF the
//                 file's `t` rows invert to, in `pi:i:` order so every row keeps
//                 its index. The tier then serves only past N bp per pixel.
//   rewritten     the input with its `T`/`Q` rows changed and nothing else, then
//                 bgzipped and indexed the way make-pif does it:
//     drop          no coarse row for an alignment under the bound on both
//                   genomes, which is under a pixel at the zoom the tier serves
//     keep-indels   indels longer than the whole bound keep their letter, not
//                   half of it. A smaller indel that would carry a run past the
//                   skew bound is folded in pieces either side of a run
//                   boundary, and a point inside an indel is on the real path,
//                   so the bound holds. `coarsenCigar` instead keeps every indel
//                   over half the bound, because it never splits one.
//
// Tier bytes are the union of Tabix chunk spans, as in coarsening.ts. The
// script also reports where the tier's bytes go, and how many distinct cells a
// 100 kb grid puts the sub-pixel alignments in, which is what binning them
// would reduce them to.
//
//   node --experimental-strip-types scripts/pif/tier-options.ts <file.pif.gz> --work <dir> [--json out.json]
//
// <dir> takes the PAF and five PIFs, about 900 MB.

import { spawnSync } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

import { flipCoarseCigar, swapCoarseCigar } from '@jbrowse/cigar-utils'

import { readAll, readTabix, unionBytes } from './tabix.ts'
import {
  cigarOf,
  coarseSegs,
  matchAdv,
  parseOps,
  peak,
  trace,
} from './geometry.ts'

import type { WriteStream } from 'node:fs'

const BOUND = 10_000 // make-pif's default --coarse, and bp per pixel at the tier's zoom
const BIN = 100_000
const REBUILDS = [10_000, 20_000, 50_000]

function coarsenKeepAbove(cigar: string, keepAbove: number) {
  const skewBound = keepAbove / 2
  let ops = ''
  let ownLen = 0
  let mateLen = 0
  let gapCount = 0
  let opCount = 0
  let runOwn = 0
  let runMate = 0
  const flushRun = () => {
    if (runOwn > 0 || runMate > 0) {
      ops +=
        runOwn === runMate
          ? `${runOwn}M`
          : runOwn === 0
            ? `${runMate}I`
            : runMate === 0
              ? `${runOwn}D`
              : `${runOwn}:${runMate}M`
      opCount++
      runOwn = 0
      runMate = 0
    }
  }
  const fold = (len: number, onOwn: boolean) => {
    let rest = len
    while (rest > 0) {
      const room = skewBound - (onOwn ? runOwn - runMate : runMate - runOwn)
      const take = Math.min(rest, Math.max(room, 0))
      if (onOwn) {
        runOwn += take
      } else {
        runMate += take
      }
      rest -= take
      if (rest > 0) {
        flushRun()
      }
    }
  }
  let len = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      len = len * 10 + c - 48
      continue
    }
    const op = cigar[i]!
    if (op === 'M' || op === '=' || op === 'X') {
      runOwn += len
      runMate += len
      ownLen += len
      mateLen += len
    } else if (op === 'D' || op === 'N' || op === 'I') {
      if (op === 'I') {
        mateLen += len
      } else {
        ownLen += len
      }
      if (len > keepAbove) {
        flushRun()
        ops += `${len}${op}`
        gapCount++
        opCount++
      } else {
        fold(len, op !== 'I')
      }
    }
    len = 0
  }
  flushRun()
  return { ops, ownLen, mateLen, gapCount, opCount }
}

function lines(src: string) {
  return createInterface({
    input: createReadStream(src).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
}

async function write(out: WriteStream, s: string) {
  if (!out.write(s)) {
    await once(out, 'drain')
  }
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`)
  }
}

function tierBytes(pif: string) {
  return readAll(`${pif}.tbi`).then(buf => {
    const chunks: Record<string, [number, number][]> = {}
    for (const { refName, chunks: c } of readTabix(buf)) {
      ;(chunks[refName[0]!] ??= []).push(...c)
    }
    return Object.fromEntries(
      Object.entries(chunks).map(([p, c]) => [p, unionBytes(c)]),
    ) as Record<string, number>
  })
}

const col = (line: string, n: number) => {
  let start = 0
  for (let i = 0; i < n; i++) {
    start = line.indexOf('\t', start) + 1
  }
  const end = line.indexOf('\t', start)
  return line.slice(start, end < 0 ? undefined : end)
}
const piOf = (line: string) => {
  const at = line.lastIndexOf('\tpi:i:')
  return Number.parseInt(line.slice(at + 6), 10)
}
const withoutCr = (line: string) => line.replace(/\tcr:Z:[^\t]*/, '')

async function main() {
  const args = process.argv.slice(2)
  const src = args[0]
  const workAt = args.indexOf('--work')
  if (!src || workAt < 0) {
    throw new Error(
      'usage: tier-options.ts <file.pif.gz> --work <dir> [--json out.json]',
    )
  }
  const work = args[workAt + 1]!
  const jsonAt = args.indexOf('--json')
  mkdirSync(work, { recursive: true })

  // Pass 1, the `t` rows: the PAF, what each alignment aligns, and the
  // keep-indels fold with its deviation
  const paf: string[] = []
  const matched: number[] = []
  const altFold = new Map<number, string>()
  let altWorst = 0
  let header = ''
  for await (const line of lines(src)) {
    if (line.startsWith('#pif')) {
      header = line
      continue
    }
    if (line.charCodeAt(0) !== 116) {
      continue
    }
    const pi = piOf(line)
    const f = line.split('\t', 9)
    const rest = line
      .slice(f.join('\t').length + 1)
      .replace(/\tpi:i:\d+/, '')
    paf[pi] = [f[5], f[6], f[7], f[8], f[4], f[0]!.slice(1), f[1], f[2], f[3], rest].join('\t')

    const found = cigarOf(line)
    if (!found) {
      continue
    }
    const ops = parseOps(found.cigar)
    let m = 0
    for (let k = 0; k < ops.length; k += 2) {
      m += matchAdv(ops[k + 1]!, ops[k]!)
    }
    matched[pi] = m
    const alt = coarsenKeepAbove(found.cigar, BOUND)
    altWorst = Math.max(altWorst, peak(trace(ops, coarseSegs(alt.ops)).ys))
    const closed = alt.ownLen === +f[3]! - +f[2]! && alt.mateLen === +f[8]! - +f[7]!
    if (!closed || alt.gapCount > 0 || alt.opCount > 1) {
      altFold.set(pi, alt.ops)
    }
  }
  if (!header.includes('version:i:2')) {
    throw new Error(`${src} is not a version-2 PIF: ${header || 'no #pif header'}`)
  }

  const pafPath = `${work}/input.paf`
  const pafOut = createWriteStream(pafPath)
  for (const row of paf) {
    await write(pafOut, `${row}\n`)
  }
  pafOut.end()
  await once(pafOut, 'finish')

  // Pass 2, the `T`/`Q` rows: where the bytes go, and the rewritten variants
  const variants = ['drop', 'keep-indels'] as const
  const outs = Object.fromEntries(
    variants.map(v => [v, createWriteStream(`${work}/${v}.pif`)]),
  )
  const small = { rows: 0, bytes: 0, matched: 0 }
  const wide = { rows: 0, bytes: 0, foldBytes: 0, matched: 0 }
  const cells = new Set<string>()
  for await (const line of lines(src)) {
    const prefix = line[0]
    if (prefix !== 'T' && prefix !== 'Q') {
      for (const v of variants) {
        await write(outs[v]!, `${line}\n`)
      }
      continue
    }
    const pi = piOf(line)
    const ownSpan = +col(line, 3) - +col(line, 2)
    const mateSpan = +col(line, 8) - +col(line, 7)
    const isSmall = ownSpan < BOUND && mateSpan < BOUND

    if (prefix === 'T') {
      const bytes = line.length + 1
      if (isSmall) {
        small.rows++
        small.bytes += bytes
        small.matched += matched[pi] ?? 0
        cells.add(
          [
            col(line, 0),
            Math.floor(+col(line, 2) / BIN),
            col(line, 5),
            Math.floor(+col(line, 7) / BIN),
          ].join('\t'),
        )
      } else {
        wide.rows++
        wide.bytes += bytes
        wide.matched += matched[pi] ?? 0
        wide.foldBytes += /\tcr:Z:[^\t]*/.exec(line)?.[0].length ?? 0
      }
    }

    if (!isSmall) {
      await write(outs.drop!, `${line}\n`)
    }
    const alt = altFold.get(pi)
    const cr =
      alt === undefined
        ? ''
        : prefix === 'T'
          ? alt
          : col(line, 4) === '-'
            ? flipCoarseCigar(alt)
            : swapCoarseCigar(alt)
    const bare = withoutCr(line)
    const piAt = bare.lastIndexOf('\tpi:i:')
    await write(
      outs['keep-indels']!,
      `${cr ? `${bare.slice(0, piAt)}\tcr:Z:${cr}${bare.slice(piAt)}` : bare}\n`,
    )
  }
  for (const v of variants) {
    outs[v]!.end()
    await once(outs[v]!, 'finish')
  }

  const results: Record<string, Record<string, number>> = {
    input: await tierBytes(src),
  }
  for (const v of variants) {
    const pif = `${work}/${v}.pif`
    run('sh', ['-c', 'bgzip -f -@ 4 "$1" && tabix -f -s1 -b3 -e4 -0 "$1.gz"', 'sh', pif])
    results[v] = await tierBytes(`${pif}.gz`)
  }
  const jbrowse = new URL('../../node_modules/.bin/jbrowse', import.meta.url).pathname
  if (!existsSync(jbrowse)) {
    throw new Error('no pinned jbrowse CLI; run pnpm install')
  }
  for (const gap of REBUILDS) {
    const out = `${work}/coarse-${gap}.pif.gz`
    run(jbrowse, ['make-pif', pafPath, '--out', out, '--coarse', String(gap)])
    results[`coarse ${gap}`] = await tierBytes(out)
  }

  const rowsWithCigar = matched.filter(m => m !== undefined).length
  const report = {
    input: basename(src),
    header,
    bound_bp: BOUND,
    alignments: paf.length,
    rows_with_cigar: rowsWithCigar,
    small: { ...small, cells_at_100kb: cells.size },
    wide,
    keep_indels_worst_px: altWorst / BOUND,
    tier_bytes: results,
  }
  const base = results.input!
  console.log(header)
  console.log(`${paf.length} alignments; bound ${BOUND} bp`)
  console.log(
    `under the bound on both genomes: ${small.rows} (${((100 * small.rows) / paf.length).toFixed(1)}%), ` +
      `${((100 * small.matched) / (small.matched + wide.matched)).toFixed(1)}% of matched bases, ` +
      `${((100 * small.bytes) / (small.bytes + wide.bytes)).toFixed(1)}% of uncompressed T bytes, ` +
      `${cells.size} cells at ${BIN / 1000} kb`,
  )
  console.log(
    `the rest: ${wide.rows}, fold is ${((100 * wide.foldBytes) / wide.bytes).toFixed(1)}% of their uncompressed T bytes`,
  )
  console.log(`keep-indels worst deviation: ${(altWorst / BOUND).toFixed(4)} px`)
  console.log('variant          T bytes    vs input     Q bytes    vs input')
  for (const [name, r] of Object.entries(results)) {
    const pct = (p: string) =>
      `${(((r[p]! - base[p]!) / base[p]!) * 100).toFixed(1)}%`.padStart(9)
    console.log(
      `${name.padEnd(13)} ${String(r.T).padStart(10)} ${pct('T')}  ${String(r.Q).padStart(10)} ${pct('Q')}`,
    )
  }
  if (jsonAt >= 0) {
    writeFileSync(args[jsonAt + 1]!, `${JSON.stringify(report, null, 2)}\n`)
  }
}

await main()

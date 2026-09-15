// What a PIF's two tiers cost to draw end to end.
//
// A PIF writes every alignment twice, once indexed on each genome, under a
// one-letter prefix on the sequence name: `t`/`q` for the full-CIGAR records
// and `T`/`Q` for the coarsened ones. A whole-genome synteny view reads one
// prefix, so "what does drawing a whole genome transfer" is answered by the
// index alone -- the union of the compressed byte intervals that prefix's
// records occupy. The numbers are BGZF offsets into the file being described.
//
// Union, not sum. Sibling references share a BGZF block wherever one block
// holds the tail of one and the head of the next, and summing chunk lengths
// counts those blocks twice. The prefixes should sum to the file size less the
// header block and the BGZF end marker; the script prints both.
//
// Byte counts mean different things across coarse-tier formats. Until
// 2026-09-02 a coarsened record carried no alignment string; since then it may
// carry a `cr:Z:` fold, and a v2+ file states its format in a `#pif` header,
// which the script prints. It also lists the alignment tags seen in the first
// 64 kB under each prefix. That list is a sample: the writer omits `cr:Z:` from
// a row whose fold is one run, which is most rows, so a sample can miss it.
//
//   node --experimental-strip-types scripts/pif/coarsening.ts <file.pif.gz> [--json out.json]
//
// The argument is a local path or an https URL; a URL reads the index and the
// sample records by range request.

import { writeFileSync } from 'node:fs'

import {
  inflateBgzf,
  readAll,
  readBytes,
  readTabix,
  sizeOf,
  unionBytes,
} from './tabix.ts'

const SAMPLE_BYTES = 1 << 16

interface PrefixRow {
  prefix: string
  refNames: number
  bytes: number
  tagsSampled: string
}

function tagsOn(lines: string[]) {
  const seen = new Set<string>()
  for (const line of lines) {
    for (const field of line.split('\t').slice(12)) {
      const tag = field.slice(0, 5)
      if (tag === 'cg:Z:' || tag === 'cr:Z:' || tag === 'cs:Z:') {
        seen.add(tag.slice(0, 2))
      }
    }
  }
  return seen
}

async function linesAt(src: string, offset: number) {
  const text = inflateBgzf(await readBytes(src, offset, SAMPLE_BYTES))
  return text.slice(0, text.lastIndexOf('\n')).split('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const src = args[0]
  if (!src) {
    throw new Error('usage: coarsening.ts <file.pif.gz> [--json out.json]')
  }
  const jsonAt = args.indexOf('--json')
  const refs = readTabix(await readAll(`${src}.tbi`))
  const fileBytes = await sizeOf(src)
  const header = (await linesAt(src, 0)).find(l => l.startsWith('#pif')) ?? null

  const byPrefix = new Map<
    string,
    { refNames: number; chunks: [number, number][] }
  >()
  for (const { refName, chunks } of refs) {
    const prefix = refName[0]!
    const e = byPrefix.get(prefix) ?? { refNames: 0, chunks: [] }
    e.refNames++
    e.chunks.push(...chunks)
    byPrefix.set(prefix, e)
  }

  const rows: PrefixRow[] = []
  for (const [prefix, e] of [...byPrefix].sort()) {
    const first = e.chunks.reduce((m, c) => Math.min(m, c[0]), Infinity)
    const tags = tagsOn(
      (await linesAt(src, first)).filter(l => l.startsWith(prefix)),
    )
    rows.push({
      prefix,
      refNames: e.refNames,
      bytes: unionBytes(e.chunks),
      tagsSampled: tags.size === 0 ? 'none' : [...tags].sort().join('+'),
    })
  }

  console.log(header ?? 'no #pif header (a version-1 or older file)')
  console.log('\nprefix  refNames        bytes  tags sampled')
  for (const r of rows) {
    console.log(
      `${r.prefix.padEnd(6)}  ${String(r.refNames).padStart(8)}  ${String(r.bytes).padStart(11)}  ${r.tagsSampled}`,
    )
  }
  const total = rows.reduce((s, r) => s + r.bytes, 0)
  console.log(
    `\nprefixes sum to ${total} bytes; the file is ${fileBytes} (${fileBytes - total} outside any prefix)`,
  )

  if (jsonAt >= 0) {
    writeFileSync(
      args[jsonAt + 1]!,
      `${JSON.stringify({ src, header, fileBytes, rows, total }, null, 2)}\n`,
    )
  }
}

await main()

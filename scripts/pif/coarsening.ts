// What a PIF's two tiers cost to draw end to end.
//
// A PIF writes every alignment twice, once indexed on each genome, under a
// one-letter prefix on the sequence name: `t`/`q` for the full-CIGAR records
// and `T`/`Q` for the coarsened ones. A whole-genome synteny view reads one
// prefix, so "what does drawing a whole genome transfer" is answered by the
// index alone -- the union of the compressed byte intervals that prefix's
// records occupy. No download, and no estimate: the numbers are BGZF offsets
// into the file being described.
//
// Union, not sum. Sibling references share a BGZF block wherever one block
// holds the tail of one and the head of the next, and summing chunk lengths
// counts those blocks twice. The check that the arithmetic is right is that the
// prefixes sum to the file size, which this prints.
//
// The script also reads the first records under each prefix back and reports
// which alignment strings they carry, because that is what the byte counts mean
// and it has changed once already. Before 2026-09-02 a coarsened record carried
// no alignment string at all -- the writer split each alignment at its large
// indels and dropped the CIGAR. Since then it carries a `cr:Z:` coarse CIGAR:
// the indels longer than half the accuracy bound, kept, with one run between
// each pair recording how far each genome advanced. The second format is larger
// and is not the one the older hosted files were measured at, so a run of this
// script reports the format it found rather than assuming either.
//
//   node --experimental-strip-types scripts/pif/coarsening.ts <file.pif.gz> [--json out.json]
//
// The argument is a local path or an https URL; a URL reads the index and the
// sample records by range request.

import { writeFileSync } from 'node:fs'

import { inflateBgzf, readAll, readBytes, readTabix, unionBytes } from './tabix.ts'

// enough to hold several BGZF blocks, so a sample is whole records rather than
// one truncated line
const SAMPLE_BYTES = 1 << 16

interface PrefixRow {
  prefix: string
  refNames: number
  bytes: number
  alignmentStrings: string
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

async function main() {
  const args = process.argv.slice(2)
  const src = args[0]
  if (!src) {
    throw new Error(
      'usage: coarsening.ts <file.pif.gz> [--json out.json]',
    )
  }
  const jsonAt = args.indexOf('--json')
  const refs = readTabix(await readAll(`${src}.tbi`))

  const byPrefix = new Map<string, { refNames: number; chunks: [number, number][] }>()
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
    const sample = inflateBgzf(await readBytes(src, first, SAMPLE_BYTES))
    const lines = sample
      .slice(0, sample.lastIndexOf('\n'))
      .split('\n')
      .filter(l => l.startsWith(prefix))
    const tags = tagsOn(lines)
    rows.push({
      prefix,
      refNames: e.refNames,
      bytes: unionBytes(e.chunks),
      alignmentStrings: tags.size === 0 ? 'none' : [...tags].sort().join('+'),
    })
  }

  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`
  console.log('prefix  refNames  whole-genome fetch  alignment strings')
  for (const r of rows) {
    console.log(
      `${r.prefix.padEnd(6)}  ${String(r.refNames).padStart(8)}  ${mb(r.bytes).padStart(18)}  ${r.alignmentStrings}`)
  }
  const total = rows.reduce((s, r) => s + r.bytes, 0)
  console.log(`\nprefixes sum to ${mb(total)}`)

  if (jsonAt >= 0) {
    writeFileSync(args[jsonAt + 1]!, `${JSON.stringify({ src, rows, total }, null, 2)}\n`)
  }
}

await main()

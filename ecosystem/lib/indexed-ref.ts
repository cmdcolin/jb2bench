// A .fai-indexed FASTA reader, for the CRAM arms that read a real reference.
//
// corpus.ts answers seqFetch from a string because hg19mod.fa is one 250 kb
// contig, and it gives the reason: keeping a second library out of the CRAM
// measurement. The paper's corpus cannot be read that way — GRCh38 with decoys
// is 3.2 GB — so this is the same argument carried to a file that has to be
// seeked rather than held.
//
// The 2019 harness used @gmod/indexedfasta here, and that library's cost is
// inside its published cram-js numbers. Reading the bytes directly is the
// deviation, and it can only flatter cram-js, which is the direction that
// matters least: the finding it feeds is that cram-js is *faster* than 2019.
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'

export interface FaiRecord {
  name: string
  length: number
  offset: number
  lineBases: number
  lineWidth: number
}

export function readFai(fasta: string): FaiRecord[] {
  return readFileSync(`${fasta}.fai`, 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => {
      const [name, length, offset, lineBases, lineWidth] = l.split('\t')
      return {
        name: name!,
        length: Number(length),
        offset: Number(offset),
        lineBases: Number(lineBases),
        lineWidth: Number(lineWidth),
      }
    })
}

/**
 * Residues for a 1-based inclusive range, which is the contract CRAM's
 * `seqFetch` is defined on.
 *
 * Reads the byte span the .fai describes and drops the line terminators from
 * it, rather than reading line by line: one `readSync` per call keeps this off
 * the profile of the thing being measured, and the terminators are at known
 * positions so removing them costs a scan.
 */
export class IndexedRef {
  private fd: number
  private byName = new Map<string, FaiRecord>()
  readonly records: FaiRecord[]

  constructor(fasta: string) {
    this.records = readFai(fasta)
    for (const r of this.records) {
      this.byName.set(r.name, r)
    }
    this.fd = openSync(fasta, 'r')
  }

  fetch(name: string, start: number, end: number) {
    const rec = this.byName.get(name)
    if (!rec) {
      throw new Error(`${name} not in the .fai`)
    }
    const from = Math.max(1, start)
    const to = Math.min(rec.length, end)
    if (to < from) {
      return ''
    }
    const seek = (pos: number) =>
      rec.offset +
      Math.floor((pos - 1) / rec.lineBases) * rec.lineWidth +
      ((pos - 1) % rec.lineBases)
    const first = seek(from)
    const last = seek(to)
    const buf = Buffer.allocUnsafe(last - first + 1)
    readSync(this.fd, buf, 0, buf.length, first)
    // Terminators only — every other byte is a residue, and the file may use
    // either line ending.
    let out = ''
    let keep = 0
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i]!
      if (c === 10 || c === 13) {
        if (keep < i) {
          out += buf.toString('latin1', keep, i)
        }
        keep = i + 1
      }
    }
    return keep < buf.length ? out + buf.toString('latin1', keep) : out
  }

  close() {
    closeSync(this.fd)
  }
}

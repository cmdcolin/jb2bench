// The two things both PIF scripts need from a file they did not write: where a
// prefix's records live in the compressed file, and what those records say.
//
// No tabix library. Reading the index is thirty lines of little-endian struct
// walking, and the alternative is a dependency whose whole surface here would be
// one call -- see docs/methodology.md on what this repo takes on.

import { readFileSync, statSync } from 'node:fs'
import { gunzipSync, inflateRawSync } from 'node:zlib'

// Bin 37450 is the pseudo-bin. Its two "chunks" are record counts, not file
// offsets, and reading them as offsets stretches every prefix over the whole
// file -- which reads as a plausible-looking table rather than as an error.
const PSEUDO_BIN = 37450

export interface RefSpan {
  refName: string
  chunks: [number, number][]
}

/**
 * Every reference sequence in a `.tbi`, with the compressed byte intervals its
 * records occupy. Offsets are BGZF block starts: a Tabix virtual offset is
 * `(block << 16) | withinBlock`, and only the block half addresses the file.
 */
export function readTabix(tbi: Buffer): RefSpan[] {
  const buf = gunzipSync(tbi)
  if (buf.readUInt32LE(0) !== 0x01494254) {
    throw new Error(
      'not a TBI (a .csi is a different layout; this reads TBI only)',
    )
  }
  let p = 4
  const i32 = () => {
    const v = buf.readInt32LE(p)
    p += 4
    return v
  }
  const nRef = i32()
  for (let i = 0; i < 6; i++) {
    i32() // format, col_seq, col_beg, col_end, meta, skip
  }
  const lNm = i32()
  const names = buf.toString('latin1', p, p + lNm).split('\0').slice(0, nRef)
  p += lNm

  return names.map(refName => {
    const chunks: [number, number][] = []
    const nBin = i32()
    for (let b = 0; b < nBin; b++) {
      const bin = buf.readUInt32LE(p)
      p += 4
      const nChunk = i32()
      for (let c = 0; c < nChunk; c++) {
        const beg = Number(buf.readBigUInt64LE(p) >> 16n)
        const end = Number(buf.readBigUInt64LE(p + 8) >> 16n)
        p += 16
        if (bin !== PSEUDO_BIN) {
          chunks.push([beg, end])
        }
      }
    }
    const nIntv = i32()
    p += 8 * nIntv
    return { refName, chunks }
  })
}

/**
 * Total bytes covered by a set of intervals, counting overlap once. Sibling
 * references share BGZF blocks wherever one block holds the tail of one and the
 * head of the next, so summing chunk lengths double-counts those blocks and
 * makes the prefixes sum to more than the file.
 */
export function unionBytes(chunks: [number, number][]): number {
  const sorted = [...chunks].sort((a, b) => a[0] - b[0])
  let total = 0
  let lo = -1
  let hi = -1
  for (const [b, e] of sorted) {
    if (b > hi) {
      if (hi > lo) {
        total += hi - lo
      }
      lo = b
      hi = e
    } else if (e > hi) {
      hi = e
    }
  }
  return hi > lo ? total + (hi - lo) : total
}

/** The whole of a local path or an http(s) URL. */
export async function readAll(src: string): Promise<Buffer> {
  if (/^https?:/.test(src)) {
    const res = await fetch(src)
    if (!res.ok) {
      throw new Error(`${src} answered ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }
  return readFileSync(src)
}

export async function sizeOf(src: string): Promise<number> {
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { method: 'HEAD' })
    const len = res.headers.get('content-length')
    if (!res.ok || len === null) {
      throw new Error(`${src} answered ${res.status} with no Content-Length`)
    }
    return Number(len)
  }
  return statSync(src).size
}

/** Bytes `[start, start+length)` of a local path or an http(s) URL. */
export async function readBytes(
  src: string,
  start: number,
  length: number,
): Promise<Buffer> {
  if (/^https?:/.test(src)) {
    const res = await fetch(src, {
      headers: { Range: `bytes=${start}-${start + length - 1}` },
    })
    if (res.status !== 206) {
      throw new Error(
        `${src} answered ${res.status} to a Range request; byte ranges are required`,
      )
    }
    return Buffer.from(await res.arrayBuffer())
  }
  return readFileSync(src).subarray(start, start + length)
}

/**
 * Decode whole BGZF blocks from `buf`, which must begin on a block boundary,
 * and return the text they hold. A trailing partial block is dropped rather
 * than decoded, so the last line may be truncated -- callers read whole lines
 * only up to the last newline.
 */
export function inflateBgzf(buf: Buffer): string {
  const out: Buffer[] = []
  let p = 0
  while (p + 18 <= buf.length) {
    if (buf[p] !== 0x1f || buf[p + 1] !== 0x8b) {
      break
    }
    const xlen = buf.readUInt16LE(p + 10)
    // the BSIZE subfield (SI1=66 SI2=67) carries the block's total size minus 1
    let bsize = -1
    let q = p + 12
    const xend = q + xlen
    while (q + 4 <= xend) {
      const si1 = buf[q]
      const si2 = buf[q + 1]
      const slen = buf.readUInt16LE(q + 2)
      if (si1 === 66 && si2 === 67) {
        bsize = buf.readUInt16LE(q + 4) + 1
        break
      }
      q += 4 + slen
    }
    if (bsize < 0 || p + bsize > buf.length) {
      break
    }
    out.push(inflateRawSync(buf.subarray(p + 12 + xlen, p + bsize - 8)))
    p += bsize
  }
  return Buffer.concat(out).toString('latin1')
}

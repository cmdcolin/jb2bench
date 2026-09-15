// The path an alignment takes, and the path an encoding of it draws, as
// segments over two axes: `own`, the genome the row is indexed on, and `mate`.

const M = 77
const I = 73
const D = 68
const N = 78
const EQ = 61
const X = 88

export const isIndel = (op: number) => op === I || op === D || op === N
export const ownAdv = (op: number, len: number) =>
  op === M || op === EQ || op === X || op === D || op === N ? len : 0
export const mateAdv = (op: number, len: number) =>
  op === M || op === EQ || op === X || op === I ? len : 0
export const matchAdv = (op: number, len: number) =>
  op === M || op === EQ || op === X ? len : 0

/** A CIGAR as `[len, opCharCode, len, opCharCode, ...]`. */
export function parseOps(cigar: string) {
  const ops: number[] = []
  let len = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      len = len * 10 + c - 48
    } else {
      ops.push(len, c)
      len = 0
    }
  }
  return ops
}

export interface Seg {
  own: number
  mate: number
}

/** The `cr:Z:` grammar as segments: `<own>:<mate>M`, `<n>M`, and kept I/D/N. */
export function coarseSegs(cr: string): Seg[] {
  const segs: Seg[] = []
  let len = 0
  let ownBeforeColon: number | undefined
  for (let i = 0; i < cr.length; i++) {
    const c = cr.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      len = len * 10 + c - 48
    } else if (c === 58) {
      ownBeforeColon = len
      len = 0
    } else {
      const op = cr[i]
      segs.push(
        op === 'M'
          ? { own: ownBeforeColon ?? len, mate: len }
          : op === 'I'
            ? { own: 0, mate: len }
            : { own: len, mate: 0 },
      )
      ownBeforeColon = undefined
      len = 0
    }
  }
  return segs
}

/** Cut at every indel of at least `size`, as the old writer's `splitCigarOnLargeGaps` did. */
export function splitSegs(ops: number[], size: number): Seg[] {
  const segs: Seg[] = []
  let own = 0
  let mate = 0
  for (let k = 0; k < ops.length; k += 2) {
    const len = ops[k]!
    const op = ops[k + 1]!
    if (len >= size && isIndel(op)) {
      if (own > 0 || mate > 0) {
        segs.push({ own, mate })
        own = 0
        mate = 0
      }
      segs.push(op === I ? { own: 0, mate: len } : { own: len, mate: 0 })
    } else {
      own += ownAdv(op, len)
      mate += mateAdv(op, len)
    }
  }
  if (own > 0 || mate > 0) {
    segs.push({ own, mate })
  }
  return segs
}

/**
 * Signed distance, at every vertex of the real path, from that vertex to the
 * coarse path taken at the same first-genome coordinate. Positive means the
 * coarse path sits further along the second genome than the truth.
 */
export function trace(ops: number[], segs: Seg[]) {
  const po = [0]
  const pm = [0]
  let co = 0
  let cm = 0
  for (const s of segs) {
    co += s.own
    cm += s.mate
    po.push(co)
    pm.push(cm)
  }
  const last = po.length - 1
  const xs: number[] = []
  const ys: number[] = []
  let i = 0
  let own = 0
  let mate = 0
  const probe = () => {
    while (i < last && po[i + 1]! < own) {
      i++
    }
    let lo: number
    let hi: number
    if (po[i] === own || (i < last && po[i + 1] === own)) {
      // a zero-own segment (a kept insertion) makes the coarse path cover a
      // range of second-genome coordinates at this point
      let j = po[i] === own ? i : i + 1
      lo = pm[j]!
      while (j < last && po[j + 1] === own) {
        j++
      }
      hi = pm[j]!
    } else if (i < last) {
      const t = (own - po[i]!) / (po[i + 1]! - po[i]!)
      lo = hi = pm[i]! + t * (pm[i + 1]! - pm[i]!)
    } else {
      lo = hi = pm[last]!
    }
    xs.push(own)
    ys.push(mate < lo ? lo - mate : mate > hi ? -(mate - hi) : 0)
  }
  probe()
  for (let k = 0; k < ops.length; k += 2) {
    own += ownAdv(ops[k + 1]!, ops[k]!)
    mate += mateAdv(ops[k + 1]!, ops[k]!)
    probe()
  }
  return { xs, ys }
}

export const peak = (ys: number[]) =>
  ys.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** The `cg:Z:` value of a PIF or PAF line, found without splitting a megabyte row. */
export function cigarOf(line: string) {
  const at = line.indexOf('\tcg:Z:')
  if (at < 0) {
    return undefined
  }
  const end = line.indexOf('\t', at + 6)
  return { at, cigar: end < 0 ? line.slice(at + 6) : line.slice(at + 6, end) }
}

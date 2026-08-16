// Emit one sample's coverage signal as bedGraph, deterministically.
//
//   node generate_cohort_bw.js <sampleIndex> <nSamples> > sample.bedGraph
//
// One file per sample is the point. A cohort signal panel — per-sample copy
// number, per-sample coverage, a tumour/normal series — is stored as N BigWigs
// because that is what the tooling that produces it emits, and a browser
// opening the panel pays a per-file cost N times. That per-file cost is what
// cohort-bw.ts measures, and it is only visible when N is large, so the corpus
// has to be N files rather than one large one.
//
// Seeded, like generate_variants.js and for the same reason: every machine gets
// byte-identical input without a simulation toolchain in the way. The signal is
// shaped rather than uniform because a BigWig's R-tree and its zoom levels are
// built from the data, so a flat file would give an index shape no real file
// has.
//
// The window matches every other benchmark here: chr22_mask:124000-143000 sits
// inside the 250 kb contig this writes across.

const REF = 'chr22_mask'
const CONTIG_LENGTH = 250_001
// 100 bp bins over 250 kb: 2500 intervals a sample. Fine enough that the R-tree
// has real depth, coarse enough that 100 samples stay a few MB in total.
const BIN = 100

const [, , idxArg, nArg] = process.argv
const idx = Number(idxArg)
const nSamples = Number(nArg)
if (!Number.isFinite(idx) || !Number.isFinite(nSamples)) {
  console.error('usage: node generate_cohort_bw.js <sampleIndex> <nSamples>')
  process.exit(1)
}

// mulberry32, seeded on the sample index so each sample differs and every
// machine agrees.
let seed = (0x9e3779b9 ^ Math.imul(idx + 1, 2654435761)) | 0
function rnd() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Two copy-number segments at fixed coordinates that a minority of samples
// carry. Shared structure across samples is what makes a panel worth drawing as
// a panel, and it also means the files are not 100 independent noise fields —
// their zoom levels and R-trees come out comparable.
const SEGMENTS = [
  { start: 131_000, end: 135_000, log2: -1.0, carrierRate: 0.18 },
  { start: 138_500, end: 141_000, log2: 0.58, carrierRate: 0.11 },
]
const carries = SEGMENTS.map(s => rnd() < s.carrierRate)

// Per-sample depth scale, so samples are not interchangeable: real panels vary
// several-fold in library depth and the browser's autoscale has to cope.
const depthScale = 0.6 + rnd() * 1.6

const out = []
for (let pos = 0; pos < CONTIG_LENGTH - BIN; pos += BIN) {
  let log2 = 0
  for (let s = 0; s < SEGMENTS.length; s++) {
    const seg = SEGMENTS[s]
    if (carries[s] && pos >= seg.start && pos < seg.end) {
      log2 += seg.log2
    }
  }
  // Lognormal-ish noise: coverage is a count process and its spread grows with
  // its mean, so additive noise would understate the variance where it matters.
  const noise = (rnd() + rnd() + rnd() - 1.5) * 0.28
  const value = 30 * depthScale * 2 ** (log2 + noise)
  out.push(`${REF}\t${pos}\t${pos + BIN}\t${value.toFixed(3)}`)
}

process.stdout.write(`${out.join('\n')}\n`)

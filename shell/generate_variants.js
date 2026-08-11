// Emit a multi-sample VCF over the benchmark window, deterministically.
//
// Written rather than simulated with bcftools on purpose: the VCF parse
// benchmark is about the parser, and a generator with a seeded RNG gives every
// machine byte-identical input without adding a toolchain dependency the other
// corpus generators do not already have. The allele frequencies and the
// genotype mix are drawn to look like a real callset (see below), because the
// scan's cost depends on how many DISTINCT genotype strings a site carries —
// a file of all `0|0` would memoize perfectly and measure nothing.
//
//   node generate_variants.js <samples> <shape> <out.vcf>
//
// shape is one of:
//   gtonly  FORMAT=GT              — the 1000 Genomes phase 3 shape
//   wide    FORMAT=GT:AD:DP:GQ:PL  — a high-coverage joint callset
//
// The window matches every other benchmark here: chr22_mask:124000-143000.
import { writeFileSync } from 'node:fs'

const REF = 'chr22_mask'
const START = 124_000
const END = 143_000
// ~1 variant per 60 bp. 1000 Genomes runs nearer 1 per 130 bp genome-wide, but
// the point of the corpus is the samples x variants product and a denser window
// keeps the file a sensible size while still being a plausible density for a
// common-variant region.
const SPACING = 60

const [, , samplesArg, shape, out] = process.argv
const nSamples = Number(samplesArg)
if (!Number.isFinite(nSamples) || !out || !['gtonly', 'wide'].includes(shape)) {
  console.error(
    'usage: node generate_variants.js <samples> <gtonly|wide> <out.vcf>',
  )
  process.exit(1)
}

// mulberry32: seeded so two machines emit the same file. The seed folds in the
// sample count and shape so the two shapes are not the same genotypes twice.
let seed = 0x9e3779b9 ^ (nSamples * 2654435761) ^ (shape === 'wide' ? 0x5bf03635 : 0)
function rnd() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const BASES = ['A', 'C', 'G', 'T']

const header = []
header.push('##fileformat=VCFv4.3')
header.push(`##contig=<ID=${REF},length=250000>`)
header.push('##INFO=<ID=AC,Number=A,Type=Integer,Description="Allele count">')
header.push('##INFO=<ID=AN,Number=1,Type=Integer,Description="Allele number">')
header.push('##INFO=<ID=AF,Number=A,Type=Float,Description="Allele frequency">')
header.push('##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">')
if (shape === 'wide') {
  header.push(
    '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths">',
  )
  header.push('##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Depth">')
  header.push('##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">')
  header.push('##FORMAT=<ID=PL,Number=G,Type=Integer,Description="Phred likelihoods">')
}
const sampleNames = Array.from({ length: nSamples }, (_, i) => `HG${String(i).padStart(5, '0')}`)
header.push(
  `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${sampleNames.join('\t')}`,
)

const format = shape === 'wide' ? 'GT:AD:DP:GQ:PL' : 'GT'
const lines = [header.join('\n')]

for (let pos = START; pos < END; pos += SPACING) {
  // Allele frequency spectrum: mostly rare, occasionally common. This is what
  // makes most genotypes `0|0` while leaving a realistic tail, and it is the
  // distribution the per-site memo actually has to cope with.
  const u = rnd()
  const af = u < 0.6 ? rnd() * 0.01 : u < 0.9 ? rnd() * 0.1 : rnd() * 0.5
  // One site in 25 is multiallelic, which is what produces genotypes like
  // `1|2` and, at a decomposed site, two-digit allele indices.
  const nAlt = rnd() < 0.04 ? 2 : 1
  const refBase = BASES[Math.floor(rnd() * 4)]
  const alts = []
  while (alts.length < nAlt) {
    const b = BASES[Math.floor(rnd() * 4)]
    if (b !== refBase && !alts.includes(b)) {
      alts.push(b)
    }
  }
  // Phased two thirds of the time, per site, matching a callset that has been
  // through a phasing pass but leaves some sites unphased.
  const sep = rnd() < 0.67 ? '|' : '/'

  const cells = new Array(nSamples)
  let ac = 0
  let an = 0
  for (let s = 0; s < nSamples; s++) {
    // 1.5% missing, the rate a real callset carries after filtering
    if (rnd() < 0.015) {
      cells[s] =
        shape === 'wide' ? `.${sep}.:0,0:0:0:0,0,0` : `.${sep}.`
      continue
    }
    const a1 = rnd() < af ? 1 + Math.floor(rnd() * nAlt) : 0
    const a2 = rnd() < af ? 1 + Math.floor(rnd() * nAlt) : 0
    ac += (a1 > 0 ? 1 : 0) + (a2 > 0 ? 1 : 0)
    an += 2
    const gt = `${a1}${sep}${a2}`
    if (shape === 'gtonly') {
      cells[s] = gt
      continue
    }
    const dp = 20 + Math.floor(rnd() * 40)
    const alt = a1 + a2 === 0 ? 0 : Math.floor(dp * ((a1 > 0) + (a2 > 0)) * 0.5)
    const gq = 20 + Math.floor(rnd() * 79)
    cells[s] = `${gt}:${dp - alt},${alt}:${dp}:${gq}:${gq * 3},0,${gq * 5}`
  }

  const info = `AC=${ac};AN=${an};AF=${(an ? ac / an : 0).toFixed(6)}`
  lines.push(
    `${REF}\t${pos}\t.\t${refBase}\t${alts.join(',')}\t100\tPASS\t${info}\t${format}\t${cells.join('\t')}`,
  )
}

writeFileSync(out, `${lines.join('\n')}\n`)
console.log(
  `${out}: ${lines.length - 1} variants x ${nSamples} samples, FORMAT=${format}`,
)

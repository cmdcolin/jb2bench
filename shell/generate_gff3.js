// Emit a gene/transcript/exon GFF3 over a synthetic contig, deterministically.
//
// Written rather than cut from a real annotation for the same reason
// generate_variants.js is: the GFF3 benchmark is about the parser, and a seeded
// generator gives every machine byte-identical input without adding a download
// or a toolchain dependency.
//
//   node generate_gff3.js <genes> <shape> <out.gff3>
//
// shape is one of:
//   sparse  ID/Name/Parent only          — a bare feature dump, TAIR10-like
//   rich    15-20 attributes per line    — annotation-grade, GENCODE-like
//
// The two shapes exist because they take opposite paths through the parser, in
// the same way the VCF corpus's gtonly/wide split does. Deferring column 9 is
// most of the parse on `rich` and almost none of it on `sparse`; scanning for
// tab offsets instead of splitting is the reverse. Reporting only one shape
// would misdescribe both changes.
//
// UNLIKE every other corpus here, this one does not sit on the render
// benchmarks' chr22_mask:124000-143000 window. The scaling axis for a GFF3
// parse is the number of features, and 5000 genes do not fit in 19 kb at any
// plausible gene density. The VCF corpus can stay in the window because it
// scales on samples instead. So this contig is deliberately named something
// that cannot be confused with the shared one.
import { writeFileSync } from 'node:fs'

const REF = 'gff_contig'
const START = 10_000
// genes are spaced far enough apart not to overlap at the sizes below; the
// parser neither knows nor cares, but an overlapping annotation would be a
// strange thing to hand a reader as a fixture
const GENE_SPACING = 8_000

const [, , genesArg, shape, out] = process.argv
const nGenes = Number(genesArg)
if (!Number.isFinite(nGenes) || !out || !['sparse', 'rich'].includes(shape)) {
  console.error('usage: node generate_gff3.js <genes> <sparse|rich> <out.gff3>')
  process.exit(1)
}

// mulberry32, seeded so two machines emit the same file. The seed folds in the
// gene count and shape so the two shapes are not the same coordinates twice.
let seed =
  0x9e3779b9 ^ (nGenes * 2654435761) ^ (shape === 'rich' ? 0x5bf03635 : 0)
function rnd() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pick = xs => xs[Math.floor(rnd() * xs.length)]

const BIOTYPES = [
  'protein_coding',
  'lncRNA',
  'processed_pseudogene',
  'nonsense_mediated_decay',
  'retained_intron',
]
const TSL = ['1', '2', '3', '4', '5', 'NA']

// Attribute values are drawn from a spread of distinct strings rather than
// repeated, because a parser that interns or memoizes would measure nothing on
// a file where every line's attributes are identical. Same reasoning as the
// genotype mix in generate_variants.js.
function geneAttrs(i, id, name) {
  if (shape === 'sparse') {
    return `ID=${id};Name=${name}`
  }
  return [
    `ID=${id}`,
    `gene_id=${id}`,
    `gene_type=${pick(BIOTYPES)}`,
    `gene_name=${name}`,
    `level=${1 + Math.floor(rnd() * 3)}`,
    `hgnc_id=HGNC:${10_000 + i}`,
    `havana_gene=OTTHUMG${String(10_000_000 + i).padStart(11, '0')}.${1 + Math.floor(rnd() * 9)}`,
    `tag=${pick(['basic', 'MANE_Select', 'CCDS', 'basic,CCDS'])}`,
  ].join(';')
}

function txAttrs(i, t, geneId, txId, name) {
  if (shape === 'sparse') {
    return `ID=${txId};Parent=${geneId};Name=${name}.${t + 1}`
  }
  return [
    `ID=${txId}`,
    `Parent=${geneId}`,
    `gene_id=${geneId}`,
    `transcript_id=${txId}`,
    `gene_type=${pick(BIOTYPES)}`,
    `gene_name=${name}`,
    `transcript_type=${pick(BIOTYPES)}`,
    `transcript_name=${name}-${200 + t}`,
    `level=${1 + Math.floor(rnd() * 3)}`,
    `protein_id=ENSP${String(400_000 + i * 4 + t).padStart(11, '0')}.${1 + Math.floor(rnd() * 5)}`,
    `transcript_support_level=${pick(TSL)}`,
    `hgnc_id=HGNC:${10_000 + i}`,
    `tag=${pick(['basic', 'RNA_Seq_supported_only,basic', 'CCDS,basic'])}`,
    `havana_gene=OTTHUMG${String(10_000_000 + i).padStart(11, '0')}.${1 + Math.floor(rnd() * 9)}`,
    `havana_transcript=OTTHUMT${String(20_000_000 + i * 4 + t).padStart(11, '0')}.${1 + Math.floor(rnd() * 9)}`,
  ].join(';')
}

function partAttrs(i, txId, geneId, n, kind) {
  if (shape === 'sparse') {
    return `Parent=${txId}`
  }
  return [
    `Parent=${txId}`,
    `gene_id=${geneId}`,
    `transcript_id=${txId}`,
    `exon_number=${n}`,
    `exon_id=ENSE${String(700_000 + i * 32 + n).padStart(11, '0')}.${1 + Math.floor(rnd() * 5)}`,
    `gene_type=${pick(BIOTYPES)}`,
    `transcript_type=${pick(BIOTYPES)}`,
    `level=${1 + Math.floor(rnd() * 3)}`,
    `tag=basic`,
    `${kind === 'CDS' ? 'protein_id' : 'havana_transcript'}=X${String(i * 8 + n).padStart(9, '0')}.1`,
  ].join(';')
}

const lines = ['##gff-version 3']

for (let i = 0; i < nGenes; i++) {
  const geneStart = START + i * GENE_SPACING
  const geneEnd = geneStart + 2000 + Math.floor(rnd() * 4000)
  const strand = rnd() < 0.5 ? '+' : '-'
  const geneId = `ENSG${String(100_000 + i).padStart(11, '0')}.${1 + Math.floor(rnd() * 20)}`
  const name = `GENE${i}`

  lines.push(
    `${REF}\tHAVANA\tgene\t${geneStart}\t${geneEnd}\t.\t${strand}\t.\t${geneAttrs(i, geneId, name)}`,
  )

  // two transcripts per gene: enough that the parent/child linking has real
  // work to do and that a gene has more than one isoform to lay out
  for (let t = 0; t < 2; t++) {
    const txId = `ENST${String(300_000 + i * 4 + t).padStart(11, '0')}.${1 + Math.floor(rnd() * 9)}`
    const txStart = geneStart + Math.floor(rnd() * 200)
    const txEnd = geneEnd - Math.floor(rnd() * 200)
    lines.push(
      `${REF}\tHAVANA\ttranscript\t${txStart}\t${txEnd}\t.\t${strand}\t.\t${txAttrs(i, t, geneId, txId, name)}`,
    )

    const nExons = 4 + Math.floor(rnd() * 5)
    const span = Math.max(1, Math.floor((txEnd - txStart) / nExons))
    for (let e = 0; e < nExons; e++) {
      const exStart = txStart + e * span
      const exEnd = exStart + Math.max(20, Math.floor(span * 0.4))
      lines.push(
        `${REF}\tHAVANA\texon\t${exStart}\t${exEnd}\t.\t${strand}\t.\t${partAttrs(i, txId, geneId, e + 1, 'exon')}`,
      )
      lines.push(
        `${REF}\tHAVANA\tCDS\t${exStart}\t${exEnd}\t.\t${strand}\t${e % 3}\t${partAttrs(i, txId, geneId, e + 1, 'CDS')}`,
      )
    }
  }
}

writeFileSync(out, `${lines.join('\n')}\n`)

const featureLines = lines.length - 1
const attrs =
  lines
    .slice(1)
    .reduce((a, l) => a + l.slice(l.lastIndexOf('\t') + 1).split(';').length, 0) /
  featureLines
console.log(
  `${out}: ${featureLines} feature lines, ${attrs.toFixed(1)} attrs/line`,
)

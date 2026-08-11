// Stamp MM/ML base-modification tags onto an existing BAM, deterministically.
//
// jb2bench had no modBAM at all, so `extractModifications` and the whole
// modification/methylation color path were never exercised by anything here —
// `flame/WORKER_FINDINGS.md` carried that as an open gap since June, and two
// committed optimizations in that path are justified by reasoning rather than
// by any trace. This closes it.
//
// Synthesized rather than downloaded, for the same reason generate_variants.js
// is: a seeded generator gives every machine byte-identical input without a
// download or another toolchain dependency. It reads SAM on stdin and writes
// SAM on stdout, so the caller pipes it through samtools.
//
//   samtools view -h in.bam | node add_modifications.js | samtools view -b -o out.bam
//
// What it emits, and why it is shaped this way:
//
//   MM:Z:C+m?,<deltas>;   ML:B:C,<probs>
//
// - **CpG only.** A C is called only when followed by G in the read. Calling
//   every C would trivially maximize the work, but real 5mC callers emit CpG
//   context and the render path bins by position — a fixture whose modified
//   bases are 4x denser than reality would misdescribe the cost it is there to
//   measure.
// - **Bimodal probabilities.** Real callers are confident: mostly near 0 or
//   near 255, not uniform. The renderer thresholds on the probability, so a
//   uniform spread would put an unrealistic share of bases near the cutoff.
// - **Strand.** MM describes the ORIGINAL read, and BAM stores SEQ already
//   flipped to the reference strand. So for a reverse-mapped read the original
//   is revcomp(SEQ), and that is what gets scanned. Getting this wrong is
//   invisible in the file and shows up only as modifications drawn at the wrong
//   end of half the reads.
//
// The delta encoding is the part worth stating exactly: each number is the
// count of SKIPPED bases of the same letter since the previous called one, not
// a coordinate. Consecutive called C's are therefore `0`.

const READS_MODIFIED = 0.85 // reads a caller emits tags for at all
const CPG_CALLED = 0.9 // CpG sites that get a call on a tagged read
const METHYLATED = 0.7 // called sites that are actually methylated

let seed = 0x9e3779b9
function rnd() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' }
function revcomp(s) {
  let out = ''
  for (let i = s.length - 1; i >= 0; i--) {
    out += COMP[s[i]] ?? 'N'
  }
  return out
}

let nReads = 0
let nTagged = 0
let nCalls = 0

function tagsFor(seq, reverse) {
  // the read as the sequencer saw it, which is what MM indexes into
  const original = reverse ? revcomp(seq) : seq
  const deltas = []
  const probs = []
  let skipped = 0
  for (let i = 0; i < original.length; i++) {
    if (original[i] !== 'C') {
      continue
    }
    // CpG context; a trailing C has no following base and is not a site
    if (original[i + 1] !== 'G' || rnd() > CPG_CALLED) {
      skipped++
      continue
    }
    deltas.push(skipped)
    skipped = 0
    // bimodal: confident methylated or confident unmethylated
    probs.push(
      rnd() < METHYLATED
        ? 200 + Math.floor(rnd() * 56)
        : Math.floor(rnd() * 40),
    )
  }
  if (deltas.length === 0) {
    return undefined
  }
  nCalls += deltas.length
  return `MM:Z:C+m?,${deltas.join(',')};\tML:B:C,${probs.join(',')}`
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buf += chunk
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    process.stdout.write(`${transform(line)}\n`)
  }
})
process.stdin.on('end', () => {
  if (buf !== '') {
    process.stdout.write(`${transform(buf)}\n`)
  }
  process.stderr.write(
    `${nTagged}/${nReads} reads tagged, ${nCalls} modification calls\n`,
  )
})

function transform(line) {
  if (line === '' || line.startsWith('@')) {
    return line
  }
  nReads++
  const cols = line.split('\t')
  const flag = Number(cols[1])
  const seq = cols[9]
  // no stored sequence (secondary alignments often carry `*`) means nothing to
  // index modifications against
  if (!seq || seq === '*' || rnd() > READS_MODIFIED) {
    return line
  }
  const tags = tagsFor(seq, (flag & 16) !== 0)
  if (tags === undefined) {
    return line
  }
  nTagged++
  return `${line}\t${tags}`
}

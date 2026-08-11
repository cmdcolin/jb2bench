// Independently decode MM/ML back against the read sequence and check it.
//
// A delta encoding is exactly the kind of thing that is wrong by one and still
// produces a file every tool accepts — samtools will happily carry a tag whose
// positions land on the wrong bases, and the error surfaces only as
// modifications drawn in the wrong places. So this decodes without reusing any
// of the generator's logic: walk the original read, count same-letter skips,
// and assert every position the tag names is really a CpG C.
//
//   samtools view in.bam | node verify_modifications.js
const COMP = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' }
function revcomp(s) {
  let out = ''
  for (let i = s.length - 1; i >= 0; i--) {
    out += COMP[s[i]] ?? 'N'
  }
  return out
}

let reads = 0
let tagged = 0
let calls = 0
let bad = 0
const examples = []

function check(line) {
  if (line === '' || line.startsWith('@')) {
    return
  }
  reads++
  const cols = line.split('\t')
  const flag = Number(cols[1])
  const seq = cols[9]
  const mm = cols.find(c => c.startsWith('MM:Z:'))
  const ml = cols.find(c => c.startsWith('ML:B:C,'))
  if (!mm) {
    return
  }
  tagged++
  if (!ml) {
    bad++
    examples.push(`${cols[0]}: MM without ML`)
    return
  }
  const body = mm.slice('MM:Z:'.length).replace(/;$/, '')
  const parts = body.split(',')
  const header = parts[0]
  if (header !== 'C+m?') {
    bad++
    examples.push(`${cols[0]}: unexpected MM header ${header}`)
    return
  }
  const deltas = parts.slice(1).map(Number)
  const probs = ml.slice('ML:B:C,'.length).split(',').map(Number)
  if (deltas.length !== probs.length) {
    bad++
    examples.push(
      `${cols[0]}: ${deltas.length} deltas vs ${probs.length} probabilities`,
    )
    return
  }
  if (probs.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    bad++
    examples.push(`${cols[0]}: probability out of range`)
    return
  }

  const original = (flag & 16) !== 0 ? revcomp(seq) : seq
  let i = 0
  let skip = deltas[0]
  for (const delta of deltas) {
    skip = delta
    // advance past `skip` unmodified C's, then land on the called one
    while (i < original.length) {
      if (original[i] === 'C') {
        if (skip === 0) {
          break
        }
        skip--
      }
      i++
    }
    if (i >= original.length) {
      bad++
      examples.push(`${cols[0]}: ran off the end of the read`)
      return
    }
    if (original[i] !== 'C' || original[i + 1] !== 'G') {
      bad++
      examples.push(
        `${cols[0]}: position ${i} is ${original[i]}${original[i + 1] ?? ''}, not a CpG C`,
      )
      return
    }
    calls++
    i++
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', c => {
  buf += c
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const l of lines) {
    check(l)
  }
})
process.stdin.on('end', () => {
  if (buf !== '') {
    check(buf)
  }
  console.log(
    `${reads} reads, ${tagged} tagged, ${calls} calls decoded and verified as CpG C, ${bad} bad`,
  )
  for (const e of examples.slice(0, 10)) {
    console.log(`  ${e}`)
  }
  process.exit(bad === 0 ? 0 : 1)
})

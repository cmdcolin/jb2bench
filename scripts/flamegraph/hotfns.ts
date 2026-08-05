// Summarize a folded-stack file: top functions by self time (leaf) and by total
// time (appears anywhere in stack). Times are the µs weights from
// cpuprofile2collapsed. Frame labels contain spaces, so the count is the last
// whitespace token and the stack is everything before it.
//
// Usage: node hotfns.ts <file.folded> [topN]
import fs from 'fs'

const file = process.argv[2]
const topN = Number.parseInt(process.argv[3] ?? '25', 10)
if (!file) {
  throw new Error('usage: hotfns.ts <file.folded> [topN]')
}

const self = new Map<string, number>()
const total = new Map<string, number>()
let grand = 0

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) {
    continue
  }
  const sp = line.lastIndexOf(' ')
  const us = Number.parseInt(line.slice(sp + 1), 10)
  if (!Number.isFinite(us)) {
    continue
  }
  grand += us
  const frames = line.slice(0, sp).split(';')
  const leaf = frames[frames.length - 1]!
  self.set(leaf, (self.get(leaf) ?? 0) + us)
  // total: unique frames in this stack each get the full weight once
  for (const f of new Set(frames)) {
    total.set(f, (total.get(f) ?? 0) + us)
  }
}

const fmt = (m: Map<string, number>) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(
      ([k, v]) =>
        `  ${((v / grand) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(5)}ms  ${k}`,
    )
    .join('\n')

console.log(`=== ${file}  (total ${(grand / 1000).toFixed(0)}ms on-CPU) ===`)
console.log(`-- top ${topN} by SELF time (leaf) --`)
console.log(fmt(self))
console.log(`-- top ${topN} by TOTAL time (in stack) --`)
console.log(fmt(total))

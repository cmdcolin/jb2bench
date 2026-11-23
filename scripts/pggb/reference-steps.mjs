// node windows.mjs | node reference-steps.mjs <chrY.gfa> <nodes dir>
// For each window, from the GFA's own GRCh38#0#chrY path: the reference steps
// that overlap it, how many of them are a later pass over a node the path
// visited earlier, and how many and how many bp of them the graph that
// graph-trace.mjs wrote to <nodes dir>/<start>.txt holds, its ids read
// without their strand. One JSON row per window, then a row for the path.
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [gfa, nodesDir] = process.argv.slice(2)
const reference = 'GRCh38#0#chrY'
const lengths = new Map()
let walk
for await (const line of createInterface({
  input: createReadStream(gfa, { highWaterMark: 1 << 24 }),
  crlfDelay: Infinity,
})) {
  if (line.startsWith('S\t')) {
    const idEnd = line.indexOf('\t', 2)
    const seqEnd = line.indexOf('\t', idEnd + 1)
    lengths.set(line.slice(2, idEnd), (seqEnd < 0 ? line.length : seqEnd) - idEnd - 1)
  } else if (line.startsWith(`P\t${reference}\t`)) {
    const stepsStart = reference.length + 3
    walk = line.slice(stepsStart, line.indexOf('\t', stepsStart))
  }
}
if (!walk) {
  throw new Error(`no P line named ${reference} in ${gfa}`)
}
const steps = walk.split(',')
const ids = steps.map(step => step.slice(0, -1))
const starts = new Float64Array(steps.length)
const later = new Uint8Array(steps.length)
const seen = new Set()
let at = 0
ids.forEach((id, i) => {
  starts[i] = at
  at += lengths.get(id)
  later[i] = seen.has(id) ? 1 : 0
  seen.add(id)
})
const firstOverlapping = bp => {
  let lo = 0
  let hi = steps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] + lengths.get(ids[mid]) <= bp) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

for await (const line of createInterface({ input: process.stdin })) {
  const [start, end] = line.trim().split(/\s+/).map(Number)
  const file = `${nodesDir}/${start}.txt`
  if (existsSync(file)) {
    const drawn = new Set(
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(id => id.replace(/[+-]$/, '')),
    )
    const own = new Set()
    const row = { start, end, steps: 0, laterPassSteps: 0, stepsDrawn: 0, laterPassStepsDrawn: 0, bp: 0, bpDrawn: 0 }
    for (let i = firstOverlapping(start); i < steps.length && starts[i] < end; i++) {
      const bp = Math.min(end, starts[i] + lengths.get(ids[i])) - Math.max(start, starts[i])
      row.steps++
      row.laterPassSteps += later[i]
      row.bp += bp
      if (drawn.has(ids[i])) {
        own.add(ids[i])
        row.stepsDrawn++
        row.laterPassStepsDrawn += later[i]
        row.bpDrawn += bp
      }
    }
    console.log(JSON.stringify({ ...row, nodes: drawn.size, nodesWithStepInWindow: own.size }))
  }
}
console.log(JSON.stringify({ path: reference, steps: steps.length, bp: at }))

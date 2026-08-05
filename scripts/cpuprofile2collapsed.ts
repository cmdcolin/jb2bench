// Convert a V8 .cpuprofile into folded/collapsed stacks for flamegraph.pl.
// Each sample's timeDelta (µs) is attributed to its stack (root->leaf), summed
// per unique stack. Prints "frame;frame;leaf <microseconds>" lines on stdout.
//
// Usage: node cpuprofile2collapsed.ts <file.cpuprofile> > out.folded
import fs from 'fs'

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
}
interface Node {
  id: number
  callFrame: CallFrame
  children?: number[]
}
interface Profile {
  nodes: Node[]
  samples: number[]
  timeDeltas: number[]
}

const file = process.argv[2]
if (!file) {
  throw new Error('usage: cpuprofile2collapsed.ts <file.cpuprofile>')
}
const prof = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile

const byId = new Map<number, Node>()
const parent = new Map<number, number>()
for (const n of prof.nodes) {
  byId.set(n.id, n)
}
for (const n of prof.nodes) {
  for (const c of n.children ?? []) {
    parent.set(c, n.id)
  }
}

function label(n: Node): string {
  const f = n.callFrame
  const name = f.functionName || '(anonymous)'
  // strip query/hash and keep just the bundle file basename for readability
  const base = (f.url || '').split('/').pop()?.split('?')[0] ?? ''
  if (name === '(root)' || name === '(program)' || name === '(idle)' || name === '(garbage collector)') {
    return name
  }
  return base ? `${name} (${base}:${f.lineNumber + 1})` : name
}

function stackFor(id: number): string {
  const frames: string[] = []
  let cur: number | undefined = id
  while (cur !== undefined) {
    const node = byId.get(cur)
    if (node) {
      frames.push(label(node))
    }
    cur = parent.get(cur)
  }
  return frames.reverse().join(';')
}

const folded = new Map<string, number>()
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i]!
  const dt = prof.timeDeltas[i] ?? 0
  if (dt <= 0) {
    continue
  }
  const s = stackFor(id)
  folded.set(s, (folded.get(s) ?? 0) + dt)
}

const out: string[] = []
for (const [stack, us] of folded) {
  out.push(`${stack} ${Math.round(us)}`)
}
process.stdout.write(out.join('\n') + '\n')

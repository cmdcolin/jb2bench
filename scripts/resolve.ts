// Resolve the hottest minified frames in a .cpuprofile back to original source
// via the build's sourcemaps. Computes self time per node (sample leaf weighted
// by timeDelta), takes the top N, and maps each callFrame (url/line/col) through
// the matching <basename>.map in the build's static/js dir.
//
// Usage: node resolve.ts <file.cpuprofile> <static/js dir> [topN]
import fs from 'fs'
import path from 'path'
import { SourceMapConsumer } from 'source-map'

const file = process.argv[2]
const jsDir = process.argv[3]
const topN = Number.parseInt(process.argv[4] ?? '15', 10)
if (!file || !jsDir) {
  throw new Error('usage: resolve.ts <file.cpuprofile> <static/js dir> [topN]')
}

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
interface Node {
  id: number
  callFrame: CallFrame
}
interface Profile {
  nodes: Node[]
  samples: number[]
  timeDeltas: number[]
}

const prof = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile
const byId = new Map<number, Node>()
for (const n of prof.nodes) {
  byId.set(n.id, n)
}

const selfUs = new Map<number, number>()
let grand = 0
for (let i = 0; i < prof.samples.length; i++) {
  const dt = prof.timeDeltas[i] ?? 0
  if (dt > 0) {
    const id = prof.samples[i]!
    selfUs.set(id, (selfUs.get(id) ?? 0) + dt)
    grand += dt
  }
}

const top = [...selfUs.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, topN)

const consumers = new Map<string, SourceMapConsumer | null>()
async function consumerFor(url: string) {
  const base = url.split('/').pop()?.split('?')[0] ?? ''
  if (!consumers.has(base)) {
    const mapPath = path.join(jsDir, base + '.map')
    if (fs.existsSync(mapPath)) {
      consumers.set(
        base,
        await new SourceMapConsumer(fs.readFileSync(mapPath, 'utf8')),
      )
    } else {
      consumers.set(base, null)
    }
  }
  return consumers.get(base) ?? null
}

console.log(`=== ${path.basename(file)}  (self-time top ${topN}, total ${(grand / 1000).toFixed(0)}ms) ===`)
for (const [id, us] of top) {
  const n = byId.get(id)!
  const cf = n.callFrame
  const pct = ((us / grand) * 100).toFixed(1).padStart(5)
  const ms = (us / 1000).toFixed(0).padStart(5)
  const synthetic = !cf.url || cf.functionName.startsWith('(')
  if (synthetic) {
    console.log(`${pct}% ${ms}ms  ${cf.functionName || '(anonymous)'}`)
  } else {
    const c = await consumerFor(cf.url)
    const pos = c
      ? c.originalPositionFor({
          line: cf.lineNumber + 1,
          column: cf.columnNumber,
        })
      : null
    const where = pos?.source
      ? `${pos.source.replace(/^.*\/node_modules\//, '').replace(/^webpack:\/\//, '')}:${pos.line} ${pos.name ? `[${pos.name}]` : ''}`
      : `${cf.url.split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber}`
    console.log(`${pct}% ${ms}ms  ${cf.functionName || '(anon)'}  ->  ${where}`)
  }
}
for (const c of consumers.values()) {
  c?.destroy()
}

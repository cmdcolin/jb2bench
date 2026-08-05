// Cross-tool zoom matrix: 2x zoom-in, both tools, one instrument.
//
// The point of the render architecture is that navigation inside already-loaded
// data is a redraw rather than a refetch. Against JBrowse's own predecessor that
// is a 1-15 s difference (results/interaction.md). Against igv.js it is not
// obvious in advance: igv also keeps the surrounding window client-side, so it
// too should avoid the network here. What it cannot avoid is re-drawing the
// pileup on the CPU. This measures that.
//
// Usage: node scripts/crosstool/zoomrunner.ts
//   CASES=200x-shortread,1000x-shortread   default is those two
import { execFileSync } from 'child_process'
import fs from 'fs'
import { loadavg } from '../render/loadavg.ts'

const LOC = 'chr22_mask:124000-143000'
const JBROWSE_PORT = 8000
const IGV_PORT = 8003
const STEPS = Number(process.env.STEPS ?? 5)

const cases = (
  process.env.CASES ?? '200x-shortread,1000x-shortread'
).split(',')

const url = (tool: string, track: string) =>
  tool === 'jbrowse'
    ? `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${track}&renderer=webgl`
    : `http://localhost:${IGV_PORT}/?loc=${LOC}&track=${track}`

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

interface Cell {
  steps: number[]
  median: number
  load: number
}
const out: Record<string, Record<string, Cell>> = {}

for (const c of cases) {
  const track = `${c.replace('-', '.')}.bam`
  out[c] = {}
  for (const tool of ['jbrowse', 'igv']) {
    const before = loadavg()
    let raw = ''
    try {
      raw = execFileSync(
        'node',
        ['scripts/crosstool/zoomprofile.ts', url(tool, track), tool],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', STEPS: String(STEPS) },
        },
      )
    } catch (e) {
      raw = (e as { stdout?: string }).stdout ?? ''
    }
    const line = raw.trim().split('\n').pop() ?? '{}'
    const parsed = JSON.parse(line) as { steps?: number[] }
    const steps = (parsed.steps ?? []).filter(Number.isFinite)
    out[c]![tool] = {
      steps: parsed.steps ?? [],
      median: steps.length ? median(steps) : Number.NaN,
      load: Math.max(before, loadavg()),
    }
    console.log(`${c} ${tool}: ${JSON.stringify(parsed.steps)}`)
  }
}

const POLL = Number(process.env.POLL_MS ?? 100)
const lines = [
  '# Cross-tool zoom benchmark: JBrowse vs igv.js',
  '',
  `2x zoom-in, ${STEPS} successive steps, median per cell. The instrument is`,
  '`scripts/crosstool/zoomprofile.ts`: time from the zoom call until the pixels',
  `stop changing, polled every ${POLL} ms. **${POLL} ms is the floor** — a redraw`,
  'that finishes inside one poll reports as one poll, so small values mean "at',
  'most one poll" and not a measured duration.',
  '',
  'Both tools hold the surrounding window client-side, so neither should refetch',
  'here; what differs is what each has to do to redraw. Read this against',
  '`results/interaction.md`, which measures the same interaction against',
  "JBrowse's own predecessor, where the old renderer does refetch.",
  '',
  '| case | JBrowse | igv.js | ratio | JBrowse steps | igv.js steps |',
  '|---|---:|---:|---:|---|---|',
]
for (const c of cases) {
  const jb = out[c]!.jbrowse!
  const ig = out[c]!.igv!
  const ratio =
    Number.isFinite(jb.median) && Number.isFinite(ig.median) && jb.median > 0
      ? `${(ig.median / jb.median).toFixed(2)}×`
      : '—'
  const fmt = (c2: Cell) =>
    Number.isFinite(c2.median) ? `${c2.median.toFixed(0)} ms` : 'FAIL'
  lines.push(
    `| ${c} | ${fmt(jb)} | ${fmt(ig)} | ${ratio} | ${JSON.stringify(jb.steps)} | ${JSON.stringify(ig.steps)} |`,
  )
}
lines.push('')
lines.push(
  `Load while measuring: ${cases
    .map(c => `${c} ${Math.max(out[c]!.jbrowse!.load, out[c]!.igv!.load).toFixed(1)}`)
    .join(', ')}. This box is shared; the two tools in a row are measured minutes apart, so read the ratio.`,
)
lines.push('')
fs.writeFileSync('results/crosstool-zoom.md', lines.join('\n'))
fs.writeFileSync('results/crosstool-zoom.json', JSON.stringify(out, null, 2))
console.log(lines.join('\n'))

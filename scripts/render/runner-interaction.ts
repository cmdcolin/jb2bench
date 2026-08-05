// Runs the zoom interaction benchmark (scripts/render/interaction.ts) across the build
// x case matrix and tabulates time-to-content (ms a loading indicator is shown
// after a zoom-in) and redraw frame cost. The headline: old builds refetch +
// re-render on every zoom (seconds of "Downloading..."), the GPU branch
// re-projects loaded reads instantly.
import { execFileSync } from 'child_process'
import fs from 'fs'

const LOC = 'chr22_mask:124000-143000'
const builds = [
  { name: 'webgl-poc', port: 8000, extra: '&renderer=webgl' },
  { name: 'release-4.3.0', port: 8001, extra: '' },
]
const cases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    cases.push({ id: `${cov}-${read}`, track: `${cov}.${read}.bam` })
  }
}

// in  — the new view is a subset of loaded data, so only the old renderer
//       refetches. The GPU branch's best case.
// out — the new view needs data neither build has, so BOTH refetch. Isolates
//       redraw cost from fetch cost, and is the harder case for the branch.
const DIRECTIONS = ['in', 'out'] as const
type Direction = (typeof DIRECTIONS)[number]

interface Result {
  zoomTimeToContentMs: number
  zoomRedrawGapMs: number
  loadingEverSeen: boolean
  stepsAttempted: number
  stepsMeasured: number
  stepsBailed: number
  stepsCensored: number
  censored: boolean
  allBailed: boolean
  maxWaitMs: number
}

function run(
  build: (typeof builds)[number],
  track: string,
  zoom: Direction,
): Result {
  const url = `http://localhost:${build.port}/?loc=${LOC}&assembly=hg19mod&tracks=${track}${build.extra}`
  const out = execFileSync('node', ['scripts/render/interaction.ts', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', ZOOM: zoom },
  })
  return JSON.parse(out.trim().split('\n').pop()!) as Result
}

// Three things that are NOT a time, and must not be printed as one:
//   allBailed  — the track refused the fetch and drew nothing on every step
//   NaN        — no step applied (view already clamped at the contig edge)
//   censored   — still loading at MAX_WAIT, so the value is a lower bound
// Reporting a bail as "91ms" is what previously made a refusal to render look
// like the fastest result in the table.
const cell = (r: Result) => {
  if (r.allBailed) {
    return '_bail_'
  }
  if (!Number.isFinite(r.zoomTimeToContentMs)) {
    return 'n/a'
  }
  const bail = r.stepsBailed ? ` (${r.stepsBailed} bail)` : ''
  return `${r.censored ? '≥' : ''}${r.zoomTimeToContentMs.toFixed(0)}ms${bail}`
}

const results: Record<string, Record<Direction, Record<string, Result>>> = {}
for (const c of cases) {
  results[c.id] = { in: {}, out: {} }
  for (const dir of DIRECTIONS) {
    for (const b of builds) {
      process.stdout.write(`${c.id} / ${b.name} / zoom-${dir}: `)
      const r = run(b, c.track, dir)
      results[c.id]![dir][b.name] = r
      process.stdout.write(
        `time-to-content ${cell(r)} (loading=${r.loadingEverSeen}, steps=${r.stepsMeasured}` +
          `${r.stepsCensored ? `, censored=${r.stepsCensored}` : ''})\n`,
      )
    }
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/interaction.json',
  JSON.stringify({ loc: LOC, results }, null, 2),
)

const MAX_WAIT_NOTE = `${results[cases[0]!.id]!.in[builds[0]!.name]!.maxWaitMs} ms`

let md = `# Zoom interaction benchmark\n\n`
md += `Region \`${LOC}\`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. `
md += `redraw = longest frame (ms) of the GPU redraw. A \`≥\` prefix marks a censored value: the step was still loading at MAX_WAIT (${MAX_WAIT_NOTE}), so the true figure is larger.\n\n`

md += `## Zoom IN — only the old renderer refetches\n\n`
md += `The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.\n\n`
md += `| case | webgl-poc | release-4.3.0 | webgl-poc redraw frame |\n`
md += `|---|---:|---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!.in['webgl-poc']!
  const r = results[c.id]!.in['release-4.3.0']!
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} | ${w.zoomRedrawGapMs.toFixed(0)}ms |\n`
}

md += `\n## Zoom OUT — mostly refused, not measured\n\n`
md += `Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.\n\n`
md += `That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. \`_bail_\` marks a cell where no step drew anything; \`(n bail)\` marks partial refusal, with the median taken only over steps that did draw.\n\n`
md += `The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. Panning at constant zoom is the way to test refetch against refetch without crossing the cap.\n\n`
md += `| case | webgl-poc | release-4.3.0 | webgl-poc redraw frame | drew/attempted |\n`
md += `|---|---:|---:|---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!.out['webgl-poc']!
  const r = results[c.id]!.out['release-4.3.0']!
  const gap = Number.isFinite(w.zoomRedrawGapMs)
    ? `${w.zoomRedrawGapMs.toFixed(0)}ms`
    : 'n/a'
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} | ${gap} | ${w.stepsMeasured}/${w.stepsAttempted} |\n`
}
fs.writeFileSync('results/interaction.md', md)
console.log('\n' + md)
console.log('Wrote results/interaction.{json,md}')

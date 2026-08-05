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
  stepsMeasured: number
  stepsCensored: number
  censored: boolean
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

// A censored cell is a lower bound, so render it as ">=N" rather than as a
// number that reads like a measurement. No measured step at all (the view was
// already at the contig edge) is "n/a", not 0 — 0 means "content never went
// away", which is the opposite conclusion.
const cell = (r: Result) =>
  Number.isFinite(r.zoomTimeToContentMs)
    ? `${r.censored ? '≥' : ''}${r.zoomTimeToContentMs.toFixed(0)}ms`
    : 'n/a'

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

md += `\n## Zoom OUT — both refetch\n\n`
md += `The new view needs data neither build has loaded, so both must fetch. What remains of the gap here is render cost rather than avoided fetching. Steps stop early when the view clamps at the 250 kb contig.\n\n`
md += `| case | webgl-poc | release-4.3.0 | webgl-poc redraw frame | steps |\n`
md += `|---|---:|---:|---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!.out['webgl-poc']!
  const r = results[c.id]!.out['release-4.3.0']!
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} | ${w.zoomRedrawGapMs.toFixed(0)}ms | ${w.stepsMeasured} |\n`
}
fs.writeFileSync('results/interaction.md', md)
console.log('\n' + md)
console.log('Wrote results/interaction.{json,md}')

// Runs the zoom interaction benchmark (scripts/interaction.ts) across the build
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

interface Result {
  zoomTimeToContentMs: number
  zoomRedrawGapMs: number
  loadingEverSeen: boolean
}

function run(build: (typeof builds)[number], track: string): Result {
  const url = `http://localhost:${build.port}/?loc=${LOC}&assembly=hg19mod&tracks=${track}${build.extra}`
  const out = execFileSync('node', ['scripts/interaction.ts', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  })
  return JSON.parse(out.trim().split('\n').pop()!) as Result
}

const results: Record<string, Record<string, Result>> = {}
for (const c of cases) {
  results[c.id] = {}
  for (const b of builds) {
    process.stdout.write(`${c.id} / ${b.name}: `)
    const r = run(b, c.track)
    results[c.id]![b.name] = r
    process.stdout.write(
      `time-to-content ${r.zoomTimeToContentMs.toFixed(0)}ms (loading=${r.loadingEverSeen})\n`,
    )
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/interaction.json',
  JSON.stringify({ loc: LOC, results }, null, 2),
)

let md = `# Zoom interaction benchmark\n\n`
md += `Region \`${LOC}\`, zoom IN by 2x (subset of already-loaded reads). `
md += `**time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median of 5 zooms. `
md += `redraw = longest frame (ms) of the GPU redraw.\n\n`
md += `| case | webgl-poc time-to-content | release-4.3.0 time-to-content | webgl-poc redraw frame |\n`
md += `|---|---:|---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!['webgl-poc']!
  const r = results[c.id]!['release-4.3.0']!
  md += `| ${c.id} | ${w.zoomTimeToContentMs.toFixed(0)}ms | ${r.zoomTimeToContentMs.toFixed(0)}ms | ${w.zoomRedrawGapMs.toFixed(0)}ms |\n`
}
fs.writeFileSync('results/interaction.md', md)
console.log('\n' + md)
console.log('Wrote results/interaction.{json,md}')

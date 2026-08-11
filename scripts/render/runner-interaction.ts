// Runs the zoom interaction benchmark (scripts/render/interaction.ts) across the build
// x case matrix and tabulates time-to-content (ms a loading indicator is shown
// after a zoom-in) and redraw frame cost. The headline: old builds refetch +
// re-render on every zoom (seconds of "Downloading..."), the GPU branch
// re-projects loaded reads instantly.
import { execFileSync } from 'child_process'
import fs from 'fs'
import { resolveBuild } from './servedbuild.ts'
import { loadavg, outliers, peak, type LoadWindow } from './loadavg.ts'

const LOC = 'chr22_mask:124000-143000'

// Column headers come from what the ports are actually serving, not from a
// hardcoded guess — see servedbuild.ts for why.
// `published` is the version the 2023 paper describes, and it is **optional**:
// the three-server setup in the README predates it, and a run that omits port
// 8004 should still produce the two-column tables rather than aborting. Every
// other role is required, because a missing baseline is a broken run.
//
// Zoom is where this column is most worth having. Cold load is fetch-dominated
// and compresses three years of change into a small ratio; zoom-in is the case
// the architecture actually changed, so the published-version column is the one
// a reader of the 2023 paper can act on.
const ROLES = ['new', 'baseline', 'published'] as const
type Role = (typeof ROLES)[number]
const OPTIONAL_ROLES: readonly Role[] = ['published']
const ports: Record<Role, { port: number; extra: string }> = {
  new: { port: 8000, extra: '&renderer=webgl' },
  baseline: { port: 8001, extra: '' },
  published: { port: 8004, extra: '' },
}

const resolved = await Promise.all(
  ROLES.map(async role => {
    try {
      return { role, name: await resolveBuild(ports[role].port), ...ports[role] }
    } catch (e) {
      if (OPTIONAL_ROLES.includes(role)) {
        console.log(
          `${role}: port ${ports[role].port} not served, skipping (optional)`,
        )
        return undefined
      }
      throw e
    }
  }),
)
const builds = resolved.filter(b => b !== undefined)
for (const b of builds) {
  console.log(`${b.role}: port ${b.port} is serving builds/${b.name}`)
}
const hasPublished = builds.some(b => b.role === 'published')
const cases: { id: string; track: string }[] = []
for (const read of ['shortread', 'longread']) {
  for (const cov of ['20x', '200x', '1000x']) {
    cases.push({ id: `${cov}-${read}`, track: `${cov}.${read}.bam` })
  }
}

// in  — the new view is a subset of loaded data, so only the old renderer
//       refetches. The GPU branch's best case.
// out — meant to be the case where both refetch. It isn't: widening past a byte
//       threshold makes JBrowse decline the fetch outright. Kept because the
//       refusal is itself worth recording.
// pan — one viewport sideways at constant bpPerPx. The region is new to both
//       builds, and the bytes per step equal the initial render's, so the cap
//       that defeats zoom-out is never approached. This is the real
//       refetch-vs-refetch comparison.
const ALL_MODES = ['in', 'out', 'pan'] as const
type Mode = (typeof ALL_MODES)[number]

// MODES=pan re-measures one mode without spending an hour on the other two.
// The md is rebuilt from results/interaction.json, so modes that were not re-run
// keep their previous values rather than being wiped — but that means a filtered
// run mixes measurements from different times, which the report has to say.
// MODES=none measures nothing and just regenerates the report from the recorded
// JSON — for when the prose around the numbers changes but the numbers do not.
// Without it the only way to correct a sentence in a generated file is to spend
// an hour re-measuring, or to hand-edit a file that the next run overwrites.
const MODES = (
  process.env.MODES === 'none'
    ? []
    : process.env.MODES
      ? process.env.MODES.split(',')
      : [...ALL_MODES]
) as Mode[]
for (const m of MODES) {
  if (!(ALL_MODES as readonly string[]).includes(m)) {
    throw new Error(`MODES entry "${m}" is not one of ${ALL_MODES.join('|')}`)
  }
}

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
  steps: { locus: string; loadingSeen: boolean }[]
  /** load average either side of this cell — filled in here, not by the child */
  load?: LoadWindow
}

function run(
  build: (typeof builds)[number],
  track: string,
  mode: Mode,
): Result {
  const url = `http://localhost:${build.port}/?loc=${LOC}&assembly=hg19mod&tracks=${track}${build.extra}`
  const out = execFileSync('node', ['scripts/render/interaction.ts', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', MODE: mode },
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

// Modes not selected this time keep whatever the last run recorded, so a
// filtered re-run does not blank out the rest of the report.
interface Saved {
  results?: Record<string, Record<Mode, Partial<Record<Role, Result>>>>
  measuredAt?: Partial<Record<Mode, string>>
}
const prior: Saved = fs.existsSync('results/interaction.json')
  ? (JSON.parse(fs.readFileSync('results/interaction.json', 'utf8')) as Saved)
  : {}

const stamp = new Date().toISOString().slice(0, 10)
const measuredAt = { ...prior.measuredAt }
for (const m of MODES) {
  measuredAt[m] = stamp
}

const results: Record<string, Record<Mode, Partial<Record<Role, Result>>>> = {}
const measured: { key: string; load: LoadWindow; value: Result }[] = []
for (const c of cases) {
  results[c.id] = {
    in: {},
    out: {},
    pan: {},
    ...prior.results?.[c.id],
  }
  for (const mode of MODES) {
    for (const b of builds) {
      const what = mode === 'pan' ? 'pan' : `zoom-${mode}`
      process.stdout.write(`${c.id} / ${b.name} / ${what}: `)
      const before = loadavg()
      const r = run(b, c.track, mode)
      const load = { before, after: loadavg() }
      r.load = load
      results[c.id]![mode][b.role] = r
      measured.push({ key: `${c.id} / ${b.name} / ${what}`, load, value: r })
      process.stdout.write(
        `time-to-content ${cell(r)} (loading=${r.loadingEverSeen}, steps=${r.stepsMeasured}` +
          `${r.stepsCensored ? `, censored=${r.stepsCensored}` : ''}` +
          `, load=${load.before.toFixed(1)}→${load.after.toFixed(1)})` +
          // the loci are the audit trail that a pan actually moved into ground
          // neither build had already fetched
          `${mode === 'pan' ? ` [${r.steps.map(s => s.locus).join(' → ')}]` : ''}\n`,
      )
    }
  }
}

// A run whose median load looks fine can still contain one badly contaminated
// cell, and that cell is invisible in any per-run summary. Name it instead.
const { medianLoad, suspect } = outliers(measured)
if (suspect.length) {
  console.log(
    `\nWARNING: ${suspect.length} cell(s) measured at more than 2x the run's ` +
      `median load (${medianLoad.toFixed(1)}). Treat these as unverified:`,
  )
  for (const s of suspect) {
    console.log(`  ${s.key} — load peaked at ${peak(s.load).toFixed(1)}`)
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/interaction.json',
  JSON.stringify(
    {
      loc: LOC,
      // record what each role actually was, so the JSON stays interpretable
      // even if the ports get pointed at different builds later
      builds: Object.fromEntries(builds.map(b => [b.role, b.name])),
      measuredAt,
      results,
    },
    null,
    2,
  ),
)

const NEW = builds.find(b => b.role === 'new')!.name
const BASE = builds.find(b => b.role === 'baseline')!.name
const PUB = builds.find(b => b.role === 'published')?.name

// The published column is emitted only when port 8004 was served, so the header
// and every row have to agree about how many columns there are. These two keep
// that in one place instead of repeating the conditional at each table.
const pubHead = hasPublished ? ` ${PUB} |` : ''
const pubCell = (r: Partial<Record<Role, Result>>) =>
  hasPublished ? ` ${r.published ? cell(r.published) : '—'} |` : ''
const MAX_WAIT_NOTE = `${results[cases[0]!.id]!.in.new!.maxWaitMs} ms`

let md = `# Zoom interaction benchmark\n\n`
md += `Region \`${LOC}\`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. `
md += `redraw = longest frame (ms) of the GPU redraw. A \`≥\` prefix marks a censored value: the step was still loading at MAX_WAIT (${MAX_WAIT_NOTE}), so the true figure is larger.\n\n`

// Modes can be re-measured independently (MODES=pan), so the table can hold
// numbers from different runs. Say when each one was taken rather than letting
// the page imply they are one sitting.
const when = ALL_MODES.map(m => `${m}: ${measuredAt[m] ?? 'unknown'}`).join(', ')
md += `Measured — ${when}. Comparisons *within* a section are same-run; comparisons across sections may not be.\n\n`

md += `## Zoom IN — only the old renderer refetches\n\n`
md += `The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.\n\n`
md += `| case | ${NEW} | ${BASE} |${pubHead} ${NEW} redraw frame |\n`
md += `|---|---:|---:|${hasPublished ? '---:|' : ''}---:|\n`
for (const c of cases) {
  const w = results[c.id]!.in.new!
  const r = results[c.id]!.in.baseline!
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} |${pubCell(results[c.id]!.in)} ${w.zoomRedrawGapMs.toFixed(0)}ms |\n`
}

md += `\n## Zoom OUT — mostly refused, not measured\n\n`
md += `Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.\n\n`
md += `That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. \`_bail_\` marks a cell where no step drew anything; \`(n bail)\` marks partial refusal, with the median taken only over steps that did draw.\n\n`
md += `The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.\n\n`
md += `| case | ${NEW} | ${BASE} |${pubHead} ${NEW} redraw frame | drew/attempted |\n`
md += `|---|---:|---:|${hasPublished ? '---:|' : ''}---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!.out.new!
  const r = results[c.id]!.out.baseline!
  const gap = Number.isFinite(w.zoomRedrawGapMs)
    ? `${w.zoomRedrawGapMs.toFixed(0)}ms`
    : 'n/a'
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} |${pubCell(results[c.id]!.out)} ${gap} | ${w.stepsMeasured}/${w.stepsAttempted} |\n`
}

md += `\n## PAN at constant zoom — both builds refetch\n\n`
md += `One full viewport sideways per step, \`bpPerPx\` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.\n\n`
md += `Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.\n\n`
md += `A 19 kb window gets about five viewport-widths before it runs out of the 250 kb \`chr22_mask\`; steps beyond that are not attempted rather than clamped into a mostly-empty view.\n\n`
md += `The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.\n\n`
md += `| case | ${NEW} | ${BASE} | ratio |${pubHead} ${NEW} redraw frame | steps |\n`
md += `|---|---:|---:|---:|${hasPublished ? '---:|' : ''}---:|---:|\n`
for (const c of cases) {
  const w = results[c.id]!.pan.new!
  const r = results[c.id]!.pan.baseline!
  // a ratio is only meaningful between two cells that are both real timings
  const comparable =
    !w.allBailed &&
    !r.allBailed &&
    !w.censored &&
    !r.censored &&
    Number.isFinite(w.zoomTimeToContentMs) &&
    Number.isFinite(r.zoomTimeToContentMs) &&
    w.zoomTimeToContentMs > 0
  const ratio = comparable
    ? `${(r.zoomTimeToContentMs / w.zoomTimeToContentMs).toFixed(2)}×`
    : '—'
  const gap = Number.isFinite(w.zoomRedrawGapMs)
    ? `${w.zoomRedrawGapMs.toFixed(0)}ms`
    : 'n/a'
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} | ${ratio} |${pubCell(results[c.id]!.pan)} ${gap} | ${w.stepsMeasured}/${w.stepsAttempted} |\n`
}
fs.writeFileSync('results/interaction.md', md)
console.log('\n' + md)
console.log('Wrote results/interaction.{json,md}')

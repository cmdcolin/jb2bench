// Runs the zoom interaction benchmark (scripts/render/interaction.ts) across the build
// x case matrix and tabulates time-to-content (ms a loading indicator is shown
// after a zoom-in) and redraw frame cost. The headline: old builds refetch +
// re-render on every zoom (seconds of "Downloading..."), the GPU branch
// re-projects loaded reads instantly.
import { execFileSync } from 'child_process'
import fs from 'fs'
import { enumerateCases, migrateCaseKeys, selectCases } from './cases.ts'
import { resolveBuild } from './servedbuild.ts'
import {
  loadavg,
  outliers,
  peak,
  waitForQuiet,
  watchForeignCpu,
  type LoadWindow,
} from './loadavg.ts'

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
// Both formats, from the shared enumeration `runner.ts` uses. This matrix was
// BAM-only until 2026-08-23, so zoom and pan had no format axis at all while
// cold load had carried one since 2026-08-16 — the gap `cases.ts` exists to
// close. `FORMATS=bam` restores the six-case run.
const allCases = enumerateCases()

// CASES=20x-shortread,200x-longread re-measures a subset, the same way MODES
// narrows by mode -- the heavy long-read cells cost minutes each, so a full
// sweep is not always affordable. Cases not selected keep their recorded values,
// which means a filtered run mixes vintages; the report dates each mode for
// exactly that reason.
const cases = selectCases(allCases)

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
  // stderr is CAPTURED, not discarded. The child prints which render-complete
  // contract and which loading detector it chose there, and those are the two
  // things that explain an inexplicable cell. Discarding them cost an hour on
  // 2026-08-23: the child was timing out because it could not see the build's
  // contract at all, and the failure reached the operator as an execFileSync
  // error with `output: [null, '', null]` — a stack trace naming no cause.
  try {
    const out = execFileSync('node', ['scripts/render/interaction.ts', url], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', MODE: mode },
    })
    return JSON.parse(out.trim().split('\n').pop()!) as Result
  } catch (e) {
    const { stdout, stderr } = e as { stdout?: string; stderr?: string }
    const lines = (stderr ?? '').trim().split('\n').filter(Boolean)
    // The message, then the innermost frames. Keeping only the tail kept only
    // stack frames and threw the message itself away, which is the one part
    // that says what happened.
    const message = lines.filter(l => /^\s*\w*(Error|Exception)\b/.test(l)).slice(0, 2)
    const why = [...new Set([...message, ...lines.slice(-3)])]
    throw new Error(
      `interaction.ts failed for ${track} / ${build.name} / ${mode}\n` +
        `  url: ${url}\n` +
        (why.length ? why.map(l => `  child: ${l.trim()}`).join('\n') : '  child said nothing') +
        (stdout?.trim() ? `\n  stdout: ${stdout.trim().slice(-200)}` : ''),
    )
  }
}

// Three things that are NOT a time, and must not be printed as one:
//   allBailed  — the track refused the fetch and drew nothing on every step
//   NaN        — no step applied (view already clamped at the contig edge)
//   censored   — still loading at MAX_WAIT, so the value is a lower bound
// Reporting a bail as "91ms" is what previously made a refusal to render look
// like the fastest result in the table.
const cell = (r: Result | undefined) => {
  // A row can be absent rather than merely stale: adding the CRAM cases gave
  // every previously-recorded row six siblings that were never measured, and
  // indexing them blind threw before any markdown was written — so a run that
  // had measured fine produced no table at all. runner.ts learned this when
  // release-2.4.0 was added as a column.
  if (!r) {
    return '—'
  }
  if (r.allBailed) {
    return '_bail_'
  }
  if (!Number.isFinite(r.zoomTimeToContentMs)) {
    return 'n/a'
  }
  const bail = r.stepsBailed ? ` (${r.stepsBailed} bail)` : ''
  return `${r.censored ? '≥' : ''}${r.zoomTimeToContentMs.toFixed(0)}ms${bail}`
}

// The same absent-row guard for the two columns that are not a time. Every row
// builder below reads them, so each one would otherwise need its own check.
const gapCell = (r: Result | undefined) =>
  r && Number.isFinite(r.zoomRedrawGapMs) ? `${r.zoomRedrawGapMs.toFixed(0)}ms` : 'n/a'
const stepsCell = (r: Result | undefined) =>
  r ? `${r.stepsMeasured}/${r.stepsAttempted}` : '—'

// Modes not selected this time keep whatever the last run recorded, so a
// filtered re-run does not blank out the rest of the report.
interface Saved {
  results?: Record<string, Record<Mode, Partial<Record<Role, Result>>>>
  measuredAt?: Partial<Record<Mode, string>>
  builds?: Partial<Record<Role, string>>
}
const priorRaw: Saved = fs.existsSync('results/interaction.json')
  ? (JSON.parse(fs.readFileSync('results/interaction.json', 'utf8')) as Saved)
  : {}
// Every row recorded while this matrix was BAM-only was keyed `<cov>-<read>`.
// Relabelling them `-bam` keeps them on the same axis as the new CRAM rows
// instead of stranding them under names the report no longer looks up.
const prior: Saved = { ...priorRaw, results: migrateCaseKeys(priorRaw.results) }

const stamp = new Date().toISOString().slice(0, 10)
const measuredAt = { ...prior.measuredAt }
for (const m of MODES) {
  measuredAt[m] = stamp
}

const results: Record<string, Record<Mode, Partial<Record<Role, Result>>>> = {}
const measured: { key: string; load: LoadWindow; value: Result }[] = []
// Cells that threw. Named at the end and in the report, never silently absent.
const failed: string[] = []
// Seeded for every case, not only the measured ones, so a CASES-filtered run
// still renders full tables from what was recorded before.
for (const c of allCases) {
  results[c.id] = {
    in: {},
    out: {},
    pan: {},
    ...prior.results?.[c.id],
  }
}
for (const c of cases) {
  for (const mode of MODES) {
    for (const b of builds) {
      const what = mode === 'pan' ? 'pan' : `zoom-${mode}`
      process.stdout.write(`${c.id} / ${b.name} / ${what}: `)
      // Let the previous cell's Chrome finish dying before starting this one.
      // Without it a cell inherits the teardown of the cell before it and
      // reports roughly double. See waitForQuiet.
      const quiet = waitForQuiet()
      if (quiet.waitedMs > 1500) {
        process.stdout.write(`[settled ${(quiet.waitedMs / 1000).toFixed(1)}s] `)
      }
      const before = loadavg()
      // Foreign CPU rather than the load average, for the reason the cold-load
      // runner switched: the load average counts this benchmark's own threads,
      // so a heavy cell disqualifies itself by working. See loadavg.ts.
      const cpu = watchForeignCpu()
      // A cell that throws must not take the other 107 with it. Two hours of
      // measurement previously died on one crashed renderer, and the modes that
      // had already been measured were never written out.
      let r: Result | undefined
      let failure: string | undefined
      try {
        r = run(b, c.track, mode)
      } catch (e) {
        failure = String(e)
      }
      const { cores, top } = await cpu.done()
      if (!r) {
        failed.push(`${c.id} / ${b.name} / ${what}`)
        console.log(`FAILED\n${failure}`)
        continue
      }
      const load = { before, after: loadavg(), foreignCores: cores, foreignTop: top }
      r.load = load
      results[c.id]![mode][b.role] = r
      measured.push({ key: `${c.id} / ${b.name} / ${what}`, load, value: r })
      process.stdout.write(
        `time-to-content ${cell(r)} (loading=${r.loadingEverSeen}, steps=${r.stepsMeasured}` +
          `${r.stepsCensored ? `, censored=${r.stepsCensored}` : ''}` +
          `, load=${load.before.toFixed(1)}→${load.after.toFixed(1)}` +
          `, foreign ${cores.toFixed(2)}${top ? `: ${top}` : ''})` +
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

if (failed.length) {
  console.log(`\n${failed.length} cell(s) failed and hold no value this run:`)
  for (const f of failed) {
    console.log(`  ${f}`)
  }
}

fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/interaction.json',
  JSON.stringify(
    {
      loc: LOC,
      // Record what each role actually was, so the JSON stays interpretable
      // even if the ports get pointed at different builds later.
      //
      // Only roles measured *this* run may overwrite a recorded name. A
      // MODES=none run measures nothing and exists to re-render prose, but it
      // still resolves the ports, so without this guard it relabels last week's
      // numbers with today's build names — and adds a `published` entry for a
      // column that was never measured. That happened on 2026-08-11 and had to
      // be reverted: the 2026-08-05 measurements were briefly attributed to a
      // build that did not exist when they were taken. This is the same failure
      // servedbuild.ts was written to prevent, arriving from the other side.
      builds: {
        ...prior.builds,
        ...(MODES.length
          ? Object.fromEntries(builds.map(b => [b.role, b.name]))
          : {}),
      },
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
// Read from whatever was actually recorded: a CASES/MODES-filtered run need not
// have measured the first case's zoom-in this time round.
const MAX_WAIT_NOTE = `${
  Object.values(results)
    .flatMap(byMode => Object.values(byMode).flatMap(byRole => Object.values(byRole)))
    .find(r => r?.maxWaitMs)?.maxWaitMs ?? 120000
} ms`

let md = `# Zoom interaction benchmark\n\n`
md += `Region \`${LOC}\`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. `
md += `redraw = longest frame (ms) of the GPU redraw. A \`≥\` prefix marks a censored value: the step was still loading at MAX_WAIT (${MAX_WAIT_NOTE}), so the true figure is larger.\n\n`
// Contamination for the run rather than per cell: this table is three modes
// deep and has no room for a column, but a reader still has to be able to tell
// a quiet sitting from a busy one. Cells carry the per-cell figure in the JSON.
{
  const fresh = measured
    .map(m => m.load.foreignCores)
    .filter((v): v is number => Number.isFinite(v))
  if (fresh.length) {
    const worst = measured.reduce((a, b) =>
      (b.load.foreignCores ?? -1) > (a.load.foreignCores ?? -1) ? b : a,
    )
    md += `Contamination, over the cells measured this run: worst **${Math.max(...fresh).toFixed(2)} foreign cores** `
    md += `(\`${worst.key}\`${worst.load.foreignTop ? ` — ${worst.load.foreignTop}` : ''}), median ${fresh.sort((a, b) => a - b)[Math.floor(fresh.length / 2)]!.toFixed(2)}. `
    md += `That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.\n\n`
  }
}

// Modes can be re-measured independently (MODES=pan), so the table can hold
// numbers from different runs. Say when each one was taken rather than letting
// the page imply they are one sitting.
const when = ALL_MODES.map(m => `${m}: ${measuredAt[m] ?? 'unknown'}`).join(', ')
md += `Measured — ${when}. Comparisons *within* a section are same-run; comparisons across sections may not be.\n\n`

md += `## Zoom IN — only the old renderer refetches\n\n`
md += `The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.\n\n`
md += `| case | ${NEW} | ${BASE} |${pubHead} ${NEW} redraw frame |\n`
md += `|---|---:|---:|${hasPublished ? '---:|' : ''}---:|\n`
for (const c of allCases) {
  const w = results[c.id]?.in.new
  const r = results[c.id]?.in.baseline
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} |${pubCell(results[c.id]!.in)} ${gapCell(w)} |\n`
}

md += `\n## Zoom OUT — mostly refused, not measured\n\n`
md += `Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.\n\n`
md += `That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. \`_bail_\` marks a cell where no step drew anything; \`(n bail)\` marks partial refusal, with the median taken only over steps that did draw.\n\n`
md += `The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.\n\n`
md += `| case | ${NEW} | ${BASE} |${pubHead} ${NEW} redraw frame | drew/attempted |\n`
md += `|---|---:|---:|${hasPublished ? '---:|' : ''}---:|---:|\n`
for (const c of allCases) {
  const w = results[c.id]?.out.new
  const r = results[c.id]?.out.baseline
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} |${pubCell(results[c.id]!.out)} ${gapCell(w)} | ${stepsCell(w)} |\n`
}

md += `\n## PAN at constant zoom — both builds refetch\n\n`
md += `One full viewport sideways per step, \`bpPerPx\` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.\n\n`
md += `Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.\n\n`
md += `A 19 kb window gets about five viewport-widths before it runs out of the 250 kb \`chr22_mask\`; steps beyond that are not attempted rather than clamped into a mostly-empty view.\n\n`
md += `The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.\n\n`
md += `| case | ${NEW} | ${BASE} | ratio |${pubHead} ${NEW} redraw frame | steps |\n`
md += `|---|---:|---:|---:|${hasPublished ? '---:|' : ''}---:|---:|\n`
for (const c of allCases) {
  const w = results[c.id]?.pan.new
  const r = results[c.id]?.pan.baseline
  // a ratio is only meaningful between two cells that are both real timings
  const comparable =
    w !== undefined &&
    r !== undefined &&
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
  md += `| ${c.id} | ${cell(w)} | ${cell(r)} | ${ratio} |${pubCell(results[c.id]!.pan)} ${gapCell(w)} | ${stepsCell(w)} |\n`
}
fs.writeFileSync('results/interaction.md', md)
console.log('\n' + md)
console.log('Wrote results/interaction.{json,md}')

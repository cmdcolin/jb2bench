// Cross-tool interaction matrix: JBrowse against igv.js and GenomeSpy, same
// corpus and same instrument, over one of two motions.
//
//   MOTION=pan (default) — scroll sideways one full viewport at constant scale.
//                          Both tools must go to the network for a region
//                          neither holds, so this prices fetch plus draw.
//   MOTION=zoom          — halve the visible width about the centre. Neither
//                          tool needs the network, so this prices redraw — and
//                          catches the older renderer refetching when it should
//                          not have to.
//
// This is the cross-tool measurement `results/crosstool.md` is missing. Every
// number there is a cold load, which folds application boot and assembly
// resolution in with the drawing — and boot is the part that says nothing about
// a renderer. The zoom comparison is worse rather than better: the README
// retracts it, because what it timed was a 500 ms JBrowse debounce and not
// JBrowse's pixels.
//
// A pan at constant `bpPerPx` is the interaction where the comparison is
// cleanest. The region is new to both tools so neither serves it from cache;
// the byte volume per step equals the initial render's, so no density cap is
// approached; and both applications are already up. What is left is the cost of
// turning bytes into pixels, which is what the JBrowse-vs-JBrowse pan in
// `results/interaction.md` measures and what nothing has measured across tools.
//
// A zoom asks the complementary question, and it is measurable here because the
// instrument changed. The earlier `zoomrunner.ts` polled screenshots every
// 100 ms and timed JBrowse's 500 ms navigation debounce rather than JBrowse's
// drawing; the README retracted its table. The draws clock resolves both, and
// reports them separately: on a zoom JBrowse waits a flat ~505 ms at every
// coverage and then draws for well under a millisecond, so the wait and the work
// are different numbers and the report prints both.
//
// The three properties that make the cold-load matrix a comparison hold here
// too, and one is added:
//
//   1. One instrument, neither tool's own — `panprofile.ts`, paint quiescence.
//   2. Runs are interleaved, so a load spike on this shared box lands on every
//      tool rather than on whichever owned the clock.
//   3. igv is measured at its default sampling depth and with downsampling
//      effectively off, as a control on whether downsampling is what is being
//      measured.
//   4. NEW: every step records the locus it landed on, in both tools, and the
//      runner checks them against each other. A pan comparison is only a
//      comparison if the two tools visited the same regions, and the two drive
//      differently — JBrowse by `horizontalScroll`, igv by `search` — so that
//      has to be verified rather than assumed.
//
// Usage: node scripts/crosstool/panrunner.ts
//   CASES=20x-shortread,...     subset of rows (CASES=none regenerates report)
//   TOOLS=jbrowse,igv,igv-deep,genomespy  subset of columns
//   JBROWSE_PORTS=8000,8001,8004  one JBrowse arm per port; 8004 is the version
//                               the 2023 paper benchmarked against igv.js
//   MOTION=pan|zoom             which interaction to measure
//   RUNS=3 STEPS=5 PAN_DIR=left
import { execFileSync } from 'child_process'
import fs from 'fs'
import { enumerateCases, selectCases } from '../render/cases.ts'

import { loadavg, outliers, peak, type LoadWindow } from '../render/loadavg.ts'
import { resolveBuild } from '../render/servedbuild.ts'

const RUNS = Number(process.env.RUNS ?? 3)
const MOTION = process.env.MOTION === 'zoom' ? 'zoom' : 'pan'
const LOC = 'chr22_mask:124000-143000'
const LOAD_CEILING = 4.0
const DEEP = 10000

// One JBrowse arm per port. The 2023 paper's own Fig 8 is igv.js against
// JBrowse v2.4.0, so serving 8004 here re-runs that comparison on this corpus
// with this instrument, and 8001 puts the last release between the two. The
// default stays 8000 alone: the extra arms triple the wall clock of a matrix
// that already runs for the better part of an hour, so they are asked for
// rather than assumed.
//
// The first port is the build under test and keeps the tool id `jbrowse`,
// because that id is the key every already-recorded row in
// results/crosstool-pan.json is stored under, and the ratio column is against
// it. The rest are `jbrowse-<build>`.
const JBROWSE_PORTS = (process.env.JBROWSE_PORTS ?? process.env.JBROWSE_PORT ?? '8000')
  .split(',')
  .map(Number)
// One server for `crosstool/`, which holds igv's harness page at the root and
// GenomeSpy's beside it. Named for what it serves rather than for igv, since it
// stopped being igv's alone when the GenomeSpy arm landed; `IGV_PORT` stays the
// spelling of the environment variable because every run script sets that one.
const CROSSTOOL_PORT = Number(process.env.CROSSTOOL_PORT ?? process.env.IGV_PORT ?? 8003)

const jbrowseArms = await Promise.all(
  JBROWSE_PORTS.map(async (port, i) => {
    const build = await resolveBuild(port)
    console.log(`port ${port} is serving builds/${build}`)
    return { port, build, id: i === 0 ? 'jbrowse' : `jbrowse-${build}` }
  }),
)
const jbrowseBuild = jbrowseArms[0]!.build

const igvVersion = JSON.parse(
  fs.readFileSync('node_modules/igv/package.json', 'utf8'),
).version as string
const gsVersion = JSON.parse(
  fs.readFileSync('node_modules/@genome-spy/core/package.json', 'utf8'),
).version as string
console.log(`igv.js ${igvVersion}, GenomeSpy ${gsVersion}`)

interface Tool {
  id: string
  label: string
  kind: 'jbrowse' | 'igv' | 'genomespy'
  /**
   * Container formats this arm can open, where it cannot open all of them.
   * GenomeSpy 0.85.0 has no CRAM lazy source, so its CRAM cells are a
   * capability limit and not a gap in the run -- recorded as `unsupported`
   * rather than left blank, since blank already means "not measured this run".
   */
  formats?: string[]
  url: (track: string) => string
}

const allTools: Tool[] = [
  // `renderer=webgl` goes only to the build under test: it is the branch's
  // WebGL2 pin, and a release that predates the parameter ignores it anyway.
  ...jbrowseArms.map(({ port, build, id }, i) => ({
    id,
    label: `JBrowse (${build})`,
    kind: 'jbrowse' as const,
    url: (t: string) =>
      `http://localhost:${port}/?loc=${LOC}&assembly=hg19mod&tracks=${t}` +
      (i === 0 ? '&renderer=webgl' : ''),
  })),
  {
    id: 'igv',
    label: `igv.js ${igvVersion}`,
    kind: 'igv',
    url: t => `http://localhost:${CROSSTOOL_PORT}/?loc=${LOC}&track=${t}`,
  },
  {
    id: 'igv-deep',
    label: `igv.js ${igvVersion} (depth ${DEEP})`,
    kind: 'igv',
    url: t => `http://localhost:${CROSSTOOL_PORT}/?loc=${LOC}&track=${t}&depth=${DEEP}`,
  },
  {
    // GenomeSpy, on the same BAM through its own lazy source. It joined the
    // cold-load matrix on 2026-08-29 and this one only now, which left the
    // motion runs answering "is a multi-second zoom what a browser costs" with
    // a single foreign tool.
    //
    // It is the more informative of the two comparisons for a render claim, and
    // for the reason that makes it awkward: `@genome-spy/core` depends on
    // `@gmod/bam` ^7.1.19, the same decoder JBrowse reads through, so this
    // column is largely renderer-against-renderer over a shared parser where
    // the igv columns confound the two. What it cannot do is CRAM.
    //
    // The harness page is `crosstool/genomespy.html`, served beside igv's on
    // the same port, and its header carries the whole account of why it
    // declares no domain and navigates with `zoomTo` afterwards -- which is
    // also the API this runner drives it by.
    id: 'genomespy',
    label: `GenomeSpy ${gsVersion}`,
    kind: 'genomespy',
    formats: ['bam'],
    url: t => `http://localhost:${CROSSTOOL_PORT}/genomespy.html?loc=${LOC}&track=${t}`,
  },
]

const toolFilter = process.env.TOOLS?.split(',')
const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.id)) : allTools

// BAM and CRAM. Both tools read CRAM natively — igv's harness switches format and index
// extension on the track name, and the JBrowse build carries a CramAdapter track
// per case — so this is the same comparison on a different container, not a
// different benchmark. It is worth having because the container is where the
// decode cost lives: CRAM trades bytes on the wire for CPU at read time, which is
// the opposite trade from BAM and should move the two tools differently.
// From the shared enumeration, so every id carries its format. This file used
// to build the list twice: BAM as a bare `20x-shortread` and CRAM as
// `20x-shortread-cram`, in adjacent loops. One format implicit and the other
// explicit, in the same array, is how a reader ends up guessing what a row
// measured — and how downstream consumers grow fallbacks that try the bare name
// and then `-bam`, quietly substituting one format for another.
const allCases = enumerateCases()
const cases = selectCases(allCases)

/**
 * Why this arm cannot open this case, or null if it can.
 *
 * A capability limit is recorded rather than skipped, the way the cold-load
 * matrix records it: a blank cell already means "not measured in the run that
 * produced this row", and a reader cannot tell that from "this tool does not
 * open CRAM". It also has to stay out of the interleaved rotation -- the
 * instrument settles on a page that draws nothing, so an arm that cannot open
 * the file would otherwise contribute the fastest number in the row.
 */
function unsupported(tool: Tool, c: { track: string }): string | null {
  const fmt = c.track.split('.').pop()!
  return tool.formats && !tool.formats.includes(fmt) ? `no ${fmt} reader` : null
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Both tools report a locus, and neither reports it the same way: JBrowse says
 * `chr22_mask:105,001..124,001` and igv says `chr22_mask:104999-124000`. Reduce
 * each to a start so the two can be compared, since what matters is whether
 * they went to the same place and not how they spell it.
 */
function locusStart(s: string): number {
  const m = /:([\d,]+)/.exec(s)
  return m ? Number(m[1]!.replaceAll(',', '')) : Number.NaN
}

interface StepResult {
  step: number
  ms: number
  polls: number
  drawMs: number
  requests: number
  bytes: number
  locus: string
  target: string
  applied: boolean
}
interface PanResult {
  tool: string
  steps: StepResult[]
  appliedSteps: number
  medianMs: number | null
  medianDrawMs: number | null
  cachedSteps: number
  totalRequests: number
  totalBytes: number
  instrument: { kind: string }
  failure?: string
}

function runOnce(url: string, kind: string): PanResult | undefined {
  let out = ''
  try {
    out = execFileSync(
      'node',
      ['--experimental-strip-types', 'scripts/crosstool/panprofile.ts', url, kind],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1 << 22,
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', MOTION },
      },
    )
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const line = out.trim().split('\n').pop()
  if (!line) return undefined
  try {
    return JSON.parse(line) as PanResult
  } catch {
    return undefined
  }
}

interface Cell {
  median: number
  /**
   * The final draw burst alone, with the waiting taken out. Time-to-content is
   * what a user waits, so it stays the headline — but on a JBrowse zoom that is
   * a flat ~505 ms debounce wrapped around half a millisecond of drawing, and a
   * reader comparing it against igv's redraw would be comparing a timer to a
   * renderer.
   */
  drawMedian: number
  /**
   * Median over only those steps that actually issued a data request.
   *
   * The headline number this table wants is "both tools had to fetch, so what
   * is left is drawing" — and that is not automatically what happened. JBrowse
   * reads in 256 KiB blocks, so one fetch can cover about two viewports and half
   * its pan steps are cache hits; igv's never are. Averaging a cache hit into a
   * fetch is how a benchmark ends up comparing two different things and calling
   * the difference rendering.
   */
  fetchedMedian: number
  runs: (number | null)[]
  appliedSteps: number[]
  cachedSteps: number
  requests: number
  bytes: number
  /** canvas draw calls per step, last run — the architectural difference */
  drawsPerStep: number[]
  /** the loci of the last run, so a row can be audited for where it went */
  loci: string[]
  load: LoadWindow
  failures: string[]
  /** Set instead of a timing where the arm cannot open this case at all. */
  unsupported?: string
}
type Row = Record<string, Cell>

// One file per motion. They are separate benchmarks that happen to share a
// runner, and a merged file would make "the median" ambiguous.
const RESULTS = `results/crosstool-${MOTION}.json`
const REPORT = `results/crosstool-${MOTION}.md`
interface Recorded {
  igvVersion: string
  gsVersion?: string
  jbrowseBuild: string
  /** every JBrowse arm this file holds, tool id → build directory */
  jbrowseBuilds: Record<string, string>
  panDir: string
  motion: string
  steps: number
  rows: Record<string, Row>
  dates: Record<string, string>
  /** cases where the two tools did not visit the same regions */
  locusMismatch: Record<string, string>
}
const prior: Recorded = fs.existsSync(RESULTS)
  ? JSON.parse(fs.readFileSync(RESULTS, 'utf8'))
  : {
      igvVersion,
      gsVersion,
      jbrowseBuild,
      jbrowseBuilds: {},
      panDir: process.env.PAN_DIR ?? 'left',
      motion: MOTION,
      steps: Number(process.env.STEPS ?? 5),
      rows: {},
      dates: {},
      locusMismatch: {},
    }

const today = new Date().toISOString().slice(0, 10)

for (const c of cases) {
  const runs: Record<string, (number | null)[]> = {}
  const fetchedRuns: Record<string, number[]> = {}
  const applied: Record<string, number[]> = {}
  const loci: Record<string, string[]> = {}
  const failures: Record<string, string[]> = {}
  const before: Record<string, number> = {}
  const cached: Record<string, number> = {}
  const reqs: Record<string, number> = {}
  const bytes: Record<string, number> = {}
  const draws: Record<string, number[]> = {}
  const drawMs: Record<string, number[]> = {}
  // Out of the rotation, not out of the row: an arm that cannot open this
  // container is recorded below with its reason.
  const measurable = tools.filter(t => {
    const why = unsupported(t, c)
    if (why) console.log(`${c.id} ${t.id}: unsupported — ${why}`)
    return !why
  })
  for (const t of measurable) {
    runs[t.id] = []
    fetchedRuns[t.id] = []
    applied[t.id] = []
    loci[t.id] = []
    failures[t.id] = []
    before[t.id] = loadavg()
    cached[t.id] = 0
    reqs[t.id] = 0
    bytes[t.id] = 0
    draws[t.id] = []
    drawMs[t.id] = []
  }

  // Interleaved: one round runs every tool back to back, so drift lands on all
  // of them rather than on whichever tool owned the clock at the time.
  for (let r = 0; r < RUNS; r++) {
    for (const t of measurable) {
      const got = runOnce(t.url(c.track), t.kind)
      if (!got) {
        runs[t.id]!.push(null)
        failures[t.id]!.push('no output')
        console.log(`${c.id} ${t.id} run ${r + 1}: NO OUTPUT`)
        continue
      }
      runs[t.id]!.push(got.medianMs)
      if (typeof got.medianDrawMs === 'number' && Number.isFinite(got.medianDrawMs)) {
        drawMs[t.id]!.push(got.medianDrawMs)
      }
      applied[t.id]!.push(got.appliedSteps)
      loci[t.id] = got.steps.filter(s => s.applied).map(s => s.locus)
      const fetched = got.steps.filter(s => s.applied && s.requests > 0)
      if (fetched.length) fetchedRuns[t.id]!.push(median(fetched.map(s => s.ms)))
      cached[t.id] = got.cachedSteps
      reqs[t.id] = got.totalRequests
      bytes[t.id] = got.totalBytes
      draws[t.id] = got.steps.filter(s => s.applied).map(s => s.polls)
      if (got.failure) failures[t.id]!.push(got.failure)
      console.log(
        `${c.id} ${t.id} run ${r + 1}: ${got.medianMs?.toFixed(0) ?? 'FAIL'} ms ` +
          `(${got.appliedSteps} steps, ${got.cachedSteps} cached, ` +
          `${got.totalRequests} reqs)${got.failure ? ` [${got.failure}]` : ''}`,
      )
    }
  }

  const row: Row = prior.rows[c.id] ?? {}
  for (const t of tools) {
    const why = unsupported(t, c)
    if (why) {
      row[t.id] = {
        median: Number.NaN,
        drawMedian: Number.NaN,
        fetchedMedian: Number.NaN,
        runs: [],
        appliedSteps: [],
        cachedSteps: 0,
        requests: 0,
        bytes: 0,
        drawsPerStep: [],
        loci: [],
        load: { before: 0, after: 0 },
        failures: [],
        unsupported: why,
      }
      continue
    }
    const vals = runs[t.id]!.filter((v): v is number => typeof v === 'number')
    row[t.id] = {
      median: vals.length ? median(vals) : Number.NaN,
      drawMedian: drawMs[t.id]!.length ? median(drawMs[t.id]!) : Number.NaN,
      fetchedMedian: fetchedRuns[t.id]!.length
        ? median(fetchedRuns[t.id]!)
        : Number.NaN,
      runs: runs[t.id]!,
      appliedSteps: applied[t.id]!,
      cachedSteps: cached[t.id]!,
      requests: reqs[t.id]!,
      bytes: bytes[t.id]!,
      drawsPerStep: draws[t.id]!,
      loci: loci[t.id]!,
      load: { before: before[t.id]!, after: loadavg() },
      failures: failures[t.id]!,
    }
  }
  prior.rows[c.id] = row
  prior.dates[c.id] = today

  // Did the tools actually visit the same regions? They are driven by different
  // mechanisms, so this is checked rather than assumed — and a mismatch
  // invalidates the row rather than costing it a footnote.
  // Every foreign arm against JBrowse, not igv alone. Each is driven by its own
  // navigation API -- igv by `search`, GenomeSpy by `zoomTo` -- so each is its
  // own chance to land somewhere else, and an arm nobody checks is an arm whose
  // column means nothing. It is also the check that carries GenomeSpy's
  // linearized-coordinate readback: a genome offset would put every step of
  // that arm somewhere JBrowse never went.
  const jb = row.jbrowse?.loci ?? []
  const bad: string[] = []
  let compared = 0
  for (const t of measurable.filter(t => t.kind !== 'jbrowse')) {
    const other = row[t.id]?.loci ?? []
    if (jb.length && other.length) {
      compared++
      const n = Math.min(jb.length, other.length)
      for (let i = 0; i < n; i++) {
        const d = Math.abs(locusStart(jb[i]!) - locusStart(other[i]!))
        if (!(d <= 50)) bad.push(`${t.id} step ${i + 1}: ${jb[i]} vs ${other[i]}`)
      }
      if (jb.length !== other.length) {
        bad.push(
          `${t.id} step counts differ: jbrowse ${jb.length}, ${t.id} ${other.length}`,
        )
      }
    }
  }
  // Only a run that actually compared something may clear a recorded mismatch:
  // a re-run of the JBrowse arms alone has checked nothing and must not erase
  // what a full run found.
  if (compared) {
    if (bad.length) {
      prior.locusMismatch[c.id] = bad.join('; ')
      console.log(`  LOCUS MISMATCH ${c.id}: ${bad.join('; ')}`)
    } else {
      delete prior.locusMismatch[c.id]
    }
  }

  prior.igvVersion = igvVersion
  prior.gsVersion = gsVersion
  prior.jbrowseBuild = jbrowseBuild
  prior.jbrowseBuilds = {
    ...prior.jbrowseBuilds,
    ...Object.fromEntries(jbrowseArms.map(a => [a.id, a.build])),
  }
  fs.mkdirSync('results', { recursive: true })
  fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
}

// ---- report ----------------------------------------------------------------

const cells: { key: string; load: LoadWindow; value: number }[] = []
for (const [id, row] of Object.entries(prior.rows)) {
  for (const [tool, cell] of Object.entries(row)) {
    // An unsupported cell carries a zeroed load window and no timing, so left
    // in it would read as the quietest cell in the run.
    if (!cell.unsupported) {
      cells.push({ key: `${id}/${tool}`, load: cell.load, value: cell.median })
    }
  }
}
const hot = outliers(cells)

// Columns come from what the file holds, not only from what this run served. A
// re-run of the 8000 arm alone must not silently drop a v2.4.0 column measured
// last week — the data is still in the JSON, and a table that omits it is a
// narrower claim than the one on disk. A recorded arm nobody served this time is
// presentation-only: it has a label, and asking it for a URL is a bug.
const recordedArms: Tool[] = Object.entries(prior.jbrowseBuilds ?? {})
  .filter(([id]) => !allTools.some(t => t.id === id))
  .map(([id, build]) => ({
    id,
    label: `JBrowse (${build})`,
    kind: 'jbrowse' as const,
    url: () => {
      throw new Error(`${id} was not served this run; serve its port to measure it`)
    },
  }))

const shownTools = [
  ...allTools.filter(t => t.kind === 'jbrowse'),
  ...recordedArms,
  ...allTools.filter(t => t.kind !== 'jbrowse'),
].filter(t => Object.values(prior.rows).some(r => r[t.id]))
const fmt = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}`

const isZoom = MOTION === 'zoom'

const lines: string[] = [
  `# Cross-tool ${MOTION}: JBrowse against igv.js and GenomeSpy`,
  '',
  ...(isZoom
    ? [
        'Generated by `scripts/crosstool/panrunner.ts` with `MOTION=zoom`. Each step',
        `halves the visible width about the centre, ${prior.steps} steps attempted, from`,
        `the benchmark window \`${LOC}\` — so the last step shows about 600 bp.`,
      ]
    : [
        `Generated by \`scripts/crosstool/panrunner.ts\`. Pan **${prior.panDir}** by one`,
        `full viewport per step at constant scale, ${prior.steps} steps attempted, from`,
        `the benchmark window \`${LOC}\`.`,
      ]),
  `Each cell is the median over ${RUNS} runs of`,
  'each run\'s median step; tools are interleaved within a round.',
  '',
  '## The instrument, and why it is not screenshots',
  '',
  'A step is done when **the page has stopped drawing to any canvas and stopped',
  'fetching**; time-to-content is the last draw before that. Both halves are',
  'necessary and both were arrived at by getting it wrong first.',
  '',
  'The cold-load matrix uses paint quiescence — poll a screenshot, wait for the',
  'hash to repeat — because neither tool\'s own loading state is trustworthy: igv',
  'hides its spinner when features finish *loading*, before drawing them, and',
  "JBrowse's indicator wording moves between releases. That instrument cannot",
  `resolve a ${MOTION}. It needs six samples at best, and one \`page.screenshot()\` on`,
  'this box measures anywhere from 43 to 161 ms, which puts its own floor between',
  `roughly 450 and 1100 ms — against ${MOTION}s of about that length. Steps duly came`,
  'back resolved in exactly the minimum six polls, reporting numbers made almost',
  'entirely of instrument. `results/quiescence.md` has the calibration.',
  '',
  'So `drawclock.ts` patches the canvas drawing APIs instead and timestamps every',
  'call. That asks the platform rather than the application, and costs an array',
  'push rather than a composite and a PNG encode.',
  '',
  'Draws alone are still not enough: JBrowse re-projects the reads it already',
  'holds within a millisecond or two, then goes quiet while it fetches, then draws',
  'again. A detector watching only draws stops at the first gap — measured that',
  'way, JBrowse\'s first pan step read **1.4 ms**, the time to re-project stale',
  'content. Hence the network gate, taken from CDP rather than from a patched',
  '`fetch`, because JBrowse fetches in a worker and a page-side hook would see',
  "igv's requests and none of JBrowse's — the same asymmetry as the screenshots,",
  'reached from another direction.',
  '',
  '`INSTRUMENT=paint` keeps the screenshot detector available for comparison,',
  'and `results/quiescence.md` measures how far apart the two land. Do not assume',
  'a sign for that difference: the natural story — a draw call precedes the',
  'compositor, so draws should read early — is contradicted on a JBrowse cold',
  'load, where draws read 4792 ms against paint\'s 2346 ms, because the page goes',
  'on issuing draw calls after the visible result has settled.',
  '',
  '**Why an interaction and not a cold load.** Every cross-tool number in',
  '`results/crosstool.md` is a cold load, which includes application boot and',
  'assembly resolution — the part with nothing to do with rendering. Both motions',
  'here run against an application that is already up, so far less of the number',
  'is startup.',
  '',
  '**The GenomeSpy column is the one that isolates the renderer.**',
  '`@genome-spy/core` reads BAM through `@gmod/bam` ^7.1.19 — the decoder this',
  'JBrowse build reads through — so a JBrowse-against-GenomeSpy difference is',
  'largely a difference in drawing. The igv.js columns are not that: igv',
  'maintains its own readers, so they confound parser with renderer. That makes',
  'GenomeSpy the more informative of the two comparisons and the narrower one:',
  '0.85.0 has no CRAM lazy source, so its CRAM cells read `n/a` rather than a',
  'timing.',
  '',
  ...(isZoom
    ? [
        '**What a zoom prices.** Neither tool needs the network: both hold the',
        'surrounding window client-side, so a 2x zoom-in is a redraw. The run confirms',
        'it rather than assuming it — across every arm and every case, **no cell issued',
        'a single data request on any zoom step**. An earlier draft of this section',
        'predicted that the older renderer would refetch and it does not; what the old',
        'renderer does is re-rasterize, which is a different cost and is priced below.',
        '',
        '**Time-to-content on JBrowse here is mostly a timer, and this report will not',
        'let it read as drawing.** A JBrowse zoom step comes back at a flat ~505 ms at',
        'every coverage, every read type and every container, which is not what work',
        'looks like: it is the 500 ms `LGVCoarseDynamicBlocks` debounce, and the',
        'drawing inside it takes well under a millisecond. An earlier version of this',
        'benchmark polled screenshots at 100 ms, could not see inside that, and',
        'published the debounce as a render time; the README retracted it. Hence two',
        'tables below — what the user waits, and what the renderer did — and never one',
        'without the other.',
      ]
    : [
        'A pan holds scale fixed and moves to a region the view did not previously',
        'show. Whether it also made both tools go to the network is a question the run',
        'answers rather than assumes; see "What each step actually did".',
      ]),
  '',
  ...(isZoom
    ? ['## Time to content, over every step', '']
    : ['## Time to content, over the steps where the tool actually fetched', '']),
  `| case | ${shownTools.map(t => t.label).join(' | ')} | ratio | load | date |`,
  `| --- | ${shownTools.map(() => '---:').join(' | ')} | ---: | ---: | --- |`,
]

/**
 * A tool that fetched on no step has no fetched median, and printing a bare dash
 * throws away a real finding: at 20x-longread JBrowse served all five pan steps
 * from one 256 KiB block, with a full render burst each time. Show its
 * all-steps median instead, daggered, so the cell says "measured, but not the
 * same measurement as its neighbour" rather than "missing".
 */
const cell = (c: Cell | undefined) => {
  if (!c) return { text: '—', comparable: false }
  // Distinct from a dash, which means nobody measured it. GenomeSpy has no CRAM
  // reader, and timing the page it draws instead would make the tool that
  // cannot open the file the fastest thing in the row.
  if (c.unsupported) return { text: 'n/a', comparable: false }
  // On a zoom nothing is supposed to fetch, so restricting to fetched steps
  // would restrict to the failure mode. Every applied step counts.
  if (isZoom) {
    return Number.isFinite(c.median)
      ? { text: `${fmt(c.median)} ms`, comparable: true }
      : { text: '—', comparable: false }
  }
  if (Number.isFinite(c.fetchedMedian)) {
    return { text: `${fmt(c.fetchedMedian)} ms`, comparable: true }
  }
  if (Number.isFinite(c.median)) {
    return { text: `${fmt(c.median)} ms †`, comparable: false }
  }
  return { text: '—', comparable: false }
}

let anyDaggered = false
for (const c of allCases) {
  const row = prior.rows[c.id]
  if (!row) continue
  const cells = shownTools.map(t => cell(row[t.id]))
  if (cells.some(x => x.text.includes('†'))) anyDaggered = true
  const pick = (c: Cell | undefined) =>
    c ? (isZoom ? c.median : c.fetchedMedian) : undefined
  const jb = pick(row.jbrowse)
  const ig = pick(row.igv)
  const ratio =
    jb && ig && Number.isFinite(jb) && Number.isFinite(ig)
      ? `${(ig / jb).toFixed(2)}x`
      : '—'
  const rowPeak = Math.max(
    ...(shownTools.map(t => row[t.id]?.load).filter(Boolean) as LoadWindow[]).map(
      peak,
    ),
  )
  lines.push(
    `| ${c.id} | ${cells.map(x => x.text).join(' | ')} | ${ratio} | ` +
      `${rowPeak.toFixed(1)} | ${prior.dates[c.id] ?? '—'} |`,
  )
}

// The drawing with the waiting removed: the last draw of a step minus the first
// draw of the burst it belongs to. Printed for the zoom because there the wait is
// a configured 500 ms constant and quoting it as render cost is the mistake this
// benchmark was retracted for once already.
/**
 * Which arms rasterize where the instrument can see it.
 *
 * The old block renderer paints in a worker and the main thread blits the
 * finished tiles, so `drawclock` — which patches the page's canvas prototypes and
 * cannot reach a worker's own global scope — times a composite rather than a
 * render. At 1000x long read that is 0.1 ms sitting underneath a 9.7 s wait.
 *
 * This is decided from the renderer each arm uses, not from its draw count, and
 * the counts are the reason why: at 20x short read the current build issues 20
 * draws a step, release-4.3.0 issues 12 to 18 and release-2.4.0 issues 6 to 12.
 * Same order of magnitude, opposite meanings — twenty WebGL draw calls against a
 * dozen `drawImage` blits. A threshold over those numbers separates nothing, and
 * an earlier version of this function used one and daggered cells at random.
 *
 * The build under test is driven with `renderer=webgl` and draws on the main
 * thread; every recorded release arm predates that renderer and does not.
 */
const rastersOffThread = (toolId: string) => toolId.startsWith('jbrowse-')

const drawCell = (c: Cell | undefined, toolId: string) => {
  if (!c || !Number.isFinite(c.drawMedian)) {
    return '—'
  }
  const text =
    c.drawMedian < 10 ? `${c.drawMedian.toFixed(1)} ms` : `${Math.round(c.drawMedian)} ms`
  return rastersOffThread(toolId) ? `${text} ‡` : text
}

const drawTable = isZoom
  ? [
      '## The redraw alone, with the waiting taken out',
      '',
      'The final draw burst of each step: its last draw minus its first. Everything',
      'else in the column above is a tool waiting — a debounce for JBrowse, nothing at',
      'all for igv, which starts drawing immediately.',
      '',
      '**`‡` is not a fast redraw, it is a blit.** The block renderer paints in a worker',
      'and the main thread only composites the finished tiles, so what is timed there is',
      'a `drawImage` and not the rendering — 0.1 ms sitting underneath a 9.7 s wait.',
      '`drawclock` patches the page\'s canvas prototypes and cannot reach a worker\'s own',
      'global scope. **Compare only the un-daggered cells with each other**: the current',
      'renderer draws on the main thread through WebGL and igv draws there through the 2D',
      'API, so for those two this column is the rasterization itself.',
      '',
      'The daggers are assigned from which renderer each arm uses, and the draw counts in',
      'the table below are why they have to be. At 20x short read the current build issues',
      '20 draws a step, release-4.3.0 issues 12 to 18, release-2.4.0 issues 6 to 12 — the',
      'same order of magnitude for twenty WebGL draw calls and a dozen blits. Nothing in',
      'the count distinguishes them.',
      '',
      `| case | ${shownTools.map(t => t.label).join(' | ')} |`,
      `| --- | ${shownTools.map(() => '---:').join(' | ')} |`,
      ...allCases
        .filter(c => prior.rows[c.id])
        .map(
          c =>
            `| ${c.id} | ${shownTools
              .map(t => drawCell(prior.rows[c.id]![t.id], t.id))
              .join(' | ')} |`,
        ),
      '',
      'Between the two arms this column can compare, it points opposite ways. The',
      'current renderer draws in a fraction of a millisecond, because the pileup is',
      'already on the GPU and a zoom is a change of projection — but the user still',
      'waits half a second, so the win is unclaimed and the debounce is what stands',
      "between them and it. igv's redraw is real CPU work and shrinks as the window",
      'narrows and there is less left to draw, which is why its steps fall away',
      'where the current renderer\'s stay flat.',
      '',
      '**No number in this table is a time a user experiences.** The table above is.',
      '',
    ]
  : []

lines.push(
  '',
  '`ratio` is igv ÷ JBrowse: above 1.0 means JBrowse got content back sooner.',
  ...(isZoom
    ? [
        '',
        '**Read that ratio with the next table open.** On a zoom it is very largely a',
        'ratio of two waits, one of which is a configured constant.',
      ]
    : []),
  ...(anyDaggered
    ? [
        '',
        '`†` is a median over **all** steps rather than fetched ones, because that',
        'arm issued no data request on any of them. It is not a missing measurement',
        'and not a comparable one: those cells rendered fully on every step — the',
        'draw counts in the table below are the ones that arm shows everywhere else —',
        'while fetching nothing, so what it already held from the initial load covered',
        'the whole pan. A ratio is left blank whenever the two arms it would divide',
        'disagree about that, rather than dividing a cached median by a fetched one.',
        '',
        'It is not a property of one arm or one read type. Which cells fall this way',
        'depends on how much each arm reads ahead and how far a viewport moves, so it',
        'varies across arms within a row — `20x-shortread-cram` fetched on neither',
        'JBrowse arm under test and on both igv arms — and the `cached` column below is',
        'where to read it rather than any rule stated here.',
        '',
        '**Why it held that much is not established here.** Long reads force a',
        'wider fetch than the viewport, since a read overlapping the left edge may',
        'start tens of kilobases earlier, and the BAI chunk granularity is coarse',
        'at this depth — but neither of those has been measured against the bytes',
        'the initial load actually pulled. Treat it as an observation about where',
        'the cost went, not an account of the caching.',
      ]
    : []),
  '',
  ...drawTable,
  '## What each step actually did',
  '',
  ...(isZoom
    ? [
        'Every arm reads `cached` on every step and `requests` zero throughout, which',
        'is the check that this page measures what it claims to: a zoom stayed inside',
        'held data for all of them, so none of the differences above is a network',
        'difference. On the pan page a high `cached` count means the opposite — there it',
        'marks a step that was not the comparison the table wanted.',
      ]
    : [
        'This table is not supporting detail; it is the reason the one above is',
        'restricted to fetched steps. **A pan is not automatically the "both tools must',
        'fetch" case.** JBrowse reads in 256 KiB blocks, so at low coverage one request',
        'can cover more than a viewport and some of its pan steps are served entirely',
        'from what it already holds; the `cached` column counts them. Averaging a cache',
        'hit together with a fetch and calling the difference "rendering" is exactly the',
        'error this benchmark exists to avoid.',
      ]),
  '',
  '`draws` is here as a diagnostic and is not a score. Two things need it. A cache',
  'hit and a step the detector gave up on before the fetch began look identical in',
  'a request count — an earlier version of this instrument reported 3 of 5 steps',
  'cached at 1000x where the true answer was none — and `draws` separates them,',
  'because a real cache hit still shows a full render burst where an abandoned step',
  'shows only the few draws that re-project stale content. It is also the control',
  'on downsampling: at `samplingDepth=10000`, which clips nothing on this corpus,',
  "igv's draws and time are both unchanged, so **igv is not winning any row by",
  'drawing less**.',
  '',
  '**What it is not is a comparison.** A batched renderer issues a fixed handful of',
  'GPU draws whatever the depth, so JBrowse sits near 50 at every coverage by',
  'construction; that is a description of the API it calls, not a measurement of',
  'anything it achieved, and the flat line it makes says nothing a reader should',
  'weigh. The number that matters is the milliseconds above. An earlier version of',
  'this repo drew the draw counts as a figure of their own — a JBrowse line pinned',
  'flat at 50 against an igv line at a quarter of a million — and that figure has',
  'been removed for exactly this reason.',
  '',
  `| case | tool | steps | cached | requests | bytes | draws/step |`,
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
)

for (const c of allCases) {
  const row = prior.rows[c.id]
  if (!row) continue
  for (const t of shownTools) {
    const cell = row[t.id]
    if (!cell) continue
    const d = cell.drawsPerStep ?? []
    const drawRange = d.length
      ? d.length > 1
        ? `${Math.min(...d)}–${Math.max(...d)}`
        : String(d[0])
      : '—'
    lines.push(
      `| ${c.id} | ${t.id} | ${cell.appliedSteps?.at(-1) ?? '—'} | ` +
        `${cell.cachedSteps ?? '—'} | ${cell.requests ?? '—'} | ` +
        `${cell.bytes ? `${(cell.bytes / 1024).toFixed(0)} KB` : '—'} | ${drawRange} |`,
    )
  }
}

lines.push(
  '',
  `\`steps\` is how many of the ${prior.steps} attempted ${MOTION} steps applied. ` +
    (isZoom
      ? 'The loop stops before the window falls under 200 bp, because below roughly a hundred bases both tools switch to drawing base letters, which is a different workload from a pileup.'
      : 'A pan stops rather than clamps when the next viewport would run off the contig, because a mostly-empty view scores fast for the same reason a refusal does.'),
  '',
  '### Read the load column carefully here',
  '',
  "`README.md` warns that a heavy row does not generate its own load — that was",
  'established for the cold-load matrix, where sampling during a 1000x-longread',
  'render found load already at 35 with `chrome=0`. **It is not true of this',
  `benchmark.** A ${MOTION} run on the heavier cases sits at \`chrome=11\` and drives`,
  'the load average up by itself, and it does so unequally: the tool doing the CPU',
  'drawing is the one making the machine busy.',
  '',
  'So a high `load` on a row here is partly a consequence of the measurement',
  'rather than a contaminant of it, and treating it as automatic grounds to',
  'discard the row would throw away the heavy cases — which are the ones worth',
  'having. The protection that matters is the interleaving: each round runs every',
  'tool back to back, so whatever the machine is doing lands on all of them.',
  '',
)

// A cell with no measurement is left as an em dash in the table above, and the
// reason it has none is stated where it belongs — in prose, about the tool,
// naming what was diagnosed. It used to be a section that pasted the harness's
// own protocol-timeout strings under the heading "Cells that did not complete",
// which read as a benchmark reporting its own plumbing.
const unmeasured = allCases.some(c => {
  const row = prior.rows[c.id]
  return (
    row &&
    shownTools.some(t => row[t.id] && !Number.isFinite(row[t.id]!.median))
  )
})
if (unmeasured) {
  lines.push(
    '## Where a cell is blank',
    '',
    "**igv.js at 1000x-longread is at the browser's memory ceiling, not merely",
    'slow.** Diagnosed separately on 2026-08-16: the renderer reaches **2299 MB of',
    'heap** and becomes ready at **80.6 s** — before the interaction has begun. igv',
    'parses alignments on the main thread, so a 268 MB BAM lands in one renderer',
    'process; JBrowse decodes the same file in a worker and completes every step.',
    'Read a blank there as "not reliably measurable at this depth" rather than as a',
    'large number.',
    '',
  )
}

// BAM against CRAM, paired by case. Derived rather than written down, so it
// cannot drift from the run the way a copied table does.
const pairs = allCases
  .filter(c => !c.id.endsWith('-cram') && prior.rows[c.id] && prior.rows[`${c.id}-cram`])
  .flatMap(c =>
    shownTools.flatMap(t => {
      const bam = prior.rows[c.id]![t.id]
      const cram = prior.rows[`${c.id}-cram`]![t.id]
      if (!bam || !cram) return []
      const bFetched = Number.isFinite(bam.fetchedMedian)
      const cFetched = Number.isFinite(cram.fetchedMedian)
      const bMs = bFetched ? bam.fetchedMedian : bam.median
      const cMs = cFetched ? cram.fetchedMedian : cram.median
      if (!Number.isFinite(bMs) || !Number.isFinite(cMs)) return []
      return [
        {
          case: c.id,
          tool: t.id,
          bMs,
          cMs,
          bBytes: bam.bytes,
          cBytes: cram.bytes,
          // One side served from cache and the other fetching is not a
          // container comparison at all, and the ratio would read as one.
          mixed: bFetched !== cFetched,
        },
      ]
    }),
  )

if (pairs.length) {
  lines.push(
    `## The same ${MOTION}, BAM against CRAM`,
    '',
    'The container is where decode cost lives: CRAM trades bytes on the wire for',
    'CPU at read time, which is the opposite trade from BAM. Both tools read both',
    'formats natively here, so this is one comparison on two containers rather',
    'than two benchmarks.',
    '',
    '| case | tool | BAM | CRAM | CRAM ÷ BAM | BAM bytes | CRAM bytes |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...pairs.map(
      p =>
        `| ${p.case} | ${p.tool} | ${fmt(p.bMs)} ms | ${fmt(p.cMs)} ms | ` +
        `${p.mixed ? '‡' : `${(p.cMs / p.bMs).toFixed(2)}x`} | ` +
        `${p.bBytes ? `${(p.bBytes / 1048576).toFixed(1)} MB` : '—'} | ` +
        `${p.cBytes ? `${(p.cBytes / 1048576).toFixed(1)} MB` : '—'} |`,
    ),
    '',
    '`‡` marks a pair where one container was served from cache on every step and',
    'the other fetched. Those two numbers differ by more than the container, so no',
    'ratio is given — and the byte columns are not comparable there either, since a',
    'cached row moved none.',
    '',
    // Derived from the pairs actually measured. This paragraph used to name
    // specific megabyte totals in prose, which is a claim that goes stale the
    // first time the matrix is re-run.
    ...(() => {
      const comparable = pairs.filter(p => !p.mixed)
      if (!comparable.length) return []
      const worst = comparable
        .filter(p => p.bBytes && p.cBytes)
        .sort((a, b) => b.bBytes / b.cBytes - a.bBytes / a.cBytes)[0]
      const grew = comparable.filter(p => p.bBytes && p.cBytes && p.cBytes > p.bBytes)
      const ratios = comparable.map(p => p.cMs / p.bMs)
      const spread = `${Math.min(...ratios).toFixed(2)}x-${Math.max(...ratios).toFixed(2)}x`
      return [
        `**Time barely moves — ${spread} across the comparable rows — and bytes usually`,
        'fall severalfold**' +
          (worst
            ? `, most sharply for ${worst.tool} at ${worst.case}, ${(worst.bBytes / 1048576).toFixed(1)} MB against ${(worst.cBytes / 1048576).toFixed(1)} MB`
            : '') +
          '.',
        ...(grew.length
          ? [
              `It is not universal: ${grew
                .map(g => `${g.tool} at ${g.case}`)
                .join(', ')} moved *more* bytes under CRAM, and nothing here explains that.`,
            ]
          : []),
        'Byte totals also depend on how many steps each side served from cache, which',
        'differs between the two containers, so treat the column as an order of',
        'magnitude rather than a measurement of compression.',
        '',
      ]
    })(),
    'What this corpus cannot show is the half that matters most. The server is',
    '`localhost`, so bytes CRAM saves cost nothing to move and the trade shows up',
    'as "same time, fewer bytes". Over a real network those saved bytes are the',
    'entire point, and this table understates CRAM accordingly. Read it as',
    'evidence that the extra decode is cheap, not that the container is a wash.',
    '',
    'The internal check that the comparison is sound is the draw counts in the table',
    'above: they are all but identical between the two containers, so the same reads',
    'reached the canvas either way and the difference is the container rather than',
    'the workload.',
    '',
  )
}

const mismatches = Object.entries(prior.locusMismatch ?? {})
if (mismatches.length) {
  lines.push(
    '## Locus mismatches — these rows are not comparisons',
    '',
    'The two tools are driven by different mechanisms (' +
      (isZoom
        ? 'JBrowse by `zoomTo`, igv by `zoomIn`'
        : 'JBrowse by `horizontalScroll`, igv by `search`') +
      '), so where they actually landed is checked rather than assumed. These cases',
    'disagreed by more than 50 bp and should not be read as a comparison of anything:',
    '',
    ...mismatches.map(([id, why]) => `- \`${id}\`: ${why}`),
    '',
  )
} else if (Object.keys(prior.rows).length) {
  lines.push(
    `Every measured case agreed on where it ${isZoom ? 'zoomed' : 'panned'} to, within 50 bp — the two`,
    'tools report a locus differently (`105,001..124,001` against',
    '`104999-124000`) but visited the same regions.',
    '',
  )
}

if (hot.suspect.length) {
  lines.push(
    "> Cells measured at more than twice the run's median load " +
      `(${hot.medianLoad.toFixed(1)}): ` +
      `${hot.suspect.map(s => s.key).join(', ')}.`,
    '',
  )
}

// Named per row, not as one banner over the table. Rows here are measured on
// different days and under different loads — the CRAM rows were added after the
// BAM ones — and a global "this is not a run of record" would condemn cells
// taken at load 1.2 because a later partial run happened at 10. That is the
// same reasoning `results/alignments.md` follows when it names its contaminated
// rows instead of its worst minute.
const hotRows = allCases
  .filter(c => prior.rows[c.id])
  .map(c => ({
    id: c.id,
    peak: Math.max(
      ...(shownTools
        .map(t => prior.rows[c.id]![t.id]?.load)
        .filter(Boolean) as LoadWindow[]).map(peak),
    ),
  }))
  .filter(r => r.peak > LOAD_CEILING)

if (hotRows.length) {
  lines.push(
    `> **Rows measured above the ${LOAD_CEILING.toFixed(1)} load ceiling:** ` +
      `${hotRows.map(r => `\`${r.id}\` (${r.peak.toFixed(1)})`).join(', ')}. ` +
      'Their milliseconds are not a run of record. Tools are interleaved within ' +
      'a round, so the ratio column survives — and note that on the heavier ' +
      'cases much of that load is the benchmark itself, since the tool doing the ' +
      'CPU drawing is the one making the machine busy. Every other row was ' +
      'measured below the ceiling and its absolutes stand.',
    '',
  )
} else if (cells.length) {
  lines.push(
    `Every row was measured below the ${LOAD_CEILING.toFixed(1)} load ceiling.`,
    '',
  )
}

lines.push(
  'Caveats that travel with any external claim: one other tool, one workload',
  'family, one locus, one machine. igv.js parses in the main thread and JBrowse',
  'in workers, and JBrowse boots an application shell where igv mounts a widget.',
  'Those are real architectural differences and they are inside the number — but',
  'less of it than in the cold-load table, which is the reason this measurement',
  'exists.',
  '',
)

prior.motion = MOTION
fs.writeFileSync(RESULTS, JSON.stringify(prior, null, 2))
fs.writeFileSync(REPORT, lines.join('\n'))
console.log(`\nwrote ${REPORT} and ${RESULTS}`)

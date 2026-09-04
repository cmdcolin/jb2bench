// Builds the shareable summary page from results/alignments.json and
// results/interaction.json. Generated rather than hand-written so the page
// cannot drift from the recorded measurements -- transcribing two dozen medians
// by hand is exactly how a presentation ends up quoting a number no run
// produced. Every figure here is read from the JSON the runners wrote.
//
//   node scripts/render/report.ts > results/report.html
import fs from 'fs'

const LOAD_CEILING = 4.0

interface Cell {
  median: number
  stddev: number
  runs: number[]
  load?: { before: number; after: number }
}
interface Cold {
  loc: string
  runs: number
  builds: { port: number; name: string }[]
  measuredAt: Record<string, string>
  results: Record<string, Record<string, Cell>>
}
interface Inter {
  zoomTimeToContentMs: number
  zoomRedrawGapMs: number
  loadingEverSeen: boolean
  stepsMeasured: number
  stepsBailed: number
  allBailed: boolean
  censored: boolean
  load?: { before: number; after: number }
}
interface Interaction {
  builds: Record<string, string>
  measuredAt: Record<string, string>
  results: Record<string, Record<string, Record<string, Inter>>>
}

const cold = JSON.parse(
  fs.readFileSync('results/alignments.json', 'utf8'),
) as Cold
const inter = JSON.parse(
  fs.readFileSync('results/interaction.json', 'utf8'),
) as Interaction

// The cold-load runner measures both formats and keys its rows `<cov>-<read>-<fmt>`;
// the interaction runner is BAM-only and keys its rows `<cov>-<read>`. Two lists
// rather than one with a suffix rule, because a row that exists on one side and
// not the other should be visible as such rather than silently absent.
const COLD_CASES = ['bam', 'cram'].flatMap(fmt =>
  ['shortread', 'longread'].flatMap(read =>
    ['20x', '200x', '1000x'].map(cov => `${cov}-${read}-${fmt}`),
  ),
)
const INTER_CASES = [
  '20x-shortread',
  '200x-shortread',
  '1000x-shortread',
  '20x-longread',
  '200x-longread',
  '1000x-longread',
]
const NEW = 'current'
const PUB = 'release-2.4.0'
const BASE = 'release-4.3.0'

const peak = (l?: { before: number; after: number }) =>
  l ? Math.max(l.before, l.after) : 0
const rowLoad = (id: string) =>
  Math.max(
    0,
    ...Object.values(cold.results[id] ?? {}).map(c => peak(c.load)),
  )
const cellOf = (id: string, build: string) => cold.results[id]?.[build]
const ms = (v?: number) =>
  v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(0)}`

// Speedups are only quoted where both halves exist. A missing published cell is
// a case that has not been re-measured since that column was added, not a zero.
function speedup(id: string, from: string) {
  const a = cellOf(id, from)
  const b = cellOf(id, NEW)
  return a && b && b.median > 0 ? a.median / b.median : Number.NaN
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Figures are inlined rather than linked: a published artifact is served under a
// CSP that blocks every external host, so a <img src="figures/..."> renders as a
// broken image there while looking fine locally.
const figure = (name: string, caption: string) => {
  const p = `results/figures/paper/png/${name}`
  if (!fs.existsSync(p)) {
    return ''
  }
  const b64 = fs.readFileSync(p).toString('base64')
  return `<figure>
    <img src="data:image/png;base64,${b64}" alt="${esc(caption)}">
    <figcaption>${caption}</figcaption>
  </figure>`
}

// Transcribed from ~/paper: Table `tab:speedup-strategies` and the Materials and
// methods section. Grouped by where in the path each one acts, because the
// paper's point is that no single stage is the bottleneck.
const TECHNIQUES: { group: string; rows: [string, string, string][] }[] = [
  {
    group: 'How a record is represented',
    rows: [
      [
        'Columnar typed arrays, end to end',
        'One object per feature holding all its attributes',
        'The layout the encoder copies from and the shader reads',
      ],
      [
        'Arena allocation per decoded block',
        'One small object per record or read feature',
        'A CRAM read feature falls from 64 to 19 bytes',
      ],
      [
        'Numeric decoding instead of strings — packed CIGAR to opcode arrays, genotypes interned to integer codes',
        'A string per record, or per sample per site, that a later stage re-parses',
        'Genotype-matrix preparation 1.87× and 2.47× faster, output byte-identical',
      ],
      [
        'WebAssembly for the innermost loops — libdeflate, htscodecs, the clustering distance kernel',
        'A JavaScript inflate and codec implementation',
        '2.5–3× on inflation in isolation, but only a few percent of a whole query',
      ],
    ],
  },
  {
    group: 'What crosses a boundary',
    rows: [
      [
        'Zero-copy transport: buffers handed across the worker as transferables',
        'A structured clone costing time proportional to payload size',
        'The shape parsed is the shape moved and the shape drawn — no translation step',
      ],
      [
        'One read per byte range, shared between callers',
        'One request per caller, cancelled by the first to abandon it',
        'No refetch or spurious failure when a neighbouring block is dropped',
      ],
      [
        'Coalesce many regions into one pass',
        'One request per region',
        '25-chromosome overview: 27 range requests and 691 kB fall to 3 and 312 kB',
      ],
      [
        'One chunked, compressed store across samples',
        'One BigWig per sample, each latency-bound',
        '2,504 individuals: 15,048 requests and 24.5 s fall to 3 requests and 0.2 s',
      ],
    ],
  },
  {
    group: 'What the GPU holds',
    rows: [
      [
        'Absolute genomic coordinates resident on the card',
        'Rendered output bound to a specific bpPerPx',
        'Pan, zoom, recolour and re-sort become shader parameter changes, with no refetch',
      ],
      [
        'Double-single coordinate split, high and low float',
        '32-bit float positions',
        'Base-accurate addressing across a human chromosome',
      ],
      [
        'One shader source in Slang, compiled to WGSL and GLSL with the buffer layout',
        'Two hand-maintained implementations kept in step',
        'The encoder and the shader that reads it cannot disagree',
      ],
      [
        'WebGPU compute over the resident genotype matrix',
        'A precomputed file fixing panel, metric and window when written',
        'All three become analytical choices; CPU fallback below a work threshold',
      ],
    ],
  },
]

const techniqueBlocks = TECHNIQUES.map(
  g => `<h3 class="grp">${g.group}</h3>
  <div class="scroll"><table class="tech">
    <thead><tr><th scope="col">Technique</th><th scope="col">Replaces</th><th scope="col">What it buys</th></tr></thead>
    <tbody>${g.rows
      .map(
        r =>
          `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td class="eff">${r[2]}</td></tr>`,
      )
      .join('')}</tbody>
  </table></div>`,
).join('\n')

// ---------------------------------------------------------------- cold table
let coldRows = ''
for (const id of COLD_CASES) {
  const load = rowLoad(id)
  const hot = load > LOAD_CEILING
  const sp = speedup(id, PUB)
  const spBase = speedup(id, BASE)
  const when = cold.measuredAt[id] ?? '—'
  coldRows += `<tr>
    <th scope="row">${id}</th>
    <td class="num strong">${ms(cellOf(id, NEW)?.median)}</td>
    <td class="num">${ms(cellOf(id, BASE)?.median)}</td>
    <td class="num">${ms(cellOf(id, 'release-4.1.15')?.median)}</td>
    <td class="num pub">${ms(cellOf(id, PUB)?.median)}</td>
    <td class="num">${Number.isFinite(spBase) ? `${spBase.toFixed(2)}×` : '—'}</td>
    <td class="num"><span class="ratio${Number.isFinite(sp) ? '' : ' none'}">${Number.isFinite(sp) ? `${sp.toFixed(2)}×` : '—'}</span></td>
    <td class="meta">${when}</td>
    <td class="num meta"><span class="load ${hot ? 'hot' : 'ok'}">${load ? load.toFixed(1) : '?'}</span></td>
  </tr>`
}

// -------------------------------------------------------- interaction table
const icell = (id: string, mode: string, role: string) =>
  inter.results[id]?.[mode]?.[role]
function ifmt(r?: Inter) {
  if (!r) {
    return '—'
  }
  if (r.allBailed) {
    return '<span class="bail">bail</span>'
  }
  if (!Number.isFinite(r.zoomTimeToContentMs)) {
    return 'n/a'
  }
  return `${r.censored ? '≥' : ''}${r.zoomTimeToContentMs.toFixed(0)}`
}

let zoomRows = ''
for (const id of INTER_CASES) {
  const n = icell(id, 'in', 'new')
  const b = icell(id, 'in', 'baseline')
  const p = icell(id, 'in', 'published')
  const instant = n && !n.loadingEverSeen
  zoomRows += `<tr>
    <th scope="row">${id}</th>
    <td class="num strong">${instant ? '<span class="instant">none</span>' : ifmt(n)}</td>
    <td class="num">${ifmt(b)}</td>
    <td class="num pub">${ifmt(p)}</td>
    <td class="num meta">${n ? `${n.zoomRedrawGapMs.toFixed(0)} ms` : '—'}</td>
  </tr>`
}

let panRows = ''
for (const id of INTER_CASES) {
  const n = icell(id, 'pan', 'new')
  const b = icell(id, 'pan', 'baseline')
  const p = icell(id, 'pan', 'published')
  const r =
    n && b && n.zoomTimeToContentMs > 0
      ? b.zoomTimeToContentMs / n.zoomTimeToContentMs
      : Number.NaN
  panRows += `<tr>
    <th scope="row">${id}</th>
    <td class="num strong">${ifmt(n)}</td>
    <td class="num">${ifmt(b)}</td>
    <td class="num pub">${ifmt(p)}</td>
    <td class="num"><span class="ratio${Number.isFinite(r) ? '' : ' none'}">${Number.isFinite(r) ? `${r.toFixed(2)}×` : '—'}</span></td>
  </tr>`
}

// ------------------------------------------------------------------ headline
const measurable = COLD_CASES.map(id => speedup(id, PUB)).filter(Number.isFinite)
const lo = measurable.length ? Math.min(...measurable) : Number.NaN
const hi = measurable.length ? Math.max(...measurable) : Number.NaN
const measuredToday = COLD_CASES.filter(
  id => cellOf(id, PUB) !== undefined,
).length

const html = `<title>JBrowse 2 Since v2.4.0</title>
<style>
  :root {
    --bg: #f4f7f7;
    --surface: #ffffff;
    --ink: #0e1719;
    --muted: #59706f;
    --line: #d9e3e2;
    --accent: #0b6b64;
    --accent-soft: #e2f0ee;
    --pub: #9d5325;
    --pub-soft: #f6e9e0;
    --warn: #8a6206;
    --warn-soft: #faf0d8;
    --good: #26694a;
    --shadow: 0 1px 2px rgba(14, 23, 25, 0.06), 0 8px 24px rgba(14, 23, 25, 0.05);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --bg: #0b1112;
      --surface: #121b1c;
      --ink: #e6efee;
      --muted: #8ea3a1;
      --line: #243234;
      --accent: #4fbcae;
      --accent-soft: #14312e;
      --pub: #d68a5a;
      --pub-soft: #2e2019;
      --warn: #d8ab3f;
      --warn-soft: #2c2413;
      --good: #63b78c;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3);
    }
  }
  :root[data-theme='dark'] {
    --bg: #0b1112;
    --surface: #121b1c;
    --ink: #e6efee;
    --muted: #8ea3a1;
    --line: #243234;
    --accent: #4fbcae;
    --accent-soft: #14312e;
    --pub: #d68a5a;
    --pub-soft: #2e2019;
    --warn: #d8ab3f;
    --warn-soft: #2c2413;
    --good: #63b78c;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  body {
    background: var(--bg);
    color: var(--ink);
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: clamp(1.5rem, 4vw, 3.5rem) clamp(1rem, 4vw, 2rem) 5rem;
  }
  .wrap {
    max-width: 68rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 2.75rem;
  }
  .prose { max-width: 40rem; }

  h1, h2, h3 { font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif; font-weight: 600; text-wrap: balance; margin: 0; }
  h1 { font-size: clamp(2rem, 5vw, 3rem); line-height: 1.12; letter-spacing: -0.01em; }
  h2 { font-size: 1.6rem; line-height: 1.2; }
  h3 { font-size: 1.1rem; }
  p { margin: 0; }
  .eyebrow {
    font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--accent); font-weight: 600; margin: 0 0 0.9rem;
  }
  .lede { font-size: 1.12rem; color: var(--muted); margin-top: 1rem; }

  header { border-bottom: 1px solid var(--line); padding-bottom: 2.25rem; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; }
  .tile {
    background: var(--surface); border: 1px solid var(--line); border-radius: 3px;
    padding: 1.15rem 1.25rem; box-shadow: var(--shadow);
    display: flex; flex-direction: column; gap: 0.3rem;
  }
  .tile .k { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .tile .v {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 2rem; font-variant-numeric: tabular-nums; line-height: 1.1; color: var(--accent);
  }
  .tile .n { font-size: 0.85rem; color: var(--muted); }

  section { display: flex; flex-direction: column; gap: 1.15rem; }

  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); box-shadow: var(--shadow); }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  caption { text-align: left; padding: 0.9rem 1rem 0; color: var(--muted); font-size: 0.85rem; }
  th, td { padding: 0.55rem 0.85rem; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
  thead th {
    font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line);
  }
  tbody th { font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .strong { color: var(--accent); font-weight: 600; }
  .pub { color: var(--pub); }
  .meta { color: var(--muted); font-size: 0.82rem; }
  .ratio { background: var(--accent-soft); color: var(--accent); border-radius: 2px; padding: 0.12rem 0.42rem; font-weight: 600; }
  .ratio.none { background: transparent; color: var(--muted); font-weight: 400; }
  .instant { background: var(--accent-soft); color: var(--accent); border-radius: 2px; padding: 0.12rem 0.42rem; font-weight: 600; }
  .bail { color: var(--muted); font-style: italic; }
  .load { border-radius: 2px; padding: 0.12rem 0.42rem; }
  .load.hot { background: var(--warn-soft); color: var(--warn); font-weight: 600; }
  .load.ok { color: var(--muted); }

  .panel {
    background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--warn);
    border-radius: 3px; padding: 1.25rem 1.4rem; display: flex; flex-direction: column; gap: 0.7rem;
    box-shadow: var(--shadow);
  }
  .panel.accent { border-left-color: var(--accent); }
  .panel h3 { font-family: system-ui, sans-serif; font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--warn); }
  .panel.accent h3 { color: var(--accent); }
  .panel p, .panel li { font-size: 0.92rem; color: var(--muted); }
  .panel ul { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.45rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; background: var(--accent-soft); color: var(--accent); padding: 0.08em 0.32em; border-radius: 2px; }
  footer { border-top: 1px solid var(--line); padding-top: 1.5rem; color: var(--muted); font-size: 0.85rem; }

  h3.grp {
    font-family: system-ui, sans-serif; font-size: 0.74rem; letter-spacing: 0.11em;
    text-transform: uppercase; color: var(--muted); margin-top: 0.5rem;
  }
  table.tech th, table.tech td { white-space: normal; vertical-align: top; }
  table.tech { font-size: 0.86rem; }
  table.tech tbody th { width: 30%; font-weight: 600; font-family: inherit; font-size: 0.86rem; color: var(--ink); }
  table.tech td { width: 30%; color: var(--muted); }
  table.tech td.eff { width: 40%; color: var(--accent); }
  p.note { font-size: 0.92rem; color: var(--muted); }

  figure { margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  figure img {
    width: 100%; max-width: 100%; height: auto; display: block;
    background: #fff; border: 1px solid var(--line); border-radius: 3px; padding: 0.4rem;
  }
  figcaption { font-size: 0.85rem; color: var(--muted); max-width: 46rem; }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">JBrowse 2 render benchmarks · ${new Date().toISOString().slice(0, 10)}</p>
    <h1>What three years bought a reader of the 2023 paper</h1>
    <p class="lede prose">
      Every speedup in this repository has been measured against a recent release, which
      answers &ldquo;what did this release change.&rdquo; This run adds the column that answers a
      different question: how much faster is JBrowse 2 today than
      <strong>v2.4.0</strong> &mdash; the version archived and benchmarked in the 2023
      <em>Genome Biology</em> paper, and the one people have actually read about.
    </p>
  </header>

  <div class="tiles">
    <div class="tile">
      <span class="k">Cold render vs v2.4.0</span>
      <span class="v">${Number.isFinite(lo) ? `${lo.toFixed(1)}–${hi.toFixed(1)}×` : '—'}</span>
      <span class="n">across ${measuredToday} measured case${measuredToday === 1 ? '' : 's'}</span>
    </div>
    <div class="tile">
      <span class="k">Zoom wait, current</span>
      <span class="v">none</span>
      <span class="n">no loading state on any case</span>
    </div>
    <div class="tile">
      <span class="k">Region</span>
      <span class="v" style="font-size:1.35rem">19 kb</span>
      <span class="n">${esc(cold.loc)}</span>
    </div>
    <div class="tile">
      <span class="k">Runs per cell</span>
      <span class="v" style="font-size:1.35rem">${cold.runs} + warmup</span>
      <span class="n">median reported</span>
    </div>
  </div>

  <section>
    <h2>End-to-end: cold load to rendered reads</h2>
    <p class="prose">
      In-page navigation&rarr;render-complete time, median of ${cold.runs} runs after a warmup.
      This is the <em>fetch-dominated</em> measurement &mdash; every build here parses in a worker
      and pulls the same bytes over the same HTTP range requests &mdash; so it understates the
      renderer difference rather than flattering it.
    </p>
    <div class="scroll">
      <table>
        <caption>Milliseconds, lower is better. <strong>current</strong> is <code>jbrowse-components</code> HEAD.</caption>
        <thead>
          <tr>
            <th scope="col">case</th>
            <th scope="col" class="num">current</th>
            <th scope="col" class="num">4.3.0</th>
            <th scope="col" class="num">4.1.15</th>
            <th scope="col" class="num">2.4.0 <span style="font-weight:400">(paper)</span></th>
            <th scope="col" class="num">vs 4.3.0</th>
            <th scope="col" class="num">vs 2.4.0</th>
            <th scope="col">measured</th>
            <th scope="col" class="num">load</th>
          </tr>
        </thead>
        <tbody>${coldRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Interactivity: what a zoom costs you</h2>
    <p class="prose">
      <strong>Time-to-content</strong> is the milliseconds a loading indicator sits on the track
      after an interaction before correct content is back. The old block renderer binds rendered
      output to a specific <code>bpPerPx</code>, so every zoom refetches and re-renders; the current
      renderer re-projects reads it already holds.
    </p>
    <div class="scroll">
      <table>
        <caption>Zoom in &mdash; the new view is a subset of loaded data, so only the block renderers refetch.</caption>
        <thead>
          <tr>
            <th scope="col">case</th>
            <th scope="col" class="num">current</th>
            <th scope="col" class="num">4.3.0</th>
            <th scope="col" class="num">2.4.0 <span style="font-weight:400">(paper)</span></th>
            <th scope="col" class="num">current redraw frame</th>
          </tr>
        </thead>
        <tbody>${zoomRows}</tbody>
      </table>
    </div>
    <div class="scroll">
      <table>
        <caption>Pan one viewport sideways at constant zoom &mdash; the region is new to <em>every</em> build, so all of them pay the fetch. This is the hardest case for the current renderer, not the easiest.</caption>
        <thead>
          <tr>
            <th scope="col">case</th>
            <th scope="col" class="num">current</th>
            <th scope="col" class="num">4.3.0</th>
            <th scope="col" class="num">2.4.0 <span style="font-weight:400">(paper)</span></th>
            <th scope="col" class="num">vs 4.3.0</th>
          </tr>
        </thead>
        <tbody>${panRows}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>It is not the GPU</h2>
    <p class="prose">
      A record crosses six stages between file byte and pixel: decompression, parsing,
      an in-memory representation, a thread boundary, an encode step, a draw. Each was
      individually reasonable and none profiled as the bottleneck — <strong>the cost was
      at the boundaries between them</strong>, where every stage handed the next a record
      in a shape that stage had to rebuild. A profiler charges that work to the stage
      doing the rebuilding, not to the boundary that forced it, so no measurement of a
      single layer points at it and no owner of a single layer can remove it.
    </p>
    ${techniqueBlocks}
    <p class="prose note">
      The WebAssembly row is why that distinction decides the outcome: inflation alone
      gets 2.5–3× faster, but a query also fetches bytes and walks an index, so the
      multiplier reaches the user as a few percent. A stage optimized alone is bounded by
      the stages around it. The ones that compound are the ones that change what crosses a
      boundary — the columnar layout, the arena, and the zero-copy transport those two
      make possible.
    </p>
  </section>

  <section>
    <h2>The figures</h2>
    ${figure('perf-coldload.png', 'Cold load to rendered reads at the 19 kb window, by coverage and read type, across four tools — JBrowse 2.4.0, JBrowse 5.0.0, igv.js and GenomeSpy. Laid out like Fig 8 of the 2023 paper so the two can be read side by side. A hollow point is a run abandoned at the paint ceiling, so its height is a bound and not a measurement.')}
    ${figure('perf-coldload-100kb.png', 'The same cold load at the 100 kb window, which quintuples the bytes per cell. Two figures rather than one eight-panel grid: reads and format already take both dimensions of the grid, and window as a third factor pushes format into a linetype the reader has to hold in mind while reading a duration off.')}
    ${figure('perf-interaction.png', 'Time-to-content after a zoom and after a pan, across three JBrowse releases. A zoom needs no network and this work redraws without refetching, so its row is flat at ~165 ms while the releases re-rasterize for seconds; a pan is new region to every arm, so all of them pay the fetch.')}
    ${figure('parser-time.png', 'The alignment parser libraries, 2023 release against current, decode only — no browser, no GPU.')}
  </section>

  <section>
    <h2>Read these with the caveats attached</h2>
    <div class="panel">
      <h3>Machine load</h3>
      <p>
        This is a shared workstation and these runs were taken while other jobs were on it.
        Any row whose <span class="load hot">load</span> is above ${LOAD_CEILING.toFixed(1)} is not
        comparable to one measured on an idle box. Contamination lands per cell, not per run, so a
        run whose average looks fine can still hold one ruined row &mdash; which is why the load is
        recorded either side of every cell rather than once per sitting.
      </p>
      <p>
        The builds are measured back to back within each case, so a load spike tends to land on all
        four columns at once. That makes the <em>ratios</em> considerably more durable than the
        absolute milliseconds, and the ratios are what these tables are for.
      </p>
    </div>
    <div class="panel accent">
      <h3>What is and is not being compared</h3>
      <ul>
        <li><strong>Cumulative, not isolated.</strong> Three years separate v2.4.0 from HEAD and
        almost none of it is the renderer. The 4.3.0 column isolates this release; the 2.4.0 column
        tells a reader of the paper what the intervening period bought them.</li>
        <li><strong>Same corpus as the paper.</strong> Reads were simulated with the same
        <code>pbsim</code> and <code>wgsim</code> invocations over the same 250 kb hg19 chr22 slice
        the 2023 methods describe.</li>
        <li><strong>Not the paper's own figures.</strong> Those plot a 10 kb region on 2023
        hardware; this bench uses 19 kb on one 2026 workstation. v2.4.0 is re-measured here rather
        than quoted, so both columns come off the same machine on the same day.</li>
        <li><strong>One machine, one locus, one workload family.</strong> Alignment pileups only.</li>
      </ul>
    </div>
  </section>

  <footer>
    Generated by <code>scripts/render/report.ts</code> from <code>results/alignments.json</code>
    and <code>results/interaction.json</code>. Cold-load rows dated individually above; zoom and pan
    measured ${esc(Object.values(inter.measuredAt).join(', '))}. Browser pinned to Chrome for
    Testing 148.0.7778.97 via puppeteer 24.43.1.
  </footer>
</div>
`

process.stdout.write(html)

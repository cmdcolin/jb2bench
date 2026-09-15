# Benchmarks

## Initial render

`scripts/render/runner.ts` → `results/alignments.md`. Cold-start
navigation→render-complete time, median of 6 runs after a warmup.

**Twelve cases since 2026-08-16, not six: both formats.** `shell/load_alignments.sh`
had always staged the CRAM tracks and nothing measured them, so the table
answered "what does coverage cost" without ever answering "what does the format
cost" — which is the axis the 2023 paper's Fig 8 is built on. Rows are now keyed
`<coverage>-<readtype>-<format>`, and every row recorded before that date was
relabelled `-bam`, since BAM is what it was. `FORMATS=bam` restores the old
six-case run for when the full matrix is unaffordable.

This is fetch-dominated — both architectures fetch in workers — so it
*undersells* the GPU branch. Wins are 1.3–1.4× on the short-read cases, 1.4×
and 2.2× on 20x and 200x long-read. **The 1000x-longread row is unusable** — it
was attempted twice on 2026-08-05, both times at peak load above 30, and
release-4.1.15 returned 25187 ms and then 56452 ms for identical work. The table
prints `unusable` there rather than a speedup.

**The 1000x-shortread regression is gone.** It was the one case where the branch
lost — 7137 ms vs 4581 ms, 0.64× — and `flame/FINDINGS.md` traced it to
main-thread `placeRect` layout costing 2116 ms at ~1M reads. Measured against
`current` on 2026-08-05 it is 3784 ms vs 5084 ms, a **1.34× win**. Read
`flame/FINDINGS.md` as a description of a fixed problem, not a live one; it is
still the right account of *why* it happened, and the fix wants confirming
against a fresh profile.

Rows are dated and carry the peak load they were measured under, because this
box is shared and contamination lands per-cell rather than across a whole run.

> **Every legacy-build column here predates the 2026-09-06 detector fix and is
> understated.** `rendercomplete.ts` used to call the old block renderer finished
> when its count of finished blocks held still for half a second, which any gap
> between two blocks satisfies. Spot-checked after the fix: `20x-shortread-bam`
> on 2.4.0 goes 2234 → 3360 ms, and the other three cells checked moved within
> their own spread. Small here, because a 19 kb view is one or two blocks — see
> the wide arm below for what the same bug did at 1 Mb. The 4.3.0 and 2.4.0
> columns want re-measuring; `current` is unaffected, since it publishes a
> per-display phase rather than per-block markers.

**`SCALE=1mb` runs the same matrix at a 1 Mb window** (`make render-1mb`) and
writes `results/alignments-1mb.md`. Eight cases rather than twelve: 20x and 100x
only, since the question there is width and not depth. Two arms rather than
three — release 4.3.0 answers "what did that release change", and these cells are
the most expensive in the repo. `scripts/paperfigs/width.R` draws it.

**A megabase is reachable.** Measured 2026-09-06, median of 6 runs, every row
inside the foreign-CPU gate: on the build under test, 1 Mb costs 2.1 s at 20x
short read and 5.7 s at 100x — 666k reads on screen at once — and 3.3 s / 9.4 s
on long read. Release 2.4.0 takes 4.1 s and 14 s for the same short-read cells.

**CRAM is free at this width on the build under test, and it is not on 2.4.0.**
2.2 s against BAM's 2.1 s at 20x short read, 10.0 s against 9.4 s at 100x long
read. On 2.4.0 the same pairs are 11.2 s against 4.1 s and 32 s against 14 s, so
the format penalty that release carries grows rather than shrinks with the
window — the 100x short-read CRAM cell is its worst at 37 s, 6.1x this work.

**The cost tracks the data, not the width.** 100x short read over 1 Mb is 80 MB
and 666k reads, and it draws in 5.7 s; 1000x short read through the 19 kb window
is roughly 8 MB and 127k reads, and it draws in 2.2 s. Ten times the bytes for
2.6 times the time. Read that as a shape and not as a measurement: the two
numbers come from different corpora measured three days apart, and the same
build has moved 40% between sessions here before.

## Zoom interaction

`scripts/render/runner-interaction.ts` → `results/interaction.md`. This is where
the architecture shows up.

The old block renderer binds rendered output to a specific bpPerPx, so **every
zoom refetches and re-renders** — "Downloading alignments…", from ~1 s up to
more than 15 s depending on data weight. The GPU branch re-projects
already-loaded reads at the new zoom with no refetch: content is never lost, and
the only cost is a single ~17–233 ms redraw frame.

Zoom is the branch's best case and pan is its worst, so the two bracket it:

| case | zoom-in (4.3.0 waits) | pan (both fetch) |
| --- | ---: | ---: |
| 20x-shortread | 0 vs 1059 ms | 336 vs 639 ms — 1.90× |
| 200x-shortread | 0 vs 1085 ms | 697 vs 1310 ms — 1.88× |
| 1000x-shortread | 0 vs 1717 ms | 1895 vs 6608 ms — 3.49× |
| 20x-longread | 0 vs 1178 ms | 361 vs 1251 ms — 3.47× |
| 200x-longread | 0 vs 2984 ms | 739 vs 3182 ms — 4.31× |
| 1000x-longread | 0 vs 15321 ms | 3972 vs 16115 ms — 4.06× |

Even when both builds must go to the network, the branch is 1.9–4.3× faster to
content, with the widest margins on the heaviest tracks. The zoom column is not
a speedup ratio: 0 ms means the branch showed no loading state at all, so there
is nothing to divide.

The metric is **time-to-content**: milliseconds the view goes without correct
content after an interaction, driven through `window.JBrowseSession` (every build
exposes it) and measured structurally by `scripts/render/contentready.ts` rather
than by reading a spinner's text — see the instrument notes below for why. `MODE` selects what the
interaction is, and the three modes ask different questions:

- **in** (default) — zoom in. The new view is a strict subset of loaded data, so
  only the old renderer refetches. This is the branch's best case by
  construction, and it is where the 0 ms column comes from.
- **out** — zoom out; intended as the case where *both* refetch. **It does not
  work**, and the table says so: past a byte threshold JBrowse declines the fetch
  and draws "Requested too much data (N Mb). Zoom in to see features or force
  load" instead of reads. That path paints nothing and returns in ~90 ms, so
  before this was detected it scored as the fastest result in the benchmark.
  release-4.3.0 refuses outright on five of six cases. Steps that refused are
  marked `_bail_` / `(n bail)` and excluded from the median.
- **pan** — scroll sideways one full viewport at constant `bpPerPx`. This is the
  refetch-against-refetch test zoom-out was meant to be: the region is new to
  both builds, and the bytes per step equal the initial render's, so the density
  cap is never approached. **This is the branch's hardest case** — both
  architectures pay the fetch, so what is left is render cost, not avoided
  network. It measures cleanly on all six cases: 5/5 steps, no bails.

A pan has to avoid landing anywhere that renders less than a full viewport of
reads, because thin data scores fast for the same reason a refusal does. Two
ways that happens here:

- **Running off the contig.** JBrowse's `maxOffset` allows scrolling until only
  ~200 px of genome remains on screen. The benchmark requires the whole new
  viewport to land inside the contig and stops rather than clamping into a
  mostly-empty view.
- **The coverage taper.** pbsim's long reads run off both ends of `chr22_mask`,
  so long-read depth falls away there. Mean depth per 19 kb window on
  1000x.longread:

  | 5k | 29k | 48k | 67k | 86k | 105k | 124k | 143k | 162k | 181k | 200k | 219k |
  | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
  | 320 | 927 | 1193 | 1218 | 1179 | 1185 | 1178 | 1163 | 1161 | 1178 | 938 | 500 |

  Panning **right** from the 124k locus puts two of five steps on that taper, in
  both builds at once — which looks like a shared speedup rather than a corpus
  artefact. The pan therefore runs **left** (`PAN_DIR=right` restores the old
  path), keeping four of five windows inside the plateau. Short-read depth is
  flat across the whole contig (~1186), and 20x-shortread accordingly measures
  identically in both directions — which is the check that the difference in the
  long-read rows is the taper and not noise.

Every step records the locus it landed on, so a run log can be audited for both.
A corpus with patchier coverage would need a real painted-content check instead.

> Corrections from the 2026-08-05 runs. The old `1000x-longread` figure of
> 15008 ms was **censored**, not measured — all five steps sat within 19 ms of
> the then 15000 ms `MAX_WAIT`. With the cap at 120 s it completes honestly at
> ~13.9–15.3 s. The zoom-out row, added the same day, measured refusals rather
> than renders until the bail check landed. And the first pan implementation
> panned rightward into the coverage taper described above.

## CRAM slice worker pool, on vs off

`scripts/render/crampool.ts`. Since 12.1 `@gmod/cram` decodes each slice on a
pool of workers; nested inside jbrowse's RPC worker that is worth **2.1–3.6x on
the decode** (see `@gmod/cram`'s `docs/WORKERS.md`, and ADR 0009 there for why
the pool is per JS context). This asks the different question of whether a
reader feels it.

**Do not measure it with a cold load.** The first attempt did and got 0.99x on
200x.shortread.cram, which is the instrument and not the result: a page load
re-pays app boot, chunk fetch and assembly resolution every run, ~2 s of
constant work that the decode is only a slice of. This script pans instead —
app up, assembly resolved, worker warm and its wasm instantiated — across
non-overlapping 19 kb windows, since jbrowse caches decoded records per region
and raw bytes per 256 KiB chunk and panning back measures a cache hit.

Needs a build with both arms in it: a CRAM track plus a `.nopool` twin
differing only in the adapter's `useSliceWorkerPool`. The file header has the
setup. The twin is necessary because the decode runs inside an RPC worker where
no page-side hook reaches, so without that config slot an A/B costs two full
builds of jbrowse-web.

**No run of record yet**, and the attempts are recorded in
[`results/crampool.md`](results/crampool.md) — every one has been on a box at load
35–45 from other work, which is far above the 4.0 this repo treats as the
threshold for a usable row. The harness is verified to drive the pans and
collect them; only the timing is waiting on a quiet machine.

## Per-frame interaction cost

`scripts/flamegraph/interaction-profile.ts` → `results/interaction-cpu.md`. Not
time-to-content but the per-frame main-thread cost of a sustained gesture, with
`THROTTLE=n` to emulate slower machines. The finding: frames are bound by React
re-render plus CSS-in-JS serialization, not by MobX or by the GPU draw.

## Cross-tool: JBrowse vs igv.js

`scripts/crosstool/runner.ts` → `results/crosstool.md`. The only comparison here
that leaves the JBrowse family, and since 2026-08-24 it runs three JBrowse arms
rather than one: the build under test, the last release, and the version the 2023
paper benchmarked. The paper's own Fig 8 is igv.js against v2.4.0, so a matrix
with only a current-JBrowse column answers half of what a reader of it is asking.
It is also what the cold-load figures under `results/figures/paper/` are drawn
from — a figure carrying another tool has to come from the instrument all the
arms share, and only this one does. Both tools read the same indexed BAMs out of
`data/` over HTTP range requests and draw a pileup, so the workload is genuinely
shared; `crosstool/index.html` is an igv.js page driven entirely by URL
parameters, the way the runners drive a JBrowse build.

Three things make it a comparison rather than a ranking:

- **The instrument belongs to neither tool.** `scripts/crosstool/paintprofile.ts`
  polls a screenshot and waits for the pixels to stop changing. igv.js hides its
  spinner when features finish *loading*, before it draws them, so trusting its
  loading state would credit it with a render it has not done — the same class of
  error as the zoom-out refusals above. Cost: the paint instrument reads a few
  hundred ms higher than the testid instrument, because it also waits out
  everything else settling on the page. Measured on `builds/current` at
  20x-shortread, paint vs testid was 3070 vs 2435 ms and 3395 vs 2921 ms — a
  consistent offset, applied to both columns.
- **Runs are interleaved.** Each round runs every tool back to back, so a load
  spike on this shared box lands on all of them. It does: `1000x-shortread`
  moved 5730 → 8495 ms for JBrowse and 51789 → 76254 ms for igv between rounds,
  and the *ratio* held at roughly 9× through it.
- **Downsampling is controlled for, not assumed away.** igv draws at most
  `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000);
  JBrowse draws every read. On this corpus the deepest 100 bp window holds
  roughly 700 short reads, so the default clips slightly and the maximum clips
  nothing. The two igv columns therefore answer "is downsampling what we are
  measuring?" rather than trading workload for speed.

`?depth=N` on the harness page sets `samplingDepth` (values above 10000 are
clamped by igv itself with a console warning) and `?height=N` the track height.
Both controls came out the same way: neither downsampling nor track height
moves igv enough to explain the ratios. At 300 px igv was in fact slightly
*slower* than at 600 px in both cases measured — 14928 vs 12344 ms at
200x-shortread, 39804 vs 38089 ms at 1000x-shortread — which is the run-to-run
spread on this box, not an effect.

Run the height control as `TOOLS=igv-h600ctl,igv-h300`, **never** as
`TOOLS=igv,igv-h300`. The latter re-measures the main table's `igv` cell in a
round that does not re-measure `jbrowse`, and the headline ratio silently ends
up comparing two rounds taken at different loads. That happened once and had to
be undone from `results/crosstool-h600-backup.json`.

```bash
npx http-server crosstool -p 8003 -s --cors &
# Every cross-tool matrix takes one JBrowse arm per port, so all three JBrowse
# versions and igv.js land in one interleaved round. `make crosstool` does all
# three motions with the arms already set.
ARMS="JBROWSE_PORTS=8000,8001,8004 TOOLS=jbrowse,jbrowse-release-4.3.0,jbrowse-release-2.4.0,igv,igv-deep"

env $ARMS RUNS=3 node scripts/crosstool/runner.ts              # → results/crosstool.{md,json}
env $ARMS MOTION=zoom node scripts/crosstool/panrunner.ts      # → results/crosstool-zoom.{md,json}
env $ARMS MOTION=pan  node scripts/crosstool/panrunner.ts      # → results/crosstool-pan.{md,json}
TOOLS=igv-h600ctl,igv-h300 CASES=200x-shortread-bam node scripts/crosstool/runner.ts
```

### igv.js is now version-selectable

`crosstool/index.html` takes `?igv=2.12.1` and loads
`crosstool/igv-2.12.1.esm.js` by dynamic import; anything else, or nothing, gets
the pinned 3.8.5 symlinked out of `node_modules`. 2.12.1 is vendored as a file
rather than installed because two majors of one package cannot both be a
dependency.

The reason to want it is that the 2023 paper timed **igv.js v2.12.1**, so a
number measured here is only commensurable with the published one if the same
igv can be put back on the bench. Both versions were checked to load and report
`__igvState.ready` with no page errors (3.8.5 had drawn no canvas by the 7 s
mark where 2.12.1 had drawn eight — a timing difference, not a failure, and
irrelevant to a runner that measures paint quiescence rather than counting
canvases).

### GenomeSpy: drawing since 2026-08-28, by not declaring a domain

`crosstool/genomespy.html`, with `@genome-spy/core` at **0.85.0**. The arm runs
in `scripts/crosstool/runner.ts` at both windows, no longer gated: it was
opt-in behind `GENOMESPY=1` while the page drew nothing, and a gated arm goes
unexercised, which is how the page rotted in the first place. `make toolcheck`
preflights it on every run instead — necessary, because the instrument on those
runs is paint quiescence and a page that throws settles immediately, so a dead
harness does not look broken, it reports the best number in the table.

**GenomeSpy does read alignments.** It has a native `bam` lazy data source, so
the comparison runs on the *same* BAM workload as igv.js and JBrowse rather
than being pushed onto signal. Its transform registry carries `pileup`,
`alignmentMismatches`, `flattenCigar` and `coverage`. The harness uses `pileup`
to assign lanes, because comparing a laid-out stack against a single
overplotted row would not be a comparison.

**What was wrong was the domain, not the assembly declaration.** Every earlier
account here blamed the genome-declaration form, and every one of them was
looking at the wrong half of the spec. Swept against a running page: with **no
`domain` anywhere on the x scale**, root `genomes` + `assembly` loads, fetches
and draws. Add a domain and every form fails identically — root `scales` or the
channel, chromosomal `{chrom, pos}` or plain linear numbers, root `genomes` or
an inline `scale.assembly` object — with `Genome hg19mod has not been loaded
yet. Call ensureAssembly("hg19mod")` and zero requests for the BAM.

The mechanism, read out of the bundle:

- Startup only *configures* genomes — `configureGenomes()` off the root spec,
  and nothing more.
- The sole loader on the `embed()` path is the view-insertion preflight
  (`assemblyPreflight`), which collects assemblies by asking each x/y scale
  resolution for its requirement and then calls `ensureAssembly` for each.
- A declared domain is read *before* that preflight runs, through
  `getConfiguredDomain` → `fromComplexInterval` → `getLocusGenome` →
  `getGenome()`, and a configured genome that has not been loaded yet throws
  there rather than loading on demand.

So the harness declares no domain, names the x scale, and moves to the window
afterwards:

```js
await api.getScaleResolutionByName('pos').zoomTo([
  { chrom, pos: start },
  { chrom, pos: end },
])
```

which lands on exactly the requested interval — read back off the resolution as
`[124000, 143001]` — and pulls 0.93 MB of BAM where every domain form fetches
nothing. The cost to the measurement is one empty axis frame before the zoom:
the lazy source declines a view wider than its `windowSize`, so that first frame
reads the header and the index and stops.

**A built-in assembly would not have had this problem**, and that is the whole
asymmetry. `hg38`, `hg19`, `mm10` and the rest are hardcoded chrom.sizes strings
in the bundle, and `getGenome` builds one on demand, synchronously, at any point
in the lifecycle. GenomeSpy's published BAM example declares `assembly: "hg38"`
and therefore never exercises the loader at all — which is why that example
could not have told us anything. A *configured* genome is checked before the
built-in fallback, so naming ours after a built-in does not help either:
`genomes: { hg19: { contigs } }` throws where a bare `assembly: "hg19"` would
not. The only route to the synchronous branch is real contig names in the
corpus, and the corpus is a 250 kb slice under a made-up `chr22_mask`.
Regenerating it onto real `chr22` coordinates would make a declared domain work
here, and would touch every other benchmark in this repo, so it stays a decision
rather than a fix.

**`windowSize` has to exceed the view span, and it rounds outward.** The lazy
source drops any request wider than `windowSize` and snaps the interval it does
load to multiples of it, so this arm reads more bytes than the window it draws —
up to two aligned blocks. The harness defaults to `max(30000, span + 1000)`,
which keeps the 19 kb window on the 30000 it has always used and lets the 100 kb
window load at all. That over-fetch is a property of the lazy source, not a
harness setting to tune away; `drewcheck.ts` counts the bytes.

**Four independent signals read clean on the dead page**, which is why the
original failure survived so long: `embed()` resolves, its promise does not
reject, `__gsState.error` stays null, and GenomeSpy logs the exception itself so
`pageerror` never fires. Only the absence of data requests gives it away — hence
`drewcheck.ts` counting bytes by URL *path*, since matching the whole URL matched
the harness page's own `&track=….bam` query and credited its 5 kB to the corpus.
The page now also records `zoomed`, `lazyLoaded` and the domain it landed on, so
a future failure says which step stopped.

The ordering looks like an upstream bug rather than a documented constraint, and
it has not been reported.

### Gosling: runs at 19 kb, and cannot reach 100 kb

`crosstool/gosling.html`, with **gosling.js 1.0.7**, on the same BAM through
Gosling's own `bam` fetcher and its `displace`/`pile` transform. 7559 reads and
1.56 MB at the 19 kb window, drawn as a real pileup.

**It is the one arm that needs a build step.** gosling.js ships ESM with bare
specifiers (`react`, `pixi.js`, `higlass`), so unlike igv.js and GenomeSpy — both
of which ship a self-contained bundle `crosstool/` symlinks into place — a
browser cannot load it out of `node_modules`. `make crosstool-bundles` builds
`crosstool/gosling.bundle.js` from the tracked `crosstool/gosling-entry.js`; the
bundle is generated and gitignored, `make serve` depends on it, and the runner
refuses to start without it rather than letting the page paint an empty frame.

Two things the harness settles cheaply that GenomeSpy makes hard:

- **The custom assembly is one line.** Gosling's `assembly` accepts
  `[[name, size], ...]` — its `ChromSizes` form — so `[['chr22_mask', 250001]]`
  is the whole declaration. No genome file is fetched and no built-in is
  involved.
- **The window is declarative.** `xDomain: { chromosome, interval }` works, so
  no post-embed zoom is needed.

**But Gosling draws BAM reads only while the visible tile is at most 20 kb
wide.** `MAX_TILE_WIDTH = 2e4` in its `BamDataFetcher`, compared against every
visible tile by `gosling-track.ts:calculateVisibleTiles`, which returns before
fetching anything. Tile width is the declared genome length over 2^zoom, so the
limit scales with the assembly and not with the file: swept on this 250 kb
corpus, 19 kb draws and 30 kb already does not, and the 100 kb window paints a
full axis and no reads having fetched only the header and the index. The runner
records those cells as `n/a` rather than timing an empty page — under paint
quiescence an empty page settles immediately, so timing it would make Gosling
the fastest tool in the table at the window it cannot render — and
`toolcheck.ts` expects them empty rather than counting them as breakage. Both
generic "did it draw" signals read clean on that page, a painted canvas and
bytes off the disk, which is why the harness counts `rawData` events into
`__goslingState.records` and `drewcheck.ts` reads it.

**So there are two Gosling arms, and the pair is the finding.**
`scripts/crosstool/goslingbundle.ts` builds a second bundle from the same entry
point with that cap and the BAM worker's own 200 kb cap raised past any genome
size, and the runner drives it as `gosling-patched` — the stock column keeps its
`n/a`, because where a tool stops is a result and a patched library is not the
library anyone installs. Two properties of that arm travel with its numbers:

- **The patch asserts before it replaces.** A text patch against someone else's
  build output is the thing that rots silently on a version bump, and a silent
  no-op would hand the runner a "patched" bundle that is stock — at the one
  window where stock draws nothing, under the instrument that reports an empty
  page as fast. Each replacement fails the build unless it matches exactly once.
- **It reads a whole tile, not the window.** At 100 kb it lays out 40002 reads,
  every read in the 20x file, against roughly 16000 in view: the tile HiGlass
  asks for at that zoom covers the contig. Same kind of over-read as GenomeSpy's
  `windowSize` snapping and larger, so the column is an upper bound on what an
  unpatched Gosling would cost at this width even if it could draw it.

**Its BAM parser is the 2023 one.** Gosling 1.0.7 depends on `@gmod/bam`
^1.1.18, `@gmod/bbi` ^3.0.1 and `@gmod/vcf` ^5.0.10 — to the version, the pins
`ecosystem/versions.json` calls the *2023* side. So whatever `ecosystem/`
measures as the parser speedup since 2023 is speedup a Gosling user has not had
yet, which is a stronger statement than any render timing against Gosling and
needs no harness. Re-check it rather than quoting it: a dependency range is not
a lockfile.

**`loadMates` is off, and that is a fairness decision.** Gosling's own pileup
example sets it, which makes the fetcher issue a second pass per read so it can
colour by inferred SV type. Neither igv.js nor JBrowse does that by default, so
the harness default matches them and `?mates=1` is the control that says what it
costs.

### HiGlass: `higlass-pileup` is the way in

**Correction: HiGlass does have an alignments plugin.** `higlass-pileup`
(1.12.2) is a plugin track that reads indexed BAM client-side, so HiGlass does
not need the corpus preprocessed into tiles for the alignment workload after
all. No harness for it has been written yet.

### Both of them read our decoder

`@genome-spy/core` 0.85.0 depends on `@gmod/bam ^7.1.19`, `@gmod/bbi ^9.2.0`,
`@gmod/bed`, `@gmod/indexedfasta`, `@gmod/tabix` and `@gmod/vcf`; gosling.js
1.0.7 depends on `@gmod/bam ^1.1.18`; and `higlass-pileup` 1.12.2 depends on
`@gmod/bam 1.1.8`. Three consequences for how any resulting number should be
read:

- A JBrowse-vs-GenomeSpy BAM comparison largely **isolates the render path**,
  because both sides decode with the same library. The igv.js comparison does
  not: igv maintains its own readers, so it confounds parser and renderer. This
  makes GenomeSpy the more informative of the two comparisons, not the less.
- **Gosling is decoder-controlled the other way.** It reads the same library at
  the version this repo calls the 2023 side, so a JBrowse-vs-Gosling number
  carries six majors of parser difference on top of the renderer difference. The
  parser half of that gap is what `ecosystem/` measures directly, so read the
  render column as an upper bound on Gosling's renderer and not as one.
- `higlass-pileup` pins `@gmod/bam` 1.1.8, same era as Gosling, against
  GenomeSpy's 7.x. Say so rather than presenting the four as one matrix.

### Cross-tool pan, and the instrument it needed

`scripts/crosstool/panrunner.ts` → `results/crosstool-pan.md`. Scroll sideways
one full viewport at constant scale, five steps, from the benchmark window. This
is the cross-tool measurement the cold-load matrix was missing: cold load is
dominated by application boot and assembly resolution, which say nothing about a
renderer, and the zoom result below is a JBrowse debounce rather than JBrowse's
pixels. A pan runs against an application that is already up.

**GenomeSpy is an arm here since 2026-09-02**, on both motions, driven through
`getScaleResolutionByName('pos').zoomTo(interval)` — the same API
`crosstool/genomespy.html` already uses to reach the benchmark window, and not
animated, so what it times is a redraw. It is the column that isolates the
renderer, since `@genome-spy/core` decodes BAM through the same `@gmod/bam` this
build does, and the narrow one: 0.85.0 has no CRAM lazy source, so its CRAM
cells read `n/a` rather than a timing. Every foreign arm's per-step loci are now
cross-checked against JBrowse's, not igv's alone.

**Paint quiescence cannot resolve it.** The screenshot detector needs six
samples at best, and one `page.screenshot()` on this box measures anywhere from
43 to 161 ms, putting its own floor between roughly 450 and 1100 ms — against
pans of about that length. Steps duly came back resolved in exactly the minimum
six polls, reporting numbers made almost entirely of instrument.

So `scripts/crosstool/drawclock.ts` patches the canvas drawing APIs and
timestamps every call — the platform, not the application. That alone is still
wrong: JBrowse re-projects the reads it already holds in a millisecond or two,
then goes quiet while it fetches, then draws again, and a draws-only detector
stops at the first gap and reports **1.4 ms**. The gate is therefore *draws
quiet **and** nothing in flight*, with the network side read from CDP because
JBrowse fetches in a worker and a page-side `fetch` hook would see igv's requests
and none of JBrowse's.

**The detector now has its own harness**, because it has been the thing that
breaks: `scripts/crosstool/quiescheck.ts` → [`results/quiescence.md`](results/quiescence.md)
runs the strategies against each other on both harnesses and reports where they
disagree. It has already corrected two claims made on this page. Screenshot cost
was first attributed to the page (43 ms JBrowse, 161 ms igv); a run on a busier
box measured the opposite assignment (157 / 49), so what varies is the machine.
And the natural story that draws read early and paint reads late is false on a
JBrowse cold load, where draws read 4792 ms against paint's 2346 ms — the page
keeps issuing draw calls after the visible result has settled.

**A pan is not automatically the "both tools fetch" case, so the run counts.**
JBrowse reads 256 KiB blocks, so at low coverage a one-viewport pan can land
inside what it already holds — at 20x-shortread, 3 of 5 steps issue no request at
all, while igv's never do. The headline table is restricted to steps where that
tool actually fetched, and the per-step table shows the rest.

Read that column with the detector's history in mind. A cache hit and a step the
detector abandoned before the fetch started look identical from the outside, and
the first version of this instrument confused them: at 1000x it reported 3 of 5
steps cached where the true answer is **none** — every step fetches 6.5 MB. What
separates them is the draw count. A genuine cache hit still shows a full 42–50
draw burst; an abandoned step shows the 10-draw re-projection of stale content
and nothing else.

Figures: `Rscript scripts/paperfigs/perf-interaction.R` →
`results/figures/paper/perf-interaction.pdf` (zoom and pan), drawn from the
run's JSON so a slide cannot quote a number no run produced. The zoom-redraw
figure that used to sit beside it went with `scripts/crosstool/panchart.R` on
2026-09-02; the draw counts it plotted are still recorded in
`results/crosstool-pan.md`. What replaced it on 2026-09-02 is
`perf-crosstool-zoom.R`, which plots the draw burst's **duration** rather than
the count — the count was flat by construction, since a batched renderer issues
a fixed handful of calls whatever the depth.

**The numbers live in [`results/crosstool-pan.md`](results/crosstool-pan.md) and
are deliberately not repeated here.** An earlier draft of this section did copy
the table in, and it was stale inside an hour — which is the same argument the
ecosystem benchmarks make for generating their prose from the run.

The shape, from the clean run of 2026-08-16: **the two tools cross between 20x
and 200x short read.** igv is faster at 20x; JBrowse is several times faster at
200x and an order of magnitude faster at 1000x. igv's pan cost tracks read count
almost exactly — a 50× rise in coverage buys a 50× rise in time — while
JBrowse's rises under 3× over the same range. An earlier version of this section
claimed JBrowse led everywhere; that came from the detector bug below, which
truncated JBrowse's steps and flattered it.

The per-step table still counts canvas draw calls, and the count is the most
reproducible number in the file — it repeats to within ~1% across runs, because
it depends on the data and the code rather than on the machine. It does two jobs
worth having: it separates a genuine cache hit from a step the detector abandoned,
and at `samplingDepth=10000` it shows igv is not winning any row by drawing less.

**It was also a figure, and it should not have been.** Until 2026-08-24
`panchart.R` drew draws-per-step as a chart of its own: a JBrowse line pinned
flat near 50 at every coverage against an igv line at a quarter of a million, on
a log axis spanning four decades. A batched renderer issues a fixed handful of
GPU draws whatever the depth, so that flat line is a description of which drawing
API each tool calls and not a result either one earned — and drawn at that scale
it read as the headline. The figure is gone; the column stays where its two jobs
are.

## The zoom, and the timer inside it

The zoom is measured again, on the same draws-and-network clock as the pan:
`MOTION=zoom node scripts/crosstool/panrunner.ts` → `results/crosstool-zoom.md`.
It replaces `zoomrunner.ts`, which polled screenshots every 100 ms, could not
resolve anything faster than that, and published a number the README had to
retract. What was wrong was the instrument and not the interaction.

**Nothing refetches on a zoom.** Across all 60 cells of the run of record — three
JBrowse arms and two igv arms over twelve cases — not one issued a data request
on any zoom step. Both tools hold the surrounding window client-side, so every
difference below is a difference in drawing and not in network. An earlier
version of this section predicted the old renderer would refetch; it does not.

**This column read a flat 504–532 ms until 2026-09-04, and that number was the
benchmark rather than the browser.** `zoomTo` is the per-frame chokepoint a
gesture writes through, and it leaves the coarse blocks on their 500 ms
`LGVCoarseDynamicBlocks` throttle deliberately — flushing sixty times a second is
the cost the throttle exists to avoid. Every discrete placer in the LGV model
ends with `settleCoarseBlocks`, and a benchmark step is a discrete jump, so the
runners take that path now. Driven bare, the benchmark timed the throttle
coalescing a gesture that never arrived, on a path no UI control takes; it also
made JBrowse the only arm entering a throttle at all, since igv is driven by
`zoomIn` and GenomeSpy by `zoomTo(interval)`, both discrete.

**The current build now reads 7–30 ms, and it rises with coverage** — 7 ms at
20x short read, 19 ms at 200x long read, 29 ms at 1000x long read. That is the
shape of work, where the old column was flat across a fifty-fold range because a
constant dominated everything the GPU was doing.

The releases have no such constant and pay real cost instead: v4.3.0 and v2.4.0
run about 1.1 s at 20x short read and **9.0 s and 5.9 s at 1000x long read**. igv
waits for nothing and spends its whole number drawing, from 47 ms at 20x short
read to 1.2 s on the long-read cases.

So the comparison no longer splits. **The current build is fastest in every cell
of the matrix, by 6.9× over igv at 20x short read and 64.7× at 200x long read.**
Until this was fixed the honest statement was the opposite one — that igv won
every short-read case, because half a second of constant loses to real work when
the work is small — and that half second was ours, not the browser's.

**Read the GenomeSpy column before quoting the igv one.** GenomeSpy returns a
flat 9 ms and is *faster* than the current build at 200x and 1000x long read
(9 ms against 19 and 29 ms). It is the arm that isolates the renderer, because
`@genome-spy/core` decodes BAM through the same `@gmod/bam` this build reads
through, where the igv columns confound parser with renderer. It is also the
narrower comparison: 0.85.0 has no CRAM lazy source, so half the matrix reads
`n/a`, and it fails to come up at all on `1000x-longread-bam` — 0/3 runs on
2026-09-04 at a 120 s ceiling, after 0/3 on 2026-09-03 at 180 s, which is a tool
limit rather than a harness timeout.

The report prints two tables and the figure two lines per tool — what the user
waits for, and what the renderer did — because quoting either alone is how this benchmark
went wrong the first time. Read the redraw table with its dagger: the block
renderer paints in a worker and the main thread blits the tiles, so `drawclock`
times a composite for the two release arms and not a render. v2.4.0 reads 0.1 ms
there, underneath a wait of seconds.

Figure: `Rscript scripts/paperfigs/perf-crosstool-zoom.R` →
`results/figures/paper/pdf/perf-crosstool-zoom.pdf`, two stacked panels because
the run measures two different numbers and only some arms have both. The top
panel is the wait, one line per arm and one legend; every JBrowse arm sits above
igv.js and GenomeSpy on this motion, and the axis says so without help from the
caption. The bottom panel puts the drawing under the wait for the current build
and igv.js alone — a figure has no dagger to hang the worker caveat on, and left
in, the release arms would sit at the bottom of it as the fastest renderers on
the page. Drawn as one panel the two measures needed two legends and a fourth
decade of axis for a 500 µs dashed line, and the reader had to work out which
arms the dashed keys applied to.

What the figure is for is the comparison neither the JBrowse-only
`perf-interaction.pdf` nor the cold-load matrix can make: igv.js does not pay a
multi-second zoom either, so what the old block renderer cost on this motion was
JBrowse's and not the web's.

At rest the page is idle: 95.7% idle over a 6 s CPU profile, ~1 ms of
JavaScript, no draws. [`flame/ZOOM_SETTLE.md`](flame/ZOOM_SETTLE.md) has the
numbers, and the retraction of an earlier version of this section that reported
an at-rest re-render loop — which was `zoomdiag.ts`'s own **clipped**
screenshots perturbing the page. A clipped capture behaves like a resize (90
induced draws in a direct test) where a full-viewport one does not (0), so
`zoomprofile.ts` and `paintprofile.ts` are unaffected and `zoomdiag.ts` grew a
`NO_SHOTS=1` mode:

```bash
NO_SHOTS=1 node scripts/crosstool/zoomdiag.ts "<url>"           # real activity
NO_SHOTS=1 NO_ZOOM=1 node scripts/crosstool/zoomdiag.ts "<url>" # at rest: silent
node scripts/crosstool/restprofile.ts "<url>" rest 6000         # idle CPU profile
```

igv.js's numbers *fall* across successive steps as its visible read count drops,
which is the shape a CPU redraw should have.

Caveats to attach to any external claim: it is one other tool, on one workload
family (alignment pileups), at one locus, on one machine. igv.js parses in the
main thread and JBrowse in workers, and JBrowse boots a full application shell
where igv.js mounts a widget — both are real architectural differences and both
are inside the number, which is why the light rows and the heavy rows say
different things.

## Row sweep — runnable, no run of record yet

`scripts/render/rowsweep.ts` sweeps row count on a multi-sample variant matrix,
recording ready time and rAF frame gaps as rows are added with region and
variant count fixed.

```bash
bash shell/generate_rowsweep.sh                  # fixture: 100…2504 samples, one variant set
node shell/load_rowsweep.js builds/current       # symlink + register the tracks
npx http-server builds/current -p 8000 -s --cors &
node scripts/render/rowsweep.ts                  # ~6 sizes x 3 passes
```

Three things it needed before it could say anything, all now in place. Its
**fixture** did not exist: it opened `mapt_<n>` on hg19, which no build here
serves. `shell/generate_rowsweep.sh` now emits the same 317-variant callset over
the standard `chr22_mask:124000-143000` window at six sample counts, so the only
thing varying across cells is rows. Its **URL form** was a `session=spec-…`
object no runner here uses; it now opens tracks the way `runner.ts` does. And
its **instrument** was the vsync-paced rAF gap, which floors at 16.7 ms:
`--disable-gpu-vsync --disable-frame-rate-limit` are now passed by default, with
`--vsync=on` to get the paced instrument back for comparison.

What it still needs is **an idle box**. Validation runs on 2026-08-11 sat at load
50–65, where the frame column measures contention rather than rendering: at 100
rows the frame median moved 10.4 → 17.4 ms across runs minutes apart. Ratios
across row counts are the robust part, and the runner now interleaves the sizes
and alternates their order pass to pass so that drift cannot align with row
count — but no output has been kept as a result, on purpose. Check
`pgrep -c claude` before believing anything it prints.


## Coarsened PIF: what the tier costs, and what it costs in accuracy

`jbrowse make-pif` writes each alignment twice more, under `T`/`Q`, with the
CIGAR replaced by a coarse CIGAR (`cr:Z:`): indels longer than half the
`--coarse` bound kept, and one straight run between each pair. A whole-genome
synteny view reads that tier instead of the full-CIGAR one. Two questions
follow, and `make pif PIF=<file.pif.gz>` answers both.

**What does reading a tier transfer?** `scripts/pif/coarsening.ts` unions the
compressed byte intervals the Tabix index gives each prefix, so the answer comes
from the index and needs no download. It reads a sample of records back and
reports which alignment strings that prefix carries, because the coarse tier's
format changed on 2026-09-02 -- before it, a coarsened record had no alignment
string at all and was roughly half the size -- and a byte count means a
different thing either side of that.

**How far does a coarsened record draw from the alignment it stands for?** A run
is a straight line, so every ribbon edge and every location marker inside one is
interpolated. `scripts/pif/deviation.ts` walks every full CIGAR in the file and,
at each vertex of the real path, measures how far the coarsened path sits from
it on the other genome, in pixels at the zoom the tier is served. A kept indel
is a vertical step in the coarse path, so a vertex anywhere on it scores zero --
which is what keeping the indel buys.

It measures a second encoding beside it: cut at every large indel and drop the
CIGAR, which is what `rb break-paf` produces upstream of a CIGAR-less writer and
what PIF's own coarse tier used to do. Nothing there bounds what the
sub-threshold indels left in place do to the straight line across a piece, and
the comparison is the point rather than a strawman.

On the UCSC hs1-to-mm39 liftOver chains, 75,076 records:

| encoding | median | p99 | worst | records past the bound |
| --- | ---: | ---: | ---: | ---: |
| coarsened (`cr:Z:`) | 0.002 px | 0.45 px | **0.87 px** | **0** |
| split at large indels, CIGAR dropped | 0.002 px | 0.93 px | 7.12 px | 612 |

The bound holds on every record; the alternative leaves it on 0.8% of them, by
as much as seven pixels. `scripts/paperfigs/pif-deviation.R` draws the record
where the coarsened encoding is at its worst.

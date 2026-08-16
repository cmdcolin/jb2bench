# jb2bench

Benchmarks for JBrowse 2, at two layers:

- **The browser** — how fast a track renders and how it behaves under
  interaction, comparing the `webgl-poc` branch (GPU/WebGL2 renderer) against
  released versions (old block renderer). That is what this directory measures.
- **The parser libraries underneath it** — `@gmod/bam`, `cram-js`,
  `bgzf-filehandle`, `@gmod/bbi`, `@gmod/vcf`, `gff-nostream`, comparing the
  versions JBrowse 2 shipped at the 2023 paper against current releases. That lives in
  [`ecosystem/`](ecosystem/README.md) and has its own README.

Both layers read the same corpus in `data/`, so the parse numbers and the render
numbers describe the same bytes.

## Layout

| path | what |
| --- | --- |
| `data/` | the corpus: reference + simulated alignments (see below) |
| `scripts/render/` | the render and zoom-interaction benchmarks |
| `scripts/flamegraph/` | CPU-profile capture and the flamegraph toolkit |
| `scripts/ld/` | the WebGPU LD compute-shader benchmarks (unrelated to render) |
| `scripts/crosstool/` | the igv.js comparison: paint-quiescence profiler and matrix |
| `crosstool/` | the igv.js and GenomeSpy harness pages, plus symlinks to `data/` and the tool bundles |
| `scripts/probe.ts`, `scripts/gpucheck.ts` | dev helpers: render testids, GPU backend |
| `shell/` | regenerate the corpus (alignments and variants), load it into the builds |
| `builds/` | the jbrowse-web builds under test (untracked, staged by hand) |
| `results/` | every measured table, plus the raw JSON and run logs behind it |
| `flame/` | CPU profiles and the findings drawn from them |
| `ecosystem/` | the parser-library benchmarks, self-contained |
| `screenshots/` | puppeteer verify/probe output (untracked) |

## Where the conclusions are

Every number lives in a file; nothing is summarized only here.

| document | question it answers |
| --- | --- |
| [`results/alignments.md`](results/alignments.md) | how long does a cold initial render take? |
| [`results/interaction.md`](results/interaction.md) | how long does a zoom make you wait? |
| [`results/interaction-cpu.md`](results/interaction-cpu.md) | where does per-frame main-thread time go during a zoom? |
| [`results/crampool.md`](results/crampool.md) | does @gmod/cram's slice worker pool make a pan faster? (no run of record yet) |
| [`results/ld-gpu-vs-cpu.md`](results/ld-gpu-vs-cpu.md) | is the LD compute shader worth it vs the CPU path? |
| [`results/ld-dispatch-limit.md`](results/ld-dispatch-limit.md) | where does the LD dispatch break, and how loudly? |
| [`flame/FINDINGS.md`](flame/FINDINGS.md) | why is 1000x-shortread a regression? |
| [`flame/ZOOM_SETTLE.md`](flame/ZOOM_SETTLE.md) | why does a zoom take 0.8 s to stop changing? |
| [`flame/WORKER_FINDINGS.md`](flame/WORKER_FINDINGS.md) | which worker-side plugin optimizations are worth doing? |
| [`results/crosstool.md`](results/crosstool.md) | how does the render time compare against igv.js? |
| [`results/crosstool-pan.md`](results/crosstool-pan.md) | and how does a *pan* compare, with startup out of the number? |
| [`results/quiescence.md`](results/quiescence.md) | which completion detector, and what does being wrong cost? |
| [`ecosystem/README.md`](ecosystem/README.md) | how much faster did the parser libraries get since 2023? |
| [`ecosystem/results/sweep.md`](ecosystem/results/sweep.md) | *where* along the majors did the parsers get faster? |
| [`ecosystem/results/cohort-bw.md`](ecosystem/results/cohort-bw.md) | what does a 100-sample BigWig panel cost to open? |
| [`ecosystem/results/vcf-scan.md`](ecosystem/results/vcf-scan.md) | what did the @gmod/vcf 7.2.0 genotype-scan rewrite buy? |
| [`ecosystem/results/gff3-lazy.md`](ecosystem/results/gff3-lazy.md) | is deferring GFF3 attribute parsing worth it, and to whom? |

## The corpus

`data/` holds one reference and the alignments simulated against it. All of it
except the reference is untracked and regenerable — roughly 750 MB.

- `hg19mod.fa` (+ `.fai`) — a 250 kb slice of hg19 chr22, contig `chr22_mask`.
  Tracked; it is the input everything else is derived from.
- `*.bam` / `*.cram` (+ indexes) — simulated alignments at 20x / 200x / 1000x
  coverage, short reads (wgsim) and long reads (pbsim).
- `*.longread.mod.bam` (+ indexes) — the long-read alignments with MM/ML
  base-modification tags stamped on: CpG-context 5mC, bimodal probabilities,
  seeded. Built by `shell/generate_modbam.sh` from the plain files, so a
  mod-vs-plain comparison differs by the tags and nothing else, and checked by
  `shell/verify_modifications.js`, which decodes MM back against each read
  independently of the generator. 20x and 200x only — the tags grow a long read
  by roughly a quarter, and 200x already carries 841k modification calls.
  Until 2026-08-11 there was no modBAM here at all, so the base-modification
  path was exercised by nothing; the first profile of it found one function
  taking a third of the RPC worker (`flame/WORKER_FINDINGS.md`).
- `*.bw` — BigWig coverage tracks at the same coverages. Unused by the
  alignments benchmark, but they are the corpus the GenomeSpy harness reads,
  since signal is the only workload a tool with no alignment track can share
  with igv.js and JBrowse. `test.bw` is a byte-identical copy of
  `200x.shortread.bw`, kept as a generic fixture name.
- `R103.model` — the pbsim error model for the long-read simulation. Tracked.
- `hg19_17.chrom.sizes` — chr17's size, left over from the variant-matrix work.
  Nothing in this repo currently reads it.

The benchmark window throughout is `chr22_mask:124000-143000` (19 kb), which
matches the historical jb2profile region.

## The benchmarks

### Initial render

`scripts/render/runner.ts` → `results/alignments.md`. Cold-start
navigation→render-complete time, median of 6 runs after a warmup.

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

### Zoom interaction

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

The metric is **time-to-content**: milliseconds a loading indicator is shown
after an interaction before correct content returns, driven through
`window.JBrowseSession` (both builds expose it). `MODE` selects what the
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

### CRAM slice worker pool, on vs off

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

### Per-frame interaction cost

`scripts/flamegraph/interaction-profile.ts` → `results/interaction-cpu.md`. Not
time-to-content but the per-frame main-thread cost of a sustained gesture, with
`THROTTLE=n` to emulate slower machines. The finding: frames are bound by React
re-render plus CSS-in-JS serialization, not by MobX or by the GPU draw.

### LD compute shader

Unrelated to the render benchmarks. These measure the **WebGPU compute** kernel
behind the LD display (`plugins/variants`), the one GPGPU path in JBrowse. They
read the shipped WGSL straight out of the committed `ldCompute.generated.ts` in
`$JBROWSE` (default `~/src/jbrowse-components`), so they always test what the app
ships. No JBrowse build or server needed.

```bash
node --experimental-strip-types scripts/ld/ldbench.ts [numSamples] [maxN]
node --experimental-strip-types scripts/ld/ldlimits.ts [--1d]
```

**`ldbench.ts`** → `results/ld-gpu-vs-cpu.md`: GPU vs a CPU mirror of
`computeLDMatrixCPU`. GPU wins 12–37× across the measured range. It also shows
`MIN_WORK = 500_000` is a *conservative* gate, not a break-even one — at 495,000
work units the GPU is still ~4× ahead.

**`ldlimits.ts`** → `results/ld-dispatch-limit.md`: the dispatch ceiling. One
thread per matrix cell, 64/workgroup, and `maxComputeWorkgroupsPerDimension` is
65535 → a 1D dispatch dies at **2897 variants**. Worse, it dies *silently*: the
over-limit dispatch is an async validation error, so nothing throws, `mapAsync`
still resolves, and the readback is an all-zero matrix that reads as "no LD
here". Run with `--1d` to reproduce the pre-fix behaviour (zeros past n=2896,
max diff 3.5e-1 vs the CPU reference); without it the shipped 2D dispatch stays
correct to ~4e-7.

Two gotchas if you write more WebGPU here:

- **WebGPU needs a secure context.** On `about:blank`, `navigator.gpu` is
  `undefined` — indistinguishable from "no WebGPU support". `scripts/ld/ldkernel.ts`
  serves a blank page over `http://localhost` for this reason. `scripts/gpucheck.ts`
  evaluates on the default `about:blank` and so reports `navigator.gpu: false`
  even on this box, which does support it.
- **WebGPU needs the Vulkan ANGLE backend here** (`--use-angle=vulkan`), not the
  `--use-angle=gl` the WebGL benchmarks use. This box exposes an `amd gcn-4`
  adapter to WebGPU, distinct from the Mesa Intel UHD 630 the WebGL path names.

### Cross-tool: JBrowse vs igv.js

`scripts/crosstool/runner.ts` → `results/crosstool.md`. The only comparison here
that leaves the JBrowse family. Both tools read the same indexed BAMs out of
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
RUNS=3 node scripts/crosstool/runner.ts          # → results/crosstool.{md,json}
TOOLS=igv-h600ctl,igv-h300 CASES=200x-shortread node scripts/crosstool/runner.ts
node scripts/crosstool/zoomrunner.ts             # → results/crosstool-zoom.{md,json}
RUNS=3 node scripts/crosstool/panrunner.ts       # → results/crosstool-pan.{md,json}
```

#### igv.js is now version-selectable

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

#### GenomeSpy: BAM harness written, does not render yet

`crosstool/genomespy.html`, with `@genome-spy/core` pinned to **0.82.0** — the
version the paper's design-space table was source-verified against, deliberately
not `latest`.

**Correction to an earlier note here: GenomeSpy does read alignments.** It has a
native `bam` lazy data source (`src/data/sources/lazy/bamSource.js`, present in
0.82.0), so the comparison can be run on the *same* BAM workload as igv.js and
JBrowse rather than being pushed onto signal. Its transform registry carries
`pileup`, `alignmentMismatches`, `flattenCigar` and `coverage`, so read layout
and mismatch drawing are available too. The harness uses `pileup` to assign
lanes, because comparing a laid-out stack against a single overplotted row would
not be a comparison.

**It draws nothing.** `embed()` resolves and a canvas is created, but a
`readPixels` sample of the plot area returns one distinct color, and the console
carries `Error: Genome hg19mod has not been loaded yet. Call
ensureAssembly("hg19mod")`. What has been ruled out:

- Not a spec-shape problem in the genome declaration. Four forms were tried —
  root `genome: {name, contigs}`, root `genomes` + root `assembly`, `genomes` +
  per-channel `scale.assembly`, and an inline object as `scale.assembly` — and
  all four `embed()` without rejecting.
- Not the root `scales` block, though that *was* one real bug: putting the
  domain there instead of on the channel's own scale creates a scale resolution
  the assembly preflight does not walk. Fixed; the domain is on the channel now.
- Not a version issue. 0.84.0 behaves identically.
- Not specific to a custom assembly: substituting the built-in `hg38` still
  produces the error once.
- Not a missing file. The only 404 in the run is `favicon.ico`.

Reading the bundle, `assemblyPreflight` is awaited inside the embed path, but
`BamSource` touches `this.genome` from its constructor, which runs earlier
during view creation. That is a plausible account and **not a verified one** —
GenomeSpy's own published BAM example presumably works, so the difference is
something in our spec or our environment that has not been identified yet. Do
not report this as an upstream bug on the strength of what is written here.

The corpus is a 250 kb slice under a made-up contig name (`chr22_mask`), which
is worth knowing before debugging further: there is no published `chrom.sizes`
to point at and no built-in assembly that matches, so this harness exercises
GenomeSpy's inline-genome path, which its examples do not.

#### HiGlass: `higlass-pileup` is the way in

**Correction: HiGlass does have an alignments plugin.** `higlass-pileup`
(1.12.2) is a plugin track that reads indexed BAM client-side, so HiGlass does
not need the corpus preprocessed into tiles for the alignment workload after
all. No harness for it has been written yet.

#### Both of them read our decoder

`@genome-spy/core` 0.82.0 depends on `@gmod/bam ^7.1.19`, `@gmod/bbi ^9.2.0`,
`@gmod/bed`, `@gmod/indexedfasta`, `@gmod/tabix` and `@gmod/vcf`, and
`higlass-pileup` 1.12.2 depends on `@gmod/bam 1.1.8`. Two consequences for how
any resulting number should be read:

- A JBrowse-vs-GenomeSpy BAM comparison largely **isolates the render path**,
  because both sides decode with the same library. The igv.js comparison does
  not: igv maintains its own readers, so it confounds parser and renderer. This
  makes GenomeSpy the more informative of the two comparisons, not the less.
- `higlass-pileup` pins `@gmod/bam` 1.1.8 against GenomeSpy's 7.x, so a HiGlass
  number is *not* decoder-controlled in the same way — it would carry six major
  versions of parser difference. Say so rather than presenting the three as one
  matrix.

#### Cross-tool pan, and the instrument it needed

`scripts/crosstool/panrunner.ts` → `results/crosstool-pan.md`. Scroll sideways
one full viewport at constant scale, five steps, from the benchmark window. This
is the cross-tool measurement the cold-load matrix was missing: cold load is
dominated by application boot and assembly resolution, which say nothing about a
renderer, and the zoom result below is a JBrowse debounce rather than JBrowse's
pixels. A pan runs against an application that is already up.

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
JBrowse reads 256 KiB blocks, so some of its pan steps are served from what it
already holds; igv's never were. The headline table is restricted to steps where
that tool actually issued a request, and the per-step table shows the rest.

**The numbers live in [`results/crosstool-pan.md`](results/crosstool-pan.md) and
are deliberately not repeated here.** An earlier draft of this section did copy
the table in, and it was stale inside an hour when the next run moved the ratios
— which is the same argument the ecosystem benchmarks make for generating their
prose from the run. What is worth stating here is the shape, because that has
held across every run so far: JBrowse ahead on both short-read cases, by a
little at 20x and by roughly an order of magnitude at 200x.

The mechanism behind the widening gap is in the per-step table, and it is the
sturdiest figure in the file: **canvas draw calls per step repeat to within ~1%
across runs**, because they depend on the data and the code rather than on the
machine. Like the parser request counts, they survive a contaminated run. Three
to four orders of magnitude separate a tool drawing through the 2D canvas API
from one batching the pileup into a handful of GPU draws.

It is **not** one call per read — about 30 per read at 20x and 8 at 200x, so the
count grows much more slowly than the read count, and nothing here explains that
shape. Quote the magnitude, not a per-read rate.

### The zoom result is not what it looks like

`results/crosstool-zoom.md` says igv.js settles a 2x zoom-in in ~340 ms against
JBrowse's ~800 ms. **That is not a drawing comparison.** Measured from inside the
page with no screenshots at all, JBrowse's real post-zoom tail is 505 ms — 505,
505 and 506 ms across three runs, which is a timer and not work. It is the
500 ms `LGVCoarseDynamicBlocks` autorun; the track's own pixels are correct at
the first frame. The rest of the 0.8 s is `zoomprofile.ts` under-subtracting its
own settle window, since each poll costs a screenshot.

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

### Row sweep — runnable, no run of record yet

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

## Builds compared

`builds/` is untracked — each entry is a deployed `jbrowse-web` build plus
symlinks into `data/`, staged by hand and wired up with
`shell/load_alignments.sh`.

| build | what it is |
| --- | --- |
| `current` | `jbrowse-components` HEAD, copied from `products/jbrowse-web/build`. The first build in `runner.ts`. |
| `webgl-poc` | the original branch build (Jun 13) the June numbers and all the flame profiles come from |
| `webgl-poc-current` | a fresh build of the same branch (2026-07-10), used for `results/interaction-cpu.md` |
| `webgl-poc-fixed` | the branch plus the tooltip-clear-on-zoom fix `ce1e168b71`, measured perf-neutral |
| `release-4.3.0` | last release, old block renderer — the baseline every speedup is against |
| `release-4.1.15` | older release, for the release-over-release trend |
| `release-2.4.0` | **the version the 2023 Genome Biology paper describes** — see below |

### `release-2.4.0`, the published baseline

Added 2026-08-11. Every other baseline here is a recent predecessor, which
answers "what did this release change" and not "what has changed since the
version people have read about". The 2023 paper archived its own source as
JBrowse v2.4.0 (Zenodo `10.5281/zenodo.7710472`) and benchmarked "jb2 parallel
(v2.4.0)", so v2.4.0 is the version in the literature and the right thing to
measure against.

No build from source is needed, which is worth knowing before anyone tries:
the release still ships a prebuilt web bundle.

```bash
curl -L -o /tmp/jb-web-2.4.0.zip \
  https://github.com/GMOD/jbrowse-components/releases/download/v2.4.0/jbrowse-web-v2.4.0.zip
mkdir -p builds/release-2.4.0 && unzip -q -o /tmp/jb-web-2.4.0.zip -d builds/release-2.4.0
./shell/load_alignments.sh        # wires the assembly + 12 alignment tracks
```

**A 2026 `jbrowse` CLI config does load in the 2023 build** — this was the risk
and it was checked rather than assumed. Serving `builds/release-2.4.0` and
opening `?loc=chr22_mask:124000-143000&assembly=hg19mod&tracks=20x.shortread.bam`
in headless Chrome renders the ruler and the track with six canvases and zero
console or page errors. The build stamps `main.05f7e6e1.js`, unique against
every other `builds/*`, so `servedbuild.ts` resolves its name correctly and no
runner change was required.

**The corpus already matches the 2023 paper's**, which is why this comparison is
worth anything: that paper generated reads over `chr22:25,000,000-25,250,000` on
hg19 with `pbsim --depth 1000 --hmm_model data/R103.model --length-mean 50000`
and `wgsim -1 150 -2 150 -N 1000000`, and `shell/generate_alignments.sh` uses the
same 250 kb slice and the same two invocations. `runner.ts`'s 19 kb window
carries a comment saying it matches the historical `jb2profile`.

**First measured 2026-08-13, and every row of it is over the load ceiling.** The
run was made to a deadline on a box sitting at load 7–28 from unrelated work, so
`results/alignments.md` marks all four re-measured rows `unusable` and none of
the absolute milliseconds should be quoted. What survives is the *ratio*: the
four builds are measured back to back inside each case, so a load spike lands on
all of them at once rather than on one column. Read against v2.4.0 those ratios
were 2.0× (1000x-shortread), 2.4× (20x-shortread) and 3.6× (200x-longread).

The cold-load measurement on an idle box is still owed, and it is the one worth
having, since a contaminated row can only be re-run and not repaired.

**It is wired into both runners** on port 8004 — `runner.ts` (cold load) and
`runner-interaction.ts` (zoom, zoom-out, pan) — and appears as an extra column
in `results/alignments.md` and all three tables of `results/interaction.md` on
the next run.

In the interaction runner the role is **optional**: if nothing is served on
8004 it logs `published: port 8004 not served, skipping (optional)` and emits
the old two-column tables. The other roles stay required, because a missing
baseline is a broken run rather than a smaller one. Both paths were checked with
`MODES=none`, which rebuilds the report from recorded JSON without measuring;
with 8004 up, unmeasured cells print `—` rather than an empty column.

Zoom is where this column is most worth having. Cold load is fetch-dominated
and compresses three years into a small ratio, whereas zoom-in is the case the
architecture actually changed.

**Read that column as cumulative, not as a second isolation.** Three years of
change separate 2.4.0 from HEAD, and almost none of it is the renderer. 4.3.0 is
the column that isolates this release; 2.4.0 is the column that tells a reader of
the 2023 paper what the intervening period bought them. The two answer different
questions and the report should not present them as one gradient.

Expect cells to fail rather than to be slow. `profile.ts` caps a run at 120 s, so
a 2023 build that cannot finish 1000x longread will error that cell — which is
itself a result, and should be printed the way igv.js's censored rows are rather
than quietly dropped.

**Port 8000 means "whichever new build you are testing."** The runners no longer
guess which one that is: each fetches the served `index.html`, matches its
content-hashed bundle against `builds/*/index.html`, and labels the column with
the build directory it actually found (`scripts/render/servedbuild.ts`). A port
serving something that is not in `builds/` aborts the run rather than producing a
table whose headers are a guess.

That check exists because the guess was wrong. Both runners used to hardcode a
name for port 8000 — and disagree about it, `current` vs `webgl-poc`. On
2026-08-05 port 8000 was serving `builds/current`, so `results/interaction.md`
attributed a correct measurement to `webgl-poc`, a different build. `current`
does ship the WebGL2 renderer, so the comparison itself stood; only the name was
wrong. The tables now name `current`.

> WebGPU note: the branch's default ladder is WebGPU → WebGL2 → Canvas2D.
> WebGPU initializes on this Intel UHD 630 / Vulkan / Dawn stack but emits
> texture-allocation validation errors, so the benchmark pins WebGL2 via
> `?renderer=webgl` — the stable path, and the realistic fallback most users hit
> today. Releases ignore the parameter.

## How the measurement is kept fair

This repo replaces `~/src/dont_care/jb2profile`, whose puppeteer scripts were
overfit to the old block-based DOM: they waited for an exact
`BLOCKS_PER_TRACK * n` count of `pileup-overlay-normal` / `wiggle-rendering-test`
blocks. The new branch paints a single canvas per display, so block counting no
longer applies. The first three points below follow from that; the rest are
lessons from measurements that turned out to be measuring the wrong thing.

- **Render-complete detection spans two disjoint contracts, and it says which
  one it used.** `scripts/render/profile.ts` waits for *quiescence*, but what
  counts as a render-complete marker depends on the build's vintage. Verified
  against `builds/` on 2026-08-12:

  | build          | signal                                             |
  | -------------- | -------------------------------------------------- |
  | release-4.3.0  | 4 × `[data-testid$="-done"]`, no phase attributes   |
  | current main   | `[data-display-phase]` + `[data-display-drawn]`     |

  There is **no overlap**, so the old marker-only detector this file used to
  describe finds nothing on a build from current main and every such row times
  out at 120 s. The detector now picks the contract inside the poll — sampling
  it beforehand does not work, since at that moment no display has mounted — and
  prints `render-complete contract: phase|legacy` on stderr so a row measured
  under a different contract from its neighbours is visible rather than silently
  incomparable.

  Guessing wrong does not error, which is why this matters: the unmatched
  selector makes the wait return immediately, and the build reports a render
  time near zero. On a baseline column that quietly shrinks every speedup in the
  table.

- **The loading-indicator wording is version-dependent too, and missing it reads
  as a perfect score.** `scripts/render/interaction.ts` decides that content is
  back when no loading indicator is on screen, so an indicator it does not
  recognize is indistinguishable from an interaction that never blocked. The
  detector matched `/Downloading|Loading alignments|Rendering/`; release-2.4.0
  labels a refetching block plain **`Loading`** and its worker step
  **`Serializing results`**, neither of which that pattern catches. Measured on
  2026-08-13, the 2023 build therefore scored **0 ms on every zoom-in case** —
  the same as the GPU branch, and the strongest-looking result in the table was
  the instrument failing. With the pattern widened, the same cell reads 3366 ms
  on 200x-longread.

  The direction of the error is what makes it dangerous: an unrecognized
  indicator can only ever make a build look *faster*, and it lands hardest on
  the oldest build in the matrix, which is the one whose wording is least likely
  to match. Widening was checked against the other columns rather than assumed
  safe — at rest `builds/current` carries no `Loading` text at all and a zoom-in
  adds no blocks to it, so its 0 ms rests on its own evidence and did not move.

- **A positive gate runs before any of it.** Every signal above is negative — no
  overlay, no unpainted display, no unstable count — so all of them pass on a
  page whose JavaScript never ran. `profile.ts` first waits for
  `window.JBrowseSession` to exist with its views initialized, so a 404ed config
  fails loudly instead of reporting a very fast render of an empty browser. A
  timeout with no display mounted at all now says so, because that is nearly
  always a trackId this build's `config.json` does not define.

  That gate is a stand-in for `@jbrowse/capture`'s `waitForSession`, which is the
  maintained implementation of this problem and has more stages (view phases,
  quiescence, a paint contract, and a check that the requested trackIds are
  actually open). It is not imported because that package's `exports` resolves to
  `./src/index.ts` while its `files` ships only `esm/`: the bare specifier lands
  on TypeScript inside `node_modules`, which node refuses to strip, and the built
  output is unreachable through the exports map. If that gets fixed — sibling
  `@jbrowse/img` has it right — drop the hand-rolled gate and take its stages.
- **Headless but still hardware-accelerated.** Plain headless Chrome on Linux
  falls back to the SwiftShader software rasterizer, which would unfairly slow
  the branch's GPU path. `--use-angle=gl` makes headless render WebGL2 through
  ANGLE on the Mesa Intel UHD 630 instead — verify with `scripts/gpucheck.ts`,
  which reports the `UNMASKED_RENDERER_WEBGL` string. Set `HEADLESS=0` to watch
  it run on the X display.
- **The metric is in-page navigation→render-complete time**, not whole-process
  wall-clock, so the ~3 s constant browser-launch overhead does not wash out the
  render difference.
- **Contamination is recorded per cell, not per run.** Competing load does not
  corrupt a run uniformly — it lands on whichever cells overlap the other job, so
  a run whose median load looks fine can still contain one ruined row. Both
  runners now read `/proc/loadavg` either side of every cell, store it with the
  measurement, and print a warning naming any cell measured at more than twice
  the run's median load (`scripts/render/loadavg.ts`). `results/alignments.md`
  carries the date and peak load of every row.
- **The build under test is identified, not assumed.** See "Builds compared".
- **The browser is pinned.** `puppeteer` is held at an exact version rather than
  a caret range, because the Chrome it bundles *is* the measurement instrument —
  a routine `pnpm update` would otherwise swap it and shift every number without
  anything looking wrong. The recorded results were produced with puppeteer
  24.43.1 → **Chrome for Testing 148.0.7778.97**. Both halves of the repo agree
  on it: the render benchmarks launch puppeteer's own browser, and
  `scripts/ld/chromePath()` resolves that same one before falling back to a
  cache scan.

## Running

**The machine must be idle.** Every number here is a render timing on one
workstation, so anything else driving the CPU or GPU corrupts the run — and the
corruption is not uniform, it lands on whichever cells happen to overlap the
other load. A 2026-08-04 re-run collided with a concurrent puppeteer screenshot
job (chrome + pngquant, load average 15–32) and release 4.3.0 drifted from
4581 ms to 7183 ms at 1000x shortread while the new build reproduced its June
numbers almost exactly. `results/run-2026-08-04.CONTAMINATED.log` is kept as the
example of what that looks like. Check `uptime` and `pgrep -c chrome` first.

This keeps happening, so it is worth knowing what it looks like from the inside.
On 2026-08-05 the box sat at load 4–12 with spikes past 35, driven by a dozen
other agent processes, and the damage was confined to the heaviest row:
`1000x-longread` zoom-in read 15321 ms during a spike to 13 against 13913 ms an
hour earlier, and the same row's initial render put release-4.1.15 at 25187 ms
in one attempt and 56452 ms in another. **A baseline that moves while its
neighbour does not is the signature** — the light rows reproduced June within 1%
throughout. Prefer re-running the affected row (`CASES=`) over re-running
everything, since the clean rows are the evidence that the run was otherwise
sound.

Two things that do *not* work as idleness checks:

- **Waiting for a low load average and then starting.** Load is a trailing
  average, so a dip is not a quiet machine. A re-run gated on three consecutive
  samples below 4.0 started at 3.15 and was at 35 by the time it finished.
- **Assuming a heavy row generates its own load.** It does not. Sampling during
  a single 1000x-longread render showed load already at 35 with `chrome=0` and
  no processes in uninterruptible sleep — the load was entirely other agents,
  and that render took 62319 ms against June's 21682 ms.

The durable fix is per-cell recording rather than pre-run gating: every cell
stores the load either side of itself, and a row above 4.0 reports `unusable`
instead of a speedup.

```bash
pnpm install

# Install the pinned measurement browser (Chrome 148.0.7778.97, the version
# puppeteer 24.43.1 resolves). This is a separate step on purpose: puppeteer's
# postinstall is disabled in pnpm-workspace.yaml, because it also fetches
# chrome-headless-shell, which nothing here drives.
npx puppeteer browsers install chrome

# serve the builds — 8000 is whichever new build you are testing
npx http-server builds/current          -p 8000 -s --cors &
npx http-server builds/release-4.3.0    -p 8001 -s --cors &
npx http-server builds/release-4.1.15   -p 8002 -s --cors &
npx http-server builds/release-2.4.0    -p 8004 -s --cors &   # the 2023 paper's version

# sanity-check the renderer is hardware, not SwiftShader
node scripts/gpucheck.ts headless

# run the matrices from the repo root (paths in the runners are root-relative)
node scripts/render/runner.ts             # → results/alignments.{md,json}
node scripts/render/runner-interaction.ts # → results/interaction.{md,json}

# both runners narrow the same two ways, for when a full sweep is unaffordable:
# CASES= picks rows, MODES= picks interactions, and either =none rebuilds the
# report from recorded JSON without measuring. Unselected cells keep their last
# value, so a filtered run mixes vintages and the tables date each row.
CASES=200x-longread node scripts/render/runner.ts
MODES=in CASES=20x-shortread,200x-longread node scripts/render/runner-interaction.ts

# the shareable summary page, generated from both JSONs so it cannot drift from
# what was measured. Reads nothing else and measures nothing.
node scripts/render/report.ts > results/report.html
```

**A build you made yourself needs its `fetchSizeLimit` raised, or it measures
nothing.** `shell/load_alignments.sh` wires the tracks with adapter defaults,
and `BamAdapter`/`CramAdapter` default `fetchSizeLimit` to 5 MB — but the 19 kb
benchmark window over 1000x coverage is a 28.1 MB fetch. The track then renders
"Requested too much data (28.1 Mb). Zoom in to see features, or force load" and
never fetches at all. Nothing errors; the page loads, the chrome paints, and the
run happily measures an empty browser. Set the slot to something large on every
track in the build's `config.json` before profiling or timing anything at 1000x.
This is the same family of failure as "a config that 404s photographs
perfectly" — see `flame/WORKER_FINDINGS.md`, which hit it.

Both matrices take upwards of 20 minutes, and a single contaminated row does not
justify redoing the other five, so each can be run in part. Rows or modes left
out keep their recorded values and their original date, and the report says which
was measured when:

```bash
CASES=1000x-longread node scripts/render/runner.ts     # one row
MODES=pan  node scripts/render/runner-interaction.ts   # one mode
MODES=none node scripts/render/runner-interaction.ts   # rebuild the report only
```

`MODES=none` measures nothing and regenerates the markdown from the recorded
JSON — for when the prose around the numbers changes but the numbers do not.
Without it, correcting a sentence in a generated file means either re-measuring
for an hour or hand-editing a file the next run overwrites.

For the parser-library benchmarks, which need no build, no server and no GPU:

```bash
cd ecosystem

make bench     # the whole thing: setup + equivalence gate + timings + report
make scan      # only the @gmod/vcf v7.1.1 -> v7.2.0 genotype-scan before/after
```

`make bench` is four steps and each is runnable alone, which is what you want
when only one of them is what you are iterating on:

```bash
./setup.sh          # clone + build every version in versions.json (minutes, once)
./setup.sh --force  # re-clone and rebuild them all
make verify         # the equivalence gate: do both sides return the same records?
make time           # the timings           -> results/bench.json
make report         # markdown + LaTeX from the JSON, measures nothing
```

`make report` is the `MODES=none` of this directory: it regenerates
`ecosystem/README.md`, `results/ecosystem.md` and `results/paper/*.tex` from the
JSON already on disk, so prose around a number can change without re-measuring.
**`ecosystem/README.md` is generated — edit `ecosystem/README.template.md`.**

`make scan` is separate from `make bench` because it runs one process per side
rather than both in one vitest process. That matters only for comparisons in the
few-percent range, which is what it measures; the reasoning and the number that
forced it are in `ecosystem/README.md`.

These are CPU benchmarks on the same box as everything else, so the idleness
warnings above apply to them too — `make time` and `make scan` will both report
whatever the machine was doing at the time.

`pnpm typecheck` typechecks everything under `scripts/`. It is clean; keep it
that way, since these scripts are run straight from source with
`--experimental-strip-types` and so get no other compile-time check.

## Regenerating the corpus

```bash
./shell/generate_alignments.sh   # needs wgsim, pbsim, minimap2, samtools
./shell/load_alignments.sh       # adds assembly + tracks to every builds/*
./shell/generate_variants.sh     # needs nothing but node
```

`generate_alignments.sh` works inside `data/` and rewrites everything there from
`hg19mod.fa`. `load_alignments.sh` copies the assembly into each build and
symlinks the alignments, so `builds/` stays small and every build serves the
same bytes.

`generate_variants.sh` writes the multi-sample VCFs the ecosystem VCF benchmark
reads, over the same contig and window. It needs no external tools — the records
come from a seeded RNG — so it is the one part of the corpus any checkout can
reproduce byte-for-byte in a couple of seconds.

## Caveats worth attaching to any external claim

- **WebGPU is not what is being measured.** The headline numbers are WebGL2;
  WebGPU is pinned off because of Dawn validation errors on this box (above).
- **Part of the long-read initial-render win is not the renderer.** Some of it
  comes from the branch's intentional SNP downsampling, which changes what is
  drawn, not just how fast it is drawn.
- **`flame/FINDINGS.md` is still against a Jun-13 build.** It resolves frames
  against June source. The class of finding is stable; the specific attribution
  needs a re-profile against a fresh build.
  `flame/WORKER_FINDINGS.md` **was** in this position and no longer is — it was
  re-profiled on 2026-08-11 against a current build, which confirmed the
  `_computeTags` fix had landed (586 ms → gone), kept two of its three verdicts
  with measurements behind them, and corrected a third claim that had been
  reasoned forward from the stale trace. Its "bgzf pool not captured" caveat is
  closed too — `flameprofile.ts` attached to the page's own workers and stopped,
  missing the pool the RPC worker spawns; it now recurses, and the pool is
  measured. A thread that is not attached looks exactly like a thread that is
  cheap, which is worth remembering before trusting any per-thread number here.
- **One machine, one locus.** Everything is a single workstation at
  `chr22_mask:124000-143000`, and the per-frame numbers come from a light 1 kb
  locus. Heavier loci that mount more overlays churn more per frame.
- **The machine is shared, and the heaviest row is currently unmeasurable.** The
  2026-08-05 numbers were taken at load 4–12, against 1.45–2.90 for a clean run,
  with spikes past 35 from a dozen other agent processes. The light rows
  reproduced June within 1%, which is the reason to trust them;
  `1000x-longread` did not, in either of two attempts, and
  `results/alignments.md` marks it `unusable` rather than reporting a speedup.
  Check the load column before quoting any row.
- **The pan comparison is one run, not a median of runs.** Each cell is the
  median of five pan steps, but the cell itself was measured once. Between the
  rightward and leftward pan runs, `200x-shortread` on release-4.3.0 moved
  1818 → 1310 ms with no corpus reason (short-read depth is flat), so
  run-to-run spread on this metric is real and not yet quantified. The ratios
  are robust — both builds are measured minutes apart under the same conditions
  — but a single absolute pan figure should not be quoted to three digits.

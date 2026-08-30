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
| `Makefile`, `scripts/gate.ts` | every benchmark in one place, and the preflight that decides whether a timing is worth keeping |
| `results/figures/` | the ggplot2 figures, laid out like the 2023 paper's Fig 8: format × read type, time against coverage. Every one draws the same four arms — v2.4.0, v4.3.0, the build under test, igv.js — from `scripts/arms.R` |
| `scripts/paperfigs/`, `results/figures/paper/` | the manuscript's own figures, ported here when the manuscript moved to a Google Doc. They draw the same JSON as the set above, and carry what it does not: GenomeSpy, igv.js at both windows, and a foreign-CPU gate that drops a contended cell rather than plotting it |

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
| [`results/crosstool-zoom.md`](results/crosstool-zoom.md) | and a *zoom*, where nothing has to be fetched at all? |
| [`results/quiescence.md`](results/quiescence.md) | which completion detector, and what does being wrong cost? |
| [`ecosystem/README.md`](ecosystem/README.md) | how much faster did the parser libraries get since 2023? |
| [`ecosystem/results/sweep.md`](ecosystem/results/sweep.md) | *where* along the majors did the parsers get faster? |
| [`ecosystem/results/cohort-bw.md`](ecosystem/results/cohort-bw.md) | what does a 100-sample BigWig panel cost to open? |
| [`ecosystem/results/vcf-scan.md`](ecosystem/results/vcf-scan.md) | what did the @gmod/vcf 7.2.0 genotype-scan rewrite buy? |
| [`ecosystem/results/gff3-lazy.md`](ecosystem/results/gff3-lazy.md) | is deferring GFF3 attribute parsing worth it, and to whom? |
| [`ecosystem/results/cram-samtools.md`](ecosystem/results/cram-samtools.md) | where does @gmod/cram stand against samtools now, on the 2019 paper's own benchmark? (no run of record yet) |

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
- `*.bw` — BigWig coverage tracks at the same coverages. Nothing in the render
  or cross-tool benchmarks currently reads them: the GenomeSpy harness reads
  BAM, through that tool's own lazy BAM source and `pileup` transform, so all
  three tools share the alignment workload rather than falling back to signal.
  This bullet claimed the opposite until 2026-08-23 — "signal is the only
  workload a tool with no alignment track can share" — which was true of an
  earlier harness design and never true of the file. `test.bw` is a
  byte-identical copy of `200x.shortread.bw`, kept as a generic fixture name.
- `R103.model` — the pbsim error model for the long-read simulation. Tracked.
- `hg19_17.chrom.sizes` — chr17's size, left over from the variant-matrix work.
  Nothing in this repo currently reads it.
- `paper2019/` — the corpus the 2019 cram-js paper benchmarked: two 1000 Genomes
  NA12878 CRAMs and GRCh38 with decoys, ~16 GB, downloaded rather than
  simulated by `shell/fetch_paper2019.sh`. Only
  `ecosystem/cram-samtools.ts` reads it, and only to say something about the
  published numbers as published; that benchmark also runs on the simulated
  corpus above, which is where its result sits beside everything else here.

The benchmark window throughout is `chr22_mask:124000-143000` (19 kb), which
matches the historical jb2profile region.

## The benchmarks

### Initial render

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
node --experimental-strip-types scripts/ld/ldband.ts [numSamples] [numSnps] [--cpu-budget=SECONDS] [--label=NAME]
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

**`ldband.ts`** → `results/ld-band.md`: the banded matrix
(`maxVariantSeparation`, plink's `--ld-window`) against the full triangle, GPU
and plain CPU side by side. This is the scale argument: the LD matrix is
materialized in full and shipped to the renderer, so it costs n(n-1)/2 cells, and
at 50,000 variants that is 1.25e9 cells = 4.66 GiB — no adapter allocates it,
`planDispatch` refuses, and the CPU fallback is ~59 minutes. Restricting pairs to
a separation of at most k makes the matrix n·k cells, i.e. **linear in the
variant count**. Measured at 50,000 variants x 2,000 samples on amd rdna-1:

| window | cells | output | GPU | CPU | CPU/GPU |
| --- | --- | --- | --- | --- | --- |
| full triangle | 1.25e9 | 4768 MiB | DECLINED | ~26 min (est) | — |
| 2000 | 9.80e7 | 374 MiB | 6181 ms | ~123 s (est) | 20x |
| 1000 | 4.95e7 | 189 MiB | 3158 ms | ~62 s (est) | 20x |
| 500 | 2.49e7 | 95 MiB | **1337 ms** | 68.7 s | 51x |
| 200 | 9.98e6 | 38 MiB | **456 ms** | 24.4 s | 53x |

Rows marked `(est)` exceeded `--cpu-budget` and are extrapolated from a measured
per-cell rate rather than run; nothing is capped silently. The DECLINED row is
the point — 50,000 variants is not a matrix any adapter will allocate, and the
window is what brings it into range at all.

Three gotchas if you write more WebGPU here:

- **WebGPU needs a secure context.** On `about:blank`, `navigator.gpu` is
  `undefined` — indistinguishable from "no WebGPU support". `scripts/ld/ldkernel.ts`
  serves a blank page over `http://localhost` for this reason. `scripts/gpucheck.ts`
  evaluates on the default `about:blank` and so reports `navigator.gpu: false`
  even on this box, which does support it.
- **WebGPU needs the Vulkan ANGLE backend on LINUX** (`--use-angle=vulkan`), not
  the `--use-angle=gl` the WebGL benchmarks use. That box exposes an `amd gcn-4`
  adapter to WebGPU, distinct from the Mesa Intel UHD 630 the WebGL path names.
  **On macOS you must NOT force it**: WebGPU there is Metal, and
  `--use-angle=vulkan` makes `requestAdapter()` resolve to `null` while
  `navigator.gpu` stays truthy — so it reads as "this machine has no GPU" rather
  than as wrong flags. `GPU_ARGS` in `ldkernel.ts` branches on the platform, and
  `launchGpuPage` now checks the adapter, not just `navigator.gpu`.
- **Run GPU timings HEADED.** Headless Chrome can substitute a software adapter
  (SwiftShader / lavapipe) that answers every WebGPU call correctly and is one to
  two orders of magnitude slower, so the run succeeds and the "GPU" column is a
  CPU. `ldband.ts` is headed by default and calls `assertHardwareAdapter`, which
  refuses to report a timing from a fallback adapter unless `--allow-software`
  says to.
- **Never call `requestDevice()` bare in a benchmark.** A WebGPU *device* gets
  the spec's DEFAULT limits — `maxStorageBufferBindingSize` 128 MiB — no matter
  what the *adapter* supports; raising them is opt-in, and
  `getGpuDevice()` (packages/render-core) opts in to the adapter's maxima.
  Measured on amd rdna-1, one browser, one adapter: adapter 2048 MiB, bare
  device 128 MiB, device-with-`requiredLimits` 2048 MiB. A benchmark that skips
  it measures a device the app never creates with a ceiling 16x too low, and the
  symptom is rows reporting DECLINED where the app dispatches happily — nothing
  errors, the table is just wrong. `requestAppLikeDevice` in `ldkernel.ts` is
  the one to use. (`ldbench.ts` and `ldlimits.ts` still request bare devices;
  their matrices stay under 128 MiB so no row changes, but new work should not
  copy them.)

### Cross-tool: JBrowse vs igv.js

`scripts/crosstool/runner.ts` → `results/crosstool.md`. The only comparison here
that leaves the JBrowse family, and since 2026-08-24 it runs three JBrowse arms
rather than one: the build under test, the last release, and the version the 2023
paper benchmarked. The paper's own Fig 8 is igv.js against v2.4.0, so a matrix
with only a current-JBrowse column answers half of what a reader of it is asking.
It is also what `results/figures/cold-load.png` is drawn from — a figure carrying
another tool has to come from the instrument all the arms share, and only this one
does. Both tools read the same indexed BAMs out of
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

#### GenomeSpy: drawing since 2026-08-28, by not declaring a domain

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

#### Gosling: runs at 19 kb, and cannot reach 100 kb

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

#### HiGlass: `higlass-pileup` is the way in

**Correction: HiGlass does have an alignments plugin.** `higlass-pileup`
(1.12.2) is a plugin track that reads indexed BAM client-side, so HiGlass does
not need the corpus preprocessed into tiles for the alignment workload after
all. No harness for it has been written yet.

#### Both of them read our decoder

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

Figures: `Rscript scripts/crosstool/panchart.R` →
`results/figures/interaction.png` (zoom and pan, all four arms) and
`zoom-redraw.png`, drawn from the run's JSON so a slide cannot quote a number no
run produced.

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

### The zoom, and the timer inside it

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

**The current build's zoom time-to-content is almost entirely a timer.** It comes
back flat at 504–532 ms across every coverage, read type and container, which is
not the shape of work. It is the 500 ms `LGVCoarseDynamicBlocks` debounce, and
the drawing inside it takes **0.2–0.6 ms**, since the pileup is already on the
GPU and a zoom is a change of projection.

The releases have no such constant and pay real cost instead: v4.3.0 and v2.4.0
run 1.1 s at 20x short read and **9.7 s and 8.0 s at 1000x long read**. igv waits
for nothing and spends its whole number drawing, from 39 ms at 20x short read to
1.4 s on the long-read cases.

So the comparison splits, and it is worth stating in the direction that does not
flatter this work: **igv is faster on every short-read case and at 20x long read**,
because half a second of constant loses to real work when the work is small. The
current build wins the heavy long-read cases 2.2–2.7×, and beats both releases
everywhere by 2–19×.

The report prints two tables and the figure set two panels — what the user waits
for, and what the renderer did — because quoting either alone is how this
benchmark went wrong the first time. Read the redraw table with its dagger: the
block renderer paints in a worker and the main thread blits the tiles, so
`drawclock` times a composite for the two release arms and not a render. v2.4.0
reads 0.1 ms there, underneath a 9.7 s wait.

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
| `current` | `jbrowse-components` main, copied from `products/jbrowse-web/build`. The first build in `runner.ts`. Restaged 2026-08-18 from `7fbb075ee5`; the commit it came from is in `builds/current/BUILD_INFO.txt`, because "HEAD" names a different build every week and the recorded numbers say only `current`. |
| `webgl-poc` | the original branch build (Jun 13) the June numbers and all the flame profiles come from |
| `webgl-poc-current` | a fresh build of the same branch (2026-07-10), used for `results/interaction-cpu.md` |
| `webgl-poc-fixed` | the branch plus the tooltip-clear-on-zoom fix `ce1e168b71`, measured perf-neutral |
| `release-4.3.0` | last release, old block renderer — the baseline every speedup is against |
| `release-4.1.15` | retired as an arm on 2026-08-24 — it sat between two releases and moved no conclusion. Still staged; nothing serves it. |
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

**It is wired into every runner** on port 8004 — `runner.ts` (JBrowse-only cold
load), `runner-interaction.ts` (JBrowse-only zoom, zoom-out, pan) and the
cross-tool pair, `crosstool/runner.ts` and `crosstool/panrunner.ts`, which take
one arm per port through `JBROWSE_PORTS` and are what `make crosstool` drives.

Since 2026-08-24 it is not an optional extra arm anywhere it matters: every
figure in `results/figures` draws v2.4.0 beside v4.3.0, the build under test and
igv.js, so a run that omits 8004 cannot produce the figure set. That is the 2023
paper's own Fig 8 comparison re-run on a corpus built to the paper's recipe, with
an instrument belonging to neither tool.

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

- **The loading indicator is no longer read as text, because that cannot be made
  to work.** `scripts/render/interaction.ts` decides that content is back when
  nothing is outstanding, and until 2026-08-25 it asked that by matching
  `document.body.innerText`. Both patterns it could use are wrong:
  `/Downloading|Loading alignments|Rendering/` misses release-2.4.0, which labels
  a refetching block plain **`Loading`** and its worker step **`Serializing
  results`**; adding `/\bLoading\b/` matches release-4.3.0 *permanently*, since
  4.3.0 fully rendered and idle still carries four `Loading` strings, so every
  step runs to `MAX_WAIT`. The per-build fallback between them needs the page to
  be genuinely at rest when it samples, and on 2.4.0 the render-complete detector
  says "at rest" with one block of six painted — so the fallback chose the narrow
  pattern for 2.4.0 in **seven of twelve cells**, and those cells recorded 0 ms
  with `loadingEverSeen: false` for zooms that take seconds.

  The direction of the error is what makes it dangerous: an unrecognized
  indicator can only ever make a build look *faster*, and it lands hardest on the
  oldest build in the matrix, whose wording is least likely to match.

  `scripts/render/contentready.ts` replaces it with a structural question, per
  build generation. Builds from the DisplayChrome work publish
  `data-display-phase` and `data-display-drawn`; older builds (4.3.0 and 2.4.0
  alike) mark each finished block with a **region-keyed** marker,
  `prerendered_canvas_{hg19mod}chr22_mask:119891..131879-0_done`. Content is back
  once the finished regions **cover the region on screen** — which is exact,
  needs no word list, and is checkable the instant an interaction is applied.
  `DETECTOR=text` still runs the old way for comparison.

  Two wrong versions of this are recorded in that file's header so nobody rebuilds
  them. Waiting for the DOM to *stop changing* declares content back in the gap
  between two blocks, which under load ended a warmup step early and left 2.4.0's
  track blank for the rest of the run. Counting *finished blocks* instead of
  measuring coverage called a view ready with half the screen unrendered, and
  then called a pan ready because the one stale block still overlapped the new
  view.

  Measured 2026-08-25 on 200x-longread-bam, zoom in: `builds/current` reads 0 ms
  on every step with **nothing** outstanding at any sample — its zero now rests on
  a positive structural fact rather than on a regex missing — while 2.4.0 reads
  1.8–5.1 s where the text detector recorded 0. **`results/interaction.json`
  predates this and was measured with the text detector; the matrix needs
  re-running on an idle box before those numbers are quoted.**

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

### The whole suite, in one place

`make` at the repo root lists every benchmark; `make all` runs them. The two
things it does that running the scripts by hand does not:

- **`make gate` runs first, and `make timings` depends on it.** It checks load,
  the number of `claude` processes (the load average lags them by minutes), free
  disk, every corpus file, which build each port is actually serving, and whether
  the sweep builds exist. Each of those checks is there because its absence has
  already cost a run — the details are in `scripts/gate.ts`.
- **Counting and timing are separate targets.** `make counts` is exact on any
  machine, because a request count does not care what else is running; `make
  timings` is worthless on a busy one. On a box that has been at load 15 for
  weeks, that split is the difference between a result and nothing.

```bash
make            # what every target does
make gate       # is this machine fit to measure on right now?
make counts     # request shapes and the equivalence gate — any box
make timings    # render, interaction, cross-tool, parsers — idle box only
make figures    # ggplot2 figures from the recorded JSON
make paper-figs # the manuscript figures, from results/paper/*.csv
make paper-data # refresh results/paper/*.csv after a fresh run
make all        # gate, counts, timings, figures, report
```

Logs land in `results/logs/<target>-<date>.log`, untracked. The Makefile does
not stage `builds/` or start the http-servers: which build sits on which port is
a decision rather than a default, so that stays `make serve` and the manual
steps below.

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
npx http-server builds/release-2.4.0    -p 8004 -s --cors &   # the 2023 paper's version

# sanity-check the renderer is hardware, not SwiftShader
node scripts/gpucheck.ts headless

# run the matrices from the repo root (paths in the runners are root-relative)
node scripts/render/runner.ts             # → results/alignments.{md,json}
node scripts/render/runner-interaction.ts # → results/interaction.{md,json}

# against igv.js. One JBrowse arm per port, so this is where v2.4.0 gets its
# cross-tool column — the comparison the 2023 paper's Fig 8 makes.
JBROWSE_PORTS=8000,8001,8004 node scripts/crosstool/panrunner.ts

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

**`fetchSizeLimit` is raised by the config pass, and that is not optional.**
`BamAdapter`/`CramAdapter` default the slot to 5 MB
(`plugins/alignments/src/BamAdapter/configSchema.ts`). Over it, the track renders
"Requested too much data (N Mb). Zoom in to see features, or force load" and
never fetches: nothing errors, the page loads, the chrome paints, and the run
either measures an empty browser or — as it does now — burns the full 120 s
timeout on a display that never mounts. Same family of failure as "a config that
404s photographs perfectly", which `flame/WORKER_FINDINGS.md` hit.

`shell/patch_adapters.js` sets the slot to 1e10 on every alignment track of
every build, as a pass over the generated `config.json` that
`shell/load_alignments.sh` runs. It has to be a separate pass because
`add-track --config` shallow-merges and naming `adapter` in it would drop
`bamLocation`.

**This section said the opposite until 2026-08-23, and the correction is the
reason the pass exists.** It read "it does not currently fire on
`builds/current`, which sets the slot nowhere", verified 2026-08-16 against the
build staged then. `builds/current` was restaged 2026-08-18 (main @ `7fbb075ee5`)
and it fires on that build. Measured across all twelve tracks and every build then served, before the
pass:

| build | tracks refusing |
| --- | --- |
| `current` | **5 of 12** — `1000x.shortread.bam`, both `200x.longread`, both `1000x.longread` |
| `release-4.3.0` | 0 of 12 |
| `release-2.4.0` | 0 of 12 |

Two things in that table matter more than the count. **Only the build under test
refused**, so every heavy row would have compared a refusal against a real
render — and a refusal is not a fast render. And at `1000x.shortread` **BAM
refused where CRAM did not**, because the estimate is of compressed bytes: the
gate lands on one format and not the other at the same coverage, which makes an
unpatched format axis not a format axis. Estimates at the benchmark window on
`current`: `200x.longread.bam` 55.3 MB, `200x.longread.cram` 21.0 MB.

Re-check after any adapter change rather than trusting this text either:

```bash
node --experimental-strip-types scripts/render/bailcheck.ts   # PORT=8000 by default
bash scripts/render/bailmatrix.sh                             # all 12 tracks x all 4 builds
```

It loads each track, counts data-file responses, greps the page for the refusal
text, and exits non-zero if anything refused — so it can gate a run rather than
being a thing to remember.

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

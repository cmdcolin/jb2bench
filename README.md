# jb2bench

Refreshed JBrowse 2 alignments render benchmark, comparing the `webgl-poc`
branch (GPU/WebGL2 renderer) against released versions (old block renderer).

This replaces `~/src/dont_care/jb2profile`, whose puppeteer scripts were overfit
to the old block-based DOM (they waited for an exact `BLOCKS_PER_TRACK * n`
count of `pileup-overlay-normal` / `wiggle-rendering-test` blocks). The new
branch paints a single canvas per display, so block counting no longer applies.

## What changed vs jb2profile

- **Render-complete detection is renderer-agnostic.** Instead of counting
  blocks, `scripts/profile.ts` waits for *quiescence*: at least one
  render-complete marker (`[data-testid$="-done"]` / `[data-testid$="_done"]`),
  no `loading-overlay`, and a stable marker count across several polls. This
  matches both the old blocks (`prerendered_canvas ... _done`, N per view) and
  the new single canvas (`pileup-display-done`).
- **Headless but still hardware-accelerated.** Plain headless Chrome on Linux
  falls back to the SwiftShader software rasterizer, which would unfairly slow
  the new branch's GPU path. `--use-angle=gl` makes headless render WebGL2
  through ANGLE on the Mesa Intel UHD 630 instead (verified by
  `scripts/gpucheck.ts`, which reports the `UNMASKED_RENDERER_WEBGL` string).
  Set `HEADLESS=0` to watch it run on the X display.
- **Metric is in-page navigation→render-complete time**, not whole-process
  wall-clock, so the ~3s constant browser-launch overhead doesn't wash out the
  render difference.

## Builds compared

- `builds/current` — a `jbrowse-web` build off `jbrowse-components` HEAD, staged
  by copying `products/jbrowse-web/build` here and running the assembly/track
  loader below. This is what `scripts/runner.ts` names as its first build.
- `builds/webgl-poc` — the original branch build the June numbers came from
  (renderer pinned to `webgl` via `?renderer=webgl`; see note below)
- `builds/release-4.3.0` — last release, old block renderer
- `builds/release-4.1.15` — older release, for the release-over-release trend

> WebGPU note: the new branch's default ladder is WebGPU → WebGL2 → Canvas2D.
> WebGPU initializes on this Intel UHD 630 / Vulkan / Dawn stack but emits
> texture-allocation validation errors, so the benchmark pins WebGL2 — the
> stable path and the realistic fallback most users hit today.

## Two benchmarks

**Initial render** (`scripts/runner.ts` → `results/alignments.md`): cold-start
nav→render-complete time. This is fetch-dominated (both architectures fetch in
workers) so it *undersells* the GPU branch — wins are 1.1–1.5× on most cases,
with one regression (1000x-shortread, diagnosed in `flame/FINDINGS.md`).

**Zoom interaction** (`scripts/runner-interaction.ts` → `results/interaction.md`):
the architectural payoff. The old block renderer binds output to a specific
bpPerPx, so **every zoom refetches + re-renders** ("Downloading alignments...",
up to ~15s at 1000x). The GPU branch re-projects already-loaded reads at the new
zoom **instantly, no refetch** (time-to-content 0ms; only a ~100–150ms redraw
frame). Metric = **time-to-content**: ms a loading indicator is shown after a
zoom-in before correct content returns. Driven via `window.JBrowseSession`
(exposed by both builds), zooming IN so the view stays a subset of loaded data.

## LD compute-shader benchmarks

Unrelated to the render benchmarks above: these measure the **WebGPU compute**
kernel behind the LD display (`plugins/variants`), the one GPGPU path in
JBrowse. They read the shipped WGSL straight out of the committed
`ldCompute.generated.ts` in `$JBROWSE` (default `~/src/jbrowse-components`), so
they always test what the app ships. No JBrowse build or server needed.

```bash
node --experimental-strip-types scripts/ldbench.ts [numSamples] [maxN]
node --experimental-strip-types scripts/ldlimits.ts [--1d]
```

**`ldbench.ts`** → `results/ld-gpu-vs-cpu.md`: GPU vs a CPU mirror of
`computeLDMatrixCPU`. GPU wins 12–37× across the measured range. It also shows
`MIN_WORK = 500_000` is a *conservative* gate, not a break-even one — at 495,000
work units the GPU is still ~4× ahead.

**`ldlimits.ts`** → `results/ld-dispatch-limit.md`: the dispatch ceiling.
One thread per matrix cell, 64/workgroup, and `maxComputeWorkgroupsPerDimension`
is 65535 → a 1D dispatch dies at **2897 variants**. Worse, it dies *silently*:
the over-limit dispatch is an async validation error, so nothing throws,
`mapAsync` still resolves, and the readback is an all-zero matrix that reads as
"no LD here". Run with `--1d` to reproduce the pre-fix behaviour (zeros past
n=2896, max diff 3.5e-1 vs the CPU reference); without it the shipped 2D
dispatch stays correct to ~4e-7.

Two gotchas worth knowing if you write more WebGPU here:

- **WebGPU needs a secure context.** On `about:blank`, `navigator.gpu` is
  `undefined` — indistinguishable from "no WebGPU support". `scripts/ldkernel.ts`
  serves a blank page over `http://localhost` for this reason.
  `scripts/gpucheck.ts` evaluates on the default `about:blank` and so reports
  `navigator.gpu: false` even on this box, which does support it.
- **WebGPU needs the Vulkan ANGLE backend here** (`--use-angle=vulkan`), not the
  `--use-angle=gl` the WebGL benchmarks use. This box exposes an `amd gcn-4`
  adapter to WebGPU (distinct from the Mesa Intel UHD 630 the WebGL path names).

## Layout

- `hg19mod.fa` — 250kb slice of hg19 chr22 (`chr22_mask`), the test reference
- `*.bam` / `*.cram` — simulated alignments at 20x / 200x / 1000x coverage,
  short reads (wgsim) and long reads (pbsim), regenerated by
  `shell/generate_alignments.sh`
- `*.bw` — BigWig files carried over from jb2profile (unused by the alignments
  benchmark; kept for future wiggle benchmarks)
- `scripts/profile.ts` — single-run initial-render profiler, prints elapsed ms
- `scripts/runner.ts` — initial-render build × case matrix → results/alignments.*
- `scripts/interaction.ts` — single-run zoom interaction profiler (time-to-content)
- `scripts/runner-interaction.ts` — interaction matrix → results/interaction.*
- `scripts/flameprofile.ts` — capture main+worker CPU profiles for one render
- `scripts/cpuprofile2collapsed.ts` + `flamegraph.pl` — make flamegraph SVGs
- `scripts/resolve.ts` — map hot minified frames back to source via sourcemaps
- `scripts/hotfns.ts` — top self/total-time functions from a folded stack file
- `scripts/rowsweep.ts` — row-count sweep on a multi-sample variant matrix:
  ready time and rAF frame gaps as rows are added, region and variant count
  fixed. **Not yet run** — its frame instrument is the same vsync-paced rAF gap
  the throttling table uses, so until sub-frame timing lands (disable vsync, or
  read GPU timestamp queries) every row under one frame reports the 16.7 ms
  floor and the sweep looks flat regardless of what is true.
- `scripts/probe.ts` / `scripts/gpucheck.ts` — dev helpers: render testids, GPU backend

## Running

**The machine must be idle.** Every number here is a render timing on one
workstation, so anything else driving the CPU or GPU corrupts the run — and the
corruption is not uniform, it lands on whichever cells happen to overlap the
other load. A 2026-08-04 re-run collided with a concurrent puppeteer screenshot
job (chrome + pngquant, load average 15–32) and release 4.3.0 drifted from
4581 ms to 7183 ms at 1000x shortread while the new build reproduced its June
numbers almost exactly; `results/run-2026-08-04.CONTAMINATED.log` is kept as the
example of what that looks like. Check `uptime` and `pgrep -c chrome` first.

```bash
pnpm install
npx puppeteer browsers install chrome   # if not already cached

# serve the three builds
npx http-server builds/webgl-poc    -p 8000 -s --cors &
npx http-server builds/release-4.3.0 -p 8001 -s --cors &
npx http-server builds/release-4.1.15 -p 8002 -s --cors &

# run the matrix (headless on the real GPU; HEADLESS=0 to watch it)
node scripts/runner.ts

# sanity-check the renderer is hardware, not SwiftShader
node scripts/gpucheck.ts headless
```

Results land in `results/alignments.md` (table) and `results/alignments.json`
(raw per-run numbers). Screenshots from the verify/probe steps are in
`screenshots/`.

## Regenerating data from scratch

```bash
./shell/generate_alignments.sh   # needs wgsim, pbsim, minimap2, samtools
./shell/load_alignments.sh       # adds assembly + tracks to every builds/*
```

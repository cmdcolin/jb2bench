# Next steps

Handoff written 2026-08-05, on top of commit `b560506` ("Reorganize the file
layout, rewrite the README, fix two silent measurement bugs").

Verified green at that commit: `pnpm typecheck` (root) 0 errors,
`ecosystem/` typecheck 0 errors, `cd ecosystem && make verify` 26/26 passing
against the corpus in its new `data/` home, all 144 `builds/*` symlinks
resolving. No render benchmark was re-run — see §2.

Items are ordered by what blocks what, not by size.

---

## 1. Re-run `make bench` before quoting any ecosystem number

**This is the one item with a correctness consequence.**

`ecosystem/vitest.config.ts` asked for a single worker as
`poolOptions: { forks: { singleFork: true } }`. Vitest 4 removed `poolOptions`
outright — it is not in the config type at all, so it was accepted silently and
did nothing. The fairness property the ecosystem README states —

> **One worker.** Two library builds competing for the same cores and page cache
> would make this a scheduling measurement.

— was therefore not in effect when the numbers currently in
`ecosystem/results/` were produced. It is in effect now (`fileParallelism: false`,
`maxWorkers: 1`), but the recorded numbers predate the fix.

Whether it actually changed them is **unknown and not determinable after the
fact**. It depends on whether vitest was scheduling `bam`/`cram`/`bgzf`/`bbi`
bench files concurrently. Within a single file, benches always ran in sequence.

```bash
cd ecosystem && make bench     # gate + timings + regenerates results/ and README.md
```

Budget roughly 10–20 minutes. It is dominated by the 2023-side 1000x long-read
parses (BAM ≈ 20.4 s and CRAM ≈ 15.9 s per iteration, ×7 with warmup); the
equivalence gate ahead of it measured 178 s.

**How to tell whether it mattered:** diff the new `ecosystem/results/bench.json`
against the committed one. If the speedup ratios hold within noise, the old
numbers were fine and the fix was insurance. If the *2023 side* moved more than
the current side, that is the signature of the old run having been contaminated
by parallel files, since the slow side has more wall-clock in which to collide.

Note `ecosystem/README.md` is generated from `README.template.md` by `report.ts`,
so a re-run rewrites it. Do not hand-edit it.

## 2. Measurement freshness — what is stale and why

Nothing here is wrong; it is all out of date in ways worth knowing before the
numbers get reused.

- **`results/alignments.md` is from June.** The 2026-08-04 attempt to refresh it
  collided with a concurrent puppeteer screenshot job and is kept, deliberately
  poisoned, as `results/run-2026-08-04.CONTAMINATED.log`. A clean re-run needs an
  idle machine — check `uptime` and `pgrep -c chrome` first.
- **`builds/current` is a hand-staged build**, not necessarily current. Rebuild
  from `jbrowse-components` HEAD (`products/jbrowse-web/build`), copy it in, then
  `./shell/load_alignments.sh` to re-wire assembly and tracks.
- **Every flamegraph in `flame/` is against the Jun-13 build.** The largest
  worker-side cost they name, `_computeTags` (586 ms, 9%), was fixed after that
  build by `b4da28ba7a` (2026-07-02, targeted SA/MM/ML tag reads). So the top of
  those profiles no longer reflects the source. `flame/WORKER_FINDINGS.md` is
  explicit that its verdicts hold "because those code paths weren't touched", not
  because they were re-measured.
- **The render benchmarks pin WebGL2, not WebGPU** (`?renderer=webgl`). WebGPU
  initializes on this box but emits Dawn texture-allocation validation errors. If
  that stack ever gets fixed, the ladder's real default becomes measurable.

## 3. Gaps that block specific work

### No modBAM fixture

`shell/generate_alignments.sh` (wgsim/pbsim) emits no MM/ML tags, and
`data/hg19mod.fa` is a *masked* reference. Nothing in the corpus enters
`extractModifications`, so the base-modification color path has never been
profiled here, and the two committed mod-path optimizations (dead
`localeCompare` sort, per-type color memoize) are justified by
removed-redundant-work reasoning rather than by any trace in this repo.

To close it: add a fixture — run an ONT 5mCG model output through, or synthesize
MM/ML onto the existing long-read BAM — plus a URL/session setting
`colorBy: { type: 'modifications' }`.

### Sub-frame timing, which blocks `rowsweep.ts`

`scripts/render/rowsweep.ts` is written but **has never been run**, on purpose.
Its instrument is the vsync-paced rAF frame gap, so every row count whose work
fits inside one frame reports the same 16.7 ms floor and the sweep looks flat
regardless of what is true. It needs either vsync disabled or GPU timestamp
queries before its output means anything. Running it as-is would produce a
confident, meaningless table.

## 4. Open engineering leads (from the profiles, not guesses)

### The 1000x-shortread regression — `placeRect` on the main thread

The one case where `webgl-poc` loses (7137 ms vs 4581 ms, 0.64×). Root cause in
`flame/FINDINGS.md`: `laidOutByGroup` deliberately lays out on the main thread so
tag colors stay a main-thread tier-2 setting, which keeps re-sort/re-color off
the worker — but at ~1M reads the synchronous per-read `placeRect` costs 2116 ms
(24% of the render window), while 4.3.0 keeps its main thread 81% idle by laying
out in the worker.

Suggested shape: keep main-thread layout for the cheap re-color/re-sort case,
offload the *initial heavy* layout to the RPC worker above a feature-count
threshold and transfer `readYs`/`maxY`. That recovers most of a 3.7 s gap.

### Per-frame interaction cost — React re-render + CSS-in-JS

`results/interaction-cpu.md`: frame time scales linearly with CPU throttle
(16.7 → 32.7 → 45.9 ms at 1×/4×/6×), which is the signature of a main-thread-JS
bound frame, not a GPU-bound one. `drawArrays` is absent from the top frames and
MobX is not in the top 22. The cost is Emotion serialization (~205 ms) and MUI
render machinery spread across chrome that re-renders every interaction frame.

Two measured directions: reposition React overlays with a cheap CSS transform
during a gesture and re-render on settle (the way the GPU pileup canvas already
repositions via a uniform), and hoist static styles out of per-frame render paths
so Emotion stops re-serializing.

Both are worth re-profiling against a fresh build first (§2).

### A benchmark that is missing

Pan and zoom-*out*, where both architectures must refetch. The current zoom
benchmark only zooms in, so the GPU branch never refetches and scores 0 ms. A
both-refetch case would isolate redraw cost from fetch cost and make the
comparison harder on the branch, which is worth having on the record.

## 5. Smaller items

- **Runner ergonomics.** `scripts/render/runner.ts` and
  `scripts/render/runner-interaction.ts` hardcode ports and disagree about what
  lives on 8000 (`current` vs `webgl-poc`). Taking build name/port as arguments
  would remove a real footgun; the README currently has to warn about it in
  prose.
- **`ecosystem/zarr.json` is transcribed, not measured here.** Its numbers come
  from `measure_signal_latency.ts` in `jbrowse-components`. Re-running that
  harness means hand-updating the JSON.
- **`data/test.bw` is byte-identical to `data/200x.shortread.bw`.** Kept as a
  generic fixture name; drop it if nothing ends up wanting it.
- **TypeScript 7.0.2 is available**; the repo is on 5.9.3 deliberately, so root
  and `ecosystem/` share one compiler. Upgrade both together or neither.
- **`build_webgl.log` / `gen_alignments.log`** still sit at the repo root. They
  are gitignored and harmless, just untidy.

## 6. Environment notes (outside the repo)

- `~/.cache/puppeteer/chrome-headless-shell/linux-148.0.7778.97/` is a partial
  download: the folder exists with no binary inside it. The 147, 150 and 151
  entries are intact. Anything that tries to resolve headless-shell 148 will fail
  on it until the folder is removed. Nothing in this repo drives headless-shell —
  the benchmarks need full Chrome for hardware GL — which is why puppeteer's
  postinstall is disabled in `pnpm-workspace.yaml`.
- **The measurement browser is Chrome for Testing 148.0.7778.97**, pinned via an
  exact `puppeteer` version rather than a caret range, because the bundled Chrome
  *is* the instrument. Install it with `npx puppeteer browsers install chrome`.
  Four Chromes are cached on this box; both halves of the repo now resolve 148.

# Next steps

Handoff updated 2026-08-05 (afternoon), on top of the pan-benchmark work. The
previous version of this file sat on commit `b560506`; what it listed as the
open item — a refetch-against-refetch measurement — is now implemented and run.

Verified green: `pnpm typecheck` (root) 0 errors. `results/alignments.md` and
`results/interaction.md` are both from 2026-08-05 and carry their own dates.

Items are ordered by what blocks what, not by size.

---

## 1. Re-measure the `1000x-longread` initial-render row — needs an idle box

**This is the one item with a correctness consequence, and it needs a machine
this one currently is not.**

The row is contaminated and `results/alignments.md` marks it `unusable` rather
than reporting a speedup. It was attempted twice on 2026-08-05:

| attempt | peak load | current | release-4.3.0 | release-4.1.15 |
| --- | ---: | ---: | ---: | ---: |
| June (reference) | — | 11733 | 17277 | 21682 |
| 09:00 | 31.9 | 8267 | 34736 | 25187 |
| 09:31 | 35.4 | 7350 | 36171 | 56452 |

release-4.1.15 returned 25187 ms and then 56452 ms for identical work. That 2.2×
spread between two measurements of one unchanged build is the whole argument for
throwing the row out.

```bash
CASES=1000x-longread node scripts/render/runner.ts   # ~8 min, rewrites only this row
```

**Do not gate this on a load-average dip.** That was tried: a run gated on three
consecutive samples below 4.0 started at 3.15 and was at 35 by the time it
finished, because load is a trailing average and the other agents had not
actually stopped. Check that the box is genuinely quiet — `pgrep -c claude`,
not just `uptime` — or run it when nothing else is scheduled.

It is also worth knowing what was ruled out: the row does **not** generate its
own load. Sampling during a single 1000x-longread render found load already at
35 with `chrome=0` and nothing in uninterruptible sleep, and that render took
62319 ms against June's 21682 ms. The load is entirely external.

Expect this row to stay the noisiest thing in the repo regardless; it is 268 MB
of BAM. The same case on the *interaction* benchmark moved 13913 → 15321 ms
between two runs an hour apart.

## 2. Re-run `make bench` before quoting any ecosystem number

Unchanged from the previous handoff, and still not done.

`ecosystem/vitest.config.ts` asked for a single worker as
`poolOptions: { forks: { singleFork: true } }`. Vitest 4 removed `poolOptions`
outright — it is not in the config type at all, so it was accepted silently and
did nothing. The fairness property the ecosystem README states —

> **One worker.** Two library builds competing for the same cores and page cache
> would make this a scheduling measurement.

— was therefore not in effect when the numbers currently in `ecosystem/results/`
were produced. It is in effect now (`fileParallelism: false`, `maxWorkers: 1`),
but the recorded numbers predate the fix.

```bash
cd ecosystem && make bench     # gate + timings + regenerates results/ and README.md
```

Budget roughly 10–20 minutes. **How to tell whether it mattered:** diff the new
`ecosystem/results/bench.json` against the committed one. If the *2023 side*
moved more than the current side, that is the signature of the old run having
been contaminated by parallel files, since the slow side has more wall-clock in
which to collide. Note `ecosystem/README.md` is generated from
`README.template.md` by `report.ts`; do not hand-edit it.

## 3. Re-profile the flamegraphs — they now describe a fixed problem

`flame/FINDINGS.md` explains why `1000x-shortread` was a regression: at ~1M
reads, `laidOutByGroup` lays out on the main thread and the synchronous per-read
`placeRect` cost 2116 ms, 24% of the render window, while 4.3.0 kept its main
thread 81% idle by laying out in the worker.

**That regression is gone.** Measured 2026-08-05 against `builds/current`:

| | June `webgl-poc` | now `current` |
| --- | ---: | ---: |
| 1000x-shortread | 7137 ms (0.64×, a loss) | 3784 ms (1.34×, a win) |

Nothing here identified the fix — only that the symptom is absent. So the open
work is to re-profile and find out what changed, because until then the repo
asserts a cause for a number that no longer exists. Both flame documents are
against the Jun-13 build, and the other hotspot they name, `_computeTags`
(586 ms, 9%), was fixed by `b4da28ba7a` (2026-07-02).

`flame/WORKER_FINDINGS.md` is explicit that its verdicts hold "because those
code paths weren't touched", not because they were re-measured. That reasoning
is now weaker than it was.

## 4. Quantify run-to-run spread on the pan metric

Each pan cell is the median of five steps, but the cell itself is measured once,
and there is evidence the spread is not small: between the rightward and
leftward pan runs, `200x-shortread` on release-4.3.0 moved 1818 → 1310 ms.
Short-read depth is flat across the contig, so that is not the corpus — it is
either run-to-run variance or the load the box was under.

The ratios are more robust than the absolutes, since both builds are measured
minutes apart under the same conditions. But nothing here establishes an error
bar, and `results/alignments.md` gets one (±stddev over 6 runs) while
`results/interaction.md` does not. Running each pan cell 3× and reporting a
median of medians would close that gap; it costs roughly 3× the ~12 minutes the
pan mode takes.

## 5. Gaps that block specific work

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

### The corpus tapers at both ends

pbsim's long reads run off the ends of `chr22_mask`, so long-read depth falls
away there — 1000x.longread drops 1178 → 938 → 500 over the last three 19 kb
windows, and starts at 320 in the first. Anything that moves the view along the
contig has to account for it; the pan benchmark does, by panning left and
stopping before the edge. A regenerated corpus that simulated onto a padded
reference and then trimmed would remove the constraint.

## 6. Open engineering leads (from the profiles, not guesses)

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

Both want re-profiling against a fresh build first (§3).

### Zoom-out is still a refusal test

Panning replaced zoom-out as the refetch-against-refetch measurement, but
zoom-out itself remains in the table recording what it actually measures:
release-4.3.0 declining to fetch on five of six cases. If the density cap ever
becomes configurable from the URL or session, zoom-out becomes measurable and
would test something pan does not — a *widening* re-projection rather than a
lateral one.

## 7. Resolved since the last handoff

- **Pan at constant zoom.** Implemented as `MODE=pan` in
  `scripts/render/interaction.ts`, run on all six cases, 5/5 steps and no bails
  everywhere. The branch is 1.9–4.3× faster to content when *both* builds must
  fetch. Two ways of accidentally measuring an empty viewport are guarded: the
  contig-edge clamp, and the coverage taper (§5).
- **The build under test is identified, not assumed.** Both runners resolve
  which build each port serves by matching the served `index.html`'s
  content-hashed bundle against `builds/*/index.html`
  (`scripts/render/servedbuild.ts`), and abort on an unrecognized one. This was
  a real error, not a hypothetical: port 8000 was serving `builds/current` while
  `runner-interaction.ts` labeled the column `webgl-poc`.
- **Contamination is attributable per cell.** `scripts/render/loadavg.ts`; both
  runners record load either side of every cell and warn about outliers.
  `results/alignments.md` carries a date and peak load per row.
- **Partial re-runs.** `CASES=` on the initial-render matrix, `MODES=` on the
  interaction matrix, and `MODES=none` to regenerate a report from recorded JSON
  without measuring. Modes and rows not selected keep their values *and* their
  original date, which the reports print.
- **The 1000x-shortread regression** — see §3, gone but unexplained.

## 8. Smaller items

- **`ecosystem/zarr.json` is transcribed, not measured here.** Its numbers come
  from `measure_signal_latency.ts` in `jbrowse-components`. Re-running that
  harness means hand-updating the JSON.
- **`data/test.bw` is byte-identical to `data/200x.shortread.bw`.** Kept as a
  generic fixture name; drop it if nothing ends up wanting it.
- **TypeScript 7.0.2 is available**; the repo is on 5.9.3 deliberately, so root
  and `ecosystem/` share one compiler. Upgrade both together or neither.
- **`build_webgl.log` / `gen_alignments.log`** still sit at the repo root. They
  are gitignored and harmless, just untidy.

## 9. Environment notes (outside the repo)

- `~/.cache/puppeteer/chrome-headless-shell/linux-148.0.7778.97/` is a partial
  download: the folder exists with no binary inside it. The 147, 150 and 151
  entries are intact. Anything that tries to resolve headless-shell 148 will fail
  on it until the folder is removed. Nothing in this repo drives headless-shell —
  the benchmarks need full Chrome for hardware GL — which is why puppeteer's
  postinstall is disabled in `pnpm-workspace.yaml`.
- **The measurement browser is Chrome for Testing 148.0.7778.97**, pinned via an
  exact `puppeteer` version rather than a caret range, because the bundled Chrome
  *is* the instrument. Install it with `npx puppeteer browsers install chrome`.
- **The box is busy.** Several agents share this worktree and this CPU. Load sat
  between 4 and 12 for the whole of 2026-08-05, against 1.45–2.90 for a run
  considered clean. Check `uptime` before starting anything, and read the load
  column in `results/alignments.md` before quoting a row.

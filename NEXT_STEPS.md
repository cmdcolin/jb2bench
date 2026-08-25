# Next steps

Handoff updated 2026-08-23. The box was finally idle, and the pass that used it
found that **the heavy cells had stopped being measurable at all**: on
`builds/current` five of twelve alignment tracks were refusing the fetch at the
benchmark window, and the three release builds were not. See §0. The previous
version sat on 2026-08-18, on top of the three-version pass: `builds/current`
restaged from main, the parser pins moved to what v2.4.0 actually resolved, and
the cross-tool pan taught to run more than one JBrowse arm. The version-coverage
table those changes serve is in [`COMPARISONS.md`](COMPARISONS.md).

---

## 0. What the 2026-08-23 pass changed

**`fetchSizeLimit` was refusing the heavy cells, on the build under test only.**
`shell/patch_adapters.js` now raises it on every alignment track of every build,
as a pass over the generated `config.json` that `load_alignments.sh` runs. Before
that pass, measured across all twelve tracks and all four builds:

| build | tracks refusing |
| --- | --- |
| `current` | **5 of 12** — `1000x.shortread.bam`, both `200x.longread`, both `1000x.longread` |
| `release-4.3.0`, `release-4.1.15`, `release-2.4.0` | 0 of 12 |

Two things there matter more than the count. Only the build under test refused,
so every heavy row would have compared a refusal against a real render. And at
`1000x.shortread` **BAM refused where CRAM did not** — the estimate is of
compressed bytes — so the gate landed on one format and not the other at the
same coverage, which is not a format axis. README said the limit "does not
currently fire on builds/current", verified 2026-08-16 against the build staged
*then*; `current` was restaged 2026-08-18 and it fires on that one.
`scripts/render/bailmatrix.sh` runs the check over the whole matrix now instead
of the two tracks `bailcheck.ts` defaulted to.

**Zoom and pan gained the format axis.** They were BAM-only while cold load had
carried both formats since 2026-08-16. `scripts/render/cases.ts` now owns the
case enumeration for both runners, which is what had let them drift; recorded
`<cov>-<read>` rows are relabelled `-bam`. The CRAM interaction cells are blank
and owed a run.

**`profile.ts` has a positive content gate.** Every readiness signal it consults
is negative and passes on a page that drew nothing. A canvas element does not
exist until something is drawn — measured on all three build generations,
sampled mid-load at 0.7 s and 2.2 s with megabytes already fetched — so counting
canvases separates "drew" from "declined to draw" with no threshold to tune.

**The GenomeSpy harness has never worked, and the 2026-08-23 fix did not fix
it.** Verified against a running page this time: it paints an empty plot frame
and issues **zero** requests for the BAM or its index. Root `genomes` + root
`assembly` — what the deprecation notice for root `genome` points at — fails
identically to the deprecated form; an inline `scale.assembly` object fails
differently; a plain numeric domain only changes which call arrives first. The
cause, read out of the bundle: startup only *configures* genomes, the sole
loader is the view-insertion preflight, and that preflight collects assemblies
from x/y scale resolutions that have already resolved to type `locus` — ours is
not visible to it then, so nothing loads and the first draw resolves against an
empty store. `crosstool/genomespy.html`'s header has the full account.

The arm is **opt-in behind `GENOMESPY=1`** in `scripts/crosstool/runner.ts`
rather than on with a comment asking for a manual preflight. Paint quiescence
cannot tell a dead harness from a fast one — a page that throws settles
immediately and reports a very small number — so leaving it on risks a wrong
column, not a missing one.

Two stale claims went with the first attempt: the header said the workload was
BigWig signal "because GenomeSpy has no alignment track" (the spec has read BAM
since it was written, through that tool's own lazy BAM source and `pileup`), and
an inline comment said four genome-declaration forms had been tested and all
four worked.

**A probe that queries the DOM for canvases misses igv.js entirely.** igv 3.x
calls `parentDiv.attachShadow()` and puts its whole UI inside, so
`document.querySelectorAll('canvas')` returns zero on a page igv has drawn
twelve canvases onto, and `document.contains(browser.root)` is false. The first
version of `toolcheck.ts` reported a working igv as drawing nothing.
`drawclock.ts` is unaffected — patching the canvas prototypes catches a draw
wherever the element lives — but anything going through a DOM query is not.

**igv.js 3.8.5 is npm `latest`** as of 2026-08-23, so the cross-tool column is
the current release rather than a trailing pin. The 2023 paper's igv 2.12.1 is
still vendored beside the harness and selected by URL.

Verified green: `pnpm typecheck` (root and `ecosystem/`) 0 errors. That was not
true on 2026-08-05 through 2026-08-16 — `b455a3c` added a field to
`multibam.ts`'s emitted row and not to its type — so if the README claims it is
clean, check rather than assume.

**Read [`COMPARISONS.md`](COMPARISONS.md) first if the question is "what do we
compare and what is missing".** This file is what is *blocked*; that one is the
map of the axes, and the two are deliberately different documents.

Items are ordered by what blocks what, not by size.

---

## 1. ~~The cold-load matrix~~ — closed 2026-08-23

**All twelve rows are measured and usable, CRAM included.** That had never been
true: every BAM row was previously taken at load 14–35 and every CRAM row was
blank, so the format axis the 2023 Fig 8 is built on had never been measured
here at all. `results/alignments.md` now carries 12 rows x 4 builds, every cell
at 0.05–0.12 foreign cores.

The headline is the row that had been unusable since June. `1000x-longread-bam`
is **3.80x** over release-4.3.0 and **4.79x** over the published v2.4.0, the
largest speedups in the table — so the case the paper's framing most wants was
also the one the instrument kept throwing away.

What made it measurable was fixing the contamination metric three times, each
time for the same underlying mistake — **the metric counting the benchmark's own
work** — and each fix condemning fewer clean rows than the last:

1. **The load average counts our own threads.** `1000x-shortread-bam` on
   release-2.4.0 takes 15.4 s a render and drove load 2.1 → 10.3 by itself on an
   idle box; the next cell then began at 10.3, having inherited a trailing
   average of work this benchmark did. Under a fixed 4.0 ceiling both rows
   report `unusable` on a quiet machine, and the heavier the case the more
   certainly it disqualifies itself. Replaced by foreign CPU — processes outside
   this run's tree — with load kept beside it as context.
2. **The corpus http-servers were foreign by ancestry.** They serve the bytes
   under test and no runner is their parent. Only 0.05 cores, but it scales with
   case weight, so it biased hardest on exactly the heavy cases. They are
   apparatus now.
3. **An orphaned Chrome billed us for a whole render.** `execFileSync` returns
   when the per-render `node` exits, and the Chrome it launched can outlive it —
   init adopts the orphan, ancestry stops reaching the run, and a before/after
   snapshot pair sees only the after-state, where an unrecognised pid is charged
   from zero. `1000x-longread-bam / current` reported **1.41 foreign cores** on
   an idle box while naming 0.11 cores of actual strangers. The watcher now
   samples /proc twice a second, keeps `once ours, always ours`, and charges a
   pid only from its first sighting. Same cell, same timings, 0.14 cores.

Two things worth carrying forward. **A contamination number needs an
attribution**, which is what made (3) findable: the total and the top consumers
disagreed, and a bare 0.55 had hidden the same disagreement for a day. The table
prints a `by` column now. And **this box floors at ~0.28 foreign cores
untouched** — two other agent sessions, a terminal, a browser — so the 0.5
ceiling is a budget over that floor, not over zero. Running shell commands
against the box during a run spends it.

Still owed on this table: the ten rows measured earlier on 2026-08-23 predate
the `by` column and show `—` there. They are clean (0.08–0.12) and do not need
re-running for their numbers, only for their attribution.

## 1a. Fill the rest of the three-version matrix — needs an idle box

The cold-load table is done (§1). What is left, cheapest first, all four builds
serving from `make serve`:

```bash
FORMATS=cram node scripts/render/runner-interaction.ts   # the six new CRAM zoom/pan cells
make crosstool                                           # igv.js against v2.4.0, 4.3.0 and main, cold load + zoom + pan
```

Two things to know before starting:

- **Zoom and pan gained the format axis on 2026-08-23** and have not been run on
  it. Both runners now enumerate cases from `scripts/render/cases.ts`, so the
  two tables cannot drift the way they did — cold load gained CRAM on
  2026-08-16 and interaction did not. Adding the CRAM cases also reproduced a
  missing-cell crash that had been killing report generation outright; that is
  guarded now.
- **`builds/current` is main @ `7fbb075ee5`, staged 2026-08-18.** Numbers
  recorded before that date under the name `current` are a different build —
  the 2026-08-11 HEAD — which is why the build carries a `BUILD_INFO.txt`.

## 2. Give the ecosystem bench a contamination instrument

**The timings themselves are done** — re-measured 2026-08-23 against the pins
`versions.json` holds, so `make report` no longer refuses and
`ecosystem/results/ecosystem.md` is current. `@gmod/vcf` has timing rows for the
first time (up to 28.2x on the genotype scan). CRAM runs 6.9–12.2x and BAM
3.8–5.8x. BigWig had rows too, reading 0.79–1.03x, and they were withdrawn on
2026-08-25 — that is what measuring a per-file cost once looks like, and in node
it was also comparing wasm against native zlib rather than against the pako a
browser gets. `versions.json` records both halves; the cohort benchmark is what
replaced it.

What is owed is the instrument, not the numbers. **`ecosystem/` has no
equivalent of `scripts/render/loadavg.ts`**, so nothing records what else the
box was doing, and the render side has now been wrong about that three separate
times (§1). Two facts about the 2026-08-23 run make the gap concrete: the
operator was editing files and running `tsc` throughout it, and the noisiest
cells are noisy enough to notice — `cram 1000x longread` reports ±42.0% on the
current side and ±27.8% on the 2023 side, `cram 200x shortread` ±19.9%/±18.6%.
The 7–12x CRAM gaps are far too large for that to reverse them, so read the
direction and the magnitude as safe and the third significant figure as not.

The fix is a vitest `globalSetup` that runs `watchForeignCpu()` across the file
and writes the result beside `bench.json`, so the report can carry the figure
the way `results/alignments.md` does. Note `ecosystem/` installs with
`--ignore-workspace`, so importing `scripts/render/loadavg.ts` means a relative
path and a `tsconfig` include, not a package reference.

One warning to leave alone: `read attempted beyond end of buffer, file seems
truncated` on stderr throughout the CRAM benchmarks. It comes from **v1.7.3
only**, in `CramSlice._fetchRecords`, and it costs no records — the gate passes
32/32 including both CRAM checks. It tracks the v1.7.3 long-read
reference-span defect the equivalence table already quantifies: 0/36, 1/331 and
5/1667 spans agree with the BAM, against the current release reproducing it
exactly.

`ecosystem/vitest.config.ts` asked for a single worker as
`poolOptions: { forks: { singleFork: true } }`. Vitest 4 removed `poolOptions`
outright — it is not in the config type at all, so it was accepted silently and
did nothing. The fairness property the ecosystem README states —

> **One worker.** Two library builds competing for the same cores and page cache
> would make this a scheduling measurement.

— was therefore not in effect for numbers recorded before 2026-08-18. It is in
effect now (`fileParallelism: false`, `maxWorkers: 1`), and the 2026-08-23 run
is the first full set taken under it.

### `pnpm exec` will not run without a TTY when the modules dir drifts

`make time` failed on 2026-08-23 with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
before running anything: `pnpm exec` runs a deps-status check, decided
`node_modules` had to be recreated, and refused to do it unattended. Passing
`--ignore-workspace` to the exec does not help — the check runs either way.

```bash
cd ecosystem && CI=true pnpm install --ignore-workspace   # 2.4 s, no lockfile change
```

Worth knowing that **`ecosystem/node_modules` and `ecosystem/.libs` are symlinks
into the primary checkout**, so that install rewrites a directory every worktree
shares. It reinstalled the same three dev dependencies, but a heavier one would
be felt by every session at once.

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

## 4a. The new benchmarks that have run once, or not at all

None of these is blocked on anything but machine time.

- **`results/sweep.md` has request counts for every version and timings for
  none worth quoting.** `MODE=count make sweep` is complete and load-independent;
  the timing half was taken at load 8–15 and the report says so in its title.
  `make sweep` on a quiet box closes it.
- **`results/cohort-bw.md`, same split.** Counts final, timings provisional. The
  same cell moved 539 → 49 ms between two runs, which is the argument.
- **`results/crosstool-pan.md` has run on some cases.** The long-read rows and
  `1000x-shortread` are the ones the paper's framing actually wants, since its
  instruction is to weight the heavy cases.
- **`@gmod/vcf` and `@gmod/bgzf-filehandle` are not in `sweep.json`.** Config
  only — the file is data-driven and `sweep.ts` picks up a new block of the same
  shape. Note that neither takes a filehandle the way the other three do, so
  they get a curve but no request-shape column.

## 5. Gaps that block specific work

### ~~No modBAM fixture~~ — closed 2026-08-11

`data/*.longread.mod.bam` carry CpG-context 5mC MM/ML tags stamped onto the
existing long reads by `shell/generate_modbam.sh`, checked by
`shell/verify_modifications.js`, which decodes MM back against each read
independently of the generator. `data/ont.6ma.chr20.bam` (`cd364f4`) adds the
corpus's first *multi-group* modBAM, from real ONT data rather than synthesized.

The first profile of that path found one function taking a third of the RPC
worker — `flame/WORKER_FINDINGS.md`. What is still owed is the same thing §3
owes: those findings are against a June build and want re-confirming.

### `rowsweep.ts` now runs; what it needs is a quiet machine

Superseded 2026-08-11. The three blockers named here — no fixture, a URL form no
runner uses, and a vsync-paced instrument that floors at 16.7 ms — are fixed, and
the README section has the commands. Disabling vsync does move the instrument:
at 100 rows, paced gave a 23.3 ms median with 20% of frames under 16 ms, and
unpaced gave 14.2 ms with 60% under. That comparison was taken at load 65, so
read the direction and not the values.

**No output has been kept as a result.** Every validation run sat at load 50–65
against the 1.5–2.9 a clean run wants, and per-frame numbers are exactly what
contention destroys — the same 100-row cell gave frame medians of 10.4, 14.2 and
17.4 ms in three runs minutes apart. The sweep is a comparison across its own
cells, so it is more robust than an absolute, and the runner now interleaves row
counts and alternates their order pass to pass to keep load from correlating with
row count. It is still not enough on a box at load 50.

Two things would make the frame column stand on its own rather than on the flags:
GPU timestamp queries around the draw, which measure the GPU's own work instead of
the callback interval, and a `%` of frames over a fixed budget reported per pass
rather than pooled, so one contended pass is visible instead of averaged in.

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

Added 2026-08-16:

- **The parsers are swept, not just sampled at two points.**
  `ecosystem/sweep.json` + `make sweep` cover every major line of `@gmod/bam`,
  `@gmod/cram` and `@gmod/bbi` — 32 builds, all of which still build from source
  with a current toolchain. `make sweep-verify` gates it the way `make verify`
  gates `make bench`.
- **Some results here no longer need an idle box.** `MODE=count make sweep` and
  `make cohort` report reads and bytes rather than milliseconds; those are exact,
  identical on every machine, and do not decay. Given how much of this file is
  blocked on a quiet machine, that property is worth more of the repo's effort.
  It has already produced findings a timing cannot see — `@gmod/cram` v8 cut the
  200x-longread query from 728 reads over 35 MB to 44 over 17.5 MB, at the same
  major where the timing curve steps.
- **The 100-BigWig cohort exists** (`shell/generate_cohort_bw.sh`,
  `make cohort`), which is where `@gmod/bbi`'s cost becomes legible: the
  single-file case is 1–3 ms and says nothing, because the cost being measured is
  per-file and a panel pays it N times.
- **Cross-tool pan** (`scripts/crosstool/panrunner.ts`), the measurement the
  paper's TODO called the strongest missing one.
- **The completion detector is a module with a harness**
  (`scripts/crosstool/quiescence.ts`, `quiescheck.ts` →
  `results/quiescence.md`). It has broken more often than anything it measures,
  and it now gets calibrated rather than asserted. Two claims written into this
  repo as mechanism were falsified by it within a run — see
  `COMPARISONS.md` §1.

From the 2026-08-05 handoff:

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

# Next steps

Handoff updated 2026-08-18, on top of the three-version pass: `builds/current`
restaged from main, the parser pins moved to what v2.4.0 actually resolved, and
the cross-tool pan taught to run more than one JBrowse arm. The version-coverage
table those changes serve is in [`COMPARISONS.md`](COMPARISONS.md); what they
left un-measured is §1, §1a and §2 here. The previous version sat on 2026-08-16.

Verified green: `pnpm typecheck` (root and `ecosystem/`) 0 errors. That was not
true on 2026-08-05 through 2026-08-16 — `b455a3c` added a field to
`multibam.ts`'s emitted row and not to its type — so if the README claims it is
clean, check rather than assume.

**Read [`COMPARISONS.md`](COMPARISONS.md) first if the question is "what do we
compare and what is missing".** This file is what is *blocked*; that one is the
map of the axes, and the two are deliberately different documents.

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

## 1a. Fill the three-version matrix — needs the same idle box

Everything a reader of the 2023 paper would ask for is now *wired* and mostly
un-measured. [`COMPARISONS.md`](COMPARISONS.md) has the coverage table; this is
the run list, cheapest first, all four serving from `make serve`:

```bash
node scripts/render/runner-interaction.ts   # fills the missing v2.4.0 column
node scripts/render/runner.ts               # every BAM row is currently unusable, and no CRAM row exists
make crosstool-versions                     # igv.js against v2.4.0, 4.3.0 and main — the paper's own Fig 8
```

Three things to know before starting:

- **The interaction table has never had its published column**, though
  `runner-interaction.ts` has carried the arm since 2026-08-11 and
  `scripts/render/report.ts` already reads it. Nothing is missing but a run with
  port 8004 served. The `published` role is optional precisely so that a run
  without it still produces the narrower table, which is why the omission was
  quiet for a week.
- **The cold-load table is the one with the worst numbers and the widest
  coverage.** All four columns exist; every BAM row was measured at load 14–35
  and every CRAM row is blank, so the format axis the 2023 Fig 8 is built on has
  never been measured here at all.
- **`builds/current` is main @ `7fbb075ee5`, staged 2026-08-18.** The numbers
  recorded before that date under the name `current` are a different build — the
  2026-08-11 HEAD — which is why the build now carries a `BUILD_INFO.txt`.

## 2. Re-run `make bench` before quoting any ecosystem number

Unchanged from the previous two handoffs, and still not done. Two things have
been added since that make it more urgent rather than less:

- **`@gmod/vcf` still has no rows in the table.** It was added to
  `versions.json` after the last `make time`, and `results/ecosystem.md` prints
  a derived warning saying so. The warning removes itself on the next full run.
- **Both pins moved on 2026-08-18, so every recorded number is now off-pin.**
  The old side is the versions `jbrowse-components` resolved at **v2.4.0** — the
  release the paper archived — read out of that tag's `yarn.lock`: bam 1.1.18,
  cram 1.7.3, bbi 3.0.0, vcf 5.0.10, bgzf 1.4.5. It used to be a tree from six
  months later, a whole major line off on bam and bbi. The new side is npm
  latest (bam 8.11.0, cram 13.4.1, bbi 11.2.2, vcf 7.2.0, bgzf 6.6.0), which is
  also what main's ranges resolve to; it used to trail by up to three majors.
- **`report.ts` now refuses to run against off-pin numbers.** It compares the
  version in each `bench.json` arm label against `versions.json` and throws, so
  `make report` cannot relabel v2.0.0 timings as v1.1.18. That refusal is the
  current state: try it and it names all eight stale arms. Arm labels are read
  from `versions.json` by `lib/arms.ts` rather than typed into each bench file,
  which is how the two drifted apart in the first place.

`./setup.sh` has to clone and build the five new old-side tags before
`make time`, so budget the extra few minutes the first time.

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

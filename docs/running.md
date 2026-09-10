# Running

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

## The whole suite, in one place

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


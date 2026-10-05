# Running the BGZF worker-pool benchmark on the Linux box

What this is for: putting a run of record behind the claim that the BGZF
inflate pool is worth ~2x. Written 2026-09-04, after a first standalone run on
a mac left the claim unconfirmed at the window size this harness uses.

## Where the ~2x actually comes from

Not from this repo. jbrowse-components quotes it in three places —
`packages/core/src/util/bgzfWorkerPool.ts`, `BamAdapter.ts`, and
`website/docs/developer_guides/optimizations.md`:

> **1.95x** end to end, over a 22-view pan and zoom across 1000x long-read
> data, with both arms returning the same 38,246 records.

Its own reference doc, `agent-docs/reference/BGZF_WORKER_POOL.md`, is careful
that **1.95x is BAM's**, and puts tabix at 1.34-1.46x over 50-400 kb windows on
a 213 MB slice of 1000 Genomes — "quoting the BAM figure for a VCF track
overstates it by a third".

## What jb2bench measures against that

The standalone arm now has a run of record (`results/bgzfpool.md`). Over five
19 kb windows, min of nine rounds, four workers:

| | jb2bench, query alone | jbrowse-components |
| --- | --- | --- |
| BAM, 1000x long read | **1.65x** | 1.95x end to end |
| BAM, 1000x short read | 1.31x | — |
| Tabix VCF, 3,000 samples | 1.28x (full GT) / 1.11x (GT only) | 1.34-1.46x |

**Tabix agrees** — their windows are 50-400 kb against these 19 kb, and the
speedup rises with the size of the chunk a query resolves to, which is the one
axis that explains every panel of the figure.

**BAM is in tension and is the thing worth resolving.** 1.95x end to end sits
*above* the 1.65x this arm measures with nothing above the query, and that is
backwards: the standalone arm is supposed to be the ceiling, because jbrowse
still pays the RPC hop, feature conversion, layout and paint. Three candidates,
and the end-to-end arm is what tells them apart:

- **Concurrency.** This arm issues one window at a time, so four workers serve
  a single query. A real pan has several block queries in flight sharing one
  pool — more parallel work than this arm ever offers. If that is the answer,
  the standalone arm understates BAM rather than bounding it.
- **The zoom-out view.** 38,246 records over 22 views averages 1,738, almost
  exactly this corpus's ~1,700 per window at 1000x long read. But an average
  hides a zoom-out, and one much larger view could be carrying the total.
- **A different fixture.** No quote names the file, so "1000x long-read data"
  may not be this corpus's `1000x.longread.bam`.

So: don't set out to "confirm 2x". Set out to find which of those three it is.

## Do the two things that are actually blocking

### 1. The end-to-end arm needs rewiring — do NOT reinstate the config slot

`scripts/bgzfpool/endtoend.ts` compares a track against a `.nopool` twin, which
depended on a `useBgzfWorkerPool` config slot on BamAdapter / VcfTabixAdapter /
Gff3TabixAdapter. **That slot was removed on purpose — it was test-only and is
not something to ship.** Don't add it back.

Today `sharedBgzfWorkerPool()` is called unconditionally, so if you run
endtoend.ts as-is, mobx-state-tree drops the unknown `.nopool` key, both arms
run pooled, and you get ~1.00x with a blob-worker column reading 4/4.

Compare two **builds** instead, which is how this repo already compares
webgl-poc against releases:

- `builds/pool` — jbrowse-web built from the tree unmodified.
- `builds/nopool` — the same tree with one local, never-committed edit to
  `packages/core/src/util/bgzfWorkerPool.ts` making `sharedBgzfWorkerPool()`
  return `Promise.resolve(undefined)`. That is the documented fallback path, so
  every adapter then inflates in process with no other behaviour change.

Then change `endtoend.ts` to take two base URLs rather than a track and its
twin. Keep the blob-worker gate exactly as it is — it is what proves the two
arms differ: **4 on the pool build, 0 on the nopool build.** Any other pair
means the arms were not different and the run is worthless.

### 2. Widen the windows, at least for tabix

`scripts/bgzfpool/windows.ts` uses five 19 kb windows. For **tabix** that is
demonstrably too narrow to meet jbrowse-components on its own ground: its
1.34-1.46x came from 50-400 kb windows, and this arm's VCF cells top out at
1.28x. Add a wide-window set alongside the 19 kb one and the two should meet.

For **BAM** the case is weaker than it first looks — 38,246 records over 22
views averages 1,738, and this corpus already returns ~1,700 per 19 kb window
at 1000x long read, so the per-view volume may already match. Widen it anyway
to see whether the ratio keeps climbing, but the BAM gap is more likely
concurrency than window size, and that is an end-to-end question rather than a
windows.ts one.

Keep any new windows non-overlapping — jbrowse caches decoded records per
region and raw bytes per 256 KiB chunk, so a repeat window times a cache hit
rather than an inflate.

## Prerequisites

- **Linux.** `endtoend.ts` gates on `scripts/render/loadavg.ts`, which reads
  `/proc`. This is the reason the run goes to that box.
- The corpus. `make corpus`. Needs wgsim, minimap2, samtools, bgzip, tabix and
  **pbsim2** — pbsim2, not pbsim3: `data/R103.model` and the `--hmm_model` flag
  in `shell/generate_alignments.sh` are pbsim2's interface. It is not in any
  package manager; build it:
  ```bash
  git clone --depth 1 https://github.com/yukiteruono/pbsim2.git
  cd pbsim2 && autoreconf -i && ./configure && make -j8   # binary at src/pbsim
  ```
- R with jsonlite, ggplot2, ggrepel, ragg.
- `JB2` / `JBROWSE` pointing at a jbrowse-components checkout with its
  dependencies installed. The standalone arm bundles `@gmod/bam`,
  `@gmod/tabix` and `@gmod/bgzf-filehandle` out of it, not out of this repo's
  node_modules, so both arms are the same code.

## Running it

**`make bgzfpool-*` will refuse to start, and not for a reason that matters
here.** Both targets depend on `gate`, and `scripts/gate.ts` exits 1 if *any*
check fails — including the three render builds it expects served on ports
8000, 8001 and 8004, and the parser sweep builds under `ecosystem/.libs/`. The
BGZF pool benchmark uses none of those. So either stage all of that, or read
the load with `--warn` and call the scripts directly:

```bash
node --experimental-strip-types scripts/gate.ts --warn   # reports, exits 0
JBROWSE=$HOME/src/jbrowse-components \
  node --experimental-strip-types scripts/bgzfpool/standalone.ts 9
# ... after doing (1) above:
npx http-server builds/pool   -p 8010 -s --cors &
npx http-server builds/nopool -p 8011 -s --cors &
node --experimental-strip-types scripts/bgzfpool/endtoend.ts 5
make paper-data paper-figs      # csv, then results/figures/paper/*/bgzfpool.*
```

Watch the foreign-cores line in the `--warn` output rather than the load
average; `loadavg.ts` explains at length why the load average alone marks clean
measurements dirty.

`bgzfpool-data.R` runs with only the standalone JSON present and draws a
one-series figure; it picks up the second series as soon as
`results/bgzfpool.json` exists.

`make paper-data` also regenerates the clustering CSVs out of the
jbrowse-components checkout, and on 2026-09-04 that **overwrote the committed
2026-09-03 cluster numbers with older 2026-08-24 ones**. Check `git diff
results/paper/` after running it and restore anything you did not mean to
touch.

## Traps that are not in the ratio

### patch_nopool.js is half dead, and the live half is load-bearing

`shell/patch_nopool.js` does two things, and only the first is obsolete:

- it adds the `.nopool` twins off the removed config slot — dead, and the
  reason the end-to-end arm needs the two-build rework above;
- **it raises `fetchSizeLimit` to 1e10 on every bgzip-backed track** — very much
  alive. Over the 5 MB default a track renders "Requested too much data" and
  never fetches: no error, no failing render, just an arm that is fast because
  it did nothing. A 3,000-sample VCF over a 19 kb window is comfortably past it,
  and a wide window puts the BAM tracks past it too.

So do not delete the script as dead code. Keep the `fetchSizeLimit` pass and
apply it to **both** builds.

### make corpus fails at the end without builds/ staged

`corpus` finishes with `load_alignments.sh` and `load_bgzf_tracks.sh`, which
both `for l in builds/*` under `set -e`. With no `builds/` the glob stays
literal, `jbrowse add-assembly --out 'builds/*'` fails, and the target aborts —
*after* every generate step has succeeded. Stage the builds first, or run the
`shell/generate_*.sh` scripts individually and the loaders afterwards.

## Two gates, and a third that already bit

- **Foreign CPU.** Above 0.5 cores of other people's work, drop the row.
- **The pool never engaged.** Blob workers must be 4/0 across the arms.
- **The renderer heap.** `1000x.longread.bam` is the heaviest query in the
  corpus and the one the BAM claim rests on. `getRecordsForRange` materializes
  every record, and at the 8 GB default it failed with
  `Array buffer allocation failed`. `standalone.ts` takes `HEAP_MB` now
  (default 8192); at `HEAP_MB=24576` the cell measures, but still only over
  **three** rounds — at nine it failed again, the second time as
  `Failed to fetch`. Three rounds gave 1.69x and 1.65x on separate runs, so
  re-take it on its own with fewer rounds rather than dropping it:

  ```bash
  TRACKS=1000x.longread.bam HEAP_MB=24576 \
    node --experimental-strip-types scripts/bgzfpool/standalone.ts 3
  ```

  A `TRACKS=` run merges into `results/bgzfpool-standalone.json` rather than
  replacing it, and each cell records the rounds and heap it was taken at, so a
  table assembled from two sittings says so. It refuses to merge across
  differing library versions.

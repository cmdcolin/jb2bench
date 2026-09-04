# Running the BGZF worker-pool benchmark on the Linux box

What this is for: putting a run of record behind the claim that the BGZF
inflate pool is worth ~2x. Written 2026-09-04, after a first standalone run on
a mac left the claim unconfirmed at the window size this harness uses.

## Where the ~2x actually comes from

Not from this repo. It is in jbrowse-components, in the docstring of
`packages/core/src/util/bgzfWorkerPool.ts`:

> Measured 1.95x end to end on the BAM side: a 22-view pan / zoom out / pan
> back over 1000x long-read data, real HTTP, headless Chrome, 4 workers, with
> both arms returning the same 38,246 records.

Read what that measured: **22 views including a zoom out**, over **1000x long
read**. Large regions, large chunks. That is the regime the pool has the most
to divide.

`scripts/bgzfpool/windows.ts` measures something else — five **19 kb** windows.
That is a small region, and the first standalone run says so:

| track | pool on ÷ pool off |
| --- | --- |
| 20x / 200x / 1000x shortread BAM | 1.24x / 1.32x / 1.30x |
| 20x / 200x longread BAM | 1.49x / 1.40x |
| 1000x longread BAM | did not fit in the renderer heap |
| VCF full genotypes, 100 / 1,000 / 3,000 samples | 1.13x / 1.26x / 1.24x |
| VCF genotypes only, 100 / 1,000 / 3,000 samples | 0.95x / 1.08x / 1.07x |

Raw: `results/bgzfpool-standalone.json`. Figure:
`results/figures/paper/png/bgzfpool.png`.

So at 19 kb nothing reaches 2x, and the trend is the one the pool doc predicts:
the ratio grows with the size of the chunk a query resolves to. **The claim is
not contradicted — it is untested at its own window size.** The two cells that
would test it are the ones missing above: 1000x long read, at a wide view.

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

### 2. Measure at the window size the claim is about

Add a wide-window set to `scripts/bgzfpool/windows.ts` alongside the 19 kb one,
sized to the zoom-out in the 1.95x measurement, and run the 1000x long-read
cell there. Keep the windows non-overlapping — jbrowse caches decoded records
per region and raw bytes per 256 KiB chunk, so a repeat window times a cache
hit rather than an inflate.

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
- **The renderer heap.** `1000x.longread.bam` failed the standalone arm on the
  mac with `RangeError: Array buffer allocation failed` — `getRecordsForRange`
  materializes every record, and at 1000x long read over even a 19 kb window
  that is more than the renderer will allocate. `standalone.ts` now launches
  Chrome with `--max-old-space-size=8192`, records a cell that still does not
  fit as `{failed}` rather than dying, and saves after every track. If the cell
  still fails on Linux, raise the heap further rather than dropping the cell —
  it is the one the 1.95x claim rests on.

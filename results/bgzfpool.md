# BGZF worker pool, on vs off, end to end in jbrowse

Does the BGZF inflate pool make a **pan** faster in jbrowse, for BAM and for
tabix VCF, and how much of the library-level speedup survives to the user?

## Runs of record

The figure is [`figures/paper/png/bgzfpool.png`](figures/paper/png/bgzfpool.png),
drawn by `scripts/paperfigs/bgzfpool.R` from `paper/bgzfpool.csv`. It carries
one series until an end-to-end run exists to draw beside it.

**The standalone arm, 2026-09-04.** Min per window over nine rounds, five
non-overlapping 19 kb windows on `chr22_mask`, four workers, 24 GB renderer
heap, bundled from `@gmod/bam@9.0.1 @gmod/tabix@3.8.2
@gmod/bgzf-filehandle@6.6.0`. Raw in `results/bgzfpool-standalone.json`, which
records the rounds and heap behind each cell.

| track | records / window | pool on ÷ pool off |
| --- | --- | --- |
| 20x shortread BAM | ~3,000 | 1.23x |
| 200x shortread BAM | ~30,000 | 1.25x |
| 1000x shortread BAM | ~153,000 | 1.31x |
| 20x longread BAM | ~40 | 1.49x |
| 200x longread BAM | ~350 | 1.55x |
| 1000x longread BAM | ~1,700 | 1.65x |
| VCF full genotypes, 100 / 1,000 / 3,000 samples | ~316 | 1.11x / 1.24x / 1.28x |
| VCF genotypes only, 100 / 1,000 / 3,000 samples | ~316 | 0.93x / 1.05x / 1.11x |

One axis explains the whole table, and it is not coverage or sample count as
such: it is how many bytes the query resolves to. Every panel rises with it,
and the smallest chunk here — 100 samples, genotypes only — is the one that
falls below 1.0, where the round trip costs more than the parallelism returns.

The 1000x long-read cell is min of **three** rounds, not nine. It is the
heaviest query in the corpus and does not survive nine: at nine it failed twice
on this box, once as `Array buffer allocation failed` and once as
`Failed to fetch`. Three rounds gave 1.69x and 1.65x on two separate runs, so
the number is stable even though the cell is not.

## How this reads against jbrowse-components' own numbers

jbrowse-components quotes the pool in two places, and this arm agrees with one
of them and is in tension with the other.

**Tabix: agrees.** `agent-docs/reference/BGZF_WORKER_POOL.md` reports
1.34-1.46x over 50-400 kb windows on a 213 MB slice of 1000 Genomes. This arm
gets 0.93-1.28x over **19 kb** windows on synthetic callsets. Same direction,
smaller windows, smaller numbers — their windows are 2.6-21x wider than these,
and the table above says what widening a window does.

**BAM: in tension, and worth resolving.** `BamAdapter.ts` and
`website/docs/developer_guides/optimizations.md` both quote **1.95x end to end,
over a 22-view pan and zoom across 1000x long-read data, both arms returning
the same 38,246 records**. This arm measures **1.65x** for that same file with
*nothing above the query*.

That is backwards. This figure's premise — stated in the section below and in
`results/crampool.md` before it — is that the library alone is an upper bound
the user never experiences, because jbrowse still pays the RPC hop, feature
conversion, layout and paint around every query. An end-to-end figure above the
library-alone ceiling means one of the following, and the end-to-end arm is
what would tell them apart:

- **Concurrency.** This arm issues one window at a time, so four workers are
  fed by one query. A jbrowse pan has several block queries in flight at once
  sharing the one pool, which is *more* parallel work than this arm ever
  offers. If so the ceiling framing is wrong for BAM and the standalone arm
  understates rather than overstates.
- **The zoom-out view.** 38,246 records over 22 views averages 1,738, which is
  almost exactly this corpus's ~1,700 per window at 1000x long read. But an
  average hides a zoom-out, and if one view in that sequence covered far more
  than the rest it could carry the total.
- **A different fixture or box.** Neither quote names the file, so "1000x
  long-read data" may not be this corpus's `1000x.longread.bam`.

Until that is settled, **1.65x is what this repo can show for BAM**, and the
1.95x is someone else's measurement of something not yet reproduced here.

**The end-to-end arm: still none.** It compared a track against a `.nopool`
twin driven by a `useBgzfWorkerPool` config slot, and that slot was removed
from jbrowse-components deliberately — it was test-only and is not shipping.
The arm needs rewiring to compare two builds instead; see
`agent-docs/bgzfpool-linux-runbook.md`.

## What is being compared

Two measurements over the same files, the same five non-overlapping 19 kb
windows on `chr22_mask`, and the same four workers:

| arm | script | what surrounds the query |
| --- | --- | --- |
| query alone | `scripts/bgzfpool/standalone.ts` | nothing — `@gmod/bam` and `@gmod/tabix` straight, over real HTTP range requests |
| in jbrowse, end to end | `scripts/bgzfpool/endtoend.ts` | an RPC hop, feature conversion, layout and paint |

The gap between them is the point. A pool speedup quoted from the library alone
is an upper bound a user never experiences, and this repo has made that mistake
in the other direction once already — `results/crampool.md` records the CRAM
slice pool measuring 2.21x on the decode and being quoted at nothing like that
end to end. The two arms together are what make an end-to-end number checkable
rather than asserted.

## Why a pan and not a cold load

A page load re-pays app boot, chunk fetch and assembly resolution every run,
roughly 2 s of constant work the inflate is a slice of. The cold-load instrument
measured 0.99x on the CRAM pool saying exactly this. A pan pays none of it — the
app is up, the assembly is resolved, the worker is warm and its wasm is
instantiated — so what is left is fetch, inflate, decode, convert and draw.

Each pan goes somewhere not yet visited: jbrowse caches decoded records per
region and raw bytes per 256 KiB chunk, so panning back over a window measures a
cache hit rather than an inflate.

## Two ways a row can be worthless

Neither shows up in the ratio, so both are gates rather than notes.

- **Foreign CPU.** Above 0.5 cores of other people's work the timing is not
  comparable to one taken on a quiet box. Same ceiling as every other benchmark
  here; see `scripts/render/loadavg.ts`.
- **The pool never engaged.** `getSharedWorkerPool()` returns `undefined`
  wherever a Worker cannot be created, and every read then quietly inflates in
  process — no error, no failing render, just the speedup gone. jbrowse-web runs
  adapters under `WebWorkerRpcDriver`, so the pool is a worker spawning workers,
  and nested workers are the thing that can be missing. So each arm counts the
  `blob:` worker targets Chrome creates: **4/0** is the pool on in one arm and
  off in its twin, and anything else means the two arms were not different.

## Running it

Needs a jbrowse-web built from a tree carrying the `useBgzfWorkerPool` config
slot on `BamAdapter`, `VcfTabixAdapter` and `Gff3TabixAdapter`. Without it the
`.nopool` twin is still created, mobx-state-tree drops the unknown key, both
arms run pooled, and the blob-worker column is what says so.

```bash
make corpus                           # includes generate_bgzf_vcf.sh and,
                                      # once builds/ is staged, the .nopool twins
npx http-server builds/current -p 8010 -s --cors &
make bgzfpool                         # both arms, gated and logged
make paper-data paper-figs            # csv, then the figure
```

`make bgzfpool` runs `make gate` first, which is the point: neither arm means
anything on a box that is not idle. To take one arm on its own, or a subset of
the corpus:

```bash
make bgzfpool-standalone
make bgzfpool-endtoend
TRACKS=1000x.longread.bam,variants.pool.3000.wide.vcf.gz \
  node --experimental-strip-types scripts/bgzfpool/endtoend.ts 5
```

If the corpus is being built by hand rather than through `make corpus`, the
order is `generate_alignments.sh`, `generate_bgzf_vcf.sh`, then — with the build
staged in `builds/` — `load_alignments.sh` and `load_bgzf_tracks.sh`.

The standalone arm bundles `@gmod/bam`, `@gmod/tabix` and
`@gmod/bgzf-filehandle` out of the jbrowse-components checkout rather than this
repo's `node_modules`, so both arms are the same code; the versions it bundled
are recorded in `results/bgzfpool-standalone.json`. Where that checkout is
comes from `JB2` through the Makefile (`$HOME/src/jbrowse-components`) and from
`JBROWSE` when the script is run directly (`../jbrowse-components`).

# BGZF worker pool, on vs off, end to end in jbrowse

Does the BGZF inflate pool make a **pan** faster in jbrowse, for BAM and for
tabix VCF, and how much of the library-level speedup survives to the user?

## Runs of record

The figure is [`figures/paper/png/bgzfpool.png`](figures/paper/png/bgzfpool.png),
drawn by `scripts/paperfigs/bgzfpool.R` from `paper/bgzfpool.csv`. It carries
one series until an end-to-end run exists to draw beside it.

**The standalone arm, 2026-09-04.** Nine rounds, min per window, five
non-overlapping 19 kb windows on `chr22_mask`, four workers, bundled from
`@gmod/bam@9.0.1 @gmod/tabix@3.8.2 @gmod/bgzf-filehandle@6.6.0`. Written by
`scripts/bgzfpool/standalone.ts`; raw in `results/bgzfpool-standalone.json`.

| track | pool on ÷ pool off |
| --- | --- |
| 20x shortread BAM | 1.24x |
| 200x shortread BAM | 1.32x |
| 1000x shortread BAM | 1.30x |
| 20x longread BAM | 1.49x |
| 200x longread BAM | 1.40x |
| 1000x longread BAM | did not fit in the renderer heap |
| VCF full genotypes, 100 / 1,000 / 3,000 samples | 1.13x / 1.26x / 1.24x |
| VCF genotypes only, 100 / 1,000 / 3,000 samples | 0.95x / 1.08x / 1.07x |

The shape is the one `@gmod/bgzf-filehandle`'s worker-pool doc describes: the
ratio grows with the size of the chunk a query resolves to, and the smallest
chunk here — 100 samples, genotypes only — sits below 1.0, where the round trip
costs more than the parallelism returns.

**This does not yet test the 1.95x in jbrowse-components.** That number, in the
docstring of `packages/core/src/util/bgzfWorkerPool.ts`, was measured over a
22-view pan / zoom out / pan back on 1000x long-read data. These windows are
19 kb, which is a far smaller chunk, and the one cell that would speak to the
claim is the one that did not fit. Nothing here contradicts 1.95x; nothing here
confirms it either. See `agent-docs/bgzfpool-linux-runbook.md`.

**The end-to-end arm: still none.** It compared a track against a `.nopool`
twin driven by a `useBgzfWorkerPool` config slot, and that slot was removed
from jbrowse-components deliberately — it was test-only and is not shipping.
The arm needs rewiring to compare two builds instead; the runbook above says
how.

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

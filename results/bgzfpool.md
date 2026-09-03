# BGZF worker pool, on vs off, end to end in jbrowse

Does the BGZF inflate pool make a **pan** faster in jbrowse, for BAM and for
tabix VCF, and how much of the library-level speedup survives to the user?

## Runs of record: none

The harness and the corpus are in place and the instrument is verified
sensitive, but nothing has been measured on a quiet box yet. Every number that
appears here from now on is written by `scripts/bgzfpool/endtoend.ts`, which
overwrites this file.

The one thing measured so far is that the standalone arm works and responds to
the axis it is supposed to: on a **contended** 16-core laptop at load 8,
`variants.pool.1000.wide` came out 1.19x and `variants.pool.3000.wide` 1.29x,
each tight across its five windows, while `variants.pool.100.gtonly` sat at
0.98x — which is the small-chunk regime `@gmod/bgzf-filehandle`'s worker-pool
doc describes, where a query resolves to one or two blocks and the round trip
costs more than the parallelism returns. Those are not results. They are the
evidence that the instrument moves when the thing it measures moves.

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
shell/generate_alignments.sh          # BAM corpus, if not already built
shell/generate_bgzf_vcf.sh            # the VCF sweep, spanning every window
# stage the build in builds/, then
shell/load_alignments.sh
shell/load_bgzf_tracks.sh             # VCF tracks + a .nopool twin of each
npx http-server builds/current -p 8010 -s --cors &

node --experimental-strip-types scripts/bgzfpool/standalone.ts 9
node --experimental-strip-types scripts/bgzfpool/endtoend.ts 5

Rscript scripts/paperfigs/bgzfpool-data.R
Rscript scripts/paperfigs/bgzfpool.R
```

The standalone arm bundles `@gmod/bam`, `@gmod/tabix` and
`@gmod/bgzf-filehandle` out of the jbrowse-components checkout rather than this
repo's `node_modules`, so both arms are the same code; the versions it bundled
are recorded in `results/bgzfpool-standalone.json`. Set `JBROWSE` if the
checkout is not `../jbrowse-components`.

# Worker-side hotspot analysis — decides the "profile-gated" plugin refactors

Follow-up to `FINDINGS.md` (which diagnosed the *main-thread* `placeRect`
regression). This one looks at the **RPC worker** CPU profile for the heaviest
case (`1000x.shortread.bam`, `chr22_mask:124000-143000`, ~1M reads) to decide
whether candidate `plugins/alignments` optimizations are worth doing.

**Rewritten 2026-08-11 against a build of that day's `main`** (plus three
GFF3/GTF parsing commits in flight at the time, which touch no alignments code
and appear nowhere in this trace). The previous version of this file was
captured against a Jun 13 build and said so at the top: its verdicts were
"still true because those code paths weren't touched," reasoned rather than
measured, and its headline cost had already been fixed in July. Everything
below is now measured. Two of the three old verdicts survive and are stated
more strongly; one claim about what the worker is *dominated by* was wrong and
is corrected.

## How this was captured, including two things that had to be fixed first

```bash
# build products/jbrowse-web from the jbrowse-components checkout, then
cp -r products/jbrowse-web/build builds/aug11-current
jbrowse add-assembly --load copy data/hg19mod.fa --out builds/aug11-current --force --name hg19mod
# add the 12 alignment tracks as in shell/load_alignments.sh, then raise the limit (below)
npx http-server builds/aug11-current -p 8000 -s --cors &
node --experimental-strip-types scripts/flamegraph/flameprofile.ts \
  "http://localhost:8000/?loc=chr22_mask:124000-143000&assembly=hg19mod&tracks=1000x.shortread.bam" \
  aug11-1000short
node --experimental-strip-types scripts/flamegraph/resolve.ts \
  flame/aug11-1000short.worker1-*.cpuprofile builds/aug11-current/static/js 120
```

Frames resolve through the build's sourcemaps, so the names below are original
source, not minified.

**`fetchSizeLimit` blocks this window outright.** At 1000x coverage the 19 kb
benchmark window is a 28.1 MB fetch, and `BamAdapter`/`CramAdapter` default
`fetchSizeLimit` to 5 MB. The track renders "Requested too much data (28.1 Mb).
Zoom in to see features, or force load" and *never fetches*, so a profile of it
contains no BAM work at all. The fixture raises the slot to 1e9 on all 12
tracks. Anyone reproducing this on a fresh build must do the same or they will
profile an empty browser — the run does not fail, it succeeds at measuring
nothing.

**The render-complete detector was stale and failed silently.** It waited on
`[data-testid$="-done"]`, and JBrowse's ADR-065 (2026-08-10) stopped mutating
`data-testid` on first paint, moving readiness to the `data-display-drawn`
attribute published beside it. Against any build after that date the old probe
matches nothing, `ready` never goes true, and the run dies on its 120 s timeout
with no profile written. `scripts/flamegraph/flameprofile.ts` now waits on
`[data-display-drawn="true"]` for every `[data-display-drawn]` element, *and* on
`[data-display-phase="loading"]` being absent — `drawn` flips on FIRST paint, so
waiting on it alone would stop the profiler partway through the fetch it is
trying to measure.

Render elapsed: 5176 ms. Profile: 19,234 main-thread samples, 10,165 worker.

## Top worker self-time

Sampled at 200 µs. Total 2745 ms wall in the profile, of which 936 ms (34%) is
idle. The percentages below are against the **1641 ms of busy time** covered by
the 120 hottest frames (94% of sampled time).

| self | frame | where |
| ---: | --- | --- |
| 171 ms | `dedupeById` | `RenderAlignmentDataRPC/executeRenderAlignmentData.ts:99` |
| 94 ms | `concatUint8Array` | `@gmod/bgzf-filehandle/src/util.ts` |
| 75 ms | `id()` | `BamAdapter/BamSlightlyLazyFeature.ts:81` (two frames, 41 + 34) |
| 65 ms | `post` | `packages/core/src/rpc/RpcServer.ts:117` |
| 60 ms | `readBamFeatures` | `@gmod/bam/src/bamFile.ts:911` |
| 49 ms | `forEachMismatchNumeric` | `@gmod/bam/src/mismatches.ts:208` |
| 47 ms | (anon) | `alignments/src/shared/extractFeatureArrays.ts:54` |
| 45 ms | (anon) | `alignments/src/shared/computeFrequenciesAndThresholds.ts:17` |
| 34 ms | (anon) | `alignments/src/features/mismatch/extract.ts:3` |
| 33 ms | `buildBaseFeatureData` | `alignments/src/shared/buildBaseFeatureData.ts:25` |
| 32 ms | `get name` | `@gmod/bam/src/record.ts:481` |
| 32 ms | `getTagAlt` | `@gmod/bam/src/record.ts:533` |

By area, summed rather than eyeballed:

| self | % of busy | area |
| ---: | ---: | --- |
| 417 ms | 25.4% | `@gmod/bam` record decode (all of `record.ts`, `bamFile.ts`, `mismatches.ts`) |
| 290 ms | 17.7% | alignments feature extraction (`shared/`, `features/`) |
| **246 ms** | **15.0%** | **`dedupeById` + the `id()` strings it consumes** |
| 195 ms | 11.9% | garbage collector |
| 178 ms | 10.8% | RPC plumbing (`RpcServer.post`, chunk loading) |
| 119 ms | 7.3% | bgzf decompression *on this thread* — see the gap below |
| 58 ms | 3.5% | coverage (`alignments-core`) |

The remaining 138 ms is range-cache/IO (31 ms), other `RenderAlignmentDataRPC`
frames (14 ms), and 93 ms spread thinly enough not to classify — the largest
single one of those is 12 ms. The areas are first-match-wins over the frame's
resolved path, so nothing is counted twice.

## The one real lead: a dup guard that cost 15% of the worker — now fixed

> **Done, 2026-08-11.** Keyed on the record's number instead of its id string.
> Paired arms, alternating, one profile each per round: the dedupe plus the
> `id()` it drove went from a median **12.5% of busy worker time to 5.9%**, with
> no overlap between the arms across four rounds (old 11.6/12.5/13.4/11.2, new
> 5.9/5.5/4.7/5.9). Isolated on 153,677 real fileOffsets from the fixture, the
> dedupe itself is **3.19x** (178.7 → 63.2 ms).
>
> Note the 15.0% in the heading came from the single unpaired profile below; the
> paired median is 12.5%, and that is the figure to quote. The residual 5.9% is
> mostly `buildBaseFeatureData`, which needs the id string per feature for the
> payload and was not touched.
>
> The guard was kept rather than deleted, and the section below says why — the
> investigation that priced it also established it is not currently catching
> anything.

> **Also fixed since this was written:** the profiler only ever attached to one
> worker, so the bgzf pool was invisible. It now recurses, and the gap section
> at the end carries what the pool costs.

`filterChainFeatures` calls `dedupeById(features)` on every alignment render,
and its own comment says why it is unconditional: it "applies in both pileup and
chain mode (it short-circuits to a plain dedupe when both are kept, the
default)". The guard exists for a rare case — "only when overlapping BAM index
chunks re-decode one read" — and in the common case returns the input array
untouched.

What it costs to find that out, at ~1M reads, is a `Set<string>` of one million
strings. `BamSlightlyLazyFeature.id()` is
`` `${this.adapter.id}-${this.fileOffset}` ``, so each membership test also
builds a fresh template literal. That is the 171 ms and the 75 ms, and a fair
share of the 195 ms of GC behind them: **246 ms, 15% of busy worker time, to
detect duplicates that are usually not there.**

**Is the guard catching anything?** Asked while pricing it, and the answer is
no. `@gmod/bam`'s `blocksForRange` runs `optimizeChunks`, which absorbs a chunk
already covered by its neighbour; a sweep of ~4800 index queries across the six
fixtures found **zero overlapping chunk pairs**, including where the 5 MB merge
cap fires — the only branch that looked like it could push an overlapping chunk,
and it does fire here (spans reach 90 MB on 1000x.longread). Fetching the
benchmark window on all six found **zero duplicate fileOffsets**, at up to
153,677 records.

The motivation that is genuinely gone is older than the comment's: block
rendering fetched adjacent overlapping regions, so a feature spanning a boundary
arrived twice. There are no blocks now, and one call means one region from one
adapter.

It was kept rather than deleted, because at the numeric price it is nearly free,
because the failure it prevents is silent — a doubled coverage depth, not a
crash — and because the class is not hypothetical: `@gmod/bam` hit it in its own
mate path ("their records came back twice") and still keeps a `readIds` set
there, keyed on `fileOffset`. Which is where the fix came from too.

The shape of that fix was visible from the identity itself: within one call every
feature comes from one adapter, so the `${adapter.id}-` prefix is constant and
the whole key is carried by the numeric `fileOffset`. A `Set<number>` over that
does the same job with no string allocation. Three things checked before doing
it, none of which this profile answers:

- `filterChainFeatures` is typed over `Feature`, not over the BAM feature, and
  the CRAM path reaches it too — but both already have a number behind the
  string. `BamSlightlyLazyFeature.id()` is `` `${adapter.id}-${fileOffset}` ``
  (`fileOffset` off the `BamRecord` it extends) and
  `CramSlightlyLazyFeature.id()` is `` `${adapter.id}-${record.uniqueId}` ``. So
  this wants a numeric accessor declared once and implemented on both, not a
  cast and not a change to `Feature` itself.
- The constant prefix really is constant: `fetchFeaturesFromAdapter` takes a
  single `adapterConfig`, so every feature in one call comes from one adapter
  and the `${adapter.id}-` half of the key distinguishes nothing.
- The same function builds a second `Set` of `id()` strings (`keptIds`) further
  down, but only on the non-default filtered paths, so it is not in this trace.
  It moved to the same key, since the reasoning is identical.

This was the item the old version of this file was looking for and did not have:
a cost that is large, in our code rather than a dependency, and paid on the
default path rather than an opt-in mode. It is worth noting how it was found —
not by looking for it, but by re-profiling to check somebody else's stale
verdicts, two of which turned out to be right.

## Verdicts on the previously profile-gated items

- **`BamSlightlyLazyFeature.get(field)` switch dispatch — still NOT WORTH IT,
  now measured.** It is 21 ms, **1.3% of busy**, summed across the five frames
  that resolve to `BamSlightlyLazyFeature.ts:145`. The June profile put it at
  ~1% and the BamAdapter CLAUDE.md called a rewrite "a deliberate refactor, not
  a drive-by"; two months of changes later it is still ~1%. Skip.

- **`computeMismatchFrequencies` / `computePositionFrequencies` Map counting —
  NOT WORTH IT, and now visible rather than absent.** The frequency work is
  62 ms, **3.8% of busy**, over five frames in
  `computeFrequenciesAndThresholds.ts` (the counting loop at :17 is 45 ms of
  it). A typed-array rewrite could not return more than that, and only if it
  were free. Skip.

- **The mod-path optimizations — still CANNOT be benchmarked here.** The fixture
  BAMs carry no MM/ML tags, so `extractModifications` is never entered. Unchanged
  from the June write-up; see the gap below.

## What changed since the June profile

**`_computeTags` is gone, confirmed.** It was the single biggest non-idle cost
in June (586 ms, 9%), caused by @gmod/bam parsing *all* of a record's tags on
first `.tags` access. The old file predicted commit `b4da28ba7a` (2026-07-02,
targeted `getTag` reads) had fixed it but could not show it. It does not appear
anywhere in the 120 hottest frames now. What appears instead is exactly the
replacement: the targeted tag readers (`getTagAlt`, `getTagRaw`,
`decodeTagValue`, `tagValueEnd`) sum to 89 ms over seven frames, and `_findTag`
to 54 ms over two — **143 ms against 586 ms**, for tag reads that now decode
only what was asked for.

**The old file's follow-on claim was wrong.** It reasoned that with
`_computeTags` removed "the worker is dominated by irreducible bgzf/WASM
decompression". It is not: bgzf is 119 ms, **7.3%** of busy time on this thread.
The worker is dominated by BAM record decode (25%) and our own feature
extraction and dedupe (33% between them). Two things moved underneath that
prediction — the tag fix removed a cost that was inflating the denominator, and
inflation moved to a shared bgzf worker pool (see the gap). Reasoning forward
from a stale profile got the direction right and the destination wrong.

**The main thread is no longer the story for this case.** It is 82% idle. The
hottest main-thread frames are `RpcClient.handler` (56 ms), `sortLayout.ts`
(52 ms across three frames) and the two `packGpu.ts` packers (29 ms). Whatever
`FINDINGS.md` diagnosed on the main thread, this case does not reproduce it.

## Gaps to close before the next pass

**~~The bgzf pool workers are not in this profile~~ — fixed, and measured.**
The table above still covers the RPC thread only, so its 7.3% is bgzf cost *on
that thread*; here is what was missing.

It was the first of the two guesses: `Target.setAutoAttach` on the page session
reaches the page's own workers and stops. The bgzf pool is spawned *by* the RPC
worker, so those threads are children of a worker target and were never
attached — the profiler captured one worker and reported success.
`flameprofile.ts` now re-arms `setAutoAttach` on every session it attaches, so
the walk recurses to any depth. The same run that captured 1 worker captures 6
threads.

What the pool actually costs, on the `1000x.shortread` render:

| thread | busy | idle | hottest |
| --- | ---: | ---: | --- |
| main | 814 ms | 3819 ms | |
| RPC worker | 1415 ms | 876 ms | |
| bgzf pool ×4 | 83/92/88/89 ms | ~1985 ms each | `wasm-function[3]`, `decompress_all` |

So the pool is **352 ms of aggregate CPU across four threads**, against 1415 ms
on the RPC worker — real, and enough that "decompression" across all worker
threads is roughly a quarter of worker CPU rather than the 7.3% the RPC thread
alone shows. It is not the hidden giant the June file's "irreducible bgzf/WASM
decompression" prediction implied, though: each pool thread is ~96% idle, and
they run in parallel, so the wall-clock contribution is ~88 ms.

Worth keeping in mind for any future profile here: a thread that is not attached
looks exactly like a thread that is cheap.

**Still no modBAM fixture.** `shell/generate_alignments.sh` (pbsim/wgsim) emits
no MM/ML tags, so the modification color mode cannot be traced at all. To
benchmark it, add a fixture — an ONT 5mCG model output, or MM/ML synthesized
onto the existing longread BAM — and a session that sets
`colorBy: { type: 'modifications' }`.

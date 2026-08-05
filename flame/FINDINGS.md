# 1000x-shortread regression — flamegraph diagnosis

Case: `chr22_mask:124000-143000` (19kb), track `1000x.shortread.bam`, the only
case where `webgl-poc` is slower than release-4.3.0 (7137ms vs 4581ms, 0.64×).

Profiles (main thread + RPC worker) captured with `scripts/flamegraph/flameprofile.ts`,
flamegraphs in `flame/*.svg`, hot frames resolved through the build sourcemaps
with `scripts/flamegraph/resolve.ts`.

## Root cause: per-read layout runs on the MAIN THREAD

On-CPU during the render window:

| thread | webgl-poc | release-4.3.0 |
|---|---:|---:|
| main   | 8861ms (43% busy) | 5159ms (**81% idle**) |
| worker | 6395ms | 4266ms |

release-4.3.0 keeps the **main thread 81% idle** — layout happens in the worker
(prerendered canvas). webgl-poc spends **2116ms (24% of the window) in a single
function on the main thread**:

```
placeRect  (packages/core/src/util/layouts/placeRect.ts:55)   2116ms self
```

Call chain (from the folded stacks) — it's inside a MobX **computed**, re-run as
part of the React render reaction:

```
runReaction_ → unstable_batchedUpdates
  → get renderState        (LinearAlignmentsDisplay/model.ts:1461)
    → get sections          (model.ts:1186)
      → get laidOutByGroup  (model.ts:873)   <-- the layout computed
        → buildLaidOutChainMap / computeChainLayout
          → placeRect  (per read)            <-- 2.1s for ~1M short reads
```

`laidOutByGroup` (model.ts:873) deliberately lays out on the main thread — its
own comment: *"Tag colors are baked here (not in the worker) so colorTagMap
stays a main-thread tier-2 setting."* That keeps re-sort / re-color / re-group
off the worker (no refetch round-trip), but for very high feature counts the
synchronous `placeRect` over every read dominates and loses to the old
worker-side layout.

This is the highest-feature-count case (1000x shortread ≈ 1M reads; both builds
hit "Max layout height reached"), so it's the worst case for any main-thread
per-read pass — exactly where the regression shows and nowhere else.

## Secondary main-thread costs (same computed chain)

```
groupedDataMaps.ts:134                                  152ms
buildReadIdToIndex (renderers/rendererTypes.ts:15)       66ms
sortLayout.ts cloneWithLayout:334 / readExtent:63       ~90ms
```

## Worker side (smaller, secondary)

```
_computeTags  (@gmod/bam record.ts:316)                 586ms (9%)
buildBaseReadArrays.ts:13 / extractFeatureArrays.ts:39 ~180ms
coverageCompute.ts:120 sweepDepths                       53ms
```

`_computeTags` is BAM tag parsing per record — worth checking whether all tags
are needed for the pileup path at this coverage.

## Actionable directions

- **Move the `placeRect` layout off the main thread** for the high-count path —
  do it in the RPC worker (as 4.3.0 did) and transfer `readYs`/`maxY`, OR run it
  in a worker only when feature count crosses a threshold. This recovers most of
  the 3.7s main-thread gap. Tension with the "layout on main thread to avoid
  refetch on re-sort/re-color" design — could keep main-thread layout for the
  cheap re-color/re-sort case but offload the initial heavy layout.
- **Make `placeRect` cheaper at scale** — it's already O(1)/O(log M) per
  placement, but ~1M calls + the surrounding `buildLaidOutChainMap` allocations
  (cloneWithLayout, per-chain maps) add up. Profile allocation/GC (GC was ~71ms
  main here, modest, so it's compute not GC).
- **Trim `_computeTags`** in the worker if pileup doesn't need every tag.

## Reproduce

```bash
node scripts/flamegraph/flameprofile.ts "http://localhost:8000/?loc=chr22_mask:124000-143000&assembly=hg19mod&tracks=1000x.shortread.bam&renderer=webgl" webgl-1000short
node scripts/flamegraph/cpuprofile2collapsed.ts flame/webgl-1000short.main.cpuprofile > flame/webgl-main.folded
perl scripts/flamegraph/flamegraph.pl flame/webgl-main.folded > flame/webgl-main.svg
node scripts/flamegraph/resolve.ts flame/webgl-1000short.main.cpuprofile builds/webgl-poc/static/js 16
```

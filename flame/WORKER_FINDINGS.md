# Worker-side hotspot analysis — decides the "profile-gated" plugin refactors

Follow-up to `FINDINGS.md` (which diagnosed the *main-thread* `placeRect`
regression). This one looks only at the **RPC worker** CPU profile for the same
heaviest case (`1000x.shortread.bam`, `chr22_mask:124000-143000`, ~1M reads,
`webgl-poc` June build) to decide whether three candidate
`plugins/alignments` optimizations are worth doing.

## ⚠️ The captured profiles are STALE (build = Jun 13)

The single biggest non-idle worker cost below, `_computeTags` (586ms / 9%,
full-record tag parse triggered by `.tags`), was **already fixed after this
build**: commit `b4da28ba7a` (2026-07-02, "targeted SA/MM/ML tag reads, skip
full-record tag parse") switched `extractFeatureArrays`' tag reads to
BamRecord's targeted `getTag`, which decodes only the requested tag. So the
top of this profile no longer reflects current source. Anything worker-side
below `_computeTags` is small enough that, with that cost removed, the worker is
dominated by irreducible bgzf/WASM decompression. **A fresh build is required to
re-profile current code** (and a modBAM fixture to profile the mod path at all —
see gap below). Treat the verdicts here as "still true because those code paths
weren't touched," not as fresh measurements.

Source: `flame/webgl-worker.folded` (leaf self-time, minified frames resolved by
name where @gmod/bam / plugin getters keep their names).

## Top worker self-time (excluding idle 3.65M, GC 260k)

| self (µs) | frame | where |
|---:|---|---|
| 586154 | `_computeTags` | @gmod/bam BamRecord — parse ALL tags on first `.tags` access |
| 280830 | (anonymous) | bgzf/decode chunk |
| 164398 | `wasm-function[3]` | decompression |
| 98452  | `getReadIndex` | @gmod/bam |
| 60115  | `get` | `BamSlightlyLazyFeature.get(field)` switch dispatch |
| 57662  | `get name` | @gmod/bam BamRecord |
| 52778  | `getReadFeatures`-family (`pe`) | @gmod/bam |
| 46640  | `get next_segment_position` | `BamSlightlyLazyFeature` string getter |
| 46132  | `readBamFeatures` | @gmod/bam |
| 39709  | `_findTag` | @gmod/bam |

`extractFeatureArrays` / `buildBaseReadArrays` together were ~180k (≈3%) — small.

## Verdicts on the profile-gated items

- **`BamSlightlyLazyFeature.get(field)` switch dispatch — NOT WORTH IT.** `get`
  is 60k self (~1% of the busy worker) and `extractFeatureArrays` ~180k. The
  BamAdapter CLAUDE.md already called this "a deliberate refactor, not a
  drive-by"; the profile confirms it isn't where the time goes. Skip.

- **`computeMismatchFrequencies` / `computePositionFrequencies` Map counting —
  NOT WORTH IT.** They don't appear in the top self-time frames at all on the
  heaviest case. A typed-array rewrite would add complexity for no measurable
  gain. Skip.

- **The committed mod-path optimizations (dead `localeCompare` sort, per-type
  color memoize) — CANNOT be benchmarked here.** The test BAMs carry **no MM/ML
  tags** (`samtools view 200x.longread.bam | grep -c MM:Z` → 0; `hg19mod.fa` is a
  *masked* reference, not modBAM). So this profile never enters
  `extractModifications`. Those two commits are justified by removed-redundant-
  work reasoning, not by this trace. To profile them, jb2bench needs a modBAM
  fixture (see gap below).

## The one real worker lead: tag decoding (`_computeTags`)

`_computeTags` alone is the biggest non-idle cost (9%), driven by `.tags`
access, plus `_findTag` (39k) and the paired-read string getters (`get name`
57k, `get next_segment_position` 46k). @gmod/bam parses **all** of a record's
tags on the first tag access and caches them; the pileup path touches a tag per
read (SA for supplementary chaining, MM for mods, the color/sort tag), so every
record pays the full parse.

Directions (in rough order of value, none a drive-by):
- Whether the plainest pileup (no tag-color / no sort-tag / no mods / no SA
  arcs) can avoid tag access entirely for a record — narrow, needs tier
  analysis, since SA is currently read unconditionally in
  `extractFeatureArrays`.
- `get next_segment_position` builds a `refName:pos` string per paired read; if
  the pileup path doesn't consume it, don't compute it in the hot loop.
- Lazy per-tag parsing in @gmod/bam itself (external repo) would help every JB2
  consumer, not just this one.

## Data gap to close before the next mod-path pass

jb2bench has no modBAM. `shell/generate_alignments.sh` (pbsim/wgsim) doesn't emit
MM/ML. To benchmark the modification color mode add a fixture — e.g. run an ONT
5mCG model output through, or synthesize MM/ML tags onto the existing longread
BAM — and a URL/session that sets `colorBy: { type: 'modifications' }`. Only then
does the `extractModifications` path (and the two committed opts) show up in a
trace.

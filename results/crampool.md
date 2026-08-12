# CRAM slice worker pool, on vs off

Does `@gmod/cram`'s slice worker pool make a **pan** faster in jbrowse?

`scripts/render/crampool.ts`, against one build carrying each CRAM track twice —
once normally and once as a `.nopool` twin differing only in the adapter's
`useSliceWorkerPool`. Five non-overlapping 19 kb pans per arm, arms alternated
ABBA, ratio taken per pair rather than between aggregates.

## Runs of record: none

**Every run below was taken at a 1-minute load average of 35–45**, on a box
running six other agent sessions, two jbrowse dev servers and a 4.4 GB `tsc`.
This repo treats anything above **4.0** as unusable, and these are an order of
magnitude past it. They are recorded because they are what was measured and
because the shape across them is worth keeping — not as a result.

| fixture              | slices | pooled (best/median) | in-process (best/median) | paired speedup             | peak load |
| -------------------- | -----: | -------------------- | ------------------------ | -------------------------- | --------: |
| 1000x.shortread.cram |     16 | 2331 / 3180 ms       | 2534 / 3653 ms           | **1.20x** [1.00, 1.34] n=30 |     44.97 |
| 1000x.shortread.cram |     16 | 1677 / 2622 ms       | 1911 / 3049 ms           | **1.07x** [0.93, 1.37] n=30 |     35.58 |
| 200x.shortread.cram  |      4 | 1198 / 1507 ms       | 1383 / 1471 ms           | 0.96x [0.79, 1.23] n=10    |     42.48 |
| 200x.shortread.cram  |      4 | 1167 / 1995 ms       | 1108 / 2092 ms           | 1.06x [0.85, 1.29] n=20    |     40.45 |
| 1000x.longread.cram  |     22 | —                    | —                        | did not settle in 120 s     |    ~45    |

Bracketed figures are p25/p75 of the per-pair ratios.

## What can and cannot be said

**Cannot:** any of these numbers as a value. The two runs of the same fixture
disagree by 12% (1.20x against 1.07x) with n=30 pairs each, and both intervals
contain 1.0. That spread is larger than sampling error at that n, so it is
environmental drift that ABBA alternation only partly cancels.

**Can, weakly:** the ordering is the same in both directions it was tested.
Deep short-read CRAM (16 slices) came out above 1.0 in both runs; shallow
(4 slices) sat on 1.0 in both. That is the direction the slice-count argument
predicts, and it is the only thing here that reproduced.

**The gap to the library number is the real finding.** The same fixture and the
same region measure **2.21x on the decode alone**, nested in a worker
(`@gmod/cram` `docs/WORKERS.md`). A pan is not decode-bound: it also pays the
fetch, the RPC hop out of the worker, feature conversion, layout and paint. So
whatever the true pan figure is, it is a fraction of the decode figure, and
quoting 2–3x as a user-visible speedup would be wrong.

Note also that jbrowse already ran CRAM inside an RPC worker before any of this,
so the pool buys **throughput only** here. The "decode is off the main thread"
half of its value was already banked; a consumer decoding on the main thread has
much more to gain than jbrowse does.

## To finish it

A box under load 4. Then:

```bash
node --experimental-strip-types scripts/render/crampool.ts 1000x.shortread.cram 6
node --experimental-strip-types scripts/render/crampool.ts 1000x.longread.cram 4
```

The long-read row is the one worth having: 22 slices is the widest case in the
corpus and the decode benchmark puts it at 3.59x, so it is where a pan should
show most. It never settled within the 120 s cap here, which matches this repo's
existing note that 1000x-longread needs an idle machine.

# Cross-tool render benchmark: JBrowse vs igv.js

JBrowse against igv.js 3.8.5 — same files, same window `chr22_mask:124000-143000`, same instrument. The JBrowse arms are `builds/current`, `builds/release-4.3.0`, `builds/release-2.4.0`; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.

The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to both columns.

Three JBrowse arms and one igv.js arm carry the comparison; the remaining igv columns are controls rather than workload knobs:

- **Downsampling.** igv draws at most `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000) and JBrowse draws every read. On this corpus the deepest 100 bp window holds roughly 700 short reads, so the default clips a little and the maximum clips nothing — if the default and `no downsampling` columns agree, downsampling is not what the comparison is measuring.
- **Track height.** The harness gives igv a 600 px track; igv's own default for a BAM track is 300, and JBrowse's pileup canvas at this viewport is about 210. igv draws packed rows until it runs out of canvas while JBrowse draws every read it holds and lets the rasterizer clip, so a taller igv track is more igv work and no more JBrowse work. The last two columns are that control, run as its own interleaved pair so it does not disturb the headline ratio.

Median of 3 runs after 1 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | JBrowse (current) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.5 | igv.js 3.8.5, no downsampling | igv.js 3.8.5, 300 px track | igv.js 3.8.5, 600 px track (control arm) | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 2101 ±42 | 2780 ±62 | 2567 ±83 | 1475 ±135 | 1437 ±41 |  |  | 0.70× | 2026-08-24 | 0.14 | claude 0.03, firefox 0.02, Isolated Web Co 0.02 | 1.6 |
| 20x-shortread-cram | 2263 ±72 | 2604 ±47 | 3940 ±27 | 1608 ±63 | 1516 ±31 |  |  | 0.71× | 2026-08-24 | 0.10 | claude 0.01, firefox 0.01 | 1.6 |
| 200x-shortread-bam | 2410 ±69 | 3209 ±39 | 4288 ±23 | 5192 ±115 | 5258 ±115 | 14928 ±6790 | 12344 ±4393 | 2.15× | 2026-08-24 | 0.09 | firefox 0.02 | 40.0 |
| 200x-shortread-cram | 2420 ±79 | 3026 ±29 | 5193 ±15 | 5327 ±73 | 5509 ±202 |  |  | 2.20× | 2026-08-24 | 0.09 | firefox 0.01 | 2.0 |
| 1000x-shortread-bam | 3342 ±43 | 4965 ±23 | 11228 ±351 | 27252 ±96 | 26604 ±626 | 39804 ±5160 | 38089 ±2482 | 8.15× | 2026-08-24 | 0.06 | firefox 0.01 | 42.8 |
| 1000x-shortread-cram | 2947 ±4 | 5884 ±70 | 13126 ±435 | 27202 ±138 | 27572 ±566 |  |  | 9.23× | 2026-08-25 | 0.09 | firefox 0.02 | 1.1 |
| 20x-longread-bam | 2205 ±65 | 3060 ±37 | 3245 ±36 | 3556 ±205 | 3573 ±38 |  |  | 1.61× | 2026-08-25 | 0.11 | firefox 0.02, claude 0.01 | 1.6 |
| 20x-longread-cram | 2336 ±30 | 2989 ±125 | 4163 ±84 | 3818 ±139 | 3796 ±16 |  |  | 1.63× | 2026-08-24 | 0.09 | firefox 0.01, claude 0.01 | 2.5 |
| 200x-longread-bam | 2834 ±15 | 6496 ±27 | 9429 ±118 | 19559 ±443 | 19193 ±166 |  |  | 6.90× | 2026-08-24 | 0.08 | firefox 0.01 | 1.8 |
| 200x-longread-cram | 2946 ±88 | 3984 ±74 | 7785 ±73 | 19666 ±113 | 18584 ±563 |  |  | 6.68× | 2026-08-24 | 0.07 | firefox 0.01 | 2.1 |
| 1000x-longread-bam | 5164 ±36 | 18319 ±1476 | 36214 ±669 | 56855 ±1409 | 56779 ±261 |  |  | 11.01× | 2026-08-25 | 0.07 | firefox 0.02 | 1.6 |
| 1000x-longread-cram | 5922 ±60 | 9571 ±176 | 23107 ±645 | 58107 ±365 | 59177 ±1492 |  |  | 9.81× | 2026-08-24 | 0.17 | Isolated Web Co 0.05, firefox 0.03 | 5.7 |

Median cell load across the matrix: 1.64. Cells measured at more than twice that: 200x-shortread-bam/igv-h300, 200x-shortread-bam/igv-h600ctl, 1000x-shortread-bam/igv-h300, 1000x-shortread-bam/igv-h600ctl, 1000x-longread-cram/jbrowse, 1000x-longread-cram/jbrowse-release-4.3.0, 1000x-longread-cram/jbrowse-release-2.4.0, 1000x-longread-cram/igv.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: both columns of a row are measured within seconds of each other, so a ratio survives load the absolutes do not.

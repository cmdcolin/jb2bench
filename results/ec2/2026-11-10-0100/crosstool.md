# Cross-tool render benchmark: JBrowse vs igv.js, GenomeSpy and Gosling

JBrowse against igv.js 3.8.10, GenomeSpy 1.3.0 and Gosling 1.0.7 — same files, same windows, same instrument. The JBrowse arms are `builds/release-5.0.0-beta.21`, `builds/release-2.4.0`, `builds/release-4.3.0`; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.

3 windows. The two narrow ones sit on the same contig, the wider containing the narrower; the 1 Mb one is a second corpus beside them — its own assembly, its own files, 20x and 100x rather than the 20x-to-1000x ladder — because a 250 kb contig cannot hold a megabase view: **19kb** `chr22_mask:124000-143000`, **100kb** `chr22_mask:75000-175000`, **1mb** `chr22_2mb:500001-1500000`. Same reads, more of them, so a row pair says how each tool scales with what is on screen rather than with what is in the file.

Three limits decide which cells exist at all, and the table names them rather than leaving a reader to infer them from a suspiciously fast cell:

- **Gosling stops at 20 kb.** `MAX_TILE_WIDTH = 2e4` in its `BamDataFetcher`, checked against every visible tile by `gosling-track.ts:calculateVisibleTiles`, which returns before fetching. Tile width is the declared genome length over 2^zoom, so on this 250 kb assembly the 19 kb window draws and the 100 kb one paints a full axis and no reads. Its 100 kb cells are `n/a`, not a timing — a page that draws nothing settles immediately under this instrument, so timing it would make Gosling the fastest tool in the table at the window it cannot render.
- **`tile cap raised` is that same build with the cap patched out**, which is the only way Gosling reaches the wider window. Read the pair, not the patched column alone: a patched library is not the one anyone installs. It also fetches a whole tile rather than the window — 40002 reads at 100 kb on the 20x file against roughly 16000 in view — so it is an upper bound on what an unpatched Gosling would cost at this width even if it could draw it.
- **Neither GenomeSpy nor Gosling reads CRAM**, so the format axis stops at BAM for both columns. igv.js and JBrowse carry the CRAM rows.

The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to every column.

**Stable pixels alone were not enough, and the Gosling arms are why.** A page that is working with nothing moving on screen satisfies a pixel-stability test, and Gosling shows a *static* "Fetching" frame for its first few seconds while a worker boots and reads the index — no animation, and no request outstanding either. Measured 2026-08-28, it settled at 2.4 s on an empty plot against a true 7.6 s. So the instrument now also refuses to settle while a corpus read is in flight, and while a harness page exports `__harnessBusy()` returning true; Gosling's is `records === 0`, a content gate that adds no constant once the first feature lands. Correcting it moved the stock 19 kb Gosling cell up by roughly half while the ungated igv arm held within 9% across the same runs. **A page that defines no such predicate is measured exactly as before**, so every column other than GenomeSpy and Gosling is unaffected and comparable with the rows recorded before this axis existed.

Three JBrowse arms and one igv.js arm carry the comparison; the remaining igv columns are controls rather than workload knobs:

- **Downsampling.** igv draws at most `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000) and JBrowse draws every read. On this corpus the deepest 100 bp window holds roughly 700 short reads, so the default clips a little and the maximum clips nothing — if the default and `no downsampling` columns agree, downsampling is not what the comparison is measuring.
- **Track height.** The harness gives igv a 600 px track; igv's own default for a BAM track is 300, and JBrowse's pileup canvas at this viewport is about 210. igv draws packed rows until it runs out of canvas while JBrowse draws every read it holds and lets the rasterizer clip, so a taller igv track is more igv work and no more JBrowse work. The last two columns are that control, run as its own interleaved pair so it does not disturb the headline ratio.

Median of 5 runs after 1 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; `n/a` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw. `>Ns` is an arm that failed to settle within the paint ceiling 2 times and was abandoned for that cell — a result about the tool at that width, not a gap in the run. The ceiling is 600s at 100 kb and 120s at the other windows, and each cell carries the ceiling it was judged against, so a row recorded under the older per-window ceilings still prints the one it actually got.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 19kb | 1338 ±23 | 2771 ±30 | 2815 ±393 | 1751 ±25 | 1748 ±12 | 1929 ±15 | 2010 ±17 | 3060 ±38 | 1.31× | 2026-11-10 | 0.02 | — | 2.3 |
| 20x-shortread-bam | 100kb | 1526 ±91 |  | 5428 ±477 | 3874 ±6 |  |  | 3085 ±18 |  | 2.54× | 2026-11-10 | 0.02 | — | 3.4 |
| 20x-shortread-cram | 19kb | 1487 ±7 | 2694 ±79 | 4249 ±32 | 1836 ±22 | 1845 ±65 | 2016 ±28 | n/a | n/a | 1.23× | 2026-11-10 | 0.02 | — | 2.7 |
| 200x-shortread-bam | 19kb | 1890 ±95 | 3402 ±12 | 5474 ±442 | 7324 ±98 | 7378 ±75 | 8798 ±104 | 3473 ±55 | 105769 ±2707 | 3.88× | 2026-11-10 | 0.01 | — | 1.8 |
| 200x-shortread-bam | 100kb | 3120 ±26 |  | 18578 ±57 | 27381 ±92 |  |  | 11622 ±17 |  | 8.78× | 2026-11-10 | 0.01 | — | 3.1 |
| 200x-shortread-cram | 19kb | 1924 ±9 | 3536 ±37 | 6498 ±92 | 7423 ±28 | 7424 ±38 | 8936 ±65 | n/a | n/a | 3.86× | 2026-11-10 | 0.02 | — | 1.9 |
| 1000x-shortread-bam | 19kb | 3124 ±98 | 6563 ±192 | 14433 ±423 | 39385 ±477 | 40436 ±582 | 49982 ±240 | 8497 ±80 | >120s | 12.61× | 2026-11-10 | 0.01 | — | 2.4 |
| 1000x-shortread-cram | 19kb | 3103 ±73 | 7511 ±68 | 17771 ±74 | 38942 ±452 | 39826 ±623 | 49399 ±377 | n/a | n/a | 12.55× | 2026-11-10 | 0.01 | — | 2.0 |
| 20x-longread-bam | 19kb | 1479 ±27 | 3127 ±49 | 3948 ±77 | 4893 ±57 | 4852 ±23 | 7019 ±86 | 7249 ±48 | >120s | 3.31× | 2026-11-10 | 0.01 | — | 1.4 |
| 20x-longread-cram | 19kb | 1503 ±29 | 2788 ±54 | 4588 ±81 | 4873 ±48 | 4841 ±52 | 7129 ±58 | n/a | n/a | 3.24× | 2026-11-10 | 0.02 | — | 2.0 |
| 200x-longread-bam | 19kb | 2756 ±67 | 8078 ±355 | 12593 ±68 | 26779 ±104 | 26790 ±234 | 48909 ±315 | 59825 ±717 | >120s | 9.72× | 2026-11-10 | 0.01 | — | 2.2 |
| 200x-longread-cram | 19kb | 2524 ±117 | 4764 ±101 | 10003 ±61 | 25933 ±372 | 26066 ±219 | 48277 ±192 | n/a | n/a | 10.27× | 2026-11-10 | 0.01 | — | 1.8 |
| 1000x-longread-bam | 19kb | 7065 ±2350 | 28043 ±2255 | 51384 ±418 | 84619 ±1099 | 86601 ±1575 | >120s | >120s | >120s | 11.98× | 2026-11-10 | 0.01 | — | 2.0 |
| 1000x-longread-cram | 19kb | 6100 ±186 | 12413 ±123 | 31442 ±386 | 81544 ±1397 | 82191 ±1579 | >120s | n/a | n/a | 13.37× | 2026-11-10 | 0.01 | — | 1.5 |

Median cell load across the matrix: 1.90. No cell stands out from the run.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

## Memory at the end of the cold load

Median over the measured runs of each cell: JS heap used, summed over the page and its dedicated workers (`Runtime.getHeapUsage`), then total PSS over every Chrome process (`/proc/<pid>/smaps_rollup`), then the GPU device memory the run added (`nvidia-smi`, where present). MB. See `scripts/crosstool/memory.ts`.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 19kb | 33 / 613 / 63 | 69 / 656 / 72 | 89 / 681 / 75 | 28 / 591 / 187 | 28 / 589 / 187 | 34 / 614 / 112 | 19 / 554 / 80 | 135 / 821 / 249 |
| 200x-shortread-bam | 19kb | 65 / 763 / 68 | 98 / 857 / 112 | 173 / 866 / 122 | 146 / 898 / 112 | 146 / 898 / 115 | 168 / 1060 / 181 | 145 / 869 / 108 | 923 / 2082 / 290 |
| 20x-shortread-bam | 100kb | 46 / 673 / 71 |  | 230 / 942 / 83 | 91 / 777 / 84 |  |  | 68 / 760 / 107 |  |
| 200x-shortread-bam | 100kb | 201 / 1190 / 103 |  | 674 / 1649 / 121 | 670 / 1959 / 96 |  |  | 914 / 2215 / 306 |  |
| 20x-shortread-cram | 19kb | 45 / 640 / 63 | 79 / 687 / 72 | 108 / 734 / 73 | 42 / 619 / 93 | 42 / 619 / 92 | 46 / 657 / 115 |  |  |
| 200x-shortread-cram | 19kb | 78 / 782 / 69 | 148 / 812 / 115 | 196 / 878 / 122 | 199 / 972 / 120 | 198 / 971 / 125 | 171 / 1133 / 169 |  |  |
| 1000x-shortread-bam | 19kb | 191 / 1272 / 90 | 189 / 1244 / 114 | 387 / 1171 / 121 | 991 / 1978 / 110 | 1013 / 1997 / 108 | 693 / 2243 / 396 | 615 / 1785 / 210 | — / — / — |
| 1000x-shortread-cram | 19kb | 177 / 1199 / 91 | 514 / 1275 / 114 | 553 / 1226 / 121 | 1090 / 2023 / 108 | 1069 / 2001 / 112 | 752 / 2954 / 384 |  |  |
| 20x-longread-bam | 19kb | 43 / 673 / 63 | 72 / 758 / 63 | 114 / 797 / 63 | 75 / 859 / 75 | 75 / 860 / 75 | 79 / 888 / 85 | 58 / 752 / 119 | — / — / — |
| 20x-longread-cram | 19kb | 42 / 672 / 62 | 83 / 720 / 63 | 130 / 751 / 65 | 101 / 817 / 75 | 102 / 814 / 75 | 83 / 1037 / 75 |  |  |
| 200x-longread-bam | 19kb | 101 / 996 / 82 | 95 / 1241 / 113 | 430 / 1393 / 121 | 536 / 2275 / 91 | 537 / 2273 / 91 | 544 / 2955 / 147 | 427 / 2133 / 394 | — / — / — |
| 200x-longread-cram | 19kb | 94 / 1006 / 83 | 185 / 918 / 120 | 318 / 1002 / 121 | 549 / 2284 / 91 | 558 / 2189 / 91 | 560 / 3037 / 151 |  |  |
| 1000x-longread-bam | 19kb | 304 / 2384 / 144 | 207 / 2854 / 111 | 1541 / 3976 / 121 | 2294 / 4606 / 91 | 2530 / 5022 / 91 | — / — / — | — / — / — | — / — / — |
| 1000x-longread-cram | 19kb | 266 / 1975 / 144 | 706 / 1765 / 115 | 1007 / 1950 / 121 | 2389 / 4707 / 91 | 2561 / 4909 / 91 | — / — / — |  |  |

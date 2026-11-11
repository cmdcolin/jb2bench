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

Median of 5 runs after 1 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; `n/a` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw. `>Ns` is an arm that failed to settle within the paint ceiling 2 times and was abandoned for that cell — a result about the tool at that width, not a gap in the run. `error` is an arm whose page settled on an error message in place of the track; `crosstool.json` holds the message in the cell's `error` field. The ceiling is 600s at 100 kb and 120s at the other windows, and each cell carries the ceiling it was judged against, so a row recorded under the older per-window ceilings still prints the one it actually got.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-2.4.0) | JBrowse (release-4.3.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 19kb | 1338 ±23 | 2815 ±393 | 2771 ±30 | 1751 ±25 | 1748 ±12 | 1929 ±15 | 2010 ±17 | 3060 ±38 | 1.31× | 2026-11-10 | 0.02 | — | 2.3 |
| 20x-shortread-bam | 100kb | 1496 ±16 | 5213 ±404 | 3674 ±81 | 3832 ±46 | 3843 ±30 | 4557 ±49 | 3083 ±21 | n/a | 2.56× | 2026-11-10 | 0.02 | — | 1.6 |
| 20x-shortread-cram | 19kb | 1487 ±7 | 4249 ±32 | 2694 ±79 | 1836 ±22 | 1845 ±65 | 2016 ±28 | n/a | n/a | 1.23× | 2026-11-10 | 0.02 | — | 2.7 |
| 20x-shortread-cram | 100kb | 1716 ±20 | 6473 ±464 | 3536 ±33 | 3947 ±31 | 3921 ±22 | 4657 ±56 | n/a | n/a | 2.30× | 2026-11-10 | 0.02 | — | 3.1 |
| 200x-shortread-bam | 19kb | 1890 ±95 | 5474 ±442 | 3402 ±12 | 7324 ±98 | 7378 ±75 | 8798 ±104 | 3473 ±55 | 105769 ±2707 | 3.88× | 2026-11-10 | 0.01 | — | 1.8 |
| 200x-shortread-bam | 100kb | 3119 ±14 | 18346 ±141 | 6962 ±40 | 27276 ±289 | 27365 ±235 | 33449 ±125 | 11642 ±53 | n/a | 8.75× | 2026-11-10 | 0.01 | — | 3.4 |
| 200x-shortread-cram | 19kb | 1924 ±9 | 6498 ±92 | 3536 ±37 | 7423 ±28 | 7424 ±38 | 8936 ±65 | n/a | n/a | 3.86× | 2026-11-10 | 0.02 | — | 1.9 |
| 200x-shortread-cram | 100kb | 3320 ±15 | 22898 ±616 | 8454 ±71 | 26804 ±132 | 26977 ±349 | 33557 ±349 | n/a | n/a | 8.07× | 2026-11-10 | 0.01 | — | 2.4 |
| 1000x-shortread-bam | 19kb | 3124 ±98 | 14433 ±423 | 6563 ±192 | 39385 ±477 | 40436 ±582 | 49982 ±240 | 8497 ±80 | >600s | 12.61× | 2026-11-10 | 0.01 | — | 2.4 |
| 1000x-shortread-bam | 100kb | 8892 ±248 | 81101 ±772 | 20742 ±184 | 175082 ±1114 | >600s | 227437 ±1399 | 45974 ±782 | n/a | 19.69× | 2026-11-10 | 0.01 | — | 2.7 |
| 1000x-shortread-cram | 19kb | 3103 ±73 | 17771 ±74 | 7511 ±68 | 38942 ±452 | 39826 ±623 | 49399 ±377 | n/a | n/a | 12.55× | 2026-11-10 | 0.01 | — | 2.0 |
| 1000x-shortread-cram | 100kb | 9651 ±63 | 80887 ±5885 | 27572 ±140 | 202671 ±1640 | 202793 ±2101 | 252095 ±2203 | n/a | n/a | 21.00× | 2026-11-10 | 0.01 | — | 2.8 |
| 20x-longread-bam | 19kb | 1479 ±27 | 3948 ±77 | 3127 ±49 | 4893 ±57 | 4852 ±23 | 7019 ±86 | 7249 ±48 | >600s | 3.31× | 2026-11-10 | 0.01 | — | 1.4 |
| 20x-longread-bam | 100kb | 1912 ±22 | 6379 ±487 | 4505 ±109 | 10771 ±69 | 10768 ±50 | 18645 ±91 | 16755 ±301 | n/a | 5.63× | 2026-11-10 | 0.01 | — | 1.9 |
| 20x-longread-cram | 19kb | 1503 ±29 | 4588 ±81 | 2788 ±54 | 4873 ±48 | 4841 ±52 | 7129 ±58 | n/a | n/a | 3.24× | 2026-11-10 | 0.02 | — | 2.0 |
| 20x-longread-cram | 100kb | 1906 ±23 | 6578 ±96 | 4163 ±82 | 10884 ±33 | 10912 ±109 | 18679 ±52 | n/a | n/a | 5.71× | 2026-11-10 | 0.01 | — | 2.7 |
| 200x-longread-bam | 19kb | 2756 ±67 | 12593 ±68 | 8078 ±355 | 26779 ±104 | 26790 ±234 | 48909 ±315 | 59825 ±717 | >600s | 9.72× | 2026-11-10 | 0.01 | — | 2.2 |
| 200x-longread-bam | 100kb | 5117 ±125 | 24997 ±455 | 11392 ±153 | 58024 ±156 | 58128 ±280 | 131127 ±248 | 149911 ±708 | n/a | 11.34× | 2026-11-10 | 0.01 | — | 1.7 |
| 200x-longread-cram | 19kb | 2524 ±117 | 10003 ±61 | 4764 ±101 | 25933 ±372 | 26066 ±219 | 48277 ±192 | n/a | n/a | 10.27× | 2026-11-10 | 0.01 | — | 1.8 |
| 200x-longread-cram | 100kb | 5045 ±90 | 22878 ±110 | 8676 ±119 | 57546 ±159 | 57646 ±251 | 131471 ±450 | n/a | n/a | 11.41× | 2026-11-10 | 0.01 | — | 1.9 |
| 1000x-longread-bam | 19kb | 7065 ±2350 | 51384 ±418 | 28043 ±2255 | 84619 ±1099 | 86601 ±1575 | >600s | 304657 ±2693 | >600s | 11.98× | 2026-11-10 | 0.01 | — | 2.0 |
| 1000x-longread-bam | 100kb | 17138 ±6379 | 91168 ±360 | 40571 ±256 | >600s | >600s | >600s | >600s | n/a | — | 2026-11-10 | 0.01 | — | 1.3 |
| 1000x-longread-cram | 19kb | 6100 ±186 | 31442 ±386 | 12413 ±123 | 81544 ±1397 | 82191 ±1579 | 181076 ±700 | n/a | n/a | 13.37× | 2026-11-10 | 0.01 | — | 1.5 |
| 1000x-longread-cram | 100kb | 17524 ±255 | 85138 ±1053 | 27845 ±273 | >600s | >600s | >600s | n/a | n/a | — | 2026-11-10 | 0.01 | — | 1.4 |
| 1mb-20x-shortread-bam | 1mb | 2900 ±24 | 30080 ±114 | 17677 ±319 | 23821 ±84 | 23758 ±81 | 29534 ±200 | 11868 ±178 | n/a | 8.21× | 2026-11-10 | 0.01 | — | 1.7 |
| 1mb-20x-shortread-cram | 1mb | 3106 ±19 | 34589 ±199 | 18503 ±154 | 24001 ±114 | 24148 ±107 | 29470 ±267 | n/a | n/a | 7.73× | 2026-11-10 | 0.01 | — | 2.1 |
| 1mb-100x-shortread-bam | 1mb | 7941 ±154 | 84232 ±278 | 29727 ±326 | 114941 ±518 | 115597 ±640 | 136818 ±487 | 50079 ±408 | n/a | 14.47× | 2026-11-10 | 0.01 | — | 2.5 |
| 1mb-100x-shortread-cram | 1mb | 8713 ±108 | >600s | 39306 ±277 | 116869 ±938 | 116469 ±768 | 138808 ±1018 | n/a | n/a | 13.41× | 2026-11-10 | 0.01 | — | 2.5 |
| 1mb-20x-longread-bam | 1mb | 5343 ±86 | 37966 ±478 | 21682 ±204 | 76159 ±83 | 76031 ±134 | >600s | 120715 ±940 | n/a | 14.25× | 2026-11-10 | 0.01 | — | 2.3 |
| 1mb-20x-longread-cram | 1mb | 5511 ±79 | error | 24213 ±326 | 75933 ±245 | 76219 ±697 | 135688 ±358 | n/a | n/a | 13.78× | 2026-11-10 | 0.01 | — | 1.6 |
| 1mb-100x-longread-bam | 1mb | 16209 ±299 | 99712 ±929 | 47908 ±701 | >600s | >600s | >600s | >600s | n/a | — | 2026-11-10 | 0.01 | — | 1.9 |
| 1mb-100x-longread-cram | 1mb | 17092 ±226 | error | 38853 ±467 | >600s | >600s | >600s | n/a | n/a | — | 2026-11-10 | 0.01 | — | 2.3 |

Median cell load across the matrix: 1.86. No cell stands out from the run.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

## Memory at the end of the cold load

Median over the measured runs of each cell: JS heap used, summed over the page and its dedicated workers (`Runtime.getHeapUsage`), then total PSS over every Chrome process (`/proc/<pid>/smaps_rollup`), then the GPU device memory the run added (`nvidia-smi`, where present). MB. See `scripts/crosstool/memory.ts`.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-2.4.0) | JBrowse (release-4.3.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 19kb | 33 / 613 / 63 | 89 / 681 / 75 | 69 / 656 / 72 | 28 / 591 / 187 | 28 / 589 / 187 | 34 / 614 / 112 | 19 / 554 / 80 | 135 / 821 / 249 |
| 200x-shortread-bam | 19kb | 65 / 763 / 68 | 173 / 866 / 122 | 98 / 857 / 112 | 146 / 898 / 112 | 146 / 898 / 115 | 168 / 1060 / 181 | 145 / 869 / 108 | 923 / 2082 / 290 |
| 20x-shortread-bam | 100kb | 46 / 674 / 71 | 229 / 920 / 83 | 160 / 862 / 75 | 91 / 775 / 84 | 91 / 775 / 84 | 91 / 908 / 89 | 129 / 802 / 107 |  |
| 200x-shortread-bam | 100kb | 200 / 1183 / 103 | 650 / 1636 / 121 | 381 / 1545 / 117 | 641 / 1930 / 98 | 639 / 1931 / 97 | 644 / 3209 / 166 | 823 / 2127 / 306 |  |
| 20x-shortread-cram | 19kb | 45 / 640 / 63 | 108 / 734 / 73 | 79 / 687 / 72 | 42 / 619 / 93 | 42 / 619 / 92 | 46 / 657 / 115 |  |  |
| 200x-shortread-cram | 19kb | 78 / 782 / 69 | 196 / 878 / 122 | 148 / 812 / 115 | 199 / 972 / 120 | 198 / 971 / 125 | 171 / 1133 / 169 |  |  |
| 1000x-shortread-bam | 19kb | 191 / 1272 / 90 | 387 / 1171 / 121 | 189 / 1244 / 114 | 991 / 1978 / 110 | 1013 / 1997 / 108 | 693 / 2243 / 396 | 615 / 1785 / 210 | — / — / — |
| 1000x-shortread-cram | 19kb | 177 / 1199 / 91 | 553 / 1226 / 121 | 514 / 1275 / 114 | 1090 / 2023 / 108 | 1069 / 2001 / 112 | 752 / 2954 / 384 |  |  |
| 20x-longread-bam | 19kb | 43 / 673 / 63 | 114 / 797 / 63 | 72 / 758 / 63 | 75 / 859 / 75 | 75 / 860 / 75 | 79 / 888 / 85 | 58 / 752 / 119 | — / — / — |
| 20x-longread-cram | 19kb | 42 / 672 / 62 | 130 / 751 / 65 | 83 / 720 / 63 | 101 / 817 / 75 | 102 / 814 / 75 | 83 / 1037 / 75 |  |  |
| 200x-longread-bam | 19kb | 101 / 996 / 82 | 430 / 1393 / 121 | 95 / 1241 / 113 | 536 / 2275 / 91 | 537 / 2273 / 91 | 544 / 2955 / 147 | 427 / 2133 / 394 | — / — / — |
| 200x-longread-cram | 19kb | 94 / 1006 / 83 | 318 / 1002 / 121 | 185 / 918 / 120 | 549 / 2284 / 91 | 558 / 2189 / 91 | 560 / 3037 / 151 |  |  |
| 1000x-longread-bam | 19kb | 304 / 2384 / 144 | 1541 / 3976 / 121 | 207 / 2854 / 111 | 2294 / 4606 / 91 | 2530 / 5022 / 91 | — / — / — | 1995 / 5211 / 35 | — / — / — |
| 1000x-longread-cram | 19kb | 266 / 1975 / 144 | 1007 / 1950 / 121 | 706 / 1765 / 115 | 2389 / 4707 / 91 | 2561 / 4909 / 91 | 2395 / 9920 / 308 |  |  |
| 20x-shortread-cram | 100kb | 59 / 719 / 70 | 249 / 957 / 86 | 195 / 851 / 73 | 97 / 799 / 84 | 97 / 800 / 84 | 106 / 839 / 185 |  |  |
| 200x-shortread-cram | 100kb | 201 / 1247 / 103 | 720 / 1484 / 125 | 386 / 1416 / 113 | 675 / 2129 / 297 | 675 / 2079 / 293 | 686 / 2857 / 655 |  |  |
| 1000x-shortread-bam | 100kb | 695 / 3095 / 225 | 1822 / 3588 / 125 | 565 / 2558 / 81 | 3471 / 5020 / 71 | — / — / — | 3164 / 11008 / 1460 | 2866 / 6385 / 978 |  |
| 1000x-shortread-cram | 100kb | 822 / 3024 / 224 | 2431 / 3430 / 125 | 1576 / 2872 / 78 | 3191 / 4864 / 71 | 3191 / 4892 / 71 | 3193 / 11275 / 2392 |  |  |
| 20x-longread-bam | 100kb | 58 / 752 / 82 | 115 / 978 / 68 | 188 / 1009 / 71 | 135 / 1058 / 75 | 137 / 1058 / 75 | 141 / 1178 / 87 | 185 / 1050 / 182 |  |
| 20x-longread-cram | 100kb | 56 / 775 / 82 | 178 / 922 / 71 | 213 / 913 / 69 | 136 / 1194 / 75 | 134 / 1188 / 75 | 148 / 1199 / 91 |  |  |
| 200x-longread-bam | 100kb | 307 / 1517 / 161 | 728 / 1796 / 125 | 297 / 1445 / 114 | 1022 / 4516 / 91 | 1004 / 4686 / 91 | 1013 / 5004 / 129 | 1079 / 2206 / 35 |  |
| 200x-longread-cram | 100kb | 309 / 1638 / 161 | 666 / 1554 / 125 | 552 / 1397 / 118 | 992 / 3805 / 91 | 997 / 3752 / 95 | 996 / 5059 / 129 |  |  |
| 1000x-longread-bam | 100kb | 1386 / 4626 / 482 | 2278 / 4713 / 125 | 554 / 3864 / 117 | — / — / — | — / — / — | — / — / — | — / — / — |  |
| 1000x-longread-cram | 100kb | 1249 / 4711 / 482 | 2115 / 3493 / 125 | 1583 / 3238 / 118 | — / — / — | — / — / — | — / — / — |  |  |
| 1mb-20x-shortread-bam | 1mb | 147 / 1078 / 108 | 2390 / 3633 / 88 | 1681 / 3161 / 90 | 652 / 1978 / 194 | 652 / 1884 / 194 | 656 / 2520 / 110 | 488 / 2280 / 352 |  |
| 1mb-20x-shortread-cram | 1mb | 150 / 1160 / 105 | 2465 / 3708 / 109 | 2290 / 3429 / 91 | 678 / 2250 / 86 | 684 / 2277 / 88 | 676 / 2351 / 181 |  |  |
| 1mb-100x-shortread-bam | 1mb | 601 / 2756 / 241 | 3418 / 5567 / 127 | 1485 / 4144 / 102 | 2499 / 7697 / 290 | 2500 / 7694 / 96 | 2232 / 10338 / 125 | 2368 / 6135 / 1220 |  |
| 1mb-100x-shortread-cram | 1mb | 676 / 2770 / 245 | — / — / — | 2846 / 4364 / 102 | 2817 / 8319 / 287 | 2854 / 8339 / 94 | 2373 / 10000 / 105 |  |  |
| 1mb-20x-longread-bam | 1mb | 324 / 1537 / 175 | 1314 / 2573 / 69 | 2458 / 4331 / 75 | 1030 / 5135 / 79 | 1019 / 5134 / 79 | — / — / — | 968 / 2839 / 31 |  |
| 1mb-20x-longread-cram | 1mb | 308 / 1642 / 175 | — / — / — | 2265 / 3768 / 79 | 1039 / 4986 / 149 | 1027 / 4991 / 149 | 1031 / 5164 / 65 |  |  |
| 1mb-100x-longread-bam | 1mb | 1278 / 4579 / 513 | 1921 / 3973 / 127 | 2142 / 4488 / 147 | — / — / — | — / — / — | — / — / — | — / — / — |  |
| 1mb-100x-longread-cram | 1mb | 1147 / 4439 / 517 | — / — / — | 3028 / 4656 / 100 | — / — / — | — / — / — | — / — / — |  |  |

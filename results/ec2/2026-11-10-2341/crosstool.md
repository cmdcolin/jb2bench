# Cross-tool render benchmark: JBrowse vs igv.js, GenomeSpy and Gosling

JBrowse against igv.js 3.8.10, GenomeSpy 1.3.0 and Gosling 1.0.7 — same files, same windows, same instrument. The JBrowse arms are `builds/release-5.0.0-beta.21`, `builds/release-4.3.0`, `builds/release-2.4.0`; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.

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

Median of 5 runs after 1 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; `n/a` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw. `>Ns` is an arm that failed to settle within the paint ceiling 1 times and was abandoned for that cell — a result about the tool at that width, not a gap in the run. The ceiling is 600s at 100 kb and 120s at the other windows, and each cell carries the ceiling it was judged against, so a row recorded under the older per-window ceilings still prints the one it actually got.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000x-shortread-bam | 19kb | 3058 ±53 | 6505 ±180 | 14355 ±133 | 38222 ±425 | 39065 ±293 | 48462 ±755 | 8384 ±63 | >600s | 12.50× | 2026-11-11 | 0.01 | — | 1.5 |
| 20x-longread-bam | 19kb | 1437 ±16 | 3161 ±43 | 3844 ±406 | 4818 ±54 | 4802 ±42 | 6933 ±63 | 7155 ±60 | >600s | 3.35× | 2026-11-11 | 0.02 | — | 1.9 |
| 200x-longread-bam | 19kb | 2656 ±74 | 8059 ±158 | 12660 ±381 | 26754 ±118 | 26784 ±211 | 49106 ±370 | 59146 ±1082 | >600s | 10.07× | 2026-11-11 | 0.01 | — | 1.2 |
| 1000x-longread-bam | 19kb | 6861 ±2270 | 27819 ±2319 | 51649 ±529 | 84837 ±1619 | 85420 ±1494 | >600s | 304657 ±2693 | >600s | 12.37× | 2026-11-11 | 0.01 | — | 2.1 |
| 1000x-longread-cram | 19kb | 6060 ±118 | 12518 ±143 | 31483 ±62 | 82524 ±1236 | 81628 ±1218 | 181076 ±700 | n/a | n/a | 13.62× | 2026-11-11 | 0.01 | — | 1.3 |
| 1mb-100x-shortread-bam | 1mb | 8020 ±204 | 29909 ±175 | 84232 ±278 | 114533 ±441 | 114476 ±581 | 136818 ±487 | 50199 ±335 | n/a | 14.28× | 2026-11-11 | 0.01 | — | 2.5 |
| 1mb-100x-shortread-cram | 1mb | 8623 ±135 | 38931 ±381 | >600s | 116420 ±294 | 115962 ±1345 | 138808 ±1018 | n/a | n/a | 13.50× | 2026-11-11 | 0.01 | — | 2.1 |
| 1mb-20x-longread-bam | 1mb | 5249 ±36 | 21388 ±291 | 37410 ±369 | 75842 ±229 | 75863 ±321 | >600s | 120715 ±940 | n/a | 14.45× | 2026-11-11 | 0.01 | — | 3.0 |
| 1mb-20x-longread-cram | 1mb | 5257 ±246 | 23614 ±194 | 12214 ±198 | 75614 ±546 | 75748 ±322 | 135688 ±358 | n/a | n/a | 14.38× | 2026-11-11 | 0.01 | — | 1.9 |
| 1mb-100x-longread-bam | 1mb | 15767 ±184 | 46133 ±388 | 96663 ±956 | >600s | >600s | >600s | >600s | n/a | — | 2026-11-11 | 0.01 | — | 1.6 |
| 1mb-100x-longread-cram | 1mb | 16359 ±299 | 36792 ±924 | 34733 ±2527 | >600s | >600s | >600s | n/a | n/a | — | 2026-11-11 | 0.01 | — | 2.4 |

Median cell load across the matrix: 1.53. No cell stands out from the run.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

## Memory at the end of the cold load

Median over the measured runs of each cell: JS heap used, summed over the page and its dedicated workers (`Runtime.getHeapUsage`), then total PSS over every Chrome process (`/proc/<pid>/smaps_rollup`), then the GPU device memory the run added (`nvidia-smi`, where present). MB. See `scripts/crosstool/memory.ts`.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, no downsampling | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | Gosling 1.0.7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000x-shortread-bam | 19kb | 191 / 1292 / 91 | 182 / 1166 / 113 | 390 / 1180 / 121 | 991 / 1982 / 108 | 1020 / 1986 / 112 | 691 / 2350 / 389 | 614 / 1783 / 210 | — / — / — |
| 20x-longread-bam | 19kb | 43 / 672 / 63 | 72 / 757 / 67 | 114 / 796 / 63 | 75 / 857 / 75 | 75 / 861 / 75 | 75 / 892 / 85 | 114 / 797 / 119 | — / — / — |
| 200x-longread-bam | 19kb | 102 / 999 / 83 | 109 / 1242 / 116 | 427 / 1390 / 121 | 534 / 2282 / 91 | 531 / 2287 / 91 | 547 / 2967 / 151 | 636 / 2127 / 394 | — / — / — |
| 1000x-longread-bam | 19kb | 303 / 2377 / 143 | 214 / 2860 / 113 | 1549 / 3974 / 121 | 2293 / 4538 / 91 | 2530 / 5030 / 91 | — / — / — | 1995 / 5211 / 35 | — / — / — |
| 1000x-longread-cram | 19kb | 252 / 1957 / 144 | 708 / 1719 / 119 | 998 / 1956 / 121 | 2396 / 4798 / 91 | 2565 / 4886 / 91 | 2395 / 9920 / 308 |  |  |
| 1mb-100x-shortread-bam | 1mb | 625 / 2742 / 241 | 1691 / 4094 / 102 | 3418 / 5567 / 127 | 2505 / 7710 / 91 | 2498 / 7698 / 91 | 2232 / 10338 / 125 | 2359 / 6117 / 1220 |  |
| 1mb-100x-shortread-cram | 1mb | 681 / 2758 / 245 | 2397 / 4380 / 86 | — / — / — | 2695 / 8205 / 95 | 2814 / 8320 / 291 | 2373 / 10000 / 105 |  |  |
| 1mb-20x-longread-bam | 1mb | 322 / 1537 / 175 | 2370 / 4260 / 75 | 1930 / 3100 / 70 | 1020 / 5121 / 79 | 1020 / 5124 / 145 | — / — / — | 968 / 2839 / 31 |  |
| 1mb-20x-longread-cram | 1mb | 304 / 1640 / 175 | 2885 / 4365 / 80 | 430 / 1210 / 73 | 1027 / 4961 / 79 | 1038 / 4952 / 149 | 1031 / 5164 / 65 |  |  |
| 1mb-100x-longread-bam | 1mb | 1247 / 4592 / 513 | 2138 / 4472 / 143 | 1965 / 3973 / 123 | — / — / — | — / — / — | — / — / — | — / — / — |  |
| 1mb-100x-longread-cram | 1mb | 1147 / 4425 / 513 | 3019 / 4694 / 100 | 1712 / 2978 / 58 | — / — / — | — / — / — | — / — / — |  |  |

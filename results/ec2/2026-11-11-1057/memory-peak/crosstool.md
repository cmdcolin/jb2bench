# Cross-tool render benchmark: JBrowse vs igv.js, GenomeSpy and Gosling

JBrowse against igv.js 3.8.10, GenomeSpy 1.3.0 and Gosling 1.0.7 — same files, same windows, same instrument. The JBrowse arms are `builds/release-5.0.0-beta.21`, `builds/release-2.4.0`; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.

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

Median of 3 runs after 0 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; `n/a` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw. `>Ns` is an arm that failed to settle within the paint ceiling 1 times and was abandoned for that cell — a result about the tool at that width, not a gap in the run. `error` is an arm whose page settled on an error message in place of the track; `crosstool.json` holds the message in the cell's `error` field. The ceiling is 600s at 100 kb and 120s at the other windows, and each cell carries the ceiling it was judged against, so a row recorded under the older per-window ceilings still prints the one it actually got.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, every row | GenomeSpy 1.3.0 | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 100kb | 2296 ±1613 | 5901 ±603 | 4481 ±61 | 5240 ±63 | 3967 ±47 | 1.95× | 2026-11-11 | 0.01 | — | 1.7 |
| 20x-shortread-cram | 100kb | 2356 ±42 | 7087 ±511 | 4571 ±21 | 5270 ±34 | n/a | 1.94× | 2026-11-11 | 0.01 | — | 1.7 |
| 200x-shortread-bam | 100kb | 3738 ±784 | 19869 ±386 | 27560 ±79 | 34065 ±187 | 12509 ±116 | 7.37× | 2026-11-11 | 0.01 | — | 1.9 |
| 200x-shortread-cram | 100kb | 3821 ±74 | 23663 ±93 | 27189 ±133 | 33495 ±234 | n/a | 7.12× | 2026-11-11 | 0.01 | — | 1.9 |
| 1000x-shortread-bam | 100kb | 9319 ±3492 | 80580 ±773 | 174755 ±280 | 224614 ±1471 | 46230 ±1400 | 18.75× | 2026-11-11 | 0.01 | — | 2.1 |
| 1000x-shortread-cram | 100kb | 10413 ±738 | 80600 ±238 | 196804 ±702 | 247729 ±905 | n/a | 18.90× | 2026-11-11 | 0.01 | — | 2.1 |
| 20x-longread-bam | 100kb | 2616 ±187 | 6902 ±656 | 11403 ±24 | 19185 ±26 | 17860 ±230 | 4.36× | 2026-11-11 | 0.01 | — | 1.6 |
| 20x-longread-cram | 100kb | 2577 ±39 | 7255 ±513 | 11493 ±17 | 19223 ±56 | n/a | 4.46× | 2026-11-11 | 0.01 | — | 1.6 |
| 200x-longread-bam | 100kb | 5794 ±1814 | 25597 ±1040 | 58561 ±178 | 131759 ±113 | 148926 ±637 | 10.11× | 2026-11-11 | 0.01 | — | 1.6 |
| 200x-longread-cram | 100kb | 5942 ±131 | 23373 ±53 | 58228 ±297 | >600s | n/a | 9.80× | 2026-11-11 | 0.01 | — | 1.5 |
| 1000x-longread-bam | 100kb | 1957 ±7509 | 93034 ±5936 | >600s | >600s | >600s | — | 2026-11-11 | 0.01 | — | 1.5 |
| 1000x-longread-cram | 100kb | 17899 ±914 | 83080 ±1191 | >600s | >600s | n/a | — | 2026-11-11 | 0.01 | — | 1.4 |

Median cell load across the matrix: 1.69. No cell stands out from the run.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

## Memory at the end of the cold load

Median over the measured runs of each cell: JS heap used, summed over the page and its dedicated workers (`Runtime.getHeapUsage`), then total PSS over every Chrome process (`/proc/<pid>/smaps_rollup`), then the GPU device memory the run added (`nvidia-smi`, where present). MB. See `scripts/crosstool/memory.ts`.

| case | window | JBrowse (release-5.0.0-beta.21) | JBrowse (release-2.4.0) | igv.js 3.8.10 | igv.js 3.8.10, every row | GenomeSpy 1.3.0 |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 100kb | 46 / 685 / 70 | 229 / 954 / 86 | 91 / 769 / 84 | 91 / 899 / 172 | 68 / 771 / 103 |
| 20x-shortread-cram | 100kb | 59 / 711 / 70 | 252 / 918 / 82 | 97 / 790 / 84 | 106 / 814 / 185 |  |
| 200x-shortread-bam | 100kb | 174 / 1174 / 102 | 606 / 1644 / 121 | 690 / 2002 / 98 | 637 / 3108 / 166 | 910 / 2174 / 302 |
| 200x-shortread-cram | 100kb | 209 / 1258 / 102 | 720 / 1469 / 125 | 799 / 2143 / 293 | 677 / 2756 / 654 |  |
| 1000x-shortread-bam | 100kb | 715 / 3040 / 224 | 1735 / 3248 / 125 | 3359 / 4910 / 85 | 3376 / 11255 / 2557 | 3030 / 6473 / 974 |
| 1000x-shortread-cram | 100kb | 729 / 2891 / 224 | 2421 / 3411 / 125 | 3208 / 5027 / 85 | 3203 / 11276 / 353 |  |
| 20x-longread-bam | 100kb | 58 / 747 / 81 | 143 / 858 / 70 | 135 / 1039 / 75 | 147 / 1162 / 91 | 187 / 1042 / 178 |
| 20x-longread-cram | 100kb | 53 / 767 / 81 | 178 / 894 / 68 | 156 / 1183 / 75 | 147 / 1192 / 91 |  |
| 200x-longread-bam | 100kb | 331 / 1539 / 161 | 739 / 1784 / 125 | 1002 / 4468 / 91 | 1021 / 5065 / 129 | 1083 / 2873 / 35 |
| 200x-longread-cram | 100kb | 313 / 1622 / 165 | 687 / 1547 / 125 | 992 / 3874 / 91 | — / — / — |  |
| 1000x-longread-bam | 100kb | 25 / 966 / 62 | 2286 / 4715 / 129 | — / — / — | — / — / — | — / — / — |
| 1000x-longread-cram | 100kb | 1227 / 4603 / 482 | 2115 / 3520 / 125 | — / — / — | — / — / — |  |

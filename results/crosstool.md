# Cross-tool render benchmark: JBrowse vs igv.js, GenomeSpy and Gosling

JBrowse against igv.js 3.8.5, GenomeSpy 0.85.0 and Gosling 1.0.7 — same files, same windows, same instrument. The JBrowse arms are `builds/current`, `builds/release-4.3.0`, `builds/release-2.4.0`; only the build under test is asked for the WebGL2 renderer, since a release that predates the parameter ignores it.

Two windows, both on the same contig, the wider one containing the narrower: **19kb** `chr22_mask:124000-143000`, **100kb** `chr22_mask:75000-175000`. Same reads, more of them, so a row pair says how each tool scales with what is on screen rather than with what is in the file.

Three limits decide which cells exist at all, and the table names them rather than leaving a reader to infer them from a suspiciously fast cell:

- **Gosling stops at 20 kb.** `MAX_TILE_WIDTH = 2e4` in its `BamDataFetcher`, checked against every visible tile by `gosling-track.ts:calculateVisibleTiles`, which returns before fetching. Tile width is the declared genome length over 2^zoom, so on this 250 kb assembly the 19 kb window draws and the 100 kb one paints a full axis and no reads. Its 100 kb cells are `n/a`, not a timing — a page that draws nothing settles immediately under this instrument, so timing it would make Gosling the fastest tool in the table at the window it cannot render.
- **`tile cap raised` is that same build with the cap patched out**, which is the only way Gosling reaches the wider window. Read the pair, not the patched column alone: a patched library is not the one anyone installs. It also fetches a whole tile rather than the window — 40002 reads at 100 kb on the 20x file against roughly 16000 in view — so it is an upper bound on what an unpatched Gosling would cost at this width even if it could draw it.
- **Neither GenomeSpy nor Gosling reads CRAM**, so the format axis stops at BAM for both columns. igv.js and JBrowse carry the CRAM rows.

The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to every column.

**Stable pixels alone were not enough, and the Gosling arms are why.** A page that is working with nothing moving on screen satisfies a pixel-stability test, and Gosling shows a *static* "Fetching" frame for its first few seconds while a worker boots and reads the index — no animation, and no request outstanding either. Measured 2026-08-28, it settled at 2.4 s on an empty plot against a true 7.6 s. So the instrument now also refuses to settle while a corpus read is in flight, and while a harness page exports `__harnessBusy()` returning true; Gosling's is `records === 0`, a content gate that adds no constant once the first feature lands. Correcting it moved the stock 19 kb Gosling cell up by roughly half while the ungated igv arm held within 9% across the same runs. **A page that defines no such predicate is measured exactly as before**, so every column other than GenomeSpy and Gosling is unaffected and comparable with the rows recorded before this axis existed.

Three JBrowse arms and one igv.js arm carry the comparison; the remaining igv columns are controls rather than workload knobs:

- **Downsampling.** igv draws at most `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000) and JBrowse draws every read. On this corpus the deepest 100 bp window holds roughly 700 short reads, so the default clips a little and the maximum clips nothing — if the default and `no downsampling` columns agree, downsampling is not what the comparison is measuring.
- **Track height.** The harness gives igv a 600 px track; igv's own default for a BAM track is 300, and JBrowse's pileup canvas at this viewport is about 210. igv draws packed rows until it runs out of canvas while JBrowse draws every read it holds and lets the rasterizer clip, so a taller igv track is more igv work and no more JBrowse work. The last two columns are that control, run as its own interleaved pair so it does not disturb the headline ratio.

Median of 3 runs after 1 warmup, tools interleaved within each round. A blank cell was not measured in the run that produced its row; `n/a` is a capability limit named in the list above, and an arm holding one is dropped from the interleaving rather than timed on a page it cannot draw. `>Ns` is an arm that failed to settle within the paint ceiling 2 times and was abandoned for that cell — a result about the tool at that width, not a gap in the run. The ceiling scales with the window (19kb 120s, 100kb 632s), so `>Ns` means the same thing on both rows.

`foreign` is the most CPU any of the row's cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. That, and not the load average, is what says whether a row is trustworthy: a row above 0.5 is contended and its absolute milliseconds are not a run of record. `load` is kept as context, because it counts this benchmark's own threads and a heavy cell inflates it by working — the 1000x long-read cells drive it into the tens on an idle box. Rows recorded before 2026-08-24 have no foreign figure and show `?`; they were judged against a 4.0 load ceiling, which is the best that can be done with what they recorded.

| case | window | JBrowse (current) | JBrowse (release-4.3.0) | JBrowse (release-2.4.0) | igv.js 3.8.5 | igv.js 3.8.5, no downsampling | igv.js 3.8.5, 300 px track | igv.js 3.8.5, 600 px track (control arm) | GenomeSpy 0.85.0 | Gosling 1.0.7 | igv default ÷ JBrowse | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 19kb | 1677 ±39 | 2788 ±124 | 2557 ±81 | 1485 ±96 | 1546 ±69 |  |  | 1389 ±33 | 2429 ±30 | 0.89× | 2026-09-03 | 0.07 | claude 0.02 | 1.0 |
| 20x-shortread-bam | 100kb | 1746 ±38 | 3265 ±34 | 4154 ±126 | 2916 ±79 | 2985 ±159 |  |  | 2120 ±42 | n/a | 1.67× | 2026-09-03 | 0.06 | — | 2.0 |
| 20x-shortread-cram | 19kb | 1758 ±143 | 2629 ±54 | 3781 ±96 | 1604 ±117 | 1592 ±96 |  |  | n/a | n/a | 0.91× | 2026-09-03 | 0.07 | claude 0.01 | 1.1 |
| 20x-shortread-cram | 100kb | 1752 ±33 | 3108 ±113 | 5237 ±89 | 2976 ±25 | 3151 ±105 |  |  | n/a | n/a | 1.70× | 2026-09-03 | 0.06 | — | 2.1 |
| 200x-shortread-bam | 19kb | 1785 ±19 | 3276 ±26 | 4244 ±17 | 5256 ±180 | 5357 ±176 | 14928 ±6790 | 12344 ±4393 | 2462 ±24 | 51947 ±639 | 2.94× | 2026-09-03 | 0.05 | — | 40.0 |
| 200x-shortread-bam | 100kb | 2751 ±86 | 5253 ±49 | 13363 ±203 | 18788 ±312 | 19017 ±424 |  |  | 7787 ±116 | n/a | 6.83× | 2026-09-03 | 0.05 | — | 1.8 |
| 200x-shortread-cram | 19kb | 1905 ±97 | 3086 ±174 | 5157 ±113 | 5248 ±155 | 5476 ±58 |  |  | n/a | n/a | 2.75× | 2026-09-03 | 0.07 | — | 1.7 |
| 200x-shortread-cram | 100kb | 2673 ±57 | 6571 ±8 | 16717 ±641 | 19010 ±163 | 18360 ±147 |  |  | n/a | n/a | 7.11× | 2026-09-03 | 0.05 | — | 1.8 |
| 1000x-shortread-bam | 19kb | 2601 ±76 | 4945 ±45 | 10773 ±68 | 26694 ±567 | 26266 ±465 | 39804 ±5160 | 38089 ±2482 | 5692 ±77 | >120s | 10.26× | 2026-09-03 | 0.04 | — | 42.8 |
| 1000x-shortread-bam | 100kb | 6858 ±142 | 13763 ±108 | 57951 ±864 | 111387 ±906 | 113094 ±229 |  |  | 30566 ±140 | n/a | 16.24× | 2026-09-03 | 0.04 | — | 2.9 |
| 1000x-shortread-cram | 19kb | 2428 ±36 | 5892 ±75 | 13079 ±145 | 26770 ±462 | 27333 ±218 |  |  | n/a | n/a | 11.03× | 2026-09-03 | 0.05 | — | 1.5 |
| 1000x-shortread-cram | 100kb | 5770 ±89 | 19356 ±415 | 57907 ±1028 | 128328 ±676 | 126547 ±1725 |  |  | n/a | n/a | 22.24× | 2026-09-03 | 0.03 | — | 2.5 |
| 20x-longread-bam | 19kb | 1717 ±70 | 2980 ±36 | 3333 ±62 | 3456 ±90 | 3565 ±50 |  |  | 4735 ±346 | >120s | 2.01× | 2026-09-03 | 0.05 | claude 0.01 | 1.4 |
| 20x-longread-bam | 100kb | 1975 ±52 | 3998 ±112 | 4836 ±85 | 7738 ±107 | 7839 ±123 |  |  | 11519 ±131 | n/a | 3.92× | 2026-09-03 | 0.06 | — | 2.5 |
| 20x-longread-cram | 19kb | 1710 ±42 | 2682 ±214 | 4002 ±48 | 3540 ±104 | 3657 ±37 |  |  | n/a | n/a | 2.07× | 2026-09-03 | 0.06 | — | 2.1 |
| 20x-longread-cram | 100kb | 1925 ±86 | 3629 ±230 | 5429 ±48 | 7622 ±64 | 7629 ±298 |  |  | n/a | n/a | 3.96× | 2026-09-03 | 0.07 | — | 1.3 |
| 200x-longread-bam | 19kb | 2237 ±41 | 6299 ±105 | 9077 ±128 | 18320 ±448 | 17919 ±212 |  |  | 42133 ±902 | >120s | 8.19× | 2026-09-03 | 0.05 | — | 1.9 |
| 200x-longread-bam | 100kb | 3737 ±77 | 7878 ±121 | 17545 ±252 | 40498 ±660 | 39421 ±151 |  |  | 105342 ±2159 | n/a | 10.84× | 2026-09-03 | 0.04 | — | 1.3 |
| 200x-longread-cram | 19kb | 2265 ±92 | 4003 ±101 | 7507 ±123 | 17779 ±26 | 17629 ±392 |  |  | n/a | n/a | 7.85× | 2026-09-03 | 0.05 | — | 1.4 |
| 200x-longread-cram | 100kb | 3882 ±14 | 6518 ±63 | 16197 ±73 | 39809 ±804 | 40363 ±615 |  |  | n/a | n/a | 10.25× | 2026-09-03 | 0.04 | — | 2.2 |
| 1000x-longread-bam | 19kb | 4640 ±74 | 17296 ±1072 | 34187 ±491 | 55068 ±485 | 55274 ±196 |  |  | >120s | >120s | 11.87× | 2026-09-03 | 0.04 | — | 1.7 |
| 1000x-longread-bam | 100kb | 10665 ±255 | 24999 ±300 | 60285 ±647 | >632s | >632s |  |  | >632s | n/a | — | 2026-09-03 | 0.04 | claude 0.01 | 1.7 |
| 1000x-longread-cram | 19kb | 4391 ±85 | 8917 ±76 | 22242 ±230 | 53567 ±117 | 52877 ±445 |  |  | n/a | n/a | 12.20× | 2026-09-03 | 0.04 | — | 1.5 |
| 1000x-longread-cram | 100kb | 11212 ±48 | 18466 ±232 | 56463 ±5940 | >632s | >632s |  |  | n/a | n/a | — | 2026-09-03 | 0.04 | claude 0.01 | 1.7 |

Median cell load across the matrix: 1.64. Cells measured at more than twice that: 200x-shortread-bam@19kb/igv-h300, 200x-shortread-bam@19kb/igv-h600ctl, 1000x-shortread-bam@19kb/igv-h300, 1000x-shortread-bam@19kb/igv-h600ctl.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

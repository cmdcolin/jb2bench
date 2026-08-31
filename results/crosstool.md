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
| 20x-shortread-bam | 19kb | 2158 ±13 | 2686 ±14 | 2477 ±28 | 1585 ±20 | 1401 ±85 |  |  | 1401 ±30 | 2500 ±34 | 0.73× | 2026-08-31 | 0.22 | firefox 0.05, Isolated Web Co 0.01, claude 0.01 | 1.1 |
| 20x-shortread-bam | 100kb | 2398 ±76 | 3299 ±61 | 4217 ±32 | 2942 ±143 | 2979 ±70 |  |  | 2168 ±14 | n/a | 1.23× | 2026-08-30 | 0.05 | — | 2.5 |
| 20x-shortread-cram | 19kb | 2255 ±66 | 2644 ±30 | 3998 ±64 | 1494 ±71 | 1543 ±74 |  |  | n/a | n/a | 0.66× | 2026-08-31 | 0.20 | firefox 0.04, Isolated Web Co 0.01, claude 0.01 | 1.5 |
| 20x-shortread-cram | 100kb | 2406 ±33 | 3244 ±36 | 5380 ±97 | 2841 ±71 | 2922 ±48 |  |  | n/a | n/a | 1.18× | 2026-08-30 | 0.06 | — | 2.1 |
| 200x-shortread-bam | 19kb | 2386 ±9 | 3284 ±120 | 4257 ±3 | 5252 ±107 | 5235 ±71 | 14928 ±6790 | 12344 ±4393 | 2458 ±10 | 52921 ±174 | 2.20× | 2026-08-30 | 0.04 | — | 40.0 |
| 200x-shortread-bam | 100kb | 3298 ±55 | 5296 ±69 | 13742 ±167 | 18591 ±40 | 18501 ±325 |  |  | 7756 ±147 | n/a | 5.64× | 2026-08-30 | 0.04 | — | 1.8 |
| 200x-shortread-cram | 19kb | 2447 ±97 | 3045 ±31 | 5164 ±96 | 5353 ±31 | 5203 ±146 |  |  | n/a | n/a | 2.19× | 2026-08-30 | 0.06 | fwupd 0.01 | 1.4 |
| 200x-shortread-cram | 100kb | 3179 ±17 | 6505 ±76 | 16521 ±254 | 18813 ±338 | 18426 ±383 |  |  | n/a | n/a | 5.92× | 2026-08-30 | 0.04 | — | 1.8 |
| 1000x-shortread-bam | 19kb | 3274 ±94 | 4998 ±100 | 10593 ±191 | 26221 ±416 | 26485 ±341 | 39804 ±5160 | 38089 ±2482 | 5623 ±76 | >120s | 8.01× | 2026-08-30 | 0.03 | — | 42.8 |
| 1000x-shortread-bam | 100kb | 7279 ±4 | 13662 ±55 | 57990 ±487 | 110589 ±329 | 110976 ±743 |  |  | 30682 ±364 | n/a | 15.19× | 2026-08-30 | 0.03 | — | 1.7 |
| 1000x-shortread-cram | 19kb | 3073 ±80 | 5710 ±86 | 13289 ±66 | 26512 ±301 | 26555 ±414 |  |  | n/a | n/a | 8.63× | 2026-08-30 | 0.04 | — | 1.6 |
| 1000x-shortread-cram | 100kb | 6081 ±12 | 19227 ±177 | 57508 ±809 | 125486 ±744 | 125663 ±67 |  |  | n/a | n/a | 20.64× | 2026-08-30 | 0.03 | — | 2.8 |
| 20x-longread-bam | 19kb | 2280 ±92 | 2889 ±69 | 3266 ±79 | 3468 ±34 | 3483 ±71 |  |  | 4942 ±333 | >120s | 1.52× | 2026-08-30 | 0.04 | — | 2.4 |
| 20x-longread-bam | 100kb | 2490 ±86 | 4052 ±12 | 4784 ±24 | 7682 ±112 | 7643 ±151 |  |  | 11501 ±245 | n/a | 3.09× | 2026-08-30 | 0.05 | — | 2.4 |
| 20x-longread-cram | 19kb | 2336 ±10 | 2773 ±107 | 4114 ±464 | 3463 ±62 | 3584 ±62 |  |  | n/a | n/a | 1.48× | 2026-08-30 | 0.05 | — | 0.8 |
| 20x-longread-cram | 100kb | 2610 ±63 | 3812 ±94 | 5348 ±67 | 7689 ±73 | 7802 ±146 |  |  | n/a | n/a | 2.95× | 2026-08-30 | 0.06 | — | 1.5 |
| 200x-longread-bam | 19kb | 2811 ±63 | 6164 ±140 | 9146 ±91 | 18327 ±243 | 18501 ±355 |  |  | 43281 ±551 | >120s | 6.52× | 2026-08-31 | 0.16 | firefox 0.03, Isolated Web Co 0.01 | 1.8 |
| 200x-longread-bam | 100kb | 4316 ±34 | 7781 ±72 | 17225 ±32 | 39913 ±179 | 39844 ±486 |  |  | 104719 ±1975 | n/a | 9.25× | 2026-08-30 | 0.03 | — | 1.6 |
| 200x-longread-cram | 19kb | 2952 ±62 | 3843 ±99 | 7626 ±138 | 18062 ±242 | 18409 ±309 |  |  | n/a | n/a | 6.12× | 2026-08-31 | 0.15 | firefox 0.03 | 1.8 |
| 200x-longread-cram | 100kb | 4637 ±52 | 6485 ±73 | 15795 ±109 | 39175 ±196 | 38935 ±100 |  |  | n/a | n/a | 8.45× | 2026-08-30 | 0.04 | — | 1.5 |
| 1000x-longread-bam | 19kb | 5140 ±14 | 17381 ±1101 | 34356 ±390 | 54744 ±817 | 54066 ±330 |  |  | >120s | >120s | 10.65× | 2026-08-30 | 0.04 | — | 2.9 |
| 1000x-longread-bam | 100kb | 11164 ±99 | 24447 ±222 | 60472 ±298 | >632s | >632s |  |  | >632s | n/a | — | 2026-08-30 | 0.03 | — | 1.7 |
| 1000x-longread-cram | 19kb | 5380 ±41 | 8866 ±145 | 22329 ±577 | 52443 ±427 | 51930 ±428 |  |  | n/a | n/a | 9.75× | 2026-08-30 | 0.04 | — | 1.4 |
| 1000x-longread-cram | 100kb | 12915 ±35 | 18551 ±209 | 57579 ±5371 | >632s | >632s |  |  | n/a | n/a | — | 2026-08-30 | 0.03 | — | 1.7 |

Median cell load across the matrix: 1.55. Cells measured at more than twice that: 200x-shortread-bam@19kb/igv-h300, 200x-shortread-bam@19kb/igv-h600ctl, 1000x-shortread-bam@19kb/igv-h300, 1000x-shortread-bam@19kb/igv-h600ctl.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

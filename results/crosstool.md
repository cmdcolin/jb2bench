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
| 20x-shortread-bam | 19kb | 1689 ±76 | 2604 ±43 | 2508 ±29 | 1396 ±81 | 1432 ±77 |  |  | 1392 ±5 | 2446 ±17 | 0.83× | 2026-08-31 | 0.10 | htop 0.02, ptyxis 0.01, claude 0.01 | 1.3 |
| 20x-shortread-bam | 100kb | 1787 ±84 | 3198 ±62 | 4168 ±88 | 2996 ±83 | 2954 ±87 |  |  | 2099 ±28 | n/a | 1.68× | 2026-08-31 | 0.06 | — | 1.4 |
| 20x-shortread-cram | 19kb | 1681 ±38 | 2692 ±121 | 3798 ±89 | 1482 ±21 | 1559 ±61 |  |  | n/a | n/a | 0.88× | 2026-08-31 | 0.10 | htop 0.02, ptyxis 0.01 | 1.9 |
| 20x-shortread-cram | 100kb | 1810 ±35 | 3311 ±100 | 5304 ±104 | 2899 ±99 | 3020 ±105 |  |  | n/a | n/a | 1.60× | 2026-08-31 | 0.07 | — | 1.5 |
| 200x-shortread-bam | 19kb | 1851 ±39 | 3162 ±39 | 4329 ±14 | 5175 ±118 | 5281 ±149 | 14928 ±6790 | 12344 ±4393 | 2382 ±36 | 54187 ±1074 | 2.80× | 2026-08-31 | 0.07 | htop 0.02, ptyxis 0.01 | 40.0 |
| 200x-shortread-bam | 100kb | 2843 ±71 | 5258 ±39 | 13750 ±257 | 19382 ±229 | 19257 ±201 |  |  | 7885 ±201 | n/a | 6.82× | 2026-08-31 | 0.06 | — | 1.7 |
| 200x-shortread-cram | 19kb | 1873 ±36 | 3070 ±106 | 5099 ±54 | 5188 ±44 | 5409 ±85 |  |  | n/a | n/a | 2.77× | 2026-08-31 | 0.10 | htop 0.02, ptyxis 0.01 | 1.5 |
| 200x-shortread-cram | 100kb | 2637 ±23 | 6703 ±168 | 17566 ±214 | 19576 ±483 | 19317 ±180 |  |  | n/a | n/a | 7.42× | 2026-08-31 | 0.05 | — | 1.7 |
| 1000x-shortread-bam | 19kb | 2801 ±108 | 4907 ±26 | 10722 ±207 | 26555 ±425 | 26725 ±140 | 39804 ±5160 | 38089 ±2482 | 5647 ±89 | >120s | 9.48× | 2026-08-31 | 0.07 | htop 0.02, ptyxis 0.01 | 42.8 |
| 1000x-shortread-bam | 100kb | 7019 ±139 | 14224 ±206 | 59520 ±1975 | 115735 ±1043 | 116177 ±743 |  |  | 32263 ±610 | n/a | 16.49× | 2026-08-31 | 0.04 | — | 2.4 |
| 1000x-shortread-cram | 19kb | 2406 ±73 | 5861 ±18 | 13627 ±1032 | 26906 ±383 | 26870 ±223 |  |  | n/a | n/a | 11.18× | 2026-08-31 | 0.08 | htop 0.02, ptyxis 0.01 | 2.5 |
| 1000x-shortread-cram | 100kb | 6216 ±83 | 20912 ±486 | 61308 ±5467 | 133019 ±1086 | 134489 ±987 |  |  | n/a | n/a | 21.40× | 2026-08-31 | 0.04 | — | 2.0 |
| 20x-longread-bam | 19kb | 1638 ±67 | 2888 ±22 | 3240 ±16 | 3476 ±66 | 3589 ±121 |  |  | 4916 ±102 | >120s | 2.12× | 2026-08-31 | 0.07 | htop 0.02, ptyxis 0.01, claude 0.01 | 1.6 |
| 20x-longread-bam | 100kb | 1973 ±33 | 4019 ±38 | 4940 ±70 | 8129 ±213 | 8117 ±57 |  |  | 11517 ±588 | n/a | 4.12× | 2026-08-31 | 0.06 | — | 2.6 |
| 20x-longread-cram | 19kb | 1653 ±75 | 2807 ±89 | 4066 ±45 | 3511 ±53 | 3492 ±36 |  |  | n/a | n/a | 2.12× | 2026-08-31 | 0.09 | htop 0.02, ptyxis 0.01, claude 0.01 | 1.6 |
| 20x-longread-cram | 100kb | 2005 ±27 | 3916 ±47 | 5484 ±180 | 8059 ±278 | 8611 ±220 |  |  | n/a | n/a | 4.02× | 2026-08-31 | 0.07 | — | 1.7 |
| 200x-longread-bam | 19kb | 2265 ±31 | 5821 ±127 | 8966 ±27 | 18153 ±325 | 18267 ±108 |  |  | 41478 ±1033 | >120s | 8.01× | 2026-08-31 | 0.08 | htop 0.02, ptyxis 0.01 | 1.3 |
| 200x-longread-bam | 100kb | 3825 ±25 | 8115 ±136 | 18000 ±154 | 41716 ±235 | 41699 ±391 |  |  | 108754 ±870 | n/a | 10.91× | 2026-08-31 | 0.04 | — | 1.9 |
| 200x-longread-cram | 19kb | 2181 ±7 | 4080 ±37 | 7732 ±76 | 17888 ±245 | 17838 ±58 |  |  | n/a | n/a | 8.20× | 2026-08-31 | 0.09 | htop 0.02, ptyxis 0.01 | 1.8 |
| 200x-longread-cram | 100kb | 3905 ±5 | 6724 ±65 | 16863 ±57 | 41274 ±719 | 41990 ±432 |  |  | n/a | n/a | 10.57× | 2026-08-31 | 0.04 | — | 1.9 |
| 1000x-longread-bam | 19kb | 4662 ±58 | 19599 ±310 | 34070 ±380 | 54881 ±253 | 54556 ±385 |  |  | >120s | >120s | 11.77× | 2026-08-31 | 0.08 | htop 0.02, ptyxis 0.01 | 2.5 |
| 1000x-longread-bam | 100kb | 11071 ±5 | 25687 ±583 | 63127 ±965 | >632s | >632s |  |  | >632s | n/a | — | 2026-08-31 | 0.10 | chrome 0.02 | 1.5 |
| 1000x-longread-cram | 19kb | 4069 ±67 | 8809 ±268 | 21725 ±403 | 53116 ±296 | 53861 ±470 |  |  | n/a | n/a | 13.05× | 2026-08-31 | 0.07 | htop 0.02, ptyxis 0.01 | 2.7 |
| 1000x-longread-cram | 100kb | 10839 ±72 | 18436 ±301 | 59822 ±3620 | >632s | >632s |  |  | n/a | n/a | — | 2026-08-31 | 0.05 | — | 2.4 |

Median cell load across the matrix: 1.62. Cells measured at more than twice that: 200x-shortread-bam@19kb/igv-h300, 200x-shortread-bam@19kb/igv-h600ctl, 1000x-shortread-bam@19kb/igv-h300, 1000x-shortread-bam@19kb/igv-h600ctl.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: every column of a row is measured within seconds of the others, so a ratio survives load the absolutes do not.

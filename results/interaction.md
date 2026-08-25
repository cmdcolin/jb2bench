# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **14.09 foreign cores** (`200x-longread-cram / release-4.3.0 / zoom-in` — MainThread 8.14, MainThread 1.08, MainThread 1.04), median 1.94. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-08-25 (structural), out: 2026-08-25 (structural), pan: 2026-08-25 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1077ms | 583ms | 17ms |
| 20x-shortread-cram | 0ms | 1072ms | 568ms | 17ms |
| 200x-shortread-bam | 0ms | 1082ms | 608ms | 17ms |
| 200x-shortread-cram | 0ms | 1162ms | 732ms | 17ms |
| 1000x-shortread-bam | 0ms | 2499ms | 845ms | 17ms |
| 1000x-shortread-cram | 0ms | 1208ms | 1186ms | 17ms |
| 20x-longread-bam | 0ms | 1378ms | 853ms | 17ms |
| 20x-longread-cram | 0ms | 1344ms | 630ms | 17ms |
| 200x-longread-bam | 0ms | 6151ms | 2998ms | 17ms |
| 200x-longread-cram | 0ms | 1984ms | 982ms | 17ms |
| 1000x-longread-bam | 0ms | 13186ms | 8115ms | 50ms |
| 1000x-longread-cram | 0ms | 3553ms | 4014ms | 83ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 382ms | 1826ms | 3382ms | 17ms | 4/4 |
| 20x-shortread-cram | 354ms | 1860ms | 2692ms | 17ms | 4/4 |
| 200x-shortread-bam | 795ms | 6132ms | 23743ms | 92ms | 4/4 |
| 200x-shortread-cram | 927ms | 8863ms | 17254ms | 92ms | 4/4 |
| 1000x-shortread-bam | 3226ms | 40447ms | ≥120009ms | 517ms | 4/4 |
| 1000x-shortread-cram | 2744ms | 47525ms | ≥104110ms | 550ms | 4/4 |
| 20x-longread-bam | 517ms | 3807ms | 3798ms | 50ms | 4/4 |
| 20x-longread-cram | 438ms | 2207ms | 2406ms | 17ms | 4/4 |
| 200x-longread-bam | 1045ms | 9958ms | 17165ms | 217ms | 4/4 |
| 200x-longread-cram | 1363ms | 6177ms | 13943ms | 208ms | 4/4 |
| 1000x-longread-bam | 3174ms | 29379ms | ≥66776ms | 600ms | 4/4 |
| 1000x-longread-cram | 4568ms | 25841ms | ≥95318ms | 575ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 235ms | 1138ms | 4.84× | 490ms | 17ms | 5/5 |
| 20x-shortread-cram | 250ms | 1120ms | 4.48× | 70ms | 17ms | 5/5 |
| 200x-shortread-bam | 877ms | 2089ms | 2.38× | 5450ms | 17ms | 5/5 |
| 200x-shortread-cram | 750ms | 2083ms | 2.78× | 4366ms | 17ms | 5/5 |
| 1000x-shortread-bam | 2931ms | 9453ms | 3.23× | 19696ms | 250ms | 5/5 |
| 1000x-shortread-cram | 1995ms | 10605ms | 5.32× | 31021ms | 167ms | 5/5 |
| 20x-longread-bam | 409ms | 1996ms | 4.88× | 2277ms | 33ms | 5/5 |
| 20x-longread-cram | 269ms | 1172ms | 4.36× | 152ms | 17ms | 5/5 |
| 200x-longread-bam | 576ms | 2962ms | 5.14× | 7199ms | 33ms | 5/5 |
| 200x-longread-cram | 748ms | 1337ms | 1.79× | 1780ms | 33ms | 5/5 |
| 1000x-longread-bam | 1797ms | 11338ms | 6.31× | 24982ms | 167ms | 5/5 |
| 1000x-longread-cram | 2752ms | 4641ms | 1.69× | 16154ms | 183ms | 5/5 |

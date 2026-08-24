# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **1.91 foreign cores** (`1000x-shortread-bam / release-4.3.0 / pan` — tsc 1.46, firefox 0.12, gnome-shell 0.05), median 0.14. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-08-24, out: 2026-08-24, pan: 2026-08-24. Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1062ms | 0ms | 17ms |
| 20x-shortread-cram | 0ms | 1055ms | 0ms | 17ms |
| 200x-shortread-bam | 0ms | 1082ms | 656ms | 17ms |
| 200x-shortread-cram | 0ms | 1079ms | 0ms | 17ms |
| 1000x-shortread-bam | 0ms | 1590ms | 0ms | 17ms |
| 1000x-shortread-cram | 0ms | 1121ms | 0ms | 17ms |
| 20x-longread-bam | 0ms | 1178ms | 788ms | 17ms |
| 20x-longread-cram | 0ms | 1074ms | 591ms | 17ms |
| 200x-longread-bam | 0ms | 2934ms | 0ms | 17ms |
| 200x-longread-cram | 0ms | 1194ms | 0ms | 17ms |
| 1000x-longread-bam | 0ms | 13070ms | 0ms | 67ms |
| 1000x-longread-cram | 0ms | 3449ms | 0ms | 50ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1760ms | 2016ms | 17ms | 4/4 |
| 20x-shortread-cram | 352ms | 1808ms | 1492ms | 17ms | 4/4 |
| 200x-shortread-bam | 583ms | 5419ms | 15242ms | 50ms | 4/4 |
| 200x-shortread-cram | 427ms | 5232ms | 0ms | 58ms | 4/4 |
| 1000x-shortread-bam | 1843ms | 20673ms | 0ms | 192ms | 4/4 |
| 1000x-shortread-cram | 1504ms | 23698ms | 0ms | 283ms | 4/4 |
| 20x-longread-bam | 403ms | 2281ms | 2816ms | 17ms | 4/4 |
| 20x-longread-cram | 0ms | 2172ms | 2928ms | 17ms | 4/4 |
| 200x-longread-bam | 820ms | 7234ms | 0ms | 217ms | 4/4 |
| 200x-longread-cram | 1053ms | 4104ms | 0ms | 175ms | 4/4 |
| 1000x-longread-bam | 3025ms | 26308ms | 0ms | 567ms | 4/4 |
| 1000x-longread-cram | 5091ms | 14387ms | 0ms | 642ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 336ms | 637ms | 1.90× | 0ms | 17ms | 5/5 |
| 20x-shortread-cram | 338ms | 684ms | 2.02× | 0ms | 17ms | 5/5 |
| 200x-shortread-bam | 506ms | 1275ms | 2.52× | 1951ms | 17ms | 5/5 |
| 200x-shortread-cram | 427ms | 1136ms | 2.66× | 2767ms | 17ms | 5/5 |
| 1000x-shortread-bam | 1221ms | 4369ms | 3.58× | 0ms | 83ms | 5/5 |
| 1000x-shortread-cram | 886ms | 4394ms | 4.96× | 0ms | 67ms | 5/5 |
| 20x-longread-bam | 320ms | 1223ms | 3.82× | 687ms | 17ms | 5/5 |
| 20x-longread-cram | 376ms | 1169ms | 3.11× | 0ms | 17ms | 5/5 |
| 200x-longread-bam | 578ms | 2586ms | 4.47× | 0ms | 17ms | 5/5 |
| 200x-longread-cram | 840ms | 1377ms | 1.64× | 2026ms | 17ms | 5/5 |
| 1000x-longread-bam | 1558ms | 11417ms | 7.33× | 0ms | 133ms | 5/5 |
| 1000x-longread-cram | 3087ms | 4723ms | 1.53× | 0ms | 183ms | 5/5 |

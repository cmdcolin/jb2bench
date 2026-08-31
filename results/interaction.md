# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **0.13 foreign cores** (`1000x-longread-bam / current / zoom-in` — http-server 0.03, htop 0.02, claude 0.01), median 0.09. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-08-31 (structural), out: 2026-08-31 (structural), pan: 2026-08-31 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1063ms | 569ms | 17ms |
| 20x-shortread-cram | 0ms | 1069ms | 591ms | 17ms |
| 200x-shortread-bam | 0ms | 1081ms | 626ms | 17ms |
| 200x-shortread-cram | 0ms | 1085ms | 609ms | 17ms |
| 1000x-shortread-bam | 0ms | 1584ms | 688ms | 17ms |
| 1000x-shortread-cram | 0ms | 1110ms | 696ms | 17ms |
| 20x-longread-bam | 0ms | 1148ms | 664ms | 17ms |
| 20x-longread-cram | 0ms | 1094ms | 618ms | 17ms |
| 200x-longread-bam | 0ms | 2819ms | 1961ms | 17ms |
| 200x-longread-cram | 0ms | 1191ms | 902ms | 33ms |
| 1000x-longread-bam | 0ms | 11837ms | 6602ms | 17ms |
| 1000x-longread-cram | 0ms | 2906ms | 2960ms | 33ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 54ms | 1915ms | 3183ms | 17ms | 4/4 |
| 20x-shortread-cram | 35ms | 1846ms | 2269ms | 17ms | 4/4 |
| 200x-shortread-bam | 334ms | 5361ms | 15893ms | 50ms | 4/4 |
| 200x-shortread-cram | 259ms | 5053ms | 10188ms | 58ms | 4/4 |
| 1000x-shortread-bam | 1587ms | 20154ms | 46696ms | 217ms | 4/4 |
| 1000x-shortread-cram | 1153ms | 23600ms | _crash_ | 242ms | 4/4 |
| 20x-longread-bam | 86ms | 2414ms | 1613ms | 17ms | 4/4 |
| 20x-longread-cram | 97ms | 2149ms | 1770ms | 17ms | 4/4 |
| 200x-longread-bam | 626ms | 6454ms | 12669ms | 150ms | 4/4 |
| 200x-longread-cram | 705ms | 4113ms | 10567ms | 142ms | 4/4 |
| 1000x-longread-bam | 2521ms | 26059ms | 41691ms | 633ms | 4/4 |
| 1000x-longread-cram | 2981ms | 11690ms | ≥86220ms | 633ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 26ms | 1116ms | 42.92× | 478ms | 17ms | 5/5 |
| 20x-shortread-cram | 4ms | 1120ms | 280.00× | 70ms | 17ms | 5/5 |
| 200x-shortread-bam | 212ms | 1303ms | 6.15× | 1875ms | 17ms | 5/5 |
| 200x-shortread-cram | 134ms | 1126ms | 8.40× | 2290ms | 17ms | 5/5 |
| 1000x-shortread-bam | 769ms | 4021ms | 5.23× | 11156ms | 67ms | 5/5 |
| 1000x-shortread-cram | 515ms | 4369ms | 8.48× | 10647ms | 67ms | 5/5 |
| 20x-longread-bam | 25ms | 1218ms | 48.72× | 171ms | 17ms | 5/5 |
| 20x-longread-cram | 48ms | 1164ms | 24.25× | 111ms | 17ms | 5/5 |
| 200x-longread-bam | 286ms | 2560ms | 8.95× | 4168ms | 33ms | 5/5 |
| 200x-longread-cram | 389ms | 1450ms | 3.73× | 1594ms | 33ms | 5/5 |
| 1000x-longread-bam | 1197ms | 11049ms | 9.23× | 21749ms | 183ms | 5/5 |
| 1000x-longread-cram | 1494ms | 3808ms | 2.55× | 10924ms | 200ms | 5/5 |

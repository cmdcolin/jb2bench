# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **0.24 foreign cores** (`20x-shortread-bam / current / zoom-in` — claude 0.09, ptyxis 0.06, gnome-shell 0.03), median 0.06. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-09-03 (structural), out: 2026-09-03 (structural), pan: 2026-09-03 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1062ms | 565ms | 17ms |
| 20x-shortread-cram | 0ms | 1061ms | 555ms | 17ms |
| 200x-shortread-bam | 0ms | 1114ms | 629ms | 17ms |
| 200x-shortread-cram | 0ms | 1067ms | 610ms | 17ms |
| 1000x-shortread-bam | 0ms | 1645ms | 697ms | 17ms |
| 1000x-shortread-cram | 0ms | 1113ms | 714ms | 17ms |
| 20x-longread-bam | 0ms | 1165ms | 670ms | 17ms |
| 20x-longread-cram | 0ms | 1081ms | 626ms | 17ms |
| 200x-longread-bam | 0ms | 2881ms | 2047ms | 17ms |
| 200x-longread-cram | 0ms | 1201ms | 894ms | 17ms |
| 1000x-longread-bam | 0ms | 12604ms | 6505ms | 33ms |
| 1000x-longread-cram | 0ms | 3016ms | 2329ms | 17ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 353ms | 1829ms | 3278ms | 17ms | 4/4 |
| 20x-shortread-cram | 344ms | 1805ms | 2306ms | 17ms | 4/4 |
| 200x-shortread-bam | 684ms | 5266ms | 16182ms | 50ms | 4/4 |
| 200x-shortread-cram | 602ms | 5157ms | 10143ms | 67ms | 4/4 |
| 1000x-shortread-bam | 1874ms | 20379ms | 47717ms | 200ms | 4/4 |
| 1000x-shortread-cram | 1484ms | 23880ms | _crash_ | 217ms | 4/4 |
| 20x-longread-bam | 396ms | 2221ms | 1709ms | 17ms | 4/4 |
| 20x-longread-cram | 405ms | 2053ms | 1785ms | 17ms | 4/4 |
| 200x-longread-bam | 894ms | 6849ms | 12574ms | 192ms | 4/4 |
| 200x-longread-cram | 1014ms | 4064ms | 10075ms | 167ms | 4/4 |
| 1000x-longread-bam | 2952ms | 26352ms | 42808ms | 600ms | 4/4 |
| 1000x-longread-cram | 3508ms | 11853ms | ≥91127ms | 600ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 214ms | 1139ms | 5.32× | 541ms | 17ms | 5/5 |
| 20x-shortread-cram | 185ms | 1112ms | 6.01× | 47ms | 17ms | 5/5 |
| 200x-shortread-bam | 818ms | 1266ms | 1.55× | 2533ms | 17ms | 5/5 |
| 200x-shortread-cram | 213ms | 1162ms | 5.46× | 2162ms | 17ms | 5/5 |
| 1000x-shortread-bam | 1296ms | 3951ms | 3.05× | 10296ms | 83ms | 5/5 |
| 1000x-shortread-cram | 1113ms | 4284ms | 3.85× | 9212ms | 67ms | 5/5 |
| 20x-longread-bam | 171ms | 1197ms | 7.00× | 200ms | 17ms | 5/5 |
| 20x-longread-cram | 192ms | 1160ms | 6.04× | 91ms | 17ms | 5/5 |
| 200x-longread-bam | 894ms | 2583ms | 2.89× | 4329ms | 33ms | 5/5 |
| 200x-longread-cram | 946ms | 1399ms | 1.48× | 1422ms | 33ms | 5/5 |
| 1000x-longread-bam | 1544ms | 10911ms | 7.07× | 20249ms | 200ms | 5/5 |
| 1000x-longread-cram | 1944ms | 4208ms | 2.16× | 9235ms | 183ms | 5/5 |

# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **0.15 foreign cores** (`200x-shortread-bam / current / zoom-in` — firefox-bin 0.04, Isolated Web Co 0.03, pipewire-pulse 0.01), median 0.09. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-08-29 (structural), out: 2026-08-29 (structural), pan: 2026-08-29 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1053ms | 557ms | 17ms |
| 20x-shortread-cram | 0ms | 1066ms | 582ms | 17ms |
| 200x-shortread-bam | 0ms | 1072ms | 623ms | 17ms |
| 200x-shortread-cram | 0ms | 1075ms | 609ms | 17ms |
| 1000x-shortread-bam | 0ms | 1522ms | 676ms | 17ms |
| 1000x-shortread-cram | 0ms | 1108ms | 681ms | 17ms |
| 20x-longread-bam | 0ms | 1177ms | 678ms | 17ms |
| 20x-longread-cram | 0ms | 1090ms | 632ms | 17ms |
| 200x-longread-bam | 0ms | 2986ms | 2091ms | 17ms |
| 200x-longread-cram | 0ms | 1178ms | 922ms | 33ms |
| 1000x-longread-bam | 0ms | 12728ms | 7294ms | 50ms |
| 1000x-longread-cram | 0ms | 2983ms | 2892ms | 50ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 354ms | 1778ms | 3236ms | 17ms | 4/4 |
| 20x-shortread-cram | 332ms | 1763ms | 2328ms | 17ms | 4/4 |
| 200x-shortread-bam | 654ms | 5345ms | 16626ms | 50ms | 4/4 |
| 200x-shortread-cram | 560ms | 5452ms | 10788ms | 50ms | 4/4 |
| 1000x-shortread-bam | 1811ms | 21347ms | 47936ms | 283ms | 4/4 |
| 1000x-shortread-cram | 1433ms | 23877ms | _crash_ | 275ms | 4/4 |
| 20x-longread-bam | 391ms | 2375ms | 1646ms | 17ms | 4/4 |
| 20x-longread-cram | 426ms | 2088ms | 1758ms | 17ms | 4/4 |
| 200x-longread-bam | 853ms | 7250ms | 12750ms | 192ms | 4/4 |
| 200x-longread-cram | 1154ms | 4118ms | 11074ms | 183ms | 4/4 |
| 1000x-longread-bam | 2933ms | 27539ms | 52210ms | 575ms | 4/4 |
| 1000x-longread-cram | 4517ms | 12245ms | ≥87459ms | 583ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 236ms | 1132ms | 4.80× | 523ms | 17ms | 5/5 |
| 20x-shortread-cram | 239ms | 1122ms | 4.69× | 47ms | 17ms | 5/5 |
| 200x-shortread-bam | 487ms | 1261ms | 2.59× | 2021ms | 17ms | 5/5 |
| 200x-shortread-cram | 346ms | 1153ms | 3.33× | 2287ms | 17ms | 5/5 |
| 1000x-shortread-bam | 1119ms | 4019ms | 3.59× | 11824ms | 67ms | 5/5 |
| 1000x-shortread-cram | 818ms | 4298ms | 5.25× | 11457ms | 67ms | 5/5 |
| 20x-longread-bam | 263ms | 1207ms | 4.59× | 200ms | 17ms | 5/5 |
| 20x-longread-cram | 264ms | 1166ms | 4.42× | 110ms | 17ms | 5/5 |
| 200x-longread-bam | 465ms | 2661ms | 5.72× | 5068ms | 33ms | 5/5 |
| 200x-longread-cram | 753ms | 1359ms | 1.80× | 1537ms | 17ms | 5/5 |
| 1000x-longread-bam | 1595ms | 11783ms | 7.39× | 23456ms | 133ms | 5/5 |
| 1000x-longread-cram | 2716ms | 4030ms | 1.48× | 9650ms | 150ms | 5/5 |

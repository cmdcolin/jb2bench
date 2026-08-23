# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Measured — in: 2026-08-05, out: 2026-08-05, pan: 2026-08-05. Comparisons *within* a section are same-run; comparisons across sections may not be.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1059ms | — | 17ms |
| 20x-shortread-cram | — | — | — | n/a |
| 200x-shortread-bam | 0ms | 1085ms | — | 17ms |
| 200x-shortread-cram | — | — | — | n/a |
| 1000x-shortread-bam | 0ms | 1717ms | — | 17ms |
| 1000x-shortread-cram | — | — | — | n/a |
| 20x-longread-bam | 0ms | 1178ms | — | 17ms |
| 20x-longread-cram | — | — | — | n/a |
| 200x-longread-bam | 0ms | 2984ms | — | 17ms |
| 200x-longread-cram | — | — | — | n/a |
| 1000x-longread-bam | 0ms | 15321ms | — | 50ms |
| 1000x-longread-cram | — | — | — | n/a |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms (1 bail) | 1970ms | — | 17ms | 3/4 |
| 20x-shortread-cram | — | — | — | n/a | — |
| 200x-shortread-bam | 0ms (3 bail) | _bail_ | — | 17ms | 1/4 |
| 200x-shortread-cram | — | — | — | n/a | — |
| 1000x-shortread-bam | 0ms (3 bail) | _bail_ | — | 17ms | 1/4 |
| 1000x-shortread-cram | — | — | — | n/a | — |
| 20x-longread-bam | 0ms (3 bail) | _bail_ | — | 17ms | 1/4 |
| 20x-longread-cram | — | — | — | n/a | — |
| 200x-longread-bam | 0ms (3 bail) | _bail_ | — | 17ms | 1/4 |
| 200x-longread-cram | — | — | — | n/a | — |
| 1000x-longread-bam | 0ms (3 bail) | _bail_ | — | 83ms | 1/4 |
| 1000x-longread-cram | — | — | — | n/a | — |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 336ms | 639ms | 1.90× | — | 17ms | 5/5 |
| 20x-shortread-cram | — | — | — | — | n/a | — |
| 200x-shortread-bam | 697ms | 1310ms | 1.88× | — | 17ms | 5/5 |
| 200x-shortread-cram | — | — | — | — | n/a | — |
| 1000x-shortread-bam | 1895ms | 6608ms | 3.49× | — | 150ms | 5/5 |
| 1000x-shortread-cram | — | — | — | — | n/a | — |
| 20x-longread-bam | 361ms | 1251ms | 3.47× | — | 17ms | 5/5 |
| 20x-longread-cram | — | — | — | — | n/a | — |
| 200x-longread-bam | 739ms | 3182ms | 4.31× | — | 33ms | 5/5 |
| 200x-longread-cram | — | — | — | — | n/a | — |
| 1000x-longread-bam | 3972ms | 16115ms | 4.06× | — | 233ms | 5/5 |
| 1000x-longread-cram | — | — | — | — | n/a | — |

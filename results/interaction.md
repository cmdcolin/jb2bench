# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **1.16 foreign cores** (`20x-shortread-cram / release-2.4.0 / zoom-in` — firefox 0.32, Isolated Web Co 0.29, RDD Process 0.14), median 0.07. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-09-04 (structural), out: 2026-09-04 (structural), pan: 2026-09-04 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

Every step is a discrete jump, so it ends with `settleCoarseBlocks` rather than leaving the 500 ms `LGVCoarseDynamicBlocks` throttle to expire — the path a UI control takes, and not the per-frame chokepoint a gesture writes through. Flushes: current. Predates the action and waits the throttle out on every step: release-4.3.0, release-2.4.0 — half a second of each of those cells is a timer, and it is a difference between the builds rather than one between the columns' instruments.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1070ms | 596ms | 17ms |
| 20x-shortread-cram | 0ms | 1086ms | 554ms | 17ms |
| 200x-shortread-bam | 0ms | 1107ms | 622ms | 17ms |
| 200x-shortread-cram | 0ms | 1085ms | 630ms | 17ms |
| 1000x-shortread-bam | 0ms | 1510ms | 669ms | 17ms |
| 1000x-shortread-cram | 0ms | 1116ms | 682ms | 17ms |
| 20x-longread-bam | 0ms | 1179ms | 668ms | 17ms |
| 20x-longread-cram | 0ms | 1082ms | 622ms | 17ms |
| 200x-longread-bam | 0ms | 2843ms | 1915ms | 17ms |
| 200x-longread-cram | 0ms | 1210ms | 906ms | 17ms |
| 1000x-longread-bam | 0ms | 12498ms | 6819ms | 33ms |
| 1000x-longread-cram | 0ms | 2889ms | 1927ms | 33ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 359ms | 1873ms | 3314ms | 17ms | 4/4 |
| 20x-shortread-cram | 366ms | 1810ms | 2805ms | 17ms | 4/4 |
| 200x-shortread-bam | 659ms | 5120ms | 16147ms | 75ms | 4/4 |
| 200x-shortread-cram | 697ms | 5193ms | 10377ms | 58ms | 4/4 |
| 1000x-shortread-bam | 1963ms | 20380ms | 47705ms | 308ms | 4/4 |
| 1000x-shortread-cram | 1997ms | 23185ms | _crash_ | 217ms | 4/4 |
| 20x-longread-bam | 385ms | 2339ms | 1076ms | 17ms | 4/4 |
| 20x-longread-cram | 402ms | 2070ms | 1855ms | 17ms | 4/4 |
| 200x-longread-bam | 917ms | 6986ms | 12290ms | 292ms | 4/4 |
| 200x-longread-cram | 1003ms | 4104ms | 10258ms | 175ms | 4/4 |
| 1000x-longread-bam | 2896ms | 26318ms | 50328ms | 617ms | 4/4 |
| 1000x-longread-cram | 3598ms | 11811ms | ≥86813ms | 592ms | 4/4 |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | current | release-4.3.0 | ratio | release-2.4.0 | current redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 174ms | 1141ms | 6.56× | 498ms | 17ms | 5/5 |
| 20x-shortread-cram | 152ms | 1136ms | 7.47× | 48ms | 17ms | 5/5 |
| 200x-shortread-bam | 815ms | 1252ms | 1.54× | 1917ms | 17ms | 5/5 |
| 200x-shortread-cram | 795ms | 1160ms | 1.46× | 2292ms | 17ms | 5/5 |
| 1000x-shortread-bam | 1181ms | 4049ms | 3.43× | 10500ms | 67ms | 5/5 |
| 1000x-shortread-cram | 1110ms | 4286ms | 3.86× | 9957ms | 83ms | 5/5 |
| 20x-longread-bam | 199ms | 1223ms | 6.15× | 195ms | 17ms | 5/5 |
| 20x-longread-cram | 176ms | 1161ms | 6.60× | 109ms | 17ms | 5/5 |
| 200x-longread-bam | 871ms | 2696ms | 3.10× | 4062ms | 33ms | 5/5 |
| 200x-longread-cram | 979ms | 1398ms | 1.43× | 1512ms | 17ms | 5/5 |
| 1000x-longread-bam | 1578ms | 11101ms | 7.03× | 22079ms | 200ms | 5/5 |
| 1000x-longread-cram | 2035ms | 4093ms | 2.01× | 11076ms | 200ms | 5/5 |

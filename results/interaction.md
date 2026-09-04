# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Measured — in: 2026-09-04 (structural), out: 2026-09-04 (structural), pan: 2026-09-04 (structural). Comparisons *within* a section are same-run; comparisons across sections may not be.

Every step is a discrete jump, so it ends with `settleCoarseBlocks` rather than leaving the 500 ms `LGVCoarseDynamicBlocks` throttle to expire — the path a UI control takes, and not the per-frame chokepoint a gesture writes through. Flushes: current. Predates the action and waits the throttle out on every step: release-4.3.0, release-2.4.0 — half a second of each of those cells is a timer, and it is a difference between the builds rather than one between the columns' instruments.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

**This column read 0 ms in every case on 2026-09-04 and does not reproduce.** Re-measured five times on an idle box it reads 146-187 ms, flat across a fifty-fold coverage range, which is the shape of fixed block bookkeeping rather than of drawing (the redraw frame is one vsync either way). The two release columns are unchanged between those runs (4.3.0 at 20x-shortread-bam: 1070 against 1066 ms), so it is not the box: it moved only on the build that can flush the coarse-block throttle, the one where the discrete drive does anything at all. Why the earlier run recorded zeros, with no loading state seen on any step, is not established. Zero was the stronger claim and it is withdrawn.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 163ms | 1066ms | 567ms | 17ms |
| 20x-shortread-cram | 187ms | 1058ms | 584ms | 17ms |
| 200x-shortread-bam | 146ms | 1110ms | 640ms | 17ms |
| 200x-shortread-cram | 174ms | 1078ms | 602ms | 17ms |
| 1000x-shortread-bam | 167ms | 1555ms | 707ms | 17ms |
| 1000x-shortread-cram | 170ms | 1112ms | 733ms | 17ms |
| 20x-longread-bam | 171ms | 1171ms | 694ms | 17ms |
| 20x-longread-cram | 169ms | 1093ms | 639ms | 17ms |
| 200x-longread-bam | 166ms | 2874ms | 2235ms | 17ms |
| 200x-longread-cram | 159ms | 1192ms | 896ms | 17ms |
| 1000x-longread-bam | 168ms | 11697ms | 6818ms | 17ms |
| 1000x-longread-cram | 163ms | 3020ms | 2499ms | 17ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | current | release-4.3.0 | release-2.4.0 | current redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | 171ms | 1755ms | 3313ms | 17ms | 4/4 |
| 20x-shortread-cram | 178ms | 1852ms | 2262ms | 17ms | 4/4 |
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
| 20x-shortread-bam | 175ms | 1133ms | 6.47× | 445ms | 17ms | 5/5 |
| 20x-shortread-cram | 168ms | 1121ms | 6.67× | 64ms | 17ms | 5/5 |
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

# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

Contamination, over the cells measured this run: worst **0.02 foreign cores** (`20x-shortread-bam / main-2026-09-24 / zoom-in`), median 0.02. That is CPU burned by processes outside this benchmark — its own tree and the corpus servers excluded. This box floors near 0.28 with nobody using it, so read the ceiling as a budget over that floor. Cells not measured this run keep their recorded figure and are absent from these two numbers.

Measured — in: 2026-09-24 (structural), out: unknown (text, pre-2026-08-25), pan: unknown (text, pre-2026-08-25). Comparisons *within* a section are same-run; comparisons across sections may not be.

Every step is a discrete jump, so it ends with `settleCoarseBlocks` rather than leaving the 500 ms `LGVCoarseDynamicBlocks` throttle to expire — the path a UI control takes, and not the per-frame chokepoint a gesture writes through. Flushes: main-2026-09-24. Predates the action and waits the throttle out on every step: release-4.3.0, release-2.4.0 — half a second of each of those cells is a timer, and it is a difference between the builds rather than one between the columns' instruments.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

**This column read 0 ms in every case on 2026-09-04 and does not reproduce.** Re-measured five times on an idle box it reads 146-187 ms, flat across a fifty-fold coverage range, which is the shape of fixed block bookkeeping rather than of drawing (the redraw frame is one vsync either way). The two release columns are unchanged between those runs (4.3.0 at 20x-shortread-bam: 1070 against 1066 ms), so it is not the box: it moved only on the build that can flush the coarse-block throttle, the one where the discrete drive does anything at all. Why the earlier run recorded zeros, with no loading state seen on any step, is not established. Zero was the stronger claim and it is withdrawn.

| case | main-2026-09-24 | release-4.3.0 | release-2.4.0 | main-2026-09-24 redraw frame |
|---|---:|---:|---:|---:|
| 20x-shortread-bam | 0ms | 1061ms | 538ms | 17ms |
| 20x-shortread-cram | — | — | — | n/a |
| 200x-shortread-bam | 0ms | 1103ms | 649ms | 17ms |
| 200x-shortread-cram | — | — | — | n/a |
| 1000x-shortread-bam | — | — | — | n/a |
| 1000x-shortread-cram | — | — | — | n/a |
| 20x-longread-bam | — | — | — | n/a |
| 20x-longread-cram | — | — | — | n/a |
| 200x-longread-bam | — | — | — | n/a |
| 200x-longread-cram | — | — | — | n/a |
| 1000x-longread-bam | — | — | — | n/a |
| 1000x-longread-cram | — | — | — | n/a |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. The PAN section below is the test this was meant to be.

| case | main-2026-09-24 | release-4.3.0 | release-2.4.0 | main-2026-09-24 redraw frame | drew/attempted |
|---|---:|---:|---:|---:|---:|
| 20x-shortread-bam | — | — | — | n/a | — |
| 20x-shortread-cram | — | — | — | n/a | — |
| 200x-shortread-bam | — | — | — | n/a | — |
| 200x-shortread-cram | — | — | — | n/a | — |
| 1000x-shortread-bam | — | — | — | n/a | — |
| 1000x-shortread-cram | — | — | — | n/a | — |
| 20x-longread-bam | — | — | — | n/a | — |
| 20x-longread-cram | — | — | — | n/a | — |
| 200x-longread-bam | — | — | — | n/a | — |
| 200x-longread-cram | — | — | — | n/a | — |
| 1000x-longread-bam | — | — | — | n/a | — |
| 1000x-longread-cram | — | — | — | n/a | — |

## PAN at constant zoom — both builds refetch

One full viewport sideways per step, `bpPerPx` unchanged. The region is new to both builds so neither can serve it from what it holds, and the bytes per step are the same as the initial render's, so the density cap that turns zoom-out into a refusal test is never approached. This is the refetch-vs-refetch comparison zoom-out was supposed to be.

Both architectures pay the fetch here, so this is the branch's *hardest* case — the opposite end from zoom-in. Any remaining gap is render cost, not avoided network.

A 19 kb window gets about five viewport-widths before it runs out of the 250 kb `chr22_mask`; steps beyond that are not attempted rather than clamped into a mostly-empty view.

The pan runs **leftward** from the benchmark locus. pbsim's long reads run off the ends of the contig, so long-read depth tapers there — panning right put two of five windows on thinned data (1000x.longread falls 1178 → 938 → 500 over the last three windows), which reads as a speedup in both builds at once. Leftward keeps four of five inside the plateau. Short-read depth is flat across the whole contig either way, and 20x-shortread indeed measures the same in both directions.

| case | main-2026-09-24 | release-4.3.0 | ratio | release-2.4.0 | main-2026-09-24 redraw frame | steps |
|---|---:|---:|---:|---:|---:|---:|
| 20x-shortread-bam | — | — | — | — | n/a | — |
| 20x-shortread-cram | — | — | — | — | n/a | — |
| 200x-shortread-bam | — | — | — | — | n/a | — |
| 200x-shortread-cram | — | — | — | — | n/a | — |
| 1000x-shortread-bam | — | — | — | — | n/a | — |
| 1000x-shortread-cram | — | — | — | — | n/a | — |
| 20x-longread-bam | — | — | — | — | n/a | — |
| 20x-longread-cram | — | — | — | — | n/a | — |
| 200x-longread-bam | — | — | — | — | n/a | — |
| 200x-longread-cram | — | — | — | — | n/a | — |
| 1000x-longread-bam | — | — | — | — | n/a | — |
| 1000x-longread-cram | — | — | — | — | n/a | — |

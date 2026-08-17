# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken and `load` the highest 1-minute load average recorded across its cells. This machine is shared: a row measured under load is not comparable to one measured idle, so any row above 4.0 reports **unusable** in place of a speedup rather than a number that looks like a result. `?` means the row predates per-cell load recording.

| case | current | release-4.3.0 | release-4.1.15 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | load |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| 20x-shortread-bam | 1734 ±58 | 2482 ±582 | 3603 ±260 | 4147 ±322 | **unusable** | **unusable** | 2026-08-13 | 23.2 |
| 20x-shortread-cram | — | — | — | — | — | — | unknown | ? |
| 200x-shortread-bam | 2803 ±293 | 3195 ±547 | 3376 ±1342 | 5198 ±1912 | **unusable** | **unusable** | 2026-08-13 | 16.8 |
| 200x-shortread-cram | — | — | — | — | — | — | unknown | ? |
| 1000x-shortread-bam | 5402 ±1572 | 5411 ±503 | 5085 ±272 | 10912 ±3214 | **unusable** | **unusable** | 2026-08-13 | 21.4 |
| 1000x-shortread-cram | — | — | — | — | — | — | unknown | ? |
| 20x-longread-bam | 1881 ±53 | 2885 ±72 | 2761 ±75 | 3315 ±1496 | **unusable** | **unusable** | 2026-08-13 | 14.7 |
| 20x-longread-cram | — | — | — | — | — | — | unknown | ? |
| 200x-longread-bam | 3402 ±1916 | 9784 ±4099 | 11364 ±3694 | 12106 ±2884 | **unusable** | **unusable** | 2026-08-13 | 27.7 |
| 200x-longread-cram | — | — | — | — | — | — | unknown | ? |
| 1000x-longread-bam | 7350 ±389 | 36171 ±6832 | 56452 ±6155 | — | **unusable** | — | 2026-08-05 | 35.4 |
| 1000x-longread-cram | — | — | — | — | — | — | unknown | ? |

> **20x-shortread-bam, 200x-shortread-bam, 1000x-shortread-bam, 20x-longread-bam, 200x-longread-bam, 1000x-longread-bam** were measured on a machine under heavy external load and the timings are not usable. The medians are left in the table because they are what was measured, not because they mean anything; re-run with `CASES=20x-shortread-bam,200x-shortread-bam,1000x-shortread-bam,20x-longread-bam,200x-longread-bam,1000x-longread-bam` on an idle box. Judge that the box is idle from `uptime` before starting, not from the load at the moment the run begins — on 2026-08-05 a run that started at load 3.15 was at 35 by the time it finished.

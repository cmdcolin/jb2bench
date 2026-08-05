# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken and `load` the highest 1-minute load average recorded across its cells. This machine is shared: a row measured under load is not comparable to one measured idle, so any row above 4.0 reports **unusable** in place of a speedup rather than a number that looks like a result. `?` means the row predates per-cell load recording.

| case | current | release-4.3.0 | release-4.1.15 | speedup vs release-4.3.0 | measured | load |
|---|---:|---:|---:|---:|---|---:|
| 20x-shortread | 1789 ±38 | 2396 ±54 | 2381 ±38 | 1.34× | 2026-08-05 | ? |
| 200x-shortread | 2153 ±51 | 2780 ±37 | 2845 ±308 | 1.29× | 2026-08-05 | ? |
| 1000x-shortread | 3784 ±89 | 5084 ±150 | 5330 ±257 | 1.34× | 2026-08-05 | ? |
| 20x-longread | 1907 ±42 | 2657 ±46 | 2640 ±80 | 1.39× | 2026-08-05 | ? |
| 200x-longread | 2907 ±45 | 6352 ±129 | 6486 ±155 | 2.19× | 2026-08-05 | ? |
| 1000x-longread | 7350 ±389 | 36171 ±6832 | 56452 ±6155 | **unusable** | 2026-08-05 | 35.4 |

> **1000x-longread** was measured on a machine under heavy external load and the timings are not usable. The medians are left in the table because they are what was measured, not because they mean anything; re-run with `CASES=1000x-longread` on an idle box. Judge that the box is idle from `uptime` before starting, not from the load at the moment the run begins — on 2026-08-05 a run that started at load 3.15 was at 35 by the time it finished.

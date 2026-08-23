# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 3 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark's own process tree**, in cores; a row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-4.3.0 | release-4.1.15 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | foreign | load |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 20x-shortread-bam | 1719 ±47 | 2278 ±16 | 2273 ±2 | 2218 ±17 | 1.33× | 1.29× | 2026-08-23 | 0.12 | 1.6 |
| 20x-shortread-cram | 1820 ±54 | 2268 ±33 | 2317 ±29 | 3604 ±20 | 1.25× | 1.98× | 2026-08-23 | 0.12 | 1.3 |
| 200x-shortread-bam | 1921 ±7 | 2757 ±42 | 2780 ±1 | 4067 ±80 | 1.44× | 2.12× | 2026-08-23 | 0.09 | 1.7 |
| 200x-shortread-cram | 1915 ±8 | 2586 ±34 | 2676 ±47 | 3509 ±59 | 1.35× | 1.83× | 2026-08-23 | 0.10 | 1.6 |
| 1000x-shortread-bam | 2828 ±4 | 4586 ±96 | 4582 ±42 | 7615 ±49 | 1.62× | 2.69× | 2026-08-23 | 0.08 | 2.1 |
| 1000x-shortread-cram | 2608 ±7 | 5771 ±171 | 5591 ±146 | 10200 ±1366 | 2.21× | 3.91× | 2026-08-23 | 0.08 | 2.2 |
| 20x-longread-bam | 1828 ±58 | 2580 ±11 | 2558 ±45 | 3026 ±45 | 1.41× | 1.66× | 2026-08-23 | 0.08 | 1.7 |
| 20x-longread-cram | 1907 ±44 | 2369 ±3 | 2358 ±26 | 3847 ±59 | 1.24× | 2.02× | 2026-08-23 | 0.11 | 2.1 |
| 200x-longread-bam | 2326 ±42 | 5679 ±101 | 5911 ±59 | 7165 ±121 | 2.44× | 3.08× | 2026-08-23 | 0.10 | 1.6 |
| 200x-longread-cram | 2427 ±44 | 3569 ±41 | 3771 ±40 | 5214 ±127 | 1.47× | 2.15× | 2026-08-23 | 0.10 | 2.0 |
| 1000x-longread-bam | 4609 ±50 | 20375 ±105 | 20314 ±1370 | 21607 ±116 | **unusable** | **unusable** | 2026-08-23 | 0.56 | 1.8 |
| 1000x-longread-cram | 4814 ±122 | 9111 ±176 | 8878 ±203 | 17915 ±621 | **unusable** | **unusable** | 2026-08-23 | 0.55 | 1.7 |

> **1000x-longread-bam, 1000x-longread-cram** were measured while something else was using the machine, and the timings are not usable. The medians are left in the table because they are what was measured, not because they mean anything; re-run with `CASES=1000x-longread-bam,1000x-longread-cram` on an idle box. Judge that the box is idle from `uptime` before starting, not from the load at the moment the run begins — on 2026-08-05 a run that started at load 3.15 was at 35 by the time it finished.

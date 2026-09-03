# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-4.3.0 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---|---:|---|---:|
| 20x-shortread-bam | 1122 ±53 | 2297 ±24 | 2234 ±13 | 2.05× | 1.99× | 2026-09-03 | 0.21 | firefox 0.03, claude 0.03, Isolated Web Co 0.02 | 1.5 |
| 20x-shortread-cram | 1214 ±22 | 2289 ±56 | 3641 ±53 | 1.89× | 3.00× | 2026-09-03 | 0.16 | Isolated Web Co 0.02, firefox 0.02, http-server 0.02 | 2.4 |
| 200x-shortread-bam | 1322 ±47 | 2759 ±46 | 4082 ±83 | 2.09× | 3.09× | 2026-09-03 | 0.16 | firefox 0.03, Isolated Web Co 0.02, http-server 0.02 | 1.4 |
| 200x-shortread-cram | 1308 ±47 | 2675 ±57 | 3489 ±79 | 2.05× | 2.67× | 2026-09-03 | 0.29 | firefox 0.08, Isolated Web Co 0.07, gnome-shell 0.04 | 1.4 |
| 1000x-shortread-bam | 2213 ±41 | 4685 ±98 | 7538 ±207 | 2.12× | 3.41× | 2026-09-03 | 0.44 | firefox 0.16, claude 0.06, gnome-shell 0.04 | 2.7 |
| 1000x-shortread-cram | 1999 ±49 | 5827 ±95 | 9898 ±1070 | 2.91× | 4.95× | 2026-09-03 | 0.20 | claude 0.05, ptyxis 0.04, http-server 0.02 | 3.0 |
| 20x-longread-bam | 1217 ±12 | 2570 ±50 | 2949 ±51 | 2.11× | 2.42× | 2026-09-03 | 0.12 | firefox 0.04, claude 0.01 | 1.5 |
| 20x-longread-cram | 1246 ±44 | 2382 ±32 | 3760 ±60 | 1.91× | 3.02× | 2026-09-03 | 0.08 | http-server 0.02, claude 0.01 | 2.2 |
| 200x-longread-bam | 1742 ±49 | 5887 ±147 | 7242 ±31 | 3.38× | 4.16× | 2026-09-03 | 0.10 | http-server 0.04, claude 0.01 | 1.6 |
| 200x-longread-cram | 1814 ±52 | 3652 ±84 | 5255 ±140 | 2.01× | 2.90× | 2026-09-03 | 0.09 | http-server 0.03 | 2.2 |
| 1000x-longread-bam | 4099 ±64 | 20572 ±1252 | 21981 ±339 | 5.02× | 5.36× | 2026-09-03 | 0.13 | http-server 0.08 | 2.4 |
| 1000x-longread-cram | 3867 ±67 | 8930 ±204 | 17902 ±1279 | 2.31× | 4.63× | 2026-09-03 | 0.09 | http-server 0.05 | 2.2 |

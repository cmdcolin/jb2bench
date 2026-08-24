# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-4.3.0 | release-4.1.15 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|
| 20x-shortread-bam | 1720 ±39 | 2338 ±59 | 2303 ±51 | 2241 ±15 | 1.36× | 1.30× | 2026-08-24 | 0.28 | ptyxis 0.09, claude 0.07, firefox 0.03 | 1.5 |
| 20x-shortread-cram | 1816 ±6 | 2269 ±20 | 2295 ±16 | 3551 ±73 | 1.25× | 1.96× | 2026-08-24 | 0.14 | claude 0.04, ptyxis 0.02 | 1.6 |
| 200x-shortread-bam | 1926 ±48 | 2794 ±13 | 2786 ±20 | 4060 ±35 | 1.45× | 2.11× | 2026-08-24 | 0.12 | firefox 0.03, claude 0.01, claude 0.01 | 1.7 |
| 200x-shortread-cram | 2013 ±44 | 2709 ±58 | 2699 ±65 | 3471 ±48 | 1.35× | 1.72× | 2026-08-24 | 0.18 | Isolated Web Co 0.06, firefox 0.02, Utility Process 0.01 | 4.2 |
| 1000x-shortread-bam | 2818 ±35 | 4700 ±108 | 4646 ±135 | 7544 ±251 | 1.67× | 2.68× | 2026-08-24 | 0.15 | Isolated Web Co 0.05, firefox 0.02, Utility Process 0.01 | 2.3 |
| 1000x-shortread-cram | 2616 ±57 | 5716 ±222 | 5695 ±138 | 9943 ±952 | 2.18× | 3.80× | 2026-08-24 | 0.17 | Isolated Web Co 0.05, firefox 0.02, Utility Process 0.01 | 2.0 |
| 20x-longread-bam | 1817 ±36 | 2613 ±65 | 2622 ±20 | 2996 ±47 | 1.44× | 1.65× | 2026-08-24 | 0.20 | Isolated Web Co 0.08, Utility Process 0.02, firefox 0.01 | 2.5 |
| 20x-longread-cram | 1827 ±44 | 2351 ±107 | 2391 ±116 | 3840 ±59 | 1.29× | 2.10× | 2026-08-24 | 0.36 | claude 0.16, ptyxis 0.06, firefox 0.02 | 1.5 |
| 200x-longread-bam | 2325 ±42 | 5979 ±138 | 6062 ±202 | 7272 ±139 | 2.57× | 3.13× | 2026-08-24 | 0.33 | chrome 0.07, claude 0.05, ptyxis 0.05 | 1.8 |
| 200x-longread-cram | 2507 ±47 | 3640 ±94 | 3757 ±61 | 5244 ±93 | 1.45× | 2.09× | 2026-08-24 | 0.19 | claude 0.07, ptyxis 0.05, gnome-shell 0.01 | 2.3 |
| 1000x-longread-bam | 4719 ±7 | 19730 ±406 | 21036 ±1160 | 21706 ±417 | 4.18× | 4.60× | 2026-08-24 | 0.19 | claude 0.05, ptyxis 0.05, node-MainThread 0.02 | 2.2 |
| 1000x-longread-cram | 4867 ±118 | 9056 ±149 | 9059 ±160 | 18044 ±1772 | 1.86× | 3.71× | 2026-08-24 | 0.10 | firefox 0.02, Isolated Web Co 0.02, Isolated Web Co 0.01 | 2.0 |

# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-4.3.0 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---|---:|---|---:|
| 20x-shortread-bam | 1764 ±45 | 2302 ±61 | 2232 ±7 | 1.31× | 1.27× | 2026-08-28 | 0.12 | firefox-bin 0.03, Isolated Web Co 0.02, claude 0.01 | 1.3 |
| 20x-shortread-cram | 1818 ±5 | 2273 ±63 | 3631 ±36 | 1.25× | 2.00× | 2026-08-28 | 0.12 | Isolated Web Co 0.02, firefox-bin 0.02, claude 0.01 | 1.3 |
| 200x-shortread-bam | 1967 ±47 | 2815 ±64 | 4035 ±78 | 1.43× | 2.05× | 2026-08-28 | 0.11 | Isolated Web Co 0.02, firefox-bin 0.02, claude 0.01 | 2.6 |
| 200x-shortread-cram | 1920 ±51 | 2669 ±35 | 3463 ±44 | 1.39× | 1.80× | 2026-08-28 | 0.12 | Isolated Web Co 0.02, firefox-bin 0.02, claude 0.01 | 2.1 |
| 1000x-shortread-bam | 2822 ±5 | 4568 ±70 | 7392 ±158 | 1.62× | 2.62× | 2026-08-28 | 0.10 | firefox-bin 0.02, Isolated Web Co 0.02 | 2.3 |
| 1000x-shortread-cram | 2613 ±38 | 5532 ±122 | 9693 ±954 | 2.12× | 3.71× | 2026-08-28 | 0.11 | firefox-bin 0.03, Isolated Web Co 0.02 | 2.2 |
| 20x-longread-bam | 1812 ±35 | 2557 ±64 | 2928 ±5 | 1.41× | 1.62× | 2026-08-28 | 0.12 | firefox-bin 0.02, Isolated Web Co 0.02, claude 0.01 | 2.2 |
| 20x-longread-cram | 1912 ±40 | 2420 ±53 | 3829 ±53 | 1.27× | 2.00× | 2026-08-28 | 0.13 | Isolated Web Co 0.02, firefox-bin 0.02, claude 0.01 | 1.4 |
| 200x-longread-bam | 2419 ±38 | 5740 ±148 | 7093 ±82 | 2.37× | 2.93× | 2026-08-28 | 0.11 | Isolated Web Co 0.02, firefox-bin 0.02 | 1.5 |
| 200x-longread-cram | 2464 ±69 | 3585 ±36 | 5147 ±127 | 1.46× | 2.09× | 2026-08-28 | 0.10 | firefox-bin 0.02, Isolated Web Co 0.02 | 1.7 |
| 1000x-longread-bam | 4621 ±81 | 18600 ±1430 | 21434 ±320 | 4.03× | 4.64× | 2026-08-28 | 0.09 | firefox-bin 0.02, Isolated Web Co 0.01 | 2.0 |
| 1000x-longread-cram | 4913 ±68 | 8779 ±120 | 16885 ±1739 | 1.79× | 3.44× | 2026-08-28 | 0.08 | firefox-bin 0.02, Isolated Web Co 0.02 | 2.0 |

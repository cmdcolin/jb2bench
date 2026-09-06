# Alignments render benchmark

Region `chr22_2mb:500001-1500000` (1 Mb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-2.4.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-2.4.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---|---:|---|---:|
| 1mb-20x-shortread-bam | 2097 ±47 | 4136 ±136 | 1.97× | 2026-09-06 | 0.18 | ptyxis 0.06, claude 0.06, gnome-shell 0.01 | 1.2 |
| 1mb-20x-shortread-cram | 2213 ±24 | 11172 ±517 | 5.05× | 2026-09-06 | 0.18 | claude 0.06, ptyxis 0.06, gnome-shell 0.02 | 1.6 |
| 1mb-100x-shortread-bam | 5710 ±61 | 14037 ±340 | 2.46× | 2026-09-06 | 0.22 | claude 0.08, ptyxis 0.04, gpg-agent 0.02 | 1.9 |
| 1mb-100x-shortread-cram | 6017 ±147 | 36848 ±3367 | 6.12× | 2026-09-06 | 0.44 | claude 0.10, ptyxis 0.09, claude 0.05 | 2.4 |
| 1mb-20x-longread-bam | 3308 ±41 | 4578 ±32 | 1.38× | 2026-09-06 | 0.35 | firefox-bin 0.09, ptyxis 0.04, gnome-shell 0.04 | 2.4 |
| 1mb-20x-longread-cram | 3619 ±121 | 9040 ±493 | 2.50× | 2026-09-06 | 0.24 | claude 0.08, ptyxis 0.04, firefox-bin 0.03 | 4.5 |
| 1mb-100x-longread-bam | 9417 ±229 | 14103 ±226 | 1.50× | 2026-09-06 | 0.15 | ptyxis 0.03, claude 0.02, claude 0.02 | 3.1 |
| 1mb-100x-longread-cram | 10023 ±150 | 32158 ±1126 | 3.21× | 2026-09-06 | 0.14 | ptyxis 0.02, claude 0.01, claude 0.01 | 2.0 |

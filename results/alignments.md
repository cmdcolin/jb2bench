# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-4.3.0 | release-2.4.0 | speedup vs release-4.3.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---:|---:|---|---:|---|---:|
| 20x-shortread-bam | 1219 ±40 | 2321 ±65 | 2246 ±44 | 1.90× | 1.84× | 2026-08-31 | 0.13 | htop 0.02, http-server 0.02, ptyxis 0.01 | 1.1 |
| 20x-shortread-cram | 1217 ±37 | 2267 ±37 | 3572 ±50 | 1.86× | 2.94× | 2026-08-31 | 0.12 | htop 0.02, http-server 0.01, ptyxis 0.01 | 1.4 |
| 200x-shortread-bam | 1411 ±42 | 2742 ±45 | 4039 ±62 | 1.94× | 2.86× | 2026-08-31 | 0.12 | htop 0.02, http-server 0.02, ptyxis 0.01 | 1.4 |
| 200x-shortread-cram | 1419 ±55 | 2609 ±22 | 3490 ±517 | 1.84× | 2.46× | 2026-08-31 | 0.12 | htop 0.02, http-server 0.02, ptyxis 0.01 | 1.4 |
| 1000x-shortread-bam | 2218 ±50 | 4508 ±124 | 7142 ±158 | 2.03× | 3.22× | 2026-08-31 | 0.12 | http-server 0.03, htop 0.02, ptyxis 0.01 | 1.6 |
| 1000x-shortread-cram | 2011 ±36 | 5422 ±143 | 10120 ±868 | 2.70× | 5.03× | 2026-08-31 | 0.12 | htop 0.02, ptyxis 0.02, http-server 0.02 | 1.6 |
| 20x-longread-bam | 1214 ±57 | 2566 ±49 | 2938 ±37 | 2.11× | 2.42× | 2026-08-31 | 0.12 | htop 0.02, http-server 0.02, ptyxis 0.01 | 1.8 |
| 20x-longread-cram | 1317 ±41 | 2381 ±112 | 3734 ±59 | 1.81× | 2.83× | 2026-08-31 | 0.12 | htop 0.02, http-server 0.02, ptyxis 0.01 | 1.6 |
| 200x-longread-bam | 1812 ±39 | 5540 ±115 | 6927 ±42 | 3.06× | 3.82× | 2026-08-31 | 0.14 | http-server 0.05, htop 0.02, ptyxis 0.02 | 1.8 |
| 200x-longread-cram | 1723 ±68 | 3512 ±84 | 4944 ±123 | 2.04× | 2.87× | 2026-08-31 | 0.12 | http-server 0.03, htop 0.02, ptyxis 0.01 | 2.1 |
| 1000x-longread-bam | 4106 ±38 | 18170 ±957 | 21232 ±284 | 4.43× | 5.17× | 2026-08-31 | 0.16 | http-server 0.08, htop 0.02, ptyxis 0.01 | 1.4 |
| 1000x-longread-cram | 3410 ±61 | 8503 ±64 | 17478 ±1367 | 2.49× | 5.13× | 2026-08-31 | 0.14 | http-server 0.05, htop 0.02, ptyxis 0.01 | 2.9 |

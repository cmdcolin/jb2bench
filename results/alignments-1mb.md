# Alignments render benchmark

Region `chr22_2mb:500001-1500000` (1 Mb). In-page navigation→render-complete time, median of 10 runs (ms). Speedup = release-2.4.0 median ÷ current median.

`measured` is when each row was taken. `foreign` is the most CPU any of its cells saw burned by processes **outside this benchmark**, in cores — outside the runner's process tree, and outside the corpus http-servers, which serve the bytes under test and are apparatus rather than contention. A row above 0.5 reports **unusable** in place of a speedup rather than a number that looks like a result, and `by` names what burned it, because a bare 0.55 cannot be acted on. This box idles near 0.28 foreign cores with nobody using it — other agent sessions, a terminal, a browser — so the ceiling is a budget over that floor and not over zero. **Running shell commands against the box during a run spends that budget**; two rows were condemned on 2026-08-23 by the operator's own `find` and `node` invocations.

`load` is the highest 1-minute load average across the row's cells, kept as context and **not** as the verdict. It counts this benchmark's own threads, so a heavy cell inflates it by working: 1000x-shortread-bam on release-2.4.0 took it from 2.1 to 10.3 on an otherwise idle box, and the next cell started at 10.3 having inherited work this benchmark did itself. Judging by load called clean rows unusable, and the heavier the case the more certainly it did. Rows measured before 2026-08-23 have no foreign-CPU figure — they show `?` and are judged the old way, by load against 4.0, which is the best that can be done with what they recorded.

| case | current | release-2.4.0 | speedup vs release-2.4.0 | measured | foreign | by | load |
|---|---:|---:|---:|---|---:|---|---:|
| 1mb-20x-shortread-bam | 2108 ±23 | 29715 ±699 | 14.10× | 2026-09-06 | 0.07 | claude 0.02 | 1.9 |
| 1mb-20x-shortread-cram | 2260 ±28 | 12484 ±239 | 5.53× | 2026-09-06 | 0.08 | gnome-shell 0.01, firefox-bin 0.01 | 2.8 |
| 1mb-100x-shortread-bam | 5811 ±116 | 38591 ±25314 | 6.64× | 2026-09-06 | 0.11 | gnome-shell 0.02, firefox-bin 0.01, fwupd 0.01 | 1.9 |
| 1mb-100x-shortread-cram | 5907 ±116 | 53822 ±797 | 9.11× | 2026-09-06 | 0.10 | gnome-shell 0.02, firefox-bin 0.01 | 2.3 |
| 1mb-20x-longread-bam | 3406 ±89 | 37697 ±554 | 11.07× | 2026-09-06 | 0.06 | — | 2.7 |
| 1mb-20x-longread-cram | 3553 ±45 | NaN ±NaN | — | 2026-09-06 | 0.06 | claude 0.01, firefox-bin 0.01 | 2.7 |
| 1mb-100x-longread-bam | 9410 ±176 | 106567 ±1513 | 11.32× | 2026-09-06 | 0.10 | firefox-bin 0.02, gnome-shell 0.02 | 1.3 |
| 1mb-100x-longread-cram | 10338 ±172 | NaN ±NaN | — | 2026-09-06 | 0.09 | gnome-shell 0.02, firefox-bin 0.01 | 2.2 |

## Peak memory

Highest resident memory across the **whole browser process tree** — browser, GPU, renderer, workers — sampled once a second, in GB. Not the JS heap: a page's cost is spread over several processes and the heap of one of them is not what a machine has to find. The figure is the worst of the row's runs, because a render that peaks at 5.5 GB and settles at 2 fails on a machine with 4 GB free and the settled number would not say so.

`stalled` counts runs that produced no timing at all — the browser stopped making progress and the run was abandoned. At this window that is a property of the build and the cell, not of the box: release 2.4.0 stalls on the heaviest short-read cell about as often as it finishes it, at 5.5 GB.

| case | current | release-2.4.0 |
|---|---:|---:|
| 1mb-20x-shortread-bam | 1.7 GB | 4.8 GB |
| 1mb-20x-shortread-cram | 1.7 GB | 2.4 GB |
| 1mb-100x-shortread-bam | 3.5 GB | 7.1 GB, 5 stalled |
| 1mb-100x-shortread-cram | 3.4 GB | 5.3 GB |
| 1mb-20x-longread-bam | 2.2 GB | 4.8 GB |
| 1mb-20x-longread-cram | 2.2 GB | — |
| 1mb-100x-longread-bam | 4.9 GB | 6.5 GB |
| 1mb-100x-longread-cram | 4.9 GB | — |

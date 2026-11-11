# Hardware panel: g4dn-nogpu

builds/release-5.0.0-beta.21, Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz (16 logical CPUs, 62.1 GB), GPU GPU 0: Tesla T4 (UUID: GPU-625c892c-8781-658f-18c0-03d7d0121f0a), Chrome/148.0.7778.97, linux 6.8.0-1069-aws. 1 warm-up and 5 runs per cell, backends interleaved within each run. Cold load is paintprofile.ts to the last changed frame; zoom is panprofile.ts INSTRUMENT=frames, the median of its steps per run. A run counts only if the page reached the pinned rung and, for webgpu and webgl, a hardware adapter. Memory is the median over counted cold-load runs: JS heap over page and workers; PSS summed over the Chrome processes (/proc).

| cell | backend | n | median ms | sd | min | max | rung | adapter | JS heap MB | Chrome MB |
|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|
| cold-20x | canvas2d | 5 | 1494 | 113 | 1448 | 1704 | canvas2d | no-webgl2 | 43 | 569 |
| cold-1000x | canvas2d | 5 | 8547 | 229 | 8170 | 8833 | canvas2d | no-webgl2 | 719 | 2592 |
| zoom-200x | canvas2d | 5 | 134 | 4 | 131 | 142 | canvas2d | no-webgl2 |  |  |

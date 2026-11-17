# Hardware panel: laptop-uhd630

builds/release-5.0.0-beta.21, Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz (16 logical CPUs, 30.6 GB), GPU null, Chrome/148.0.7778.97, linux 7.0.0-43-generic. 1 warm-up and 5 runs per cell, backends interleaved within each run. Cold load is paintprofile.ts to the last changed frame; zoom is panprofile.ts INSTRUMENT=frames, the median of its steps per run. A run counts only if the page reached the pinned rung and, for webgpu and webgl, a hardware adapter. Memory is the median over counted cold-load runs: JS heap over page and workers; PSS summed over the Chrome processes (/proc).

| cell | backend | n | median ms | sd | min | max | rung | adapter | JS heap MB | Chrome MB |
|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|
| cold-20x | webgl | 5 | 1196 | 2752 | 1051 | 8021 | webgl2 | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) | 43 | 618 |
| cold-20x | canvas2d | 5 | 1305 | 1043 | 1153 | 3531 | canvas2d | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) | 43 | 616 |
| cold-1000x | webgl | 5 | 10814 | 1140 | 10739 | 13680 | webgl2 | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) | 715 | 2815 |
| cold-1000x | canvas2d | 5 | 10448 | 1384 | 9911 | 13675 | canvas2d | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) | 714 | 2546 |
| zoom-200x | webgl | 5 | 33 | 3 | 30 | 37 | webgl2 | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) |  |  |
| zoom-200x | canvas2d | 5 | 116 | 8 | 100 | 123 | canvas2d | ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6) |  |  |

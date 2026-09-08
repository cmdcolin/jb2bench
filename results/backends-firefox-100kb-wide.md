# Backend comparison (firefox)

Build `current`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), firefox, measured 2026-09-08. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 1.7; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/backends-firefox-100kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 1351 ± 30 (WebGPU) | 1358 ± 17 (WebGL2) | 1386 ± 45 (Canvas2D) | 1.03x |
| 100x-shortread | 1775 ± 38 (WebGPU) | 1819 ± 24 (WebGL2) | 1855 ± 28 (Canvas2D) | 1.05x |
| 20x-longread | 1448 ± 12 (WebGPU) | 1419 ± 50 (WebGL2) | 1636 ± 36 (Canvas2D) | 1.13x |
| 100x-longread | 2382 ± 76 (WebGPU) | 2386 ± 29 (WebGL2) | 2699 ± 27 (Canvas2D) | 1.13x |

Screenshots of every cell's warmup render are in `screenshots/backends/`.

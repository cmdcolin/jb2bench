# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 5.2; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite/colins-MacBook-Pro/backends-firefox-100kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 862 ± 20 (WebGPU) | 1202 ± 14 (WebGL2) | 886 ± 5 (Canvas2D) | 1.03x |
| 100x-shortread | 1456 ± 9 (WebGPU) | 1781 ± 6 (WebGL2) | 1615 ± 11 (Canvas2D) | 1.11x |
| 20x-longread | 1056 ± 30 (WebGPU) | 1391 ± 15 (WebGL2) | 1339 ± 25 (Canvas2D) | 1.27x |
| 100x-longread | 2451 ± 38 (WebGPU) | 2824 ± 53 (WebGL2) | 2912 ± 23 (Canvas2D) | 1.19x |

Screenshots of every cell's warmup render are in `results/webgpu-lite/colins-MacBook-Pro/screenshots/`.

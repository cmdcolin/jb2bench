# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.6; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite/colin-940Z5L/backends-firefox-100kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 1465 ± 48 (WebGPU) | 1489 ± 33 (WebGL2) | 1421 ± 26 (Canvas2D) | 0.97x |
| 100x-shortread | 2273 ± 31 (WebGPU) | 2246 ± 42 (WebGL2) | 2246 ± 17 (Canvas2D) | 0.99x |
| 20x-longread | 1755 ± 31 (WebGPU) | 1763 ± 20 (WebGL2) | 1985 ± 3529 (Canvas2D) | 1.13x |
| 100x-longread | 3380 ± 50 (WebGPU) | 3368 ± 23 (WebGL2) | 3727 ± 17 (Canvas2D) | 1.10x |

Screenshots of every cell's warmup render are in `results/webgpu-lite/colin-940Z5L/screenshots/`.

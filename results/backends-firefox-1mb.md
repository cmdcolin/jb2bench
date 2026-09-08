# Backend comparison (firefox)

Build `current`, region `chr22_2mb:500001-1500000` (1 Mb), firefox, measured 2026-09-08. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 2.0; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/backends-firefox-1mb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 2467 ± 51 (WebGPU) | 2459 ± 47 (WebGL2) | 2881 ± 56 (Canvas2D) | 1.17x |
| 100x-shortread | 8087 ± 316 (WebGPU) | 8368 ± 306 (WebGL2) | 9043 ± 142 (Canvas2D) | 1.12x |
| 20x-longread | 3766 ± 79 (WebGPU) | 3797 ± 76 (WebGL2) | 4565 ± 37 (Canvas2D) | 1.21x |
| 100x-longread | 14974 ± 188 (WebGPU) | 15270 ± 175 (WebGL2) | 16567 ± 158 (Canvas2D) | 1.11x |

Screenshots of every cell's warmup render are in `screenshots/backends/`.

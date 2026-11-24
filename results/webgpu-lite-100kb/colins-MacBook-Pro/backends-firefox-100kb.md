# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.8; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite-100kb/colins-MacBook-Pro/backends-firefox-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 845 ± 43 (WebGPU) | 1199 ± 5 (WebGL2) | 921 ± 6 (Canvas2D) | 1.09x |
| 200x-shortread | 2406 ± 6 (WebGPU) | 2754 ± 28 (WebGL2) | 2594 ± 28 (Canvas2D) | 1.08x |
| 1000x-shortread | 9632 ± 107 (WebGPU) | 9964 ± 183 (WebGL2) | 9844 ± 193 (Canvas2D) | 1.02x |
| 20x-longread | 1061 ± 7 (WebGPU) | 1416 ± 27 (WebGL2) | 1386 ± 12 (Canvas2D) | 1.31x |
| 200x-longread | 4051 ± 29 (WebGPU) | 4303 ± 25 (WebGL2) | 4469 ± 25 (Canvas2D) | 1.10x |
| 1000x-longread | 16202 ± 181 (WebGPU) | 16987 ± 643 (WebGL2) | 16257 ± 802 (Canvas2D) | 1.00x |

Screenshots of every cell's warmup render are in `results/webgpu-lite-100kb/colins-MacBook-Pro/screenshots/`.

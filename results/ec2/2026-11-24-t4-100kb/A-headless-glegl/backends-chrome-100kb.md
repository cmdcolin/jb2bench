# Backend comparison (chrome)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), chrome, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 4.0; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/t4-headed-100kb/A-headless-glegl/backends-chrome-100kb.json`.

| case | webgl | canvas2d | canvas2d ÷ webgl |
|---|---:|---:|---:|
| 20x-shortread | 1036 ± 47 (WebGL2) | 963 ± 6 (Canvas2D) | 0.93x |
| 200x-shortread | 2568 ± 15 (WebGL2) | 2534 ± 45 (Canvas2D) | 0.99x |
| 1000x-shortread | 8252 ± 69 (WebGL2) | 7928 ± 140 (Canvas2D) | 0.96x |
| 20x-longread | 1309 ± 32 (WebGL2) | 1559 ± 53 (Canvas2D) | 1.19x |
| 200x-longread | 4465 ± 58 (WebGL2) | 4826 ± 69 (Canvas2D) | 1.08x |
| 1000x-longread | 16405 ± 367 (WebGL2) | 16417 ± 397 (Canvas2D) | 1.00x |

Screenshots of every cell's warmup render are in `results/t4-headed-100kb/A-headless-glegl/screenshots/`.

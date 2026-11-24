# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 2.1; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite-100kb/cdiesh-Precision-7540/backends-firefox-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 745 ± 25 (WebGPU) | 737 ± 13 (WebGL2) | 726 ± 23 (Canvas2D) | 0.97x |
| 200x-shortread | 1980 ± 36 (WebGPU) | 1987 ± 43 (WebGL2) | 2036 ± 60 (Canvas2D) | 1.03x |
| 1000x-shortread | 7830 ± 191 (WebGPU) | 9715 ± 279 (WebGL2) | 9565 ± 193 (Canvas2D) | 1.22x |
| 20x-longread | 841 ± 34 (WebGPU) | 916 ± 18 (WebGL2) | 1183 ± 19 (Canvas2D) | 1.41x |
| 200x-longread | 3138 ± 71 (WebGPU) | 3920 ± 816 (WebGL2) | 4941 ± 762 (Canvas2D) | 1.57x |
| 1000x-longread | 14695 ± 339 (WebGPU) | 14697 ± 90 (WebGL2) | 14676 ± 275 (Canvas2D) | 1.00x |

Screenshots of every cell's warmup render are in `results/webgpu-lite-100kb/cdiesh-Precision-7540/screenshots/`.

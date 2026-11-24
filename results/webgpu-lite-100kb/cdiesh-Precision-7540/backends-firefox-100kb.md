# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 2.3; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite-100kb/cdiesh-Precision-7540/backends-firefox-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 715 ± 31 (WebGPU) | 753 ± 23 (WebGL2) | 767 ± 20 (Canvas2D) | 1.07x |
| 200x-shortread | 1964 ± 23 (WebGPU) | 2065 ± 655 (WebGL2) | 2048 ± 36 (Canvas2D) | 1.04x |
| 1000x-shortread | 7900 ± 295 (WebGPU) | 9606 ± 228 (WebGL2) | 9412 ± 207 (Canvas2D) | 1.19x |
| 20x-longread | 879 ± 47 (WebGPU) | 882 ± 22 (WebGL2) | 1128 ± 15 (Canvas2D) | 1.28x |
| 200x-longread | 3093 ± 72 (WebGPU) | 3129 ± 799 (WebGL2) | 5166 ± 157 (Canvas2D) | 1.67x |
| 1000x-longread | 14711 ± 469 (WebGPU) | 14657 ± 175 (WebGL2) | 14758 ± 200 (Canvas2D) | 1.00x |

Screenshots of every cell's warmup render are in `results/webgpu-lite-100kb/cdiesh-Precision-7540/screenshots/`.

# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.0; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite/cdiesh-Precision-7540/backends-firefox-100kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 730 ± 720 (WebGPU) | 722 ± 31 (WebGL2) | 687 ± 18 (Canvas2D) | 0.94x |
| 100x-shortread | 1179 ± 29 (WebGPU) | 1241 ± 32 (WebGL2) | 1243 ± 20 (Canvas2D) | 1.05x |
| 20x-longread | 843 ± 21 (WebGPU) | 883 ± 24 (WebGL2) | 1080 ± 638 (Canvas2D) | 1.28x |
| 100x-longread | 1976 ± 19 (WebGPU) | 2033 ± 42 (WebGL2) | 2306 ± 45 (Canvas2D) | 1.17x |

Screenshots of every cell's warmup render are in `results/webgpu-lite/cdiesh-Precision-7540/screenshots/`.

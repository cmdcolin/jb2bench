# Backend comparison (chrome)

Build `release-5.0.0-beta.21`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), chrome, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.9; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/t4-headed/B-headed-vulkan/backends-chrome-100kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 865 ± 32 (WebGPU) | 948 ± 48 (WebGL2) | 949 ± 31 (Canvas2D) | 1.10x |
| 100x-shortread | 1347 ± 10 (WebGPU) | 1454 ± 10 (WebGL2) | 1554 ± 7 (Canvas2D) | 1.15x |
| 20x-longread | 1067 ± 49 (WebGPU) | 1156 ± 6 (WebGL2) | 1457 ± 6 (Canvas2D) | 1.37x |
| 100x-longread | 2454 ± 32 (WebGPU) | 2439 ± 45 (WebGL2) | 2952 ± 9 (Canvas2D) | 1.20x |

Screenshots of every cell's warmup render are in `results/t4-headed/B-headed-vulkan/screenshots/`.

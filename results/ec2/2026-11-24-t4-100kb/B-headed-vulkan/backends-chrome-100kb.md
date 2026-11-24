# Backend comparison (chrome)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), chrome, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.8; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/t4-headed-100kb/B-headed-vulkan/backends-chrome-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 969 ± 21 (WebGPU) | 981 ± 13 (WebGL2) | 972 ± 9 (Canvas2D) | 1.00x |
| 200x-shortread | 2353 ± 34 (WebGPU) | 2454 ± 10 (WebGL2) | 2551 ± 50 (Canvas2D) | 1.08x |
| 1000x-shortread | 8071 ± 189 (WebGPU) | 8266 ± 138 (WebGL2) | 8069 ± 111 (Canvas2D) | 1.00x |
| 20x-longread | 1162 ± 13 (WebGPU) | 1266 ± 30 (WebGL2) | 1575 ± 15 (Canvas2D) | 1.36x |
| 200x-longread | 4284 ± 55 (WebGPU) | 4467 ± 9 (WebGL2) | 4989 ± 81 (Canvas2D) | 1.16x |
| 1000x-longread | 16374 ± 116 (WebGPU) | 16854 ± 248 (WebGL2) | 16492 ± 323 (Canvas2D) | 1.01x |

Screenshots of every cell's warmup render are in `results/t4-headed-100kb/B-headed-vulkan/screenshots/`.

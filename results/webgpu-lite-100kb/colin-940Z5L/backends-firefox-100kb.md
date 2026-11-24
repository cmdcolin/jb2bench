# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 3.0; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite-100kb/colin-940Z5L/backends-firefox-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 1449 ± 6 (WebGPU) | 1485 ± 15 (WebGL2) | 1484 ± 20 (Canvas2D) | 1.02x |
| 200x-shortread | 3411 ± 14 (WebGPU) | 3459 ± 12 (WebGL2) | 3456 ± 19 (Canvas2D) | 1.01x |
| 1000x-shortread | 12505 ± 116 (WebGPU) | 12827 ± 69 (WebGL2) | 12512 ± 156 (Canvas2D) | 1.00x |
| 20x-longread | 1748 ± 16 (WebGPU) | 1785 ± 6 (WebGL2) | 1988 ± 12 (Canvas2D) | 1.14x |
| 200x-longread | 5156 ± 24 (WebGPU) | 5194 ± 31 (WebGL2) | 5583 ± 42 (Canvas2D) | 1.08x |
| 1000x-longread | 22720 ± 1981 (WebGPU) | 22404 ± 454 (WebGL2) | 21332 ± 151 (Canvas2D) | 0.94x |

Screenshots of every cell's warmup render are in `results/webgpu-lite-100kb/colin-940Z5L/screenshots/`.

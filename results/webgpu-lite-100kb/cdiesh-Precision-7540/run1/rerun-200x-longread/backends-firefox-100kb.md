# Backend comparison (firefox)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), firefox, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 2.1; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/webgpu-lite-100kb/cdiesh-Precision-7540/rerun-200x-longread/backends-firefox-100kb.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 200x-longread | 3099 ± 746 (WebGPU) | 3075 ± 792 (WebGL2) | 5010 ± 803 (Canvas2D) | 1.62x |

Screenshots of every cell's warmup render are in `results/webgpu-lite-100kb/cdiesh-Precision-7540/rerun-200x-longread/screenshots/`.

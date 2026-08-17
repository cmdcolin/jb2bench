# Backend comparison (firefox)

Build `current`, region `chr22_mask:124000-143000` (19kb), firefox, measured 2026-08-06. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 1 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 26.0; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/backends-firefox.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | FAIL | 2704 ± 0 (WebGL2) | 14478 ± 0 (Canvas2D) | — |

Screenshots of every cell's warmup render are in `screenshots/backends/`.

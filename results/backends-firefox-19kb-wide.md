# Backend comparison (firefox)

Build `current`, region `chr22_2mb:990501-1009500` (19 kb (2 Mb contig)), firefox, measured 2026-09-08. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 1.5; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/backends-firefox-19kb-wide.json`.

| case | default | webgl | canvas2d | canvas2d ÷ default |
|---|---:|---:|---:|---:|
| 20x-shortread | 1169 ± 43 (WebGPU) | 1231 ± 25 (WebGL2) | 1167 ± 39 (Canvas2D) | 1.00x |
| 100x-shortread | 1286 ± 23 (WebGPU) | 1324 ± 32 (WebGL2) | 1335 ± 50 (Canvas2D) | 1.04x |
| 20x-longread | 1271 ± 15 (WebGPU) | 1249 ± 687 (WebGL2) | 1257 ± 26 (Canvas2D) | 0.99x |
| 100x-longread | 1435 ± 27 (WebGPU) | 1487 ± 14 (WebGL2) | 1473 ± 54 (Canvas2D) | 1.03x |

Screenshots of every cell's warmup render are in `screenshots/backends/`.

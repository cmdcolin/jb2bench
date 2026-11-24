# Backend comparison (chrome)

Build `release-5.0.0-beta.21`, region `chr22_2mb:950001-1050000` (100 kb (2 Mb contig)), chrome, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 5 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 2.9; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `results/t4-headed/A-headless-glegl/backends-chrome-100kb-wide.json`.

| case | webgl | canvas2d | canvas2d ÷ webgl |
|---|---:|---:|---:|
| 20x-shortread | 955 ± 28 (WebGL2) | 847 ± 16 (Canvas2D) | 0.89x |
| 100x-shortread | 1538 ± 12 (WebGL2) | 1546 ± 33 (Canvas2D) | 1.01x |
| 20x-longread | 1241 ± 9 (WebGL2) | 1349 ± 58 (Canvas2D) | 1.09x |
| 100x-longread | 2525 ± 63 (WebGL2) | 2845 ± 14 (Canvas2D) | 1.13x |

Screenshots of every cell's warmup render are in `results/t4-headed/A-headless-glegl/screenshots/`.

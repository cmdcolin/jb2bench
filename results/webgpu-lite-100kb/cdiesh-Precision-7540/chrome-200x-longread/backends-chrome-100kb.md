# Backend comparison (chrome)

Build `release-5.0.0-beta.21`, region `chr22_mask:75000-175000` (100 kb), chrome, measured 2026-11-24. One build, one machine, one instrument — only the `?renderer=` rung changes. In-page navigation→render-complete, median of 8 runs (ms) ± the standard deviation of those runs.

`rung` is the backend each column actually reached, probed per cell rather than assumed. `ink` is the share of the largest canvas that is not background: a cell near zero drew nothing, and its timing is not a render cost. Chrome's WebGPU is exactly that case on this box (blank canvas, Dawn texture-allocation validation error), which is why WebGPU is measured through Firefox Nightly — see the header comment and jbrowse-components ADR-024.

Highest 1-minute load average across all cells: 1.6; above 4.0 a cell is not comparable to one measured idle. Per-cell load is in `/tmp/claude-1001/-home-cdiesh-paper/8768347c-194c-4041-a48b-c99604263446/scratchpad/dell-chrome-200xlong/backends-chrome-100kb.json`.

| case | webgl | canvas2d | canvas2d ÷ webgl |
|---|---:|---:|---:|
| 200x-longread | 2722 ± 55 (WebGL2) | 3087 ± 67 (Canvas2D) | 1.13x |

Screenshots of every cell's warmup render are in `/tmp/claude-1001/-home-cdiesh-paper/8768347c-194c-4041-a48b-c99604263446/scratchpad/dell-chrome-200xlong/screenshots/`.

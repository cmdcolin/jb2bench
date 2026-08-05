# Alignments render benchmark

Region `chr22_mask:124000-143000` (19kb). In-page navigation→render-complete time, median of 6 runs (ms). Speedup = release-4.3.0 median ÷ webgl-poc median.

| case | webgl-poc | release-4.3.0 | release-4.1.15 | speedup vs release-4.3.0 |
|---|---:|---:|---:|---:|
| 20x-shortread | 1882 ±49 | 2382 ±80 | 2379 ±36 | 1.27× |
| 200x-shortread | 2486 ±69 | 2777 ±33 | 2781 ±69 | 1.12× |
| 1000x-shortread | 7137 ±75 | 4581 ±69 | 4732 ±52 | 0.64× |
| 20x-longread | 1983 ±36 | 2580 ±3 | 2582 ±79 | 1.30× |
| 200x-longread | 3834 ±72 | 5885 ±68 | 5984 ±126 | 1.54× |
| 1000x-longread | 11733 ±108 | 17277 ±1490 | 21682 ±262 | 1.47× |

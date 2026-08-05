# Cross-tool render benchmark: JBrowse vs igv.js

JBrowse `builds/current` (WebGL2) against igv.js 3.8.5, same BAM files, same window `chr22_mask:124000-143000`, same instrument.

The instrument is `scripts/crosstool/paintprofile.ts`: navigation to the last frame in which the pixels change, polled by screenshot. It belongs to neither tool — igv.js hides its spinner when features finish *loading*, before it draws them, so its own loading state would credit it with a render it has not done. Cost: the paint instrument reads a few hundred ms higher than the testid instrument used elsewhere in this repo, because it also waits out the settling of everything else on the page. That bias applies to both columns.

`igv.js` is measured three ways, two of them controls rather than workload knobs:

- **Downsampling.** igv draws at most `samplingDepth` reads per 100 bp window (default 500, hard maximum 10000) and JBrowse draws every read. On this corpus the deepest 100 bp window holds roughly 700 short reads, so the default clips a little and the maximum clips nothing — if the default and `no downsampling` columns agree, downsampling is not what the comparison is measuring.
- **Track height.** The harness gives igv a 600 px track; igv's own default for a BAM track is 300, and JBrowse's pileup canvas at this viewport is about 210. igv draws packed rows until it runs out of canvas while JBrowse draws every read it holds and lets the rasterizer clip, so a taller igv track is more igv work and no more JBrowse work. The last two columns are that control, run as its own interleaved pair so it does not disturb the headline ratio.

Median of 3 runs after 1 warmup, tools interleaved within each round. `load` is the highest 1-minute load average across the row's cells; this box is shared, and a row above 4.0 is not comparable to one measured idle. A blank cell was not measured in the run that produced its row.

| case | JBrowse (current) | igv.js 3.8.5 | igv.js 3.8.5, no downsampling | igv.js 3.8.5, 300 px track | igv.js 3.8.5, 600 px track (control arm) | igv default ÷ JBrowse | measured | load |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 20x-shortread | 2419 ±69 | 1837 ±200 | 1974 ±196 |  |  | 0.76× | 2026-08-05 | 30.5 |
| 200x-shortread | 2475 ±52 | 7162 ±160 | 7255 ±536 | 14928 ±6790 | 12344 ±4393 | 2.89× | 2026-08-05 | 40.0 |
| 1000x-shortread | 5944 ±1256 | 51789 ±12126 | 56722 ±1432 | 39804 ±5160 | 38089 ±2482 | 8.71× | 2026-08-05 | 42.8 |
| 20x-longread | 2755 ±168 | 5456 ±1072 | 6062 ±1270 |  |  | 1.98× | 2026-08-05 | 31.4 |
| 200x-longread | 3623 ±430 | 27735 ±2493 | 31133 ±4311 |  |  | 7.66× | 2026-08-05 | 20.7 |
| 1000x-longread | 8273 ±2447 | 91447 ±0 | 118024 ±0 |  |  | 11.05× | 2026-08-05 | 35.8 |

Median cell load across the matrix: 31.45. No cell stands out from the run.

A ratio above 1 means igv.js took longer. Read the ratios, not the absolutes: both columns of a row are measured within seconds of each other, so a ratio survives load the absolutes do not.

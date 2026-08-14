# Multi-track interaction cost (pan)

Region `chr22_mask:124000-143000`, 240 rAF-paced frames x 2 passes per row, viewport 1280x900. The gesture stays inside already-loaded data, so no row refetches: this is re-render cost, not network. `over budget` is the share of frames whose gap exceeded 20 ms.

Frames are **unpaced** (`--disable-gpu-vsync --disable-frame-rate-limit`), so a gap below 16.7 ms is real and the light rows are not floored.

Two builds, **interleaved within each pass** so both arms see the same machine.

| tracks open | multibam-base | multibam | speedup | over budget multibam-base → multibam | load |
|---|---:|---:|---:|---:|---:|
| 4 | 12.6 ms | 4.9 ms | 2.57× | 5% → 2% | 16.4 |
| 6 | 15.7 ms | 4.9 ms | 3.20× | 22% → 1% | 14.8 |

Per-pass frame medians, so one contended pass is visible rather than pooled away:

| build | tracks open | pass 1 | pass 2 |
|---|---|---:|---:|
| multibam-base | 4 | 13.3 | 10.6 |
| multibam-base | 6 | 16.3 | 15.3 |
| multibam | 4 | 4.7 | 5.4 |
| multibam | 6 | 5.1 | 4.6 |

Tracks, in the order they are added: `20x.shortread.bam`, `200x.shortread.bam`, `20x.longread.bam`, `200x.longread.bam`, `20x.longread.mod.bam`, `200x.longread.mod.bam`

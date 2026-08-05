# Zoom interaction benchmark

Region `chr22_mask:124000-143000`, zoom IN by 2x (subset of already-loaded reads). **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median of 5 zooms. redraw = longest frame (ms) of the GPU redraw.

| case | webgl-poc time-to-content | release-4.3.0 time-to-content | webgl-poc redraw frame |
|---|---:|---:|---:|
| 20x-shortread | 0ms | 1074ms | 17ms |
| 200x-shortread | 0ms | 1106ms | 17ms |
| 1000x-shortread | 0ms | 1760ms | 17ms |
| 20x-longread | 0ms | 1150ms | 17ms |
| 200x-longread | 0ms | 2786ms | 17ms |
| 1000x-longread | 0ms | 15008ms | 117ms |

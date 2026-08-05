# Zoom interaction benchmark

Region `chr22_mask:124000-143000`. **time-to-content** = ms a loading indicator ("Downloading alignments...") is shown after a zoom before correct content returns; median over the measured steps. redraw = longest frame (ms) of the GPU redraw. A `≥` prefix marks a censored value: the step was still loading at MAX_WAIT (120000 ms), so the true figure is larger.

## Zoom IN — only the old renderer refetches

The new view is a strict subset of already-loaded reads, so the GPU branch re-projects without going to the network. This is its best case.

| case | webgl-poc | release-4.3.0 | webgl-poc redraw frame |
|---|---:|---:|---:|
| 20x-shortread | 0ms | 1064ms | 17ms |
| 200x-shortread | 0ms | 1142ms | 17ms |
| 1000x-shortread | 0ms | 1676ms | 17ms |
| 20x-longread | 0ms | 1171ms | 17ms |
| 200x-longread | 0ms | 3024ms | 17ms |
| 1000x-longread | 0ms | 13913ms | 50ms |

## Zoom OUT — mostly refused, not measured

Zooming out was meant to be the case where BOTH builds refetch, isolating render cost from avoided fetching. It largely does not work: past a byte threshold JBrowse declines the fetch and renders "Requested too much data (N Mb). Zoom in to see features or force load" instead of reads.

That path is fast and paints nothing, so it previously scored as a ~90ms success — the best-looking number in the table was a refusal to draw. `_bail_` marks a cell where no step drew anything; `(n bail)` marks partial refusal, with the median taken only over steps that did draw.

The honest reading: for anything heavier than 20x shortread, this comparison has no render timing in it. Panning at constant zoom is the way to test refetch against refetch without crossing the cap.

| case | webgl-poc | release-4.3.0 | webgl-poc redraw frame | drew/attempted |
|---|---:|---:|---:|---:|
| 20x-shortread | 0ms (1 bail) | 1968ms | 17ms | 3/4 |
| 200x-shortread | 0ms (3 bail) | _bail_ | 17ms | 1/4 |
| 1000x-shortread | 0ms (3 bail) | _bail_ | 17ms | 1/4 |
| 20x-longread | 0ms (3 bail) | _bail_ | 17ms | 1/4 |
| 200x-longread | 0ms (3 bail) | _bail_ | 17ms | 1/4 |
| 1000x-longread | 0ms (3 bail) | _bail_ | 50ms | 1/4 |

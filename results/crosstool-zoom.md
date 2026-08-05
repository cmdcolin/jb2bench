# Cross-tool zoom benchmark: JBrowse vs igv.js

2x zoom-in, 5 successive steps, median per cell. The instrument is
`scripts/crosstool/zoomprofile.ts`: time from the zoom call until the pixels
stop changing, polled every 100 ms. **100 ms is the floor** — a redraw
that finishes inside one poll reports as one poll, so small values mean "at
most one poll" and not a measured duration.

Both tools hold the surrounding window client-side, so neither should refetch
here; what differs is what each has to do to redraw. Read this against
`results/interaction.md`, which measures the same interaction against
JBrowse's own predecessor, where the old renderer does refetch.

| case | JBrowse | igv.js | ratio | JBrowse steps | igv.js steps |
|---|---:|---:|---:|---|---|
| 200x-shortread | 802 ms | 340 ms | 0.42× | [716,834,802,863,755] | [801,496,340,284,251] |
| 1000x-shortread | 788 ms | 363 ms | 0.46× | [731,788,811,700,896] | [709,481,363,213,200] |

Load while measuring: 200x-shortread 6.8, 1000x-shortread 5.3. This box is shared; the two tools in a row are measured minutes apart, so read the ratio.

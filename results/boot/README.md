# Cold-load phases: where a first visit spends its time

`scripts/boot/boottrace.ts`, 2026-11-05, on ada: `release-5.0.0-beta.20`, Chrome 156
headless, WebGL2 on the A6000 (`CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle'`),
`chr22_mask:75000-175000`, `20x.shortread.bam`. Fresh profile per run, so a
first visit. Median of 5.

Served by `scripts/boot/h2serve.mjs` (HTTP/2, precompressed gzip, max-age 3600,
byte ranges), with the cert trusted through `--ignore-certificate-errors-spki-list`.
Three serving choices each faked a result before they were fixed, and every one
of them inflates JBrowse alone:

- **HTTP cache off, or `no-store`.** The worker's chunk loader
  (`parallelChunkLoading.ts`) fetches each chunk and then `importScripts` it as a
  cache read, so without a cache every worker chunk is fetched twice in series.
- **`--ignore-certificate-errors`.** Chrome skips the HTTP cache for an origin
  with a cert error, which is the same failure by another route (1.81 s against
  1.19 s at the network row below).
- **HTTP/1.1 (`http-server`).** Six connections per host, so the 45-chunk
  session wave queues. Kept as its own row because self-hosted Apache often is
  HTTP/1.1.

| serving | first read drawn |
| --- | ---: |
| h2, localhost | 672 ms |
| h2, 40 ms RTT, 50 Mbps | 1194 ms |
| HTTP/1.1 + gzip, 40 ms RTT, 50 Mbps | 1479 ms |

## The h2 network row, by phase

| phase | wall ms | bound by |
| --- | ---: | --- |
| HTML | 60 | network |
| eager JS lands | → 252 | network, ~460 KB gz |
| eval, session wave, `.fai` requested | → 388 | main-thread JS, 179 ms busy |
| `.fai` → BAM index requested | 114 | main thread, 120 ms busy |
| index → reads requested | 119 | main thread, 104 ms busy: track and display models |
| reads transfer, 2.15 MB | 404 | bandwidth |
| decode, upload, first draw | 169 | worker decode ~130 ms |

The reads are requested by `RenderAlignmentData` as soon as the display model
exists (RPC log: `CoreLoadTrackCode` and `CoreGetRefNames` go out at ~356 ms,
then nothing is in flight until `CoreGetContigs` and `RenderAlignmentData`).
They wait on main-thread construction, not on the shader chunks or the lazy
tooltip, which both land after the request.

Main-thread samples before the reads request (`scripts/boot/stacks.mjs`):
react-dom is the largest bucket (~100 ms), then Emotion/stylis (~25 ms), GC,
MST, mobx-react, and the alignments display model's own construction
(`slangPass`, `pileupShape`). WebGL compile and link: 118 calls, 95–240 ms,
mostly overlapping the reads transfer.

The cross-tool cold-load table's ~1.7 s floor at 20x is the laptop and the paint
instrument's polling, not boot: the same cell draws at 0.67 s here.

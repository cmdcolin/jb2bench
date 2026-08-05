# Parser libraries: 2023 release vs current

Same corpus and same window as the render benchmarks: simulated alignments over
a 250 kb slice of hg19 chr22, window `chr22_mask:124000-143000` (19 kb).

Both sides are built from source from a pinned GitHub tag with the same
toolchain, so the difference is library code rather than a change of transpiler
target or module format. `old` is the version JBrowse 2 depended on at the 2023
paper; `new` is the current release.

| case | 2023 | current | speedup | time cut |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 30.8 ms ±7.3% | 5.63 ms ±4.2% | 5.46x | 82% |
| bam 20x longread | 191 ms ±6.6% | 71.1 ms ±8.4% | 2.69x | 63% |
| bam 200x shortread | 243 ms ±8.2% | 63.8 ms ±15.6% | 3.80x | 74% |
| bam 200x longread | 2713 ms ±11.0% | 503 ms ±7.4% | 5.40x | 81% |
| bam 1000x shortread | 1305 ms ±9.1% | 246 ms ±11.3% | 5.30x | 81% |
| bam 1000x longread | 20442 ms ±20.0% | 2807 ms ±14.6% | 7.28x | 86% |
| bigwig 20x shortread | 1.52 ms ±6.2% | 1.15 ms ±4.2% | 1.32x | 24% |
| bigwig 20x longread | 1.88 ms ±6.1% | 1.75 ms ±4.2% | 1.07x | 7% |
| bigwig 200x shortread | 1.90 ms ±5.9% | 2.07 ms ±5.4% | 0.92x | -9% |
| bigwig 200x longread | 2.06 ms ±3.5% | 2.19 ms ±4.9% | 0.94x | -6% |
| bigwig 1000x shortread | 2.26 ms ±4.1% | 2.62 ms ±5.5% | 0.86x | -16% |
| bigwig 1000x longread | 2.15 ms ±3.6% | 2.63 ms ±4.6% | 0.82x | -22% |
| bgzf browser path 20x shortread | 104 ms ±3.0% | 18.4 ms ±6.6% | 5.63x | 82% |
| bgzf node path 20x shortread | 44.0 ms ±7.7% | 17.8 ms ±4.3% | 2.47x | 59% |
| bgzf browser path 20x longread | 121 ms ±3.5% | 38.5 ms ±7.7% | 3.13x | 68% |
| bgzf node path 20x longread | 54.6 ms ±5.4% | 41.0 ms ±8.1% | 1.33x | 25% |
| bgzf browser path 200x shortread | 1308 ms ±15.5% | 202 ms ±5.2% | 6.47x | 85% |
| bgzf node path 200x shortread | 630 ms ±19.1% | 198 ms ±4.9% | 3.19x | 69% |
| bgzf browser path 200x longread | 1567 ms ±12.2% | 368 ms ±1.4% | 4.26x | 77% |
| bgzf node path 200x longread | 514 ms ±6.0% | 361 ms ±2.0% | 1.42x | 30% |
| cram 20x shortread | 680 ms ±20.6% | 64.7 ms ±1.8% | 10.52x | 90% |
| cram 20x longread | 538 ms ±2.6% | 44.1 ms ±3.3% | 12.21x | 92% |
| cram 200x shortread | 863 ms ±4.5% | 208 ms ±11.8% | 4.15x | 76% |
| cram 200x longread | 3311 ms ±7.1% | 307 ms ±19.2% | 10.80x | 91% |
| cram 1000x shortread | 3419 ms ±6.5% | 606 ms ±15.9% | 5.64x | 82% |
| cram 1000x longread | 15907 ms ±21.0% | 1280 ms ±8.5% | 12.43x | 92% |

## Do both sides return the same thing?

Checked by `equivalence.test.ts`, which runs before these timings and fails if
the current release drops any record that lies inside the window.

| case | 2023 | current | the 2023 release missed | omitted at the window edge |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 3079 | 3081 | 2 | 0 |
| bam 200x shortread | 31126 | 31134 | 8 | 0 |
| bam 1000x shortread | 153652 | 153686 | 34 | 0 |
| cram 20x shortread | 3079 | 3081 | 2 | 0 |
| cram 200x shortread | 31126 | 31131 | 8 | 3 |
| cram 200x longread | 331 | 335 | 4 | 0 |
| cram 1000x shortread | 153652 | 153669 | 34 | 17 |
| cram 1000x longread | 1667 | 1683 | 16 | 0 |
| bigwig 20x longread | 13168 | 13167 | 0 | 1 |
| bigwig 200x longread | 17676 | 17675 | 0 | 1 |
| bigwig 1000x shortread | 17047 | 17046 | 0 | 1 |
| bigwig 1000x longread | 18495 | 18494 | 0 | 1 |

### CRAM reference spans, against the BAM holding the same alignments

| case | v1.7.1 agrees | current agrees | of |
| --- | --- | --- | --- |
| 20x shortread | 3079 | 3079 | 3079 |
| 20x longread | 0 | 36 | 36 |
| 200x shortread | 31123 | 31123 | 31123 |
| 200x longread | 1 | 331 | 331 |
| 1000x shortread | 153635 | 153635 | 153635 |
| 1000x longread | 5 | 1667 | 1667 |

v1.7.1 derives a long read's reference span wrongly; the current
release reproduces the BAM exactly. Short reads were always correct in both.

## Versions measured

```
bam-js/old tag=v2.0.0 version=2.0.0 sha=20bae275727b1990b9951acbdb497d08c3c35d30
  deps={"@gmod/bgzf-filehandle":"^1.4.4","abortable-promise-cache":"^1.5.0","buffer-crc32":"^0.2.13","generic-filehandle":"^3.0.0","long":"^4.0.0","quick-lru":"^4.0.0"}
bam-js/new tag=v7.8.1 version=7.8.1 sha=9af0f987393f8c3ce792de6ea02e7edd8435bdd4
  deps={"@gmod/bgzf-filehandle":"^6.2.0","@jbrowse/quick-lru":"^7.3.5","crc":"^4.3.2","generic-filehandle2":"^2.2.0"}
cram-js/old tag=v1.7.1 version=1.7.1 sha=20c8c80011358b0255a241b38c25f53c1ea9f98e
  deps={"@gmod/binary-parser":"^1.3.5","@jkbonfield/htscodecs":"^0.5.1","abortable-promise-cache":"^1.2.0","buffer-crc32":"^0.2.13","bzip2":"^0.1.1","cross-fetch":"^3.0.0","generic-filehandle":"^3.4.0","long":"^4.0.0","md5":"^2.2.1","pako":"^1.0.4","quick-lru":"^4.0.1"}
cram-js/new tag=v10.4.0 version=10.4.0 sha=3c3435c588dcb50be83373d78203ff3966f98be0
  deps={"@jbrowse/quick-lru":"^7.3.5","crc":"^4.3.2","generic-filehandle2":"^2.2.0","md5":"^2.3.0"}
bgzf-filehandle/old tag=v1.4.3 version=1.4.3 sha=237f1fe1a4cfee7754dc4097cb1b5878eaafbdb4
  deps={"es6-promisify":"^7.0.0","generic-filehandle":"^2.2.1","long":"^5.1.0","pako":"^1.0.11"}
bgzf-filehandle/new tag=v6.3.2 version=6.3.2 sha=21a05fdb6475f590f1dd70d90f3d25fa215eed89
  deps={"generic-filehandle2":"^2.2.0","pako-esm2":"^2.0.2"}
bbi-js/old tag=v4.0.0 version=4.0.0 sha=d239d409d1d7b2e62710afccb8c70134eadef50b
  deps={"abortable-promise-cache":"^1.4.1","binary-parser":"^2.1.0","eslint-plugin-unicorn":"^46.0.0","generic-filehandle":"^3.0.0","pako":"^2.0.0","quick-lru":"^4.0.0","rxjs":"^7.8.0"}
bbi-js/new tag=v10.0.2 version=10.0.2 sha=e97360024aab6697cb8accdd5fa87c8f0942d6b1
  deps={"@gmod/abortable-promise-cache":"^3.0.4","@jbrowse/quick-lru":"^7.3.5","generic-filehandle2":"^2.2.0"}
```

Generated by `report.ts`; raw numbers in `results/bench.json`.

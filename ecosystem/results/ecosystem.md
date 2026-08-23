# Parser libraries: 2023 release vs current

Same corpus and same window as the render benchmarks: simulated alignments over
a 250 kb slice of hg19 chr22, window `chr22_mask:124000-143000` (19 kb).

Both sides are built from source from a pinned GitHub tag with the same
toolchain, so the difference is library code rather than a change of transpiler
target or module format. `old` is the version JBrowse 2 depended on at the 2023
paper; `new` is the current release.

| case | 2023 | current | speedup | time cut |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 32.8 ms ±7.0% | 8.44 ms ±9.5% | 3.89x | 74% |
| bam 20x longread | 207 ms ±3.3% | 55.1 ms ±4.7% | 3.75x | 73% |
| bam 200x shortread | 247 ms ±2.8% | 55.5 ms ±8.8% | 4.45x | 78% |
| bam 200x longread | 2292 ms ±5.5% | 515 ms ±5.6% | 4.46x | 78% |
| bam 1000x shortread | 1004 ms ±4.6% | 208 ms ±4.8% | 4.83x | 79% |
| bam 1000x longread | 12751 ms ±6.2% | 2195 ms ±1.0% | 5.81x | 83% |
| bigwig 20x shortread | 0.96 ms ±3.6% | 0.93 ms ±2.2% | 1.03x | 3% |
| bigwig 20x longread | 1.24 ms ±2.2% | 1.57 ms ±3.2% | 0.79x | -26% |
| bigwig 200x shortread | 1.41 ms ±1.3% | 1.71 ms ±2.0% | 0.82x | -21% |
| bigwig 200x longread | 1.56 ms ±1.9% | 1.86 ms ±2.9% | 0.84x | -19% |
| bigwig 1000x shortread | 1.63 ms ±2.2% | 1.77 ms ±3.3% | 0.92x | -8% |
| bigwig 1000x longread | 1.71 ms ±2.0% | 1.94 ms ±3.0% | 0.88x | -14% |
| bgzf browser path 20x shortread | 117 ms ±2.6% | 18.6 ms ±4.9% | 6.31x | 84% |
| bgzf node path 20x shortread | 36.4 ms ±3.5% | 19.0 ms ±4.6% | 1.92x | 48% |
| bgzf browser path 20x longread | 124 ms ±3.7% | 34.5 ms ±2.8% | 3.59x | 72% |
| bgzf node path 20x longread | 48.2 ms ±4.0% | 37.4 ms ±6.9% | 1.29x | 23% |
| bgzf browser path 200x shortread | 1032 ms ±0.2% | 187 ms ±0.5% | 5.52x | 82% |
| bgzf node path 200x shortread | 466 ms ±36.8% | 210 ms ±1.3% | 2.22x | 55% |
| bgzf browser path 200x longread | 1282 ms ±0.3% | 372 ms ±0.4% | 3.44x | 71% |
| bgzf node path 200x longread | 421 ms ±3.9% | 333 ms ±0.8% | 1.26x | 21% |
| cram 20x shortread | 898 ms ±2.7% | 91.7 ms ±5.8% | 9.79x | 90% |
| cram 20x longread | 1129 ms ±2.4% | 114 ms ±5.7% | 9.88x | 90% |
| cram 200x shortread | 1404 ms ±19.9% | 203 ms ±18.6% | 6.93x | 86% |
| cram 200x longread | 4924 ms ±13.1% | 623 ms ±9.7% | 7.90x | 87% |
| cram 1000x shortread | 9175 ms ±22.3% | 1079 ms ±10.2% | 8.50x | 88% |
| cram 1000x longread | 28173 ms ±27.8% | 2309 ms ±42.0% | 12.20x | 92% |
| vcf genotypes 100 samples gtonly | 23.3 ms ±5.9% | 5.13 ms ±5.3% | 4.54x | 78% |
| vcf SAMPLES 100 samples gtonly | 27.7 ms ±7.8% | 8.26 ms ±5.5% | 3.36x | 70% |
| vcf genotypes 1000 samples gtonly | 338 ms ±12.6% | 26.4 ms ±2.6% | 12.84x | 92% |
| vcf SAMPLES 1000 samples gtonly | 204 ms ±7.8% | 54.8 ms ±2.5% | 3.72x | 73% |
| vcf genotypes 3000 samples gtonly | 903 ms ±15.9% | 156 ms ±12.2% | 5.80x | 83% |
| vcf SAMPLES 3000 samples gtonly | 613 ms ±9.4% | 181 ms ±3.4% | 3.39x | 70% |
| vcf genotypes 100 samples wide | 95.1 ms ±6.9% | 5.57 ms ±5.3% | 17.07x | 94% |
| vcf SAMPLES 100 samples wide | 137 ms ±9.4% | 44.2 ms ±3.3% | 3.11x | 68% |
| vcf genotypes 1000 samples wide | 709 ms ±1.5% | 25.1 ms ±0.5% | 28.20x | 96% |
| vcf SAMPLES 1000 samples wide | 797 ms ±5.7% | 427 ms ±3.6% | 1.87x | 46% |
| vcf genotypes 3000 samples wide | 2827 ms ±7.9% | 113 ms ±4.6% | 24.97x | 96% |
| vcf SAMPLES 3000 samples wide | 2908 ms ±8.1% | 1367 ms ±3.4% | 2.13x | 53% |

## Do both sides return the same thing?

Checked by `equivalence.test.ts`, which runs before these timings and fails if
the current release drops any record that lies inside the window.

| case | 2023 | current | the 2023 release missed | omitted at the window edge |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 3079 | 3081 | 2 | 0 |
| bam 200x shortread | 31126 | 31133 | 8 | 1 |
| bam 1000x shortread | 153652 | 153677 | 34 | 9 |
| cram 20x shortread | 3079 | 3081 | 2 | 0 |
| cram 200x shortread | 31126 | 31133 | 8 | 1 |
| cram 200x longread | 331 | 335 | 4 | 0 |
| cram 1000x shortread | 153652 | 153677 | 34 | 9 |
| cram 1000x longread | 1667 | 1683 | 16 | 0 |
| bigwig 20x longread | 13168 | 13167 | 0 | 1 |
| bigwig 200x longread | 17676 | 17675 | 0 | 1 |
| bigwig 1000x shortread | 17047 | 17046 | 0 | 1 |
| bigwig 1000x longread | 18495 | 18494 | 0 | 1 |

### CRAM reference spans, against the BAM holding the same alignments

| case | v1.7.3 agrees | current agrees | of |
| --- | --- | --- | --- |
| 20x shortread | 3079 | 3079 | 3079 |
| 20x longread | 0 | 36 | 36 |
| 200x shortread | 31125 | 31125 | 31125 |
| 200x longread | 1 | 331 | 331 |
| 1000x shortread | 153643 | 153643 | 153643 |
| 1000x longread | 5 | 1667 | 1667 |

v1.7.3 derives a long read's reference span wrongly; the current
release reproduces the BAM exactly. Short reads were always correct in both.

## Versions measured

```
bam-js/old tag=v1.1.18 version=1.1.18 sha=bdab15139db56188a7ec46bc8e887f331196c232
  deps={"@gmod/bgzf-filehandle":"^1.4.4","abortable-promise-cache":"^1.5.0","buffer-crc32":"^0.2.13","cross-fetch":"^3.0.2","generic-filehandle":"^3.0.0","long":"^4.0.0","object.entries-ponyfill":"^1.0.1","quick-lru":"^2.0.0"}
bam-js/new tag=v8.11.0 version=8.11.0 sha=51de80027fa90c28e7b7ac504852c76c8ce4077c
  deps={"@gmod/bgzf-filehandle":"^6.6.0","@gmod/shared-read-cache":"^1.5.1","@jbrowse/quick-lru":"^7.3.5","crc":"^4.3.2","generic-filehandle2":"^2.2.1"}
cram-js/old tag=v1.7.3 version=1.7.3 sha=bfec2875b82ce240e3ad776e932fb496ed3064ec
  deps={"@gmod/binary-parser":"^1.3.5","@jkbonfield/htscodecs":"^0.5.1","abortable-promise-cache":"^1.2.0","buffer-crc32":"^0.2.13","bzip2":"^0.1.1","cross-fetch":"^3.0.0","generic-filehandle":"^3.4.0","long":"^4.0.0","md5":"^2.2.1","pako":"^1.0.4","quick-lru":"^4.0.1"}
cram-js/new tag=v13.4.1 version=13.4.1 sha=eb529bce1660bc1c05b99c181ebfdbded9ddab9c
  deps={"@gmod/shared-read-cache":"^1.5.1","crc":"^4.3.2","generic-filehandle2":"^2.2.1","md5":"^2.3.0"}
bgzf-filehandle/old tag=v1.4.5 version=1.4.5 sha=75fa7098907d1c2c19666af642f59b16bad1ae31
  deps={"es6-promisify":"^7.0.0","generic-filehandle":"^3.0.0","long":"^5.1.0","pako":"^1.0.11"}
bgzf-filehandle/new tag=v6.6.0 version=6.6.0 sha=43a6817688c50e518aeac0d7a24970fa61aeba8d
  deps={"generic-filehandle2":"^2.2.1","pako-esm2":"^2.0.2"}
bbi-js/old tag=v3.0.0 version=3.0.0 sha=8def16f471adabb44162bad881321ac7811678a9
  deps={"abortable-promise-cache":"^1.4.1","binary-parser":"^2.1.0","generic-filehandle":"^3.0.0","pako":"^2.0.0","quick-lru":"^4.0.0","rxjs":"^7.8.0"}
bbi-js/new tag=v11.2.2 version=11.2.2 sha=2e727665c6fbaf74dc6267de87a9c800e3d9fb4c
  deps={"@gmod/shared-read-cache":"^1.5.1","generic-filehandle2":"^2.2.1"}
vcf-js/old tag=v5.0.10 version=5.0.10 sha=8d5c9518cdc236004797ae2aa24d3ec36919448a
  deps={}
vcf-js/new tag=v7.2.0 version=7.2.0 sha=162d85e7812986758a4167f71d16762acd89f616
  deps={}
vcf-js-scan/old tag=v7.1.1 version=7.1.1 sha=19daaa0b181fe544d60e379ec7c9c8c5abaf01cf
  deps={}
vcf-js-scan/new tag=v7.2.0 version=7.2.0 sha=162d85e7812986758a4167f71d16762acd89f616
  deps={}
```

Generated by `report.ts`; raw numbers in `results/bench.json`.

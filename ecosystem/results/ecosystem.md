# Parser libraries: 2023 release vs current

Same corpus and same window as the render benchmarks: simulated alignments over
a 250 kb slice of hg19 chr22, window `chr22_mask:124000-143000` (19 kb).

Both sides are built from source from a pinned GitHub tag with the same
toolchain, so the difference is library code rather than a change of transpiler
target or module format. `old` is the version JBrowse 2 depended on at the 2023
paper; `new` is the current release.

| case | 2023 | current | speedup | time cut |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 22.0 ms ±4.0% | 5.23 ms ±5.7% | 4.21x | 76% |
| bam 20x longread | 146 ms ±1.5% | 38.3 ms ±2.3% | 3.81x | 74% |
| bam 200x shortread | 172 ms ±2.0% | 39.9 ms ±9.2% | 4.31x | 77% |
| bam 200x longread | 1692 ms ±1.6% | 351 ms ±0.7% | 4.82x | 79% |
| bam 1000x shortread | 866 ms ±0.5% | 182 ms ±4.2% | 4.76x | 79% |
| bam 1000x longread | 9748 ms ±8.2% | 1860 ms ±0.5% | 5.24x | 81% |
| bgzf browser path 20x shortread | 101 ms ±1.0% | 18.1 ms ±4.6% | 5.58x | 82% |
| bgzf node path 20x shortread | 75.9 ms ±49.1% | 18.1 ms ±4.7% | 4.20x | 76% |
| bgzf browser path 20x longread | 122 ms ±0.5% | 35.1 ms ±3.0% | 3.47x | 71% |
| bgzf node path 20x longread | 47.6 ms ±5.0% | 35.1 ms ±2.6% | 1.35x | 26% |
| bgzf browser path 200x shortread | 1044 ms ±0.2% | 190 ms ±0.4% | 5.50x | 82% |
| bgzf node path 200x shortread | 358 ms ±3.8% | 187 ms ±1.2% | 1.91x | 48% |
| bgzf browser path 200x longread | 1140 ms ±0.4% | 329 ms ±0.6% | 3.47x | 71% |
| bgzf node path 200x longread | 851 ms ±43.3% | 313 ms ±0.5% | 2.71x | 63% |
| cram 20x shortread | 385 ms ±1.0% | 39.0 ms ±5.7% | 9.86x | 90% |
| cram 20x longread | 412 ms ±1.3% | 42.2 ms ±2.7% | 9.77x | 90% |
| cram 200x shortread | 718 ms ±1.3% | 79.9 ms ±9.7% | 8.98x | 89% |
| cram 200x longread | 2732 ms ±0.8% | 263 ms ±0.3% | 10.38x | 90% |
| cram 1000x shortread | 3243 ms ±0.9% | 363 ms ±3.9% | 8.93x | 89% |
| cram 1000x longread | 11859 ms ±0.6% | 1079 ms ±1.2% | 10.99x | 91% |
| vcf genotypes 100 samples gtonly | 16.5 ms ±3.1% | 2.55 ms ±1.2% | 6.48x | 85% |
| vcf SAMPLES 100 samples gtonly | 14.4 ms ±0.8% | 5.08 ms ±0.5% | 2.83x | 65% |
| vcf genotypes 1000 samples gtonly | 160 ms ±0.3% | 20.2 ms ±0.5% | 7.91x | 87% |
| vcf SAMPLES 1000 samples gtonly | 130 ms ±0.2% | 43.8 ms ±0.8% | 2.97x | 66% |
| vcf genotypes 3000 samples gtonly | 538 ms ±0.1% | 89.4 ms ±1.2% | 6.02x | 83% |
| vcf SAMPLES 3000 samples gtonly | 418 ms ±0.3% | 160 ms ±0.4% | 2.62x | 62% |
| vcf genotypes 100 samples wide | 64.8 ms ±0.3% | 2.94 ms ±0.5% | 22.07x | 95% |
| vcf SAMPLES 100 samples wide | 63.3 ms ±0.5% | 31.8 ms ±1.0% | 1.99x | 50% |
| vcf genotypes 1000 samples wide | 640 ms ±0.2% | 23.2 ms ±0.7% | 27.54x | 96% |
| vcf SAMPLES 1000 samples wide | 605 ms ±0.2% | 312 ms ±0.2% | 1.94x | 48% |
| vcf genotypes 3000 samples wide | 1978 ms ±0.2% | 98.9 ms ±1.1% | 20.01x | 95% |
| vcf SAMPLES 3000 samples wide | 1851 ms ±0.1% | 970 ms ±0.1% | 1.91x | 48% |

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

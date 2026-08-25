# Parser libraries: 2023 release vs current

Same corpus and same window as the render benchmarks: simulated alignments over
a 250 kb slice of hg19 chr22, window `chr22_mask:124000-143000` (19 kb).

Both sides are built from source from a pinned GitHub tag with the same
toolchain, so the difference is library code rather than a change of transpiler
target or module format. `old` is the version JBrowse 2 depended on at the 2023
paper; `new` is the current release.

| case | 2023 | current | speedup | time cut |
| --- | --- | --- | --- | --- |
| bam 20x shortread | 22.4 ms ±4.6% | 5.21 ms ±5.3% | 4.30x | 77% |
| bam 20x longread | 145 ms ±2.2% | 40.7 ms ±6.2% | 3.57x | 72% |
| bam 200x shortread | 175 ms ±1.4% | 39.8 ms ±6.4% | 4.39x | 77% |
| bam 200x longread | 1768 ms ±4.0% | 383 ms ±0.4% | 4.61x | 78% |
| bam 1000x shortread | 920 ms ±0.5% | 190 ms ±3.8% | 4.85x | 79% |
| bam 1000x longread | 10262 ms ±4.4% | 1962 ms ±2.5% | 5.23x | 81% |
| bigwig 20x shortread | 0.82 ms ±5.7% | 0.74 ms ±2.2% | 1.10x | 9% |
| bigwig 20x longread | 1.20 ms ±2.2% | 1.43 ms ±2.8% | 0.84x | -19% |
| bigwig 200x shortread | 1.30 ms ±2.2% | 1.46 ms ±3.6% | 0.90x | -12% |
| bigwig 200x longread | 1.55 ms ±3.4% | 1.61 ms ±3.9% | 0.96x | -4% |
| bigwig 1000x shortread | 1.39 ms ±2.2% | 1.53 ms ±4.2% | 0.91x | -10% |
| bigwig 1000x longread | 1.48 ms ±2.6% | 1.59 ms ±3.8% | 0.93x | -8% |
| bgzf browser path 20x shortread | 101 ms ±2.0% | 17.8 ms ±4.2% | 5.68x | 82% |
| bgzf node path 20x shortread | 37.7 ms ±3.8% | 17.1 ms ±4.3% | 2.21x | 55% |
| bgzf browser path 20x longread | 125 ms ±0.5% | 36.0 ms ±2.8% | 3.46x | 71% |
| bgzf node path 20x longread | 78.0 ms ±35.7% | 32.0 ms ±2.4% | 2.44x | 59% |
| bgzf browser path 200x shortread | 981 ms ±0.2% | 179 ms ±0.9% | 5.49x | 82% |
| bgzf node path 200x shortread | 565 ms ±46.5% | 173 ms ±0.3% | 3.27x | 69% |
| bgzf browser path 200x longread | 1079 ms ±0.4% | 315 ms ±0.8% | 3.42x | 71% |
| bgzf node path 200x longread | 515 ms ±18.3% | 312 ms ±0.5% | 1.65x | 39% |
| cram 20x shortread | 372 ms ±0.7% | 40.2 ms ±4.6% | 9.23x | 89% |
| cram 20x longread | 467 ms ±1.8% | 41.2 ms ±2.3% | 11.34x | 91% |
| cram 200x shortread | 770 ms ±1.1% | 81.5 ms ±7.7% | 9.45x | 89% |
| cram 200x longread | 2799 ms ±0.3% | 251 ms ±0.7% | 11.14x | 91% |
| cram 1000x shortread | 3214 ms ±1.9% | 353 ms ±3.9% | 9.12x | 89% |
| cram 1000x longread | 12671 ms ±1.8% | 1157 ms ±1.0% | 10.95x | 91% |
| vcf genotypes 100 samples gtonly | 16.9 ms ±2.9% | 2.59 ms ±1.6% | 6.53x | 85% |
| vcf SAMPLES 100 samples gtonly | 14.1 ms ±1.4% | 4.46 ms ±1.1% | 3.16x | 68% |
| vcf genotypes 1000 samples gtonly | 157 ms ±1.7% | 20.8 ms ±1.8% | 7.55x | 87% |
| vcf SAMPLES 1000 samples gtonly | 127 ms ±1.7% | 37.8 ms ±1.5% | 3.35x | 70% |
| vcf genotypes 3000 samples gtonly | 526 ms ±1.4% | 85.4 ms ±2.1% | 6.16x | 84% |
| vcf SAMPLES 3000 samples gtonly | 435 ms ±3.1% | 156 ms ±10.1% | 2.79x | 64% |
| vcf genotypes 100 samples wide | 65.9 ms ±1.1% | 2.88 ms ±0.9% | 22.89x | 96% |
| vcf SAMPLES 100 samples wide | 65.4 ms ±0.8% | 32.4 ms ±0.7% | 2.02x | 50% |
| vcf genotypes 1000 samples wide | 665 ms ±1.1% | 23.0 ms ±1.2% | 28.96x | 97% |
| vcf SAMPLES 1000 samples wide | 624 ms ±0.7% | 306 ms ±0.4% | 2.04x | 51% |
| vcf genotypes 3000 samples wide | 2012 ms ±0.1% | 96.3 ms ±1.7% | 20.88x | 95% |
| vcf SAMPLES 3000 samples wide | 1878 ms ±0.4% | 948 ms ±0.1% | 1.98x | 50% |

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

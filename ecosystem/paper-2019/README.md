# The 2019 cram-js benchmark, as it was run

The harness behind the figure in [Buels, Dider, Diesh, Robinson & Holmes,
"Cram-JS: reference-based decompression in node and the browser", *Bioinformatics*
35(21):4451–4452
(2019)](https://doi.org/10.1093/bioinformatics/btz384), vendored here in full,
raw results included.

Provenance: `github.com/shihabdider/CRAM-JS-Benchmark`, commit `a6c9ac7`
(2019-04-25), copied unmodified on 2026-08-16. The repository carries no license
file. It is kept here because a benchmark whose only surviving copy is one
personal GitHub account is a benchmark that will eventually stop existing —
this one was briefly thought to have, under a misremembered account name.

| file | what |
| --- | --- |
| `cram_js_benchmark.py` | the driver: builds the random intervals, calls both tools, writes the TSV |
| `read_cram.js` | the cram-js arm, one query per node process |
| `bm_pipeline.sh` | fetches the corpus, converts the E. coli BAM to CRAM, runs the two scripts |
| `bm_data_files.txt` | the six corpus URLs |
| `make_bm_plot.py` | the figure |
| `cram_js_runtime.tsv` | **900 rows of raw runtimes** — the measurement itself |
| `benchmark_data_graph.png` | the figure as it was generated |

## What it measured

Three CRAMs, three interval lengths, 100 random intervals each:

| fixture | size | how it was obtained |
| --- | --- | --- |
| `NA12878...low_coverage.cram` | 4415 MB | 1000 Genomes, GRCh38 |
| `NA12878...exome.cram` | 8185 MB | 1000 Genomes, GRCh38 |
| `MiSeq_Ecoli_DH10B_110721_PF.bam.cram` | 828 MB | Illumina FTP, converted locally |

Each replicate drew one random contig (of chr1–chr22, chrX, chrY; the E. coli
file has one) and one random start, then queried `start+1000`, `start+10000` and
`start+100000` from it. Both arms were timed as whole processes: `samtools view`
under `/usr/bin/time`, and `node read_cram.js` self-timing from its first line to
the resolution of `getRecordsForRange`.

## The result, recomputed from the raw TSV

Medians rather than the figure's means, because three of the nine cells are
heavily skewed. n = 100 per cell. `../cram-samtools.ts` recomputes this same
table from this same TSV, so a report generated a year from now still carries
the baseline it is arguing with.

| fixture | interval | cram-js | samtools | ratio |
| --- | ---: | ---: | ---: | ---: |
| human low-coverage | 1 kb | 0.856 s | 0.060 s | 14.3x |
| human low-coverage | 10 kb | 0.833 s | 0.040 s | 20.8x |
| human low-coverage | 100 kb | 1.138 s | 0.070 s | 16.3x |
| human exome | 1 kb | 0.862 s | 0.060 s | 14.4x |
| human exome | 10 kb | 0.864 s | 0.050 s | 17.3x |
| human exome | 100 kb | 1.135 s | 0.070 s | 16.2x |
| E. coli high-coverage | 1 kb | 0.776 s | 0.040 s | 19.4x |
| E. coli high-coverage | 10 kb | 1.976 s | 0.170 s | 11.6x |
| E. coli high-coverage | 100 kb | 12.189 s | 1.270 s | 9.6x |

An order of magnitude, near enough flat across every condition — which is the
claim the paper makes, and it holds.

## Four things the raw data says that the figure cannot

These matter because `../cram-samtools.ts` reproduces the procedure and has to
decide, cell by cell, whether to keep the 2019 choice or fix it. Each is
answered there.

**Most cells never measured a decode.** The fastest cram-js run in the whole
900 is 0.284 s, and the median is 0.885 s. Six of the nine cells sit within a
factor of 1.3 of their own floor, so what they timed was node starting up,
`@gmod/cram` and `@gmod/indexedfasta` being imported, and a `.crai` being parsed
— not reads being decoded. Only the E. coli 10 kb and 100 kb cells rise clear of
that floor. A ratio against a tool that starts in 5 ms therefore reports a
constant, and reports it three times per file.

**Random intervals on an exome are mostly empty.** Off-target windows dominate a
uniform draw across chr1–chrY, so the exome column is a startup measurement with
a decode in a minority of its rows. The harness discarded record counts, so
nothing in the TSV distinguishes an empty window from a decoded one.

**The samtools column is elapsed time, and its resolution is 10 ms.** The
driver shells out to `time samtools ...` and keeps the first whitespace-separated
token. GNU `time` would have written `0.06user` there; the bare two-decimal
values match BSD/macOS `/usr/bin/time`, whose first field is `real`. So both arms
are wall clock — comparable — but every samtools figure below ~0.1 s is
quantized to a handful of distinct values.

**samtools was passed `-t reference.fa`, not `-T`.** `-t` names a
tab-delimited list of sequence names and lengths; `-T` names the reference FASTA
that CRAM decode needs. What resolved the reference on the 2019 machine —
`REF_PATH`, `REF_CACHE`, or the EBI M5 lookup — is not recoverable from the
repository.

## Running it today

`bm_pipeline.sh` no longer completes. `ussd-ftp.illumina.com` still resolves but
no longer accepts connections, so the E. coli BAM cannot be fetched from the URL
in `bm_data_files.txt`; the two 1000 Genomes CRAMs and the GRCh38 reference are
all still served. `../../shell/fetch_paper2019.sh` fetches what remains
fetchable and says plainly what it could not get.

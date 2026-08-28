# Format support, measured

Each cell is one page load against a plain `http-server`, at `chr22_mask:124000-143000`, settled for 20 s. **drew** means marks appeared on a canvas *and* the tool fetched the file; either one alone is not enough, because a tool that paints an empty frame and a tool that fetches bytes it cannot draw both look like success from one side.

This is a floor, not a verdict on quality: it says the tool opened the file from a static host, not that it rendered it well. A **no** belongs to the tool *and its harness page together* — the page can be at fault, and on 2026-08-28 one was. Measured 2026-08-28.

| format | JBrowse (builds/current) | igv.js 3.8.5 | GenomeSpy 0.85.0 | Gosling 1.0.7 | note |
|---|---|---|---|---|---|
| BAM | drew, 1.9 MB | drew, 0.7 MB | drew, 0.9 MB | drew, 1.6 MB |  |
| CRAM | drew, 0.5 MB | drew, 0.3 MB | **no** | **no** |  |
| BigWig | drew, 0.3 MB | drew, 0.1 MB | **no** | **no** | self-indexing, no sidecar |
| VCF | drew, 1.3 MB | drew, 1.3 MB | **no** | **no** | bgzip + tabix |

## Why each `no`

- **GenomeSpy 0.85.0 / CRAM** — 0/0 canvases painted, 0.0 MB fetched. cannot open "20x.shortread.cram" — genomespy 0.85.0 has no CRAM lazy source
- **GenomeSpy 0.85.0 / BigWig** — 0/0 canvases painted, 0.0 MB fetched. cannot open "20x.shortread.bw" — this harness builds a BAM pileup spec only; genomespy itself also reads bigwig, bigbed, vcf, gff3 and tabix
- **GenomeSpy 0.85.0 / VCF** — 0/0 canvases painted, 0.0 MB fetched. cannot open "variants.browser.vcf.gz" — this harness builds a BAM pileup spec only; genomespy itself also reads bigwig, bigbed, vcf, gff3 and tabix
- **Gosling 1.0.7 / CRAM** — 0/0 canvases painted, 0.0 MB fetched. cannot open "20x.shortread.cram" — gosling 1.0.7 has no CRAM fetcher
- **Gosling 1.0.7 / BigWig** — 0/0 canvases painted, 0.0 MB fetched. cannot open "20x.shortread.bw" — this harness builds a BAM pileup spec only; gosling itself also reads bigwig, vcf, gff, bed and csv
- **Gosling 1.0.7 / VCF** — 0/0 canvases painted, 0.0 MB fetched. cannot open "variants.browser.vcf.gz" — this harness builds a BAM pileup spec only; gosling itself also reads bigwig, vcf, gff, bed and csv

## What this does not answer

Whether the rendering is correct or complete, how fast it is, and every part of the design-space comparison that is a judgement call. GFF3 has no row: `data/features.*.gff3` sit on a contig named `gff_contig` because they were generated for the parser benchmark, so no tool configured for `hg19mod` can open them. That is a corpus gap, not a capability finding.

# Corpus

## Building it

`data/` holds one reference and the alignments simulated against it. All of it
except the reference is untracked and regenerable — roughly 750 MB.

- `hg19mod.fa` (+ `.fai`) — a 250 kb slice of hg19 chr22, contig `chr22_mask`.
  Tracked; it is the input everything else is derived from.
- `*.bam` / `*.cram` (+ indexes) — simulated alignments at 20x / 200x / 1000x
  coverage, short reads (wgsim) and long reads (pbsim).
- `*.longread.mod.bam` (+ indexes) — the long-read alignments with MM/ML
  base-modification tags stamped on: CpG-context 5mC, bimodal probabilities,
  seeded. Built by `shell/generate_modbam.sh` from the plain files, so a
  mod-vs-plain comparison differs by the tags and nothing else, and checked by
  `shell/verify_modifications.js`, which decodes MM back against each read
  independently of the generator. 20x and 200x only — the tags grow a long read
  by roughly a quarter, and 200x already carries 841k modification calls.
  Until 2026-08-11 there was no modBAM here at all, so the base-modification
  path was exercised by nothing; the first profile of it found one function
  taking a third of the RPC worker (`flame/WORKER_FINDINGS.md`).
- `*.bw` — BigWig coverage tracks at the same coverages. Nothing in the render
  or cross-tool benchmarks currently reads them: the GenomeSpy harness reads
  BAM, through that tool's own lazy BAM source and `pileup` transform, so all
  three tools share the alignment workload rather than falling back to signal.
  This bullet claimed the opposite until 2026-08-23 — "signal is the only
  workload a tool with no alignment track can share" — which was true of an
  earlier harness design and never true of the file.
- `chr22_2mb.fa` (+ `.fai`) — a 2 Mb slice of GRCh38 chr22 (20,000,001–22,000,000,
  no Ns), contig `chr22_2mb`. Tracked, and the input the wide arm is derived
  from. A different genome build from `hg19mod.fa`, which does not matter to a
  simulation but is worth knowing before the two corpora are read as one.
- `2mb.*.bam` / `2mb.*.cram` (+ indexes) — the wide arm: 20x and 100x over that
  contig, short and long reads, built by `shell/generate_1mb.sh`. Roughly 550 MB
  and regenerable in about a minute.
- `R103.model` — the pbsim error model for the long-read simulation. Tracked.
- `hg19_17.chrom.sizes` — chr17's size, left over from the variant-matrix work.
  Nothing in this repo currently reads it.
- `paper2019/` — the corpus the 2019 cram-js paper benchmarked: two 1000 Genomes
  NA12878 CRAMs and GRCh38 with decoys, ~16 GB, downloaded rather than
  simulated by `shell/fetch_paper2019.sh`. Only
  `ecosystem/cram-samtools.ts` reads it, and only to say something about the
  published numbers as published; that benchmark also runs on the simulated
  corpus above, which is where its result sits beside everything else here.

The benchmark window is `chr22_mask:124000-143000` (19 kb), which matches the
historical jb2profile region, and it is what every table here reports unless it
says otherwise.

The exception is the **wide arm**, added 2026-09-05: `chr22_2mb:500001-1500000`
(1 Mb) on its own assembly. Everything above sits on a 250 kb contig, so the
only variable the corpus could move was depth — 20x to 1000x through a fixed
19 kb window. The wide arm holds depth at what people actually have (20x and
100x) and moves the window instead. 100x over 2 Mb is 200 Mb of aligned bases
against the deep arm's 250 Mb over 250 kb: about the same bytes, spread over 50x
the screen, which is what separates fetch and decode cost from per-feature
layout and paint. The contig is 2 Mb and the window the middle 1 Mb of it
because JBrowse clamps bpPerPx at the contig width — a window that *is* the
assembly cannot be panned or zoomed out of, and is a different thing from a 1 Mb
view of a chromosome.

`SCALE=1mb` selects it, in `scripts/render/cases.ts`. Its results are their own
files (`results/alignments-1mb.md`) rather than more rows in the deep arm's
table: the two share no assembly, no window and no coverage ladder, so one table
would carry a column for every axis and a value for none of them.


## Regenerating it

```bash
./shell/generate_alignments.sh   # needs wgsim, pbsim, minimap2, samtools
./shell/load_alignments.sh       # adds assembly + tracks to every builds/*
./shell/generate_variants.sh     # needs nothing but node
```

`generate_alignments.sh` works inside `data/` and rewrites everything there from
`hg19mod.fa`. `load_alignments.sh` copies the assembly into each build and
symlinks the alignments, so `builds/` stays small and every build serves the
same bytes.

`generate_variants.sh` writes the multi-sample VCFs the ecosystem VCF benchmark
reads, over the same contig and window. It needs no external tools — the records
come from a seeded RNG — so it is the one part of the corpus any checkout can
reproduce byte-for-byte in a couple of seconds.


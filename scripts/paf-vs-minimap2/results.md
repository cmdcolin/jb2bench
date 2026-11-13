# Graph-derived haplotype alignments vs minimap2 at the CFHR3–CFHR1 deletion, and repeated nodes on the GRCh38 path

Measured 2026-11-07 on `ada` (24 cores, 125 GB), everything under `~/work/paf-vs-minimap2/`.
Scripts are in `scripts/`; every number below is produced by them from the files named.

Tools: minimap2 2.24-r1122, samtools 1.13, tabix (htslib) 1.13, python 3.10.12, GNU awk 5.1.0, pigz 2.6, GNU sort 8.32. The PIF was written by jbrowse-cli 5.0.0-beta.8 (`make-pif --csi`) from the PAF that gfa_to_pairwise_paf.py v1.0.0 unpacked from `hprc-v2.1-mc-grch38.gfa.gz` with `--max-gap 10000` (scripts/build_hprc_multiway_synteny.sh in jbrowse-components).

## 1. Setting

- Window: GRCh38 chr1:196,640,000–196,900,000 (260 kb), the view of the paper's Figure 5 (supplementary table `tab:gbz-requests` gives the coordinates). The CFHR3–CFHR1 deletion is 84,684 bp.
- Haplotypes: HG01109#1, HG01123#1, HG01960#1, HG02055#1 (carry the deletion), HG00097#1, HG00099#1, HG00128#1, HG00133#1 (do not).
- "PIF": the hosted `hprc_multiway_gfa.pif.gz`, queried at the window from the target side (`tabix pif.gz 'tGRCh38#0#chr1:196640000-196900000'`, the fine tier whose `cg:Z:` is the source PAF's). Each haplotype has one contig in the window; the carriers have two rows (the deletion is a >10 kb gap, so the chain breaks), the others one. The rows were checked byte-for-byte against the raw PAF the PIF was indexed from (`scripts/extract_pif_rows.sh`): identical.
- "minimap2": the whole contig the PIF aligns in the window, fetched from the HPRC release 2 assembly by HTTP range request (`scripts/fetch_contig.py`, using the published `.fai`/`.gzi`), aligned to GRCh38 chr1 (`~/data/hg38/hg38.fa`, UCSC hg38, chr1 extracted) with `minimap2 -cx asm5 --cs --eqx` (`scripts/align_all.sh`). Primary rows (`tp:A:P`) overlapping the window are compared. `-x asm20` was run as well; it is reported for the three contigs that finished (see "What was not done").
- Comparison (`scripts/compare.py`): for each of the 260,000 reference bases, where each method places it on the haplotype (contig, position, strand), by walking the =/X/I/D CIGARs. A base is *exact* when both methods put it on the same haplotype base, *within 10 bp* when on the same contig and strand within 10 bp, *different* otherwise, *PIF only* / *mm2 only* when one method aligns it and the other has it unaligned (a `D`, or between alignments), *neither* when both leave it unaligned. Independently of minimap2, every PIF `=` pair and every PIF `X` pair is checked against the two FASTAs: are the reference base and the haplotype base the same letter?

## 2. Per-haplotype results (minimap2 -x asm5)

| haplotype | contig | PIF-placed bp | of which `=` / `X` | mm2-placed bp | both | exact | within 10 bp | different | PIF only | mm2 only | neither | PIF `=` pairs identical in FASTA | PIF `X` pairs identical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HG01109#1 | JAHEPA020000055.1 | 175,170 | 174,864 / 306 | 175,229 | 174,184 | 174,000 (99.332%) | 174,138 (99.411%) | 46 | 986 | 1,045 | 83,785 | 174,864 / 174,864 | 6 / 306 |
| HG01123#1 | CM089081.1 | 175,210 | 174,908 / 302 | 175,267 | 174,250 | 174,009 (99.315%) | 174,139 (99.389%) | 111 | 960 | 1,017 | 83,773 | 174,908 / 174,908 | 0 / 302 |
| HG01960#1 | CM088644.1 | 175,216 | 174,903 / 313 | 175,265 | 174,254 | 173,990 (99.300%) | 174,137 (99.384%) | 117 | 962 | 1,011 | 83,773 | 174,903 / 174,903 | 2 / 313 |
| HG02055#1 | CM092205.1 | 175,214 | 174,884 / 330 | 175,266 | 174,249 | 174,009 (99.312%) | 174,163 (99.400%) | 86 | 965 | 1,017 | 83,769 | 174,884 / 174,884 | 0 / 330 |
| HG00097#1 | CM094060.1 | 259,906 | 259,727 / 179 | 259,921 | 259,879 | 259,773 (99.949%) | 259,832 (99.972%) | 47 | 27 | 42 | 52 | 259,727 / 259,727 | 1 / 179 |
| HG00099#1 | JBHDWO010000059.1 | 259,851 | 259,451 / 400 | 259,870 | 259,796 | 259,473 (99.855%) | 259,733 (99.955%) | 63 | 55 | 74 | 75 | 259,451 / 259,451 | 0 / 400 |
| HG00128#1 | JBHIKS010000054.1 | 259,899 | 259,769 / 130 | 259,912 | 259,866 | 259,684 (99.917%) | 259,819 (99.969%) | 47 | 33 | 46 | 55 | 259,769 / 259,769 | 0 / 130 |
| HG00133#1 | CM090045.1 | 259,733 | 258,985 / 748 | 259,573 | 259,484 | 259,239 (99.810%) | 259,386 (99.866%) | 98 | 249 | 89 | 178 | 258,985 / 258,985 | 1 / 748 |

Reading of the table:

- Where both methods align a base, they put it on the same haplotype base for 99.9%+ of bases (non-carriers: 99.81–99.95% exact, 99.87–99.97% within 10 bp of all PIF-placed bases; carriers: 99.30–99.33% exact, 99.38–99.41% within 10 bp, and the shortfall is one 954 bp block at the deletion, section 3).
- Every PIF `=` pair is an identical base in the two FASTAs: 1,737,491 of 1,737,491 `=` bases over the eight haplotypes (column "PIF `=` pairs identical"). The PIF's `=` runs are shared graph nodes; two walks through one node carry the same sequence, and the check confirms that against the released assemblies and hg38.
- The PIF's `X` bases (130–748 per haplotype) are the converter's pairing of private bases between two shared nodes; they are not compared bases, and 0–6 of them per haplotype happen to be identical letters. minimap2 never reports a mismatch (`X`) at a base pair the PIF marks `=` (column `mm2_X_where_pif_eq_same_base` in `out/summary.csv` is 0 for all eight).
- Bases "within 10 bp" but not exact, and the "different" bases (46–117 per haplotype), are indel placement: the same insertion or deletion placed at a different position inside a short tandem repeat by the two methods (`out/*.runs.tsv` lists every run; e.g. HG00097#1 196,671,760: PIF 199,154,556 vs minimap2 199,154,558, a 2 bp shift over 3 bases). The largest non-carrier differences sit at chr1:196,885,489–196,885,600, where minimap2 breaks each non-carrier contig's alignment into two rows (one ending at 196,885,498, the next starting at 196,885,520 with a 9 bp query overlap) and the PIF keeps one chain; 22 bp are then PIF-only and up to 40 bp "different".
- The only non-carrier run of 100 bp or more: HG00133#1, chr1:196,776,014–196,776,168 (154 bp) PIF-only. minimap2 splits its alignment there too (rows ending at 196,776,005 and starting at 196,776,168, 164 bp of haplotype unaligned between them); the PIF aligns those bases through shared nodes.

### minimap2 -x asm20, three contigs

| haplotype | contig | PIF-placed bp | of which `=` / `X` | mm2-placed bp | both | exact | within 10 bp | different | PIF only | mm2 only | neither | PIF `=` pairs identical in FASTA | PIF `X` pairs identical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HG01109#1 | JAHEPA020000055.1 | 175,170 | 174,864 / 306 | 175,234 | 174,414 | 174,231 (99.464%) | 174,369 (99.543%) | 45 | 756 | 820 | 84,010 | 174,864 / 174,864 | 6 / 306 |
| HG00099#1 | JBHDWO010000059.1 | 259,851 | 259,451 / 400 | 259,892 | 259,818 | 259,489 (99.861%) | 259,749 (99.961%) | 69 | 33 | 74 | 75 | 259,451 / 259,451 | 0 / 400 |
| HG00128#1 | JBHIKS010000054.1 | 259,899 | 259,769 / 130 | 259,934 | 259,888 | 259,684 (99.917%) | 259,819 (99.969%) | 69 | 11 | 46 | 55 | 259,769 / 259,769 | 0 / 130 |

Same picture; asm20 moves HG01109#1's deletion boundary again (section 3).

## 3. Every disagreement of 1 kb or more

| haplotype | mm2 | status | GRCh38 chr1 | length | PIF says | minimap2 says |
|---|---|---|---|---|---|---|
| HG01109#1 | asm20 | neither | 196,759,449-196,843,410 | 83,961 | between alignments: previous alignment ends ref 196,759,449 query 49,424,041, next starts ref 196,844,133 query 49,424,041, query gap 0 bp | inside an alignment, reference-only (D) |
| HG01109#1 | asm5 | neither | 196,759,449-196,843,179 | 83,730 | between alignments: previous alignment ends ref 196,759,449 query 49,424,041, next starts ref 196,844,133 query 49,424,041, query gap 0 bp | inside an alignment, reference-only (D) |
| HG01123#1 | asm5 | neither | 196,759,449-196,843,179 | 83,730 | between alignments: previous alignment ends ref 196,759,449 query 191,911,215, next starts ref 196,844,133 query 191,911,215, query gap 0 bp | inside an alignment, reference-only (D) |
| HG01960#1 | asm5 | neither | 196,759,449-196,843,179 | 83,730 | between alignments: previous alignment ends ref 196,759,449 query 196,600,857, next starts ref 196,844,133 query 196,600,857, query gap 0 bp | inside an alignment, reference-only (D) |
| HG02055#1 | asm5 | neither | 196,759,449-196,843,179 | 83,730 | between alignments: previous alignment ends ref 196,759,449 query 202,010,796, next starts ref 196,844,133 query 202,010,796, query gap 0 bp | inside an alignment, reference-only (D) |

There is exactly one, and it is the deletion itself, in all four carriers. Both methods delete 84,684 bp of reference with 0 bp of haplotype in the gap, and both show it as the paper's figure does; they place the breakpoint 954 bp apart:

- PIF: haplotype bases 49,423,087–49,424,041 (HG01109#1; the same 954 bp offset in the other three) sit at chr1:196,758,495–196,759,449, then the deletion chr1:196,759,449–196,844,133.
- minimap2 asm5: those same 954 haplotype bases sit at chr1:196,843,179–196,844,133, after the deletion chr1:196,758,495–196,843,179.

`scripts/deletion_flanks.sh` and `scripts/deletion_flanks.py` explain it: the two reference stretches are a 960 bp near-identical pair (chr1:196,758,495–196,759,455 vs 196,843,179–196,844,139, 3 mismatches), the deletion's two flanks. The carriers' 954 bp match the left copy with 4 mismatches and the right copy with 4 mismatches: they carry the left copy's base at offset 197 and the right copy's at offset 219 (plus three private variants at 230, 629, 903), so the breakpoint lies in the 22 bp between, and the whole-block placement at either end is equally supported. The graph walks the shared nodes on the left, minimap2 scores the right; neither is wrong, and the reference span of the deletion is the same length either way. With asm20, minimap2 places the boundary 723 bp into the repeat instead (neither-run 196,759,449–196,843,410): the placement within the repeat is a scoring choice, not a sequence fact.

In the per-base table this one block is all of the carriers' PIF-only (954 + a few bp), mm2-only (954 + a few bp) and non-exact counts; outside it, the carriers agree like the non-carriers.

## 4. Nodes the GRCh38 path visits more than once

Result: **0**. The GRCh38 walks of hprc-v2.1-mc-grch38.gfa.gz visit 83,303,684 nodes, and every one of them exactly once; no node is visited twice within a chromosome and none is shared between two GRCh38 sequences. Every step is in the forward orientation (0 `<` steps). So the converter's repeated-node rule is never exercised on this graph, and the alignments at the locus (chr1:196640000-196900000: GRCh38 walks 10678 nodes, 0 of them visited more than once) do not touch one.

Method (`scripts/run_count.sh`, 3768 s wall for the one pass over the 63.6 GB gzip on the loaded host, pigz-bound; sort under `-S 4G`, everything under `ulimit -v 20 GB`): `pigz -dc graph | awk '$1=="W" && $2=="GRCh38"'`, one `node<TAB>chromosome` line per step (`scripts/emit_steps.py`), `LC_ALL=C sort`, then `scripts/count_sorted.py` counts ids with more than one line. Checks: a positive control with a planted within-chromosome repeat and a planted cross-chromosome share reports both; the number of `<`/`>` characters in the saved GRCh38 W lines (`nodes/grch38_walks.gfa.gz`) is 83,303,684, the same as the visit count; the per-sequence distinct counts sum to the total.

| GRCh38 sequence | nodes walked | distinct | visited more than once |
|---|---|---|---|
| chr1 | 6,366,942 | 6,366,942 | 0 |
| chr2 | 6,704,905 | 6,704,905 | 0 |
| chr3 | 5,359,879 | 5,359,879 | 0 |
| chr4 | 5,446,766 | 5,446,766 | 0 |
| chr5 | 4,989,667 | 4,989,667 | 0 |
| chr6 | 4,799,024 | 4,799,024 | 0 |
| chr7 | 4,628,750 | 4,628,750 | 0 |
| chr8 | 4,374,451 | 4,374,451 | 0 |
| chr9 | 3,867,404 | 3,867,404 | 0 |
| chr10 | 3,912,660 | 3,912,660 | 0 |
| chr11 | 3,757,137 | 3,757,137 | 0 |
| chr12 | 3,634,990 | 3,634,990 | 0 |
| chr13 | 2,714,505 | 2,714,505 | 0 |
| chr14 | 2,607,961 | 2,607,961 | 0 |
| chr15 | 2,951,717 | 2,951,717 | 0 |
| chr16 | 2,738,392 | 2,738,392 | 0 |
| chr17 | 2,316,861 | 2,316,861 | 0 |
| chr18 | 2,156,443 | 2,156,443 | 0 |
| chr19 | 1,894,108 | 1,894,108 | 0 |
| chr20 | 1,817,551 | 1,817,551 | 0 |
| chr21 | 1,192,842 | 1,192,842 | 0 |
| chr22 | 1,389,745 | 1,389,745 | 0 |
| chrX | 3,120,073 | 3,120,073 | 0 |
| chrY | 445,420 | 445,420 | 0 |
| 171 other sequences (unplaced, random, chrM, chrEBV) | 115,491 | 115,491 | 0 |
| all 195 GRCh38 sequences (one W line each) | 83,303,684 | 83,303,684 | 0 |

How the converter handles them (gfa_to_pairwise_paf.py, docstring and `align_walk`): the reference walk is indexed node → (rank, offset); a node the reference visits more than once keeps every occurrence, and a query step on such a node takes the occurrence nearest ahead in the open chain's direction, else the first, so a chain never jumps backwards or to another chromosome because of a repeated node.

## 5. Genome-wide, one haplotype (HG00133#1)

HG00133 hap1's whole release 2 assembly (899 MB bgzip, md5 as published) against GRCh38 chr1–22, X, Y, M with `minimap2 -t 8 -cx asm5 --cs --eqx` (3,336 s wall, 26.2 GB peak RSS), compared with the PIF's 563 genome-wide rows for HG00133#1 (`grep '^HG00133#1#' hprc_multiway_gfa.paf`, the PAF the PIF indexes) by `scripts/compare_segments.py`: the same classification as section 2 but on diagonal segments with one sweep per chromosome (12 s), minimap2 primary rows only.

Genome total: the PIF places 2,824,550,623 bp of GRCh38 on the haplotype; **2,814,216,099 (99.634%) exact**, 2,816,699,338 (99.722%) within 10 bp, 3,759,830 (0.133%) on the same contig but shifted by more than 10 bp, 2,155,123 (0.076%) placed by minimap2 on another contig or strand, 1,936,332 (0.069%) aligned by the PIF and not by minimap2. minimap2 places 2,867,952,420 bp, of which 45,338,129 (1.58%) the PIF does not.

| chrom | length | PIF-placed | mm2-placed | exact | within 10 bp | shifted >10 bp | elsewhere | PIF only | mm2 only | neither |
|---|---|---|---|---|---|---|---|---|---|---|
| chr1 | 248,956,422 | 225,017,836 | 227,929,512 | 223,391,791 | 223,560,279 | 296,664 | 1,073,461 | 87,432 | 2,999,108 | 20,939,478 |
| chr2 | 242,193,529 | 237,226,896 | 238,383,911 | 236,546,209 | 236,729,601 | 258,479 | 168,037 | 70,779 | 1,227,794 | 3,738,839 |
| chr3 | 198,295,559 | 195,429,106 | 196,961,730 | 195,065,849 | 195,206,231 | 166,544 | 0 | 56,331 | 1,588,955 | 1,277,498 |
| chr4 | 190,214,555 | 187,215,603 | 188,741,060 | 186,767,166 | 186,906,715 | 242,325 | 95 | 66,468 | 1,591,925 | 1,407,027 |
| chr5 | 181,538,259 | 176,606,180 | 178,633,999 | 176,114,739 | 176,241,792 | 200,457 | 108,887 | 55,044 | 2,082,863 | 2,849,216 |
| chr6 | 170,805,979 | 168,695,697 | 169,866,710 | 168,253,850 | 168,373,572 | 184,387 | 252 | 137,486 | 1,308,499 | 801,783 |
| chr7 | 159,345,973 | 155,226,988 | 157,761,949 | 154,526,148 | 154,676,179 | 362,573 | 66,822 | 121,414 | 2,656,375 | 1,462,610 |
| chr8 | 145,138,636 | 142,140,949 | 143,452,768 | 141,715,359 | 141,853,856 | 196,141 | 0 | 90,952 | 1,402,771 | 1,594,916 |
| chr9 | 138,394,717 | 113,928,603 | 117,108,110 | 113,057,984 | 113,236,517 | 119,972 | 447,883 | 124,231 | 3,303,738 | 21,162,376 |
| chr10 | 133,797,422 | 130,850,836 | 131,714,148 | 130,480,282 | 130,604,850 | 194,136 | 713 | 51,137 | 914,449 | 2,032,137 |
| chr11 | 135,086,622 | 131,091,325 | 133,071,941 | 130,692,956 | 130,809,934 | 111,984 | 0 | 169,407 | 2,150,023 | 1,845,274 |
| chr12 | 133,275,309 | 130,527,328 | 131,568,673 | 130,156,689 | 130,269,875 | 143,735 | 21,264 | 92,454 | 1,133,799 | 1,614,182 |
| chr13 | 114,364,328 | 95,661,075 | 96,763,874 | 95,476,801 | 95,547,917 | 87,617 | 0 | 25,541 | 1,128,340 | 17,574,913 |
| chr14 | 107,043,718 | 87,550,301 | 88,251,866 | 86,964,879 | 87,030,426 | 111,866 | 10 | 407,999 | 1,109,564 | 18,383,853 |
| chr15 | 101,991,189 | 79,171,948 | 83,130,046 | 79,001,364 | 79,074,240 | 68,190 | 0 | 29,518 | 3,987,616 | 18,831,625 |
| chr16 | 90,338,345 | 78,683,707 | 81,020,636 | 78,368,345 | 78,469,273 | 144,047 | 22,268 | 48,119 | 2,385,048 | 9,269,590 |
| chr17 | 83,257,441 | 78,239,263 | 79,056,884 | 77,871,433 | 77,951,699 | 196,118 | 38,959 | 52,487 | 870,108 | 4,148,070 |
| chr18 | 80,373,285 | 74,658,086 | 77,168,310 | 74,488,934 | 74,548,959 | 89,104 | 0 | 20,023 | 2,530,247 | 3,184,952 |
| chr19 | 58,617,616 | 55,525,248 | 56,691,866 | 55,133,545 | 55,212,021 | 172,777 | 94,543 | 45,907 | 1,212,525 | 1,879,843 |
| chr20 | 64,444,167 | 60,878,869 | 62,590,732 | 60,684,172 | 60,739,007 | 108,680 | 153 | 31,029 | 1,742,892 | 1,822,406 |
| chr21 | 46,709,983 | 34,802,536 | 37,517,010 | 34,684,814 | 34,719,676 | 66,533 | 322 | 16,005 | 2,730,479 | 9,176,968 |
| chr22 | 50,818,468 | 34,992,071 | 37,545,268 | 34,841,775 | 34,888,708 | 55,798 | 80 | 47,485 | 2,600,682 | 13,225,715 |
| chrX | 156,040,895 | 150,430,172 | 152,806,336 | 149,931,015 | 150,048,011 | 181,703 | 111,374 | 89,084 | 2,465,248 | 3,145,475 |
| chrY | 57,227,415 | 0 | 215,081 | 0 | 0 | 0 | 0 | 0 | 215,081 | 57,012,334 |

Reading: agreement is uniform across chromosomes (exact 99.2–99.8% per chromosome, chrY aside). What minimap2 aligns and the graph does not (45 Mb, 1.6%) sits where Minigraph-Cactus clips or leaves the reference unwalked by this haplotype: 3–4 Mb each on chr1, chr9, chr15, chr21, chr22 (pericentromeric and acrocentric satellite arrays) and 215 kb on chrY for a female haplotype (X-transposed/PAR homology that minimap2 maps to Y). "Elsewhere" is half on chr1 (1.07 Mb) and chr9 (448 kb), the segmental-duplication-rich pericentromeres, where minimap2 and the graph pick different paralogous copies; "shifted" is indel placement in repeats as at the locus.

## 6. What was not done, and why

- `-x asm20` finished for three contigs (HG01109#1, HG00099#1, HG00128#1) before I stopped the other five: the whole-contig asm20 jobs used 10–13 GB each and the host was at 102 of 125 GB with other users' jobs running. asm5 left no gap at the locus that asm20 would fill (with asm5 minimap2 aligns 259,573–259,921 of the non-carriers' 260,000 bases and 175,229–175,266 of the carriers', the rest being the deletion), so the second preset was not needed for the question.
- minimap2 was given GRCh38 chr1 only for the locus (and the 24 chromosomes + chrM for the genome-wide run), not alts or unplaced contigs; the graph's GRCh38 walks are chr1–22, X, Y plus two unplaced contigs (`cut -f6 hprc_multiway_gfa.paf | sort | uniq -c`).
- The hosted PIF and the raw PAF it indexes were used as they are; the eight haplotypes' PIF rows were not regenerated from the GFA.

## 7. Commands

```
# on ada, in ~/work/paf-vs-minimap2
bash scripts/run_count.sh                      # nohup, ulimit -v 20 GB; GRCh38 W lines, node lengths, sort, count
python3 -I scripts/repeated_bp.py nodes/repeated_nodes.tsv nodes/node_lengths.tsv.gz nodes/grch38_walks.gfa.gz chr1:196640000-196900000
samtools faidx ~/data/hg38/hg38.fa chr1 > ref/chr1.fa && samtools faidx ref/chr1.fa
bash scripts/fetch_all.sh "HG01109#1#JAHEPA020000055.1" "HG01123#1#CM089081.1" "HG01960#1#CM088644.1" "HG02055#1#CM092205.1" \
  "HG00097#1#CM094060.1" "HG00099#1#JBHDWO010000059.1" "HG00128#1#JBHIKS010000054.1" "HG00133#1#CM090045.1"
bash scripts/extract_pif_rows.sh               # tabix tGRCh38#0#chr1:196640000-196900000, un-swapped, checked against the raw PAF
bash scripts/align_all.sh                      # minimap2 -t 2 -cx {asm5,asm20} --cs --eqx ref/chr1.fa asm/<contig>.fa, 6 jobs at a time
bash scripts/run_compare.sh asm5               # compare.py per haplotype -> out/summary.csv, out/runs_1kb.tsv
bash scripts/run_compare.sh asm20
python3 -I scripts/make_tables.py out/summary.csv out/runs_1kb.tsv
bash scripts/deletion_flanks.sh && python3 -I scripts/deletion_flanks.py
bash scripts/align_genome.sh                   # HG00133 hap1 whole assembly vs chr1-22,X,Y,M, minimap2 -t 8 asm5; compare_segments.py by chromosome
```

Run times (wall): fetch of the eight contigs 2 min in all; minimap2 asm5 per contig 66 s (102 Mb) to 2,052 s (254 Mb, under load), 8.7 GB peak RSS; compare.py under a minute per haplotype. Count and genome-wide times are in their sections.

## Files

- `out/summary.csv`: the per-haplotype table (asm5 and asm20 rows).
- `out/runs_1kb.tsv`: every non-exact run of 1 kb or more; `out/<hap>.<preset>.runs.tsv`: every run.
- `pif/HG*.1.paf`: the PIF rows at the window, standard PAF orientation; `pif/window.t_rows.pif`: as tabix returned them.
- `mm2/*.paf`: minimap2 output, whole contig vs chr1; `mm2/*.log`: minimap2 stderr with `/usr/bin/time`.
- `nodes/repeated_nodes.txt`: the count; `nodes/repeated_nodes.tsv`: every repeated node with visits and chromosomes; `nodes/repeated_bp.txt`: lengths; `nodes/grch38_walks.gfa.gz`, `nodes/node_lengths.tsv.gz`: the GRCh38 W lines and every node's length, for reruns without the 64 GB graph.
- `mm2_genome/HG00133.1.asm5.paf`, `out/HG00133.1.genome.asm5.by_chrom.tsv`: the genome-wide run.

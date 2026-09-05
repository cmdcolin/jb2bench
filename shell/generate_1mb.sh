#!/bin/bash
# Regenerate the wide-window arm of the corpus: alignments over a 2 Mb contig,
# for the 1 Mb render window (SCALE=1mb in scripts/render/cases.ts).
#
# Everything else in data/ sits on the 250 kb chr22_mask contig, so the widest
# window that corpus can hold is 250 kb and the 1 Mb question cannot be asked of
# it at all. The contig here is 2 Mb rather than 1 Mb so the window is a slice of
# a chromosome and not the whole assembly: JBrowse clamps bpPerPx at the contig
# width, and a pan or a zoom-out from a whole-contig view has nowhere to go.
#
# 100x and 20x, over 2 Mb: 200 Mb and 40 Mb of aligned bases, against the 250 Mb
# the 1000x arm carries over 250 kb. So the wide arm is not more data than the
# deep one — it is the same order of bytes spread over 4x the screen, which is
# the variable the 1 Mb window exists to move.
#
# data/chr22_2mb.fa is tracked and is the input, cut from GRCh38 chr22
# (20,000,001-22,000,000, no Ns). It is a different build from hg19mod.fa, which
# does not matter to a simulation but is worth knowing before the two corpora
# are read as one.
set -e
cd "$(dirname "$0")/../data"
REF=chr22_2mb.fa
DEPTH=100
# 100x over 2 Mb of 2x150 pairs
PAIRS=666667

echo "[$(date +%T)] simulate shortreads (wgsim ${PAIRS} pairs)"
wgsim -1 150 -2 150 -N "$PAIRS" "$REF" 2mb.1.fq 2mb.2.fq > /dev/null 2>&1

echo "[$(date +%T)] simulate longreads (pbsim depth ${DEPTH})"
pbsim "$REF" --depth "$DEPTH" --hmm_model R103.model --length-mean 50000 --prefix 2mb.sim > /dev/null 2>&1
rm -f 2mb.sim*.ref 2mb.sim*.maf

echo "[$(date +%T)] align shortreads"
minimap2 -t 8 -a -x sr "$REF" 2mb.1.fq 2mb.2.fq 2>/dev/null |
  samtools fixmate -u -m - - |
  samtools sort -u -@2 - |
  samtools markdup -@8 --reference "$REF" - --write-index 2mb.100x.shortread.cram

echo "[$(date +%T)] align longreads"
minimap2 -t 8 -a "$REF" 2mb.sim_0001.fastq 2>/dev/null |
  samtools fixmate -u -m - - |
  samtools sort -u -@2 - |
  samtools markdup -@8 --reference "$REF" - --write-index 2mb.100x.longread.cram

for k in shortread longread; do
  echo "[$(date +%T)] subsample ${k} -> 20x"
  samtools view -T "$REF" "2mb.100x.${k}.cram" -s 50.20 -o "2mb.20x.${k}.cram"
done

echo "[$(date +%T)] index crams + make bams"
for i in 2mb.*.cram; do
  samtools index -@3 "$i"
  base=$(basename "$i" .cram)
  samtools view -T "$REF" -@3 "$i" -o "$base.tmp.bam"
  samtools calmd -@3 "$base.tmp.bam" "$REF" --output-fmt BAM 2>/dev/null > "$base.bam"
  samtools index -@3 "$base.bam"
  rm -f "$base.tmp.bam"
done

rm -f 2mb.1.fq 2mb.2.fq 2mb.sim_0001.fastq
echo "[$(date +%T)] DONE wide-window generation"
ls -la 2mb.*.bam 2mb.*.cram

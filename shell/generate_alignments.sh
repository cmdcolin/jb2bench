#!/bin/bash
# Regenerate BAM/CRAM alignment test data for jb2bench.
# Simulates short reads (wgsim) and long reads (pbsim), aligns with minimap2,
# subsamples to several coverage levels, and emits indexed BAM + CRAM.
# Everything is read from and written into data/, alongside the reference.
set -e
cd "$(dirname "$0")/../data"
REF=hg19mod.fa

echo "[$(date +%T)] simulate shortreads (wgsim 1M pairs)"
wgsim -1 150 -2 150 -N 1000000 "$REF" 1000x.1.fq 1000x.2.fq > /dev/null 2>&1

echo "[$(date +%T)] simulate longreads (pbsim depth 1000)"
pbsim "$REF" --depth 1000 --hmm_model R103.model --length-mean 50000 --prefix 1000x > /dev/null 2>&1
rm -f *.ref *.maf

echo "[$(date +%T)] align shortreads"
minimap2 -t 8 -a -x sr "$REF" 1000x.1.fq 1000x.2.fq 2>/dev/null |
  samtools fixmate -u -m - - |
  samtools sort -u -@2 - |
  samtools markdup -@8 --reference "$REF" - --write-index 1000x.shortread.cram

echo "[$(date +%T)] align longreads"
minimap2 -t 8 -a "$REF" 1000x_0001.fastq 2>/dev/null |
  samtools fixmate -u -m - - |
  samtools sort -u -@2 - |
  samtools markdup -@8 --reference "$REF" - --write-index 1000x.longread.cram

for k in shortread longread; do
  for i in 02 20; do
    frac=0.$i
    a=$(echo "1000*$frac/1" | bc)
    echo "[$(date +%T)] subsample ${k} -> ${a}x"
    samtools view -T "$REF" "1000x.${k}.cram" -s "50.$i" -o "${a}x.${k}.cram"
  done
done

echo "[$(date +%T)] index crams + make bams"
for i in *.cram; do
  samtools index -@3 "$i"
  base=$(basename "$i" .cram)
  samtools view -T "$REF" -@3 "$i" -o "$base.tmp.bam"
  samtools calmd -@3 "$base.tmp.bam" "$REF" --output-fmt BAM 2>/dev/null > "$base.bam"
  samtools index -@3 "$base.bam"
  rm -f "$base.tmp.bam"
done
rm -f 1000x.1.fq 1000x.2.fq 1000x_0001.fastq
echo "[$(date +%T)] DONE alignment generation"
ls -la *.bam *.cram

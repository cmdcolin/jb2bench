#!/usr/bin/env bash
# Genome-wide: HG00133 hap1's whole release 2 assembly against GRCh38's 24
# chromosomes (the graph's GRCh38 walks are chr1-22, X and Y; chrM added),
# minimap2 asm5, 8 threads, under a 48 GB address-space cap.
set -euo pipefail
cd "$(dirname "$0")/.."
ulimit -v 48000000
mkdir -p mm2_genome
asm=asm_full/HG00133_hap1_hprc_r2_v1.0.1.fa.gz
[ -s ref/grch38_primary.fa ] || {
  samtools faidx ~/data/hg38/hg38.fa chr{1..22} chrX chrY chrM > ref/grch38_primary.fa.part
  mv ref/grch38_primary.fa.part ref/grch38_primary.fa
  samtools faidx ref/grch38_primary.fa
}
out=mm2_genome/HG00133.1.asm5.paf
echo "$(date -Is) start"
/usr/bin/time -f "%e s wall, %U s user, %M KB max RSS" nice -n 10 minimap2 -t 8 -cx asm5 --cs --eqx ref/grch38_primary.fa "$asm" > "$out.part" 2> mm2_genome/HG00133.1.asm5.log
mv "$out.part" "$out"
echo "$(date -Is) done: $(tail -1 mm2_genome/HG00133.1.asm5.log), $(wc -l < "$out") rows"
grep "^HG00133#1#" ~/hprc_multiway/build/hprc_multiway_gfa.paf > pif/HG00133.1.genome.paf
echo "PIF rows genome-wide: $(wc -l < pif/HG00133.1.genome.paf)"
python3 -I scripts/compare_segments.py --pif pif/HG00133.1.genome.paf --mm2 "$out" --sizes ref/grch38_primary.fa.fai --out out/HG00133.1.genome.asm5 | tee out/HG00133.1.genome.asm5.total.txt
echo "$(date -Is) compared"

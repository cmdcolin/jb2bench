#!/bin/bash
# Download the gene review portal's inputs for scripts/portals/gene.ts --local.
#
#   scripts/portals/fetch-tiberius.sh <dir> <colo829 dir>
#
# hg38 and its alias table are linked from the directory fetch-colo829.sh fills. GENCODE v49 is cut to chr22:
# gene-review-portal reads a local GFF into one string, and the whole-genome file passes Node's string limit.
set -euo pipefail
dir=$1
colo=$2
mkdir -p "$dir"
cd "$dir"
D=https://jbrowse.org/demos/tiberius_review
G=https://jbrowse.org/ucsc/hg38/gencode.v49.annotation.sorted.gff3.gz
for u in https://jbrowse.org/genomes/GRCh38/tiberius_grch38.gff.gz{,.tbi} $D/{HBR_brain,UHR_reference}_rnaseq_chr22.bam{,.bai}; do
  [ -s "$(basename "$u")" ] || curl -fSLO "$u"
done
if [ ! -s gencode.v49.chr22.gff3.gz.tbi ]; then
  (curl -fsSL $G | zcat | sed -n '/^#/p;/^[^#]/q'; tabix $G chr22) | bgzip > gencode.v49.chr22.gff3.gz
  tabix -p gff gencode.v49.chr22.gff3.gz
fi
for f in hg38.prefix.fa.gz{,.fai,.gzi} hg38_aliases.txt; do
  ln -sf "$colo/$f" "$f"
done

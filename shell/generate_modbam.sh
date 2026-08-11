#!/bin/bash
# Derive modBAM fixtures from the existing long-read alignments.
#
# Long-read only on purpose: 5mC calling is an ONT/PacBio workflow, and the
# modification render path is worth measuring on the read lengths it actually
# meets. Deriving rather than re-simulating also means the mod fixtures sit on
# the same reads as the plain ones, so a mod-vs-plain comparison differs by the
# tags and nothing else.
#
# 1000x is deliberately not generated: the plain file is already 268 MB and the
# tags grow a long read by roughly a quarter, for a case the 200x file already
# exercises at 335 reads in the benchmark window.
set -euo pipefail
cd "$(dirname "$0")/../data"
REF=hg19mod.fa

for cov in 20x 200x; do
  src="${cov}.longread.bam"
  out="${cov}.longread.mod.bam"
  if [ ! -f "$src" ]; then
    echo "missing $src — run generate_alignments.sh first" >&2
    exit 1
  fi
  echo "[$(date +%T)] $src -> $out"
  samtools view -h "$src" |
    node ../shell/add_modifications.js |
    samtools view -b -o "$out" -
  samtools index "$out"
done

echo "[$(date +%T)] done"
ls -la ./*.longread.mod.bam

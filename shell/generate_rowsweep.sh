#!/bin/bash
# Build the row-sweep corpus: the same 19 kb window and the same variants at
# every size, with only the number of sample columns changing.
#
# This is the fixture behind `scripts/render/rowsweep.ts`, which asks whether
# row count is paid once at upload or again at every frame. For that question
# the variants must be held fixed and only the rows may vary — otherwise a
# slowdown at 2504 rows could be the extra variants rather than the extra rows.
# generate_variants.js already emits a deterministic callset over
# chr22_mask:124000-143000 for a given sample count, which is exactly that
# control, so this script only sweeps its first argument.
#
# Unlike the parser corpus (generate_variants.sh) these are bgzipped and tabix
# indexed: the browser reads them over HTTP range requests like any other track,
# and a plain VCF has no index to range into.
#
# Sample counts stop at 2504, the size of the 1000 Genomes phase 3 panel, since
# that is the scale the paper's row-axis claim is made at.
set -e
cd "$(dirname "$0")/.."
GEN=shell/generate_variants.js
OUT=data/rowsweep

mkdir -p "$OUT"

for n in 100 250 500 1000 2000 2504; do
  vcf="$OUT/rowsweep.$n.vcf"
  node "$GEN" "$n" gtonly "$vcf"
  bgzip -f "$vcf"
  tabix -f -p vcf "$vcf.gz"
  printf '%-28s %s\n' "$(basename "$vcf.gz")" "$(du -h "$vcf.gz" | cut -f1)"
done

echo
echo "Wire into a served build with: node shell/load_rowsweep.js builds/<name>"

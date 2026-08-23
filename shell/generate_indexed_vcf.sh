#!/bin/bash
# A bgzipped, tabix-indexed VCF for the browser benchmarks.
#
# Separate from the parser corpus on purpose, and the two must not be merged.
# `generate_variants.sh` emits plain uncompressed VCF because the @gmod/vcf
# benchmark measures the line scan, and wrapping those bytes in BGZF would fold
# @gmod/bgzf-filehandle's decompression into a number meant to be about the VCF
# parser. A browser wants the opposite: no genome browser loads an unindexed VCF
# over HTTP range requests, so a capability check against a plain file would
# report "cannot open VCF" about the fixture rather than about the tool.
#
# So this derives an indexed copy and leaves the originals alone. It is the
# tool x format matrix's variant row, nothing else reads it.
set -e
cd "$(dirname "$0")/.."

SRC=data/variants.1000.wide.vcf
OUT=data/variants.browser.vcf.gz

for t in bgzip tabix; do
  command -v "$t" >/dev/null || { echo "$t not found (htslib)" >&2; exit 1; }
done
[ -f "$SRC" ] || { echo "$SRC missing — run shell/generate_variants.sh" >&2; exit 1; }

# Sorted by position before indexing: tabix rejects an out-of-order file, and
# the generator emits ascending positions per contig but makes no promise of it.
# The header has to survive the sort, hence the split.
grep '^#' "$SRC" > /tmp/vcfhdr.$$
grep -v '^#' "$SRC" | sort -k1,1 -k2,2n > /tmp/vcfbody.$$
cat /tmp/vcfhdr.$$ /tmp/vcfbody.$$ | bgzip -c > "$OUT"
rm -f /tmp/vcfhdr.$$ /tmp/vcfbody.$$
tabix -p vcf -f "$OUT"

echo "wrote $OUT ($(grep -vc '^#' "$SRC") records) and $OUT.tbi"
ls -la "$OUT" "$OUT.tbi"

#!/bin/bash
# Regenerate the multi-sample VCF corpus for the ecosystem benchmarks.
#
# Unlike generate_alignments.sh this needs no external tools — the records are
# emitted by generate_variants.js from a seeded RNG, so every machine gets
# byte-identical files. Runs in a second or two.
#
# The files are plain, uncompressed VCF on purpose. This corpus feeds the VCF
# *parser* benchmark, and that benchmark measures the line scan; wrapping it in
# BGZF would fold @gmod/bgzf-filehandle's decompression into a number that is
# meant to be about @gmod/vcf. (The decompression is separately measured by
# bgzf.bench.ts, and is not the expensive half: TextDecoder runs at ~3.9 GB/s
# here, roughly 6% of what the genotype scan costs on the same bytes.)
set -e
cd "$(dirname "$0")/.."
GEN=shell/generate_variants.js

for n in 100 1000 3000; do
  for shape in gtonly wide; do
    node "$GEN" "$n" "$shape" "data/variants.$n.$shape.vcf"
  done
done

echo
ls -la data/variants.*.vcf

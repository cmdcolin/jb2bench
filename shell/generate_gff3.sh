#!/bin/bash
# Regenerate the GFF3 corpus for the ecosystem benchmarks.
#
# Like generate_variants.sh this needs no external tools — the records come from
# generate_gff3.js and a seeded RNG, so every machine gets byte-identical files.
# Runs in a second or two.
#
# Plain, uncompressed GFF3 on purpose, for the same reason the VCF corpus is:
# this feeds the GFF3 *parser* benchmark, and folding BGZF decompression into it
# would make the number partly about @gmod/bgzf-filehandle, which bgzf.bench.ts
# already measures on its own.
set -e
cd "$(dirname "$0")/.."
GEN=shell/generate_gff3.js

for n in 200 1000 5000; do
  for shape in sparse rich; do
    node "$GEN" "$n" "$shape" "data/features.$n.$shape.gff3"
  done
done

echo
ls -la data/features.*.gff3

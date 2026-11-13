#!/usr/bin/env bash
# Fetch the eight haplotypes' contigs that the PIF aligns in the window.
set -euo pipefail
cd "$(dirname "$0")/.."
ulimit -v 8000000
for name in "$@"; do
  python3 -I scripts/fetch_contig.py "$name" ~/hprc_multiway/build/asm_index.csv asm
done
for f in asm/*.fa; do [ -f "$f.fai" ] || samtools faidx "$f"; done
cut -f1,2 asm/*.fai

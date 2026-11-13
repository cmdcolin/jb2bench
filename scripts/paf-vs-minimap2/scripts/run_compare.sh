#!/usr/bin/env bash
# compare.py for every haplotype and preset; gathers summary.csv and runs_1kb.tsv.
set -euo pipefail
cd "$(dirname "$0")/.."
ulimit -v 8000000
mkdir -p out
W=chr1:196640000-196900000
for preset in "$@"; do
  for p in pif/HG?????.1.paf; do
    hap=$(basename "$p" .paf)
    contig=$(cut -f1 "$p" | head -1 | tr '#' .)
    mm2="mm2/$contig.$preset.paf"
    [ -s "$mm2" ] || { echo "missing $mm2"; continue; }
    python3 -I scripts/compare.py --hap "${hap/./#}" --pif "$p" --mm2 "$mm2" --ref ref/chr1.fa --qfa "asm/$contig.fa" --window $W --out "out/$hap.$preset"
  done
done
{ head -1 "$(ls out/*.summary.tsv | head -1)"; for f in out/*.summary.tsv; do tail -1 "$f"; done; } | tr '\t' , > out/summary.csv
{ head -1 "$(ls out/*.runs.tsv | head -1)"; for f in out/*.runs.tsv; do awk -F'\t' 'NR>1 && $6>=1000 && $3!="exact"' "$f"; done; } > out/runs_1kb.tsv

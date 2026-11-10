#!/usr/bin/env bash
# hosted-windows.sh: the HPRC v2.1 graph track on the hosted demo, from a cold
# cache, ROUNDS times over the Figure 5 window, 1 Mb of chr17, the MHC class II
# region and the whole MHC; medians follow the runs.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROUNDS=${ROUNDS:-5}
out=results/graph-track/hosted-windows-$(hostname -s)-$(date -u +%Y-%m-%d).jsonl
mkdir -p results/graph-track
: >"$out"
for _ in $(seq "$ROUNDS"); do
  for w in "chr1 196640000 196900000" "chr17 0 1000000" "chr6 32400000 32800000" "chr6 29600000 33400000"; do
    read -r ref start end <<<"$w"
    SETTLE_MS=1000 node scripts/gbz/graph-trace.mjs hprc_minigraph_segments "$ref" "$start" "$end" >>"$out"
  done
done
python3 -I scripts/gbz/trace-medians.py "$out"

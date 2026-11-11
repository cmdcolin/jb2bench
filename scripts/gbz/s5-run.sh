#!/bin/bash
# Supplementary Table S5: eight HPRC haplotypes as rows at the CFHR3-CFHR1
# locus, read from GBZ-base or from the PIF, at four windows centred on the
# Figure 5 view (chr1:196,640,000-196,900,000), RUNS cold runs each, the
# routes interleaved. The walk-file route is the Discussion's third route. Appends one JSON line per run to OUT.
#
#   RUNS=3 OUT=results/graph-track/s5.jsonl scripts/gbz/s5-run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
RUNS=${RUNS:-3}
OUT=${OUT:-results/graph-track/s5-$(date +%Y-%m-%d).jsonl}
mkdir -p "$(dirname "$OUT")"
export JB2_BUILD=${JB2_BUILD:-https://jbrowse.org/code/jb2/v5.0.0-beta.21/}
WINDOWS=(
  chr1:196765001-196775000
  chr1:196640000-196900000
  chr1:196270001-197270000
  chr1:195270001-198270000
)
trace() {
  for attempt in 1 2 3; do
    if line=$(node scripts/gbz/lanes-trace.mjs "$@"); then
      echo "$line" >>"$OUT"
      return
    fi
    echo "retry $attempt: $*" >&2
    sleep 10
  done
  return 1
}
for _ in $(seq "$RUNS"); do
  for loc in "${WINDOWS[@]}"; do
    trace hprc_v2_1_gbz_lanes "$loc" scripts/gbz/gbz-lanes-track.json
    trace hprc_v2_1_pif_lanes "$loc"
    trace hprc_v2_1_walk_lanes "$loc"
  done
done
echo "wrote $OUT"

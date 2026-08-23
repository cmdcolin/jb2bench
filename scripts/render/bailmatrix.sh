#!/bin/bash
# bailcheck across every track and every build, which is the form the question
# actually takes: "is the format axis measurable at all on this staged set of
# builds". One port at a time answers it for one build, and the refusal is
# per (build, track) — CRAM and BAM estimate their window differently, so a
# limit that spares one can catch the other.
cd "$(dirname "$0")/../.."
TRACKS=""
for read in shortread longread; do
  for cov in 20x 200x 1000x; do
    for fmt in bam cram; do
      TRACKS="$TRACKS $cov.$read.$fmt"
    done
  done
done
for port in 8000 8001 8002 8004; do
  echo "=== port $port ==="
  PORT=$port node --experimental-strip-types scripts/render/bailcheck.ts $TRACKS
done

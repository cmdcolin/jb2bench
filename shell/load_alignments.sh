#!/bin/bash
# Load hg19mod assembly + alignment tracks into every build in builds/.
# Track ids match the <cov>.<readtype>.<fmt> naming the profiler URLs use.
set -e
cd "$(dirname "$0")/.."
REF=hg19mod.fa

for l in builds/*; do
  echo "=== $l ==="
  jbrowse add-assembly --load copy "$REF" --out "$l" --force --name hg19mod
  for k in shortread longread; do
    for cov in 20x 200x 1000x; do
      for fmt in bam cram; do
        track="$cov.$k.$fmt"
        if [ -f "$track" ]; then
          jbrowse add-track "$track" --load symlink --out "$l" --trackId "$track" --force -a hg19mod >/dev/null
        fi
      done
    done
  done
  echo "  tracks loaded"
done
echo "DONE loading alignments"

#!/usr/bin/env bash
# Load the BGZF pool benchmark's tracks into every build in builds/: the
# indexed VCF sweep, plus a `.nopool` twin of every bgzip-backed track.
#
# Run after load_alignments.sh, which puts the assembly and the BAM tracks in.
# Track ids stay the bare filename, because the harness addresses tracks as
# ?tracks=variants.1000.wide.vcf.gz and the symlink lands under that name too.
set -euo pipefail
cd "$(dirname "$0")/.."

for l in builds/*; do
  echo "=== $l ==="
  for n in 100 1000 3000; do
    for shape in gtonly wide; do
      track="variants.pool.$n.$shape.vcf.gz"
      if [ -f "data/$track" ]; then
        jbrowse add-track "data/$track" --load symlink --out "$l" \
          --trackId "$track" --force -a hg19mod >/dev/null
      else
        echo "  data/$track missing — run shell/generate_bgzf_vcf.sh"
      fi
    done
  done
  node shell/patch_nopool.js "$l"
done
echo "DONE loading bgzf pool tracks"

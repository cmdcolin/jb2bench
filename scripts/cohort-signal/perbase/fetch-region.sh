#!/usr/bin/env bash
# Cut REGION out of each ENCODE BigWig in samples.tsv and write it back as a
# BigWig of its own, so the per-sample arm, the store and the bedGraph are all
# built from the same values and served from the same host. The cut files have
# one chromosome and zoom levels built over the region only, which makes each
# header and index smaller than the full file's: the BigWig arm is flattered,
# not penalised.
#
#   scripts/cohort-signal/perbase/fetch-region.sh   [JOBS=8]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$here/../../../data/perbase-atac
export out REGION=chr1:10000000-20000000
mkdir -p "$out/bw" "$out/bg"
printf 'chr1\t248956422\n' > "$out/chrom.sizes"

cut_one() {
  local name=$1 url=$2 chrom=${REGION%%:*} span=${REGION#*:}
  [ -s "$out/bw/$name.bw" ] && return 0
  bigWigToBedGraph -chrom="$chrom" -start="${span%-*}" -end="${span#*-}" "$url" "$out/bg/$name.bg"
  bedGraphToBigWig "$out/bg/$name.bg" "$out/chrom.sizes" "$out/bw/$name.bw"
  echo "$name $(wc -l < "$out/bg/$name.bg") intervals"
}
export -f cut_one

grep -v '^#' "$here/samples.tsv" | cut -f1,3 | xargs -P "${JOBS:-8}" -L1 bash -c 'cut_one "$0" "$1"'

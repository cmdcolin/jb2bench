#!/usr/bin/env bash
# Align each fetched contig to GRCh38 chr1 with minimap2 asm5 and asm20: 16
# jobs, 6 at a time, niced, each under a 16 GB address-space cap. One contig is
# one query sequence, which minimap2 aligns on one thread, so parallelism comes
# from the jobs, not -t.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p mm2
minimap2 --version > mm2/minimap2.version
one() {
  fa=$1 preset=$2
  base=$(basename "$fa" .fa)
  out="mm2/$base.$preset.paf"
  [ -s "$out" ] && exit 0
  ulimit -v 16000000
  echo "$(date -Is) start $base $preset"
  /usr/bin/time -f "%e s wall, %U s user, %M KB max RSS" nice -n 10 minimap2 -t 2 -cx "$preset" --cs --eqx ref/chr1.fa "$fa" > "$out.part" 2> "mm2/$base.$preset.log"
  mv "$out.part" "$out"
  echo "$(date -Is) done  $base $preset: $(tail -1 "mm2/$base.$preset.log"), $(wc -l < "$out") rows"
}
export -f one
for preset in asm5 asm20; do for fa in asm/*.fa; do echo "$fa $preset"; done; done \
  | xargs -P 6 -n 2 bash -c 'one "$@"' _
echo "$(date -Is) all done"

#!/bin/bash
# Serve the files `make webgpu-lite` needs (SCALE as there) over HTTP on the local network,
# so another laptop can fetch them with DATA_URL. Only those files are served,
# out of a scratch directory of links, not the whole of data/. Ctrl-C to stop.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8099}
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

SCALE=${SCALE:-100kb}
case "$SCALE" in
  100kb-wide) PREFIX=2mb. COVS="20x 100x" FILES="chr22_2mb.fa chr22_2mb.fa.fai" ;;
  100kb) PREFIX= COVS="20x 200x 1000x" FILES="hg19mod.fa hg19mod.fa.fai" ;;
  *) echo "SCALE must be 100kb or 100kb-wide, not $SCALE" >&2; exit 1 ;;
esac
for k in shortread longread; do
  for cov in $COVS; do
    FILES="$FILES $PREFIX$cov.$k.bam $PREFIX$cov.$k.bam.bai"
  done
done
N=0
for f in $FILES; do
  [ -f "data/$f" ] || { echo "data/$f missing; nothing to share" >&2; exit 1; }
  ln -s "$(readlink -f "data/$f")" "$DIR/$f"
  N=$((N + 1))
done

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
IP=${IP:-$(ipconfig getifaddr en0 2>/dev/null || echo '<this machine IP>')}
echo "on each laptop, in its jb2bench clone:"
echo
echo "  DATA_URL=http://$IP:$PORT SCALE=$SCALE make webgpu-lite"
echo
echo "serving $N files on port $PORT; Ctrl-C when every laptop has them"
python3 -m http.server "$PORT" --directory "$DIR"

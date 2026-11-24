#!/bin/bash
# Serve the eight files `make webgpu-lite` needs over HTTP on the local network,
# so another laptop can fetch them with DATA_URL. Only those files are served,
# out of a scratch directory of links, not the whole of data/. Ctrl-C to stop.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8099}
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

for k in shortread longread; do
  for cov in 20x 100x; do
    for f in "2mb.$cov.$k.bam" "2mb.$cov.$k.bam.bai"; do
      [ -f "data/$f" ] || { echo "data/$f missing; nothing to share" >&2; exit 1; }
      ln -s "$PWD/data/$f" "$DIR/$f"
    done
  done
done

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
IP=${IP:-$(ipconfig getifaddr en0 2>/dev/null || echo '<this machine IP>')}
echo "on each laptop, in its jb2bench clone:"
echo
echo "  DATA_URL=http://$IP:$PORT make webgpu-lite"
echo
echo "serving 8 files on port $PORT; Ctrl-C when every laptop has them"
python3 -m http.server "$PORT" --directory "$DIR"

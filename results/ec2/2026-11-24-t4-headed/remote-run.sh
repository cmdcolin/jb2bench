#!/bin/bash
set -uo pipefail
cd /home/cdiesh/src/jb2bench
PATH="$PWD/node_modules/.bin:$PATH" ./shell/load_alignments.sh builds/release-5.0.0-beta.21 >/dev/null 2>&1 || echo "load_alignments failed"
OUT=results/t4-headed; mkdir -p $OUT
nvidia-smi -L > $OUT/machine.txt; lscpu | sed -n 's/^Model name: *//p' >> $OUT/machine.txt
node_modules/.bin/http-server builds/release-5.0.0-beta.21 -p 8090 -s --cors > $OUT/server.log 2>&1 &
sleep 3
pgrep Xvfb >/dev/null || (Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &); sleep 2
echo "== A headless gl-egl $(date -u +%T)"
CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle' SCALE=100kb-wide node --experimental-strip-types scripts/render/backends.ts \
  --port=8090 --runs=5 --rungs=webgl,canvas2d --out=$OUT/A-headless-glegl 2>&1 | tail -40
echo "== B headed vulkan $(date -u +%T)"
DISPLAY=:99 HEADLESS=0 CHROME_ANGLE='--use-angle=vulkan --use-vulkan=native' SCALE=100kb-wide node --experimental-strip-types scripts/render/backends.ts \
  --port=8090 --runs=5 --rungs=default,webgl,canvas2d --out=$OUT/B-headed-vulkan 2>&1 | tail -40
echo "== done $(date -u +%T)"

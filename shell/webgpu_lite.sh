#!/bin/bash
# WebGPU against WebGL 2 and Canvas 2D on one laptop, one window, one build:
# the 100 kb window of the chr22_2mb corpus, 20x and 100x short and long BAM,
# v5.0.0-beta.21 by default, headed Firefox Nightly, one warm-up and five runs
# per cell. 72 page loads, about 10-15 minutes. Firefox windows take over the
# display the whole time.
#
# Built to be run on a laptop that has only a clone of this repo. The 2mb.* BAMs
# are not in git, so first run `make webgpu-lite-share` on a machine that has
# them, then on the laptop:
#
#   DATA_URL=http://<that machine's IP>:8099 make webgpu-lite
#
# It stages the build if builds/ lacks it (needs `gh auth login`), downloads the
# BAMs from DATA_URL if data/ lacks them, serves the build on its own
# port, runs, and writes results/webgpu-lite/<hostname>/ with the GPU listing
# beside the timings. Copy the BAMs rather than regenerate them: wgsim and pbsim
# seed from the clock, so a regenerated corpus is different reads.
#
# Knobs: TAG (release tag), FIREFOX (Nightly binary), PORT, RUNS, DATA_URL.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=${TAG:-v5.0.0-beta.21}
BUILD="release-${TAG#v}"
PORT=${PORT:-8090}
RUNS=${RUNS:-5}
HOST=$(hostname -s)
OUT="results/webgpu-lite/$HOST"

case "$(uname)" in
  Darwin) DEFAULT_FF="/Applications/Firefox Nightly.app/Contents/MacOS/firefox" ;;
  *) DEFAULT_FF=/usr/bin/firefox-nightly ;;
esac
FIREFOX=${FIREFOX:-$DEFAULT_FF}

[ -x "$FIREFOX" ] || {
  echo "no Firefox Nightly at $FIREFOX; install it or set FIREFOX=/path/to/firefox" >&2
  exit 1
}

[ -d node_modules ] || pnpm install

BAMS=()
for k in shortread longread; do
  for cov in 20x 100x; do
    BAMS+=("2mb.$cov.$k.bam" "2mb.$cov.$k.bam.bai")
  done
done
missing=()
for f in "${BAMS[@]}"; do
  [ -f "data/$f" ] || missing+=("$f")
done
if [ ${#missing[@]} -gt 0 ]; then
  [ -n "${DATA_URL:-}" ] || {
    echo "data/ lacks ${missing[*]}" >&2
    echo "run 'make webgpu-lite-share' where they exist, then set DATA_URL=http://<its IP>:8099" >&2
    exit 1
  }
  for f in "${missing[@]}"; do
    curl -f --progress-bar -o "data/$f.part" "$DATA_URL/$f"
    mv "data/$f.part" "data/$f"
  done
fi

mkdir -p builds
if [ -d "builds/$BUILD" ]; then
  PATH="$PWD/node_modules/.bin:$PATH" ./shell/load_alignments.sh "builds/$BUILD"
else
  shell/stage_release.sh "$TAG"
fi

mkdir -p "$OUT"
node_modules/.bin/http-server "builds/$BUILD" -p "$PORT" -s --cors >"$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 30); do
  curl -sf "http://localhost:$PORT/index.html" >/dev/null && break
  sleep 1
done

{
  echo "host: $HOST"
  echo "date: $(date -u +%FT%TZ)"
  echo "build: $BUILD"
  echo "firefox: $("$FIREFOX" --version 2>/dev/null | head -1)"
  echo "os: $(uname -srm)"
  echo "cpu: $(lscpu 2>/dev/null | sed -n 's/^Model name: *//p'; sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  echo "gpus:"
  (lspci 2>/dev/null | grep -Ei 'vga|3d|display' || system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Chipset|Vendor') | sed 's/^/  /'
} > "$OUT/machine.txt"
cat "$OUT/machine.txt"

SCALE=100kb-wide node --experimental-strip-types scripts/render/backends.ts \
  --browser=firefox --firefox="$FIREFOX" --port="$PORT" --runs="$RUNS" \
  --wait-for-load=4 --out="$OUT" 2>&1 | tee "$OUT/run.log"

echo
echo "done: $OUT"
echo "Firefox hides the adapter, so with two GPUs watch which one is busy"
echo "during a run (intel_gpu_top, radeontop, nvidia-smi) and note it in"
echo "$OUT/machine.txt. Then commit $OUT on a branch and push it."

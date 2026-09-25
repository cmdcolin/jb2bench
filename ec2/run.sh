#!/bin/bash
# The full paper matrix on the instance, one phase at a time, with the results
# pulled back after each one.
#
# Phases run as `make` targets rather than as spelled-out env, so the numbers
# come off the instance the same way they come off the workstation. That is the
# point of measuring here at all: a rebench that also changed how the run is
# invoked would not be a rebench.
#
#   ec2/run.sh                     every phase in PHASES below
#   ec2/run.sh crosstool-zoom      only the named targets
#
# EC2_BUILD names the builds/ entry served on port 8000 as the build under test,
# and provision.sh copies the same one. Name a tagged release -- stage it with
# `make stage-release TAG=<tag>` first -- because `current` records nothing
# about which commit it was built from and Methods has to name a version.
#
# Before this: ec2/up.sh, then EC2_CORPUS=full ec2/provision.sh. The spike
# corpus does not carry the long-read, CRAM or 1 Mb files half of these phases
# read, and a phase that cannot find its corpus fails the gate rather than
# quietly measuring the cells it does have.
#
# The instance powers itself off MAX_MINUTES after launch whatever is running,
# so set EC2_MAX_MINUTES before ec2/up.sh for a run this long. The 2026-09-24
# spike put the cold-load phases in the hours rather than the minutes, and a
# power-off mid-phase loses that phase; it does not lose the ones already
# pulled back, which is why each one rsyncs on its own.
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

# Cold load first: it is the longest phase and the one the manuscript's main
# figure reads, so a run that gets cut short should have it in hand. Parsers and
# cram-samtools are node-only, cost minutes, and go last for the same reason.
PHASES=${PHASES:-"crosstool-cold-paper crosstool-zoom crosstool-pan render render-1mb interaction parsers cram-samtools"}
[ $# -gt 0 ] && PHASES="$*"

STAMP=$(date +%Y-%m-%d-%H%M)
OUT=$CODE/results/ec2/$STAMP
mkdir -p "$OUT"
echo "build under test: ${EC2_BUILD:-current}"
echo "phases: $PHASES"
echo "results: $OUT"

# Servers stay up across every phase, and the build under test is whatever
# EC2_BUILD named. `make serve` reads BUILD for exactly this.
remote "bash -s" <<EOF 2>&1 | tee "$OUT/serve.log"
set -euo pipefail
cd $REMOTE_ROOT
export CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle'
nvidia-smi -L
node --experimental-strip-types ec2/gpuprobe.ts | tee results-gpu.jsonl
if ! grep '"set":"configured"' results-gpu.jsonl | grep -q '"hardware":true'; then
  echo "RUN STOP: CHROME_ANGLE does not reach a hardware WebGL2 -- every GPU timing would be software"
  exit 1
fi
pkill -f http-server || true
make serve BUILD=${EC2_BUILD:-current}
EOF

for phase in $PHASES; do
  echo "=== $phase ==="
  # `|| true` so one failed phase does not abandon the ones after it; the log
  # and the gate output say which cells are missing, and a phase is cheaper to
  # repeat on its own than the whole matrix is.
  remote "bash -s" <<EOF 2>&1 | tee "$OUT/$phase.log" || true
set -uo pipefail
cd $REMOTE_ROOT
export CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle'
make $phase
uptime
EOF
  rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results/" "$OUT/"
  echo "--- $phase pulled back into $OUT"
done

rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results-gpu.jsonl" "$OUT/gpu.jsonl" || true
echo
echo "results in $OUT"
echo "next: copy into results/ and run make paper-data && make paper-figs, then"
echo "      resync the paper's bench/ from this checkout (make resync-bench there)"

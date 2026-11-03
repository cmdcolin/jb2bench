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
# so set EC2_MAX_MINUTES before ec2/up.sh for a run this long: the default
# PHASES take about 20 hours. A power-off mid-phase loses what was not yet
# pulled back, which is why results sync every SYNC_SECONDS.
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

# The two phases the manuscript's figures read: cold load (with memory) and
# zoom. Cold load first, since it is the longest and the main figure. The
# others -- crosstool-pan render render-1mb interaction parsers cram-samtools --
# are named on the command line when wanted; parsers needs ecosystem/.libs
# node_modules, which provision.sh does not copy.
PHASES=${PHASES:-"crosstool-cold-paper crosstool-zoom"}
[ $# -gt 0 ] && PHASES="$*"

STAMP=$(date +%Y-%m-%d-%H%M)
OUT=$CODE/results/ec2/$STAMP
mkdir -p "$OUT"
echo "build under test: ${EC2_BUILD:-current}"
echo "phases: $PHASES"
echo "results: $OUT"

# `[e]` so the pattern does not match the remote shell running the pgrep.
DRIVER="pgrep -f '[e]c2/phases.sh' >/dev/null"

# Servers stay up across every phase, and the build under test is whatever
# EC2_BUILD named. Skipped when reattaching, since it restarts the servers.
if remote "$DRIVER"; then
  echo "a phase driver is already running on the instance; attaching"
else
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
make crosstool-bundles
# nohup and no shared stdout, as in spike.sh: a server holding the ssh
# channel's stdout keeps this session open forever, which \`make serve\`'s
# plain \`&\` does.
for pb in 8000:${EC2_BUILD:-current} 8001:release-4.3.0 8004:release-2.4.0; do
  nohup npx http-server builds/\${pb#*:} -p \${pb%%:*} -s --cors >/dev/null 2>&1 &
done
nohup npx http-server crosstool -p 8003 -s --cors >/dev/null 2>&1 &
sleep 5
node --experimental-strip-types scripts/gate.ts --warn
EOF
remote "cd $REMOTE_ROOT && setsid nohup ec2/phases.sh $PHASES >results/ec2-run.log 2>&1 </dev/null &"
fi

# The phases run detached on the instance (ec2/phases.sh), and this loop only
# pulls results back every SYNC_SECONDS until the instance says it is done. A
# dropped connection costs nothing: rerun `make ec2-run` with the same PHASES and
# it reattaches to a running driver, or restarts one that skips finished phases.
SYNC_SECONDS=${SYNC_SECONDS:-600}
until remote "test -f $REMOTE_ROOT/results/.ec2/finished && ! $DRIVER"; do
  sleep "$SYNC_SECONDS"
  rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results/" "$OUT/" || true
  remote "tail -n 3 $REMOTE_ROOT/results/ec2-run.log; uptime" || true
done
rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results/" "$OUT/"
cat "$OUT/ec2-run.log"

rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results-gpu.jsonl" "$OUT/gpu.jsonl" || true
echo
echo "results in $OUT"
echo "next: copy into results/ and run make paper-data && make paper-figs, then"
echo "      resync the paper's bench/ from this checkout (make resync-bench there)"

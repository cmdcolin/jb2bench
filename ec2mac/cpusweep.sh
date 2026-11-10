#!/bin/bash
# shellcheck disable=SC2034
# The panel cells on the Linux GPU instance with Chrome confined to 2, 4 and 8
# CPUs (taskset, inherited by every Chrome process), WebGL2 only. Reads
# ec2/config.sh and ec2/.state but writes nothing under ec2/; results land in
# results/ec2mac/g4dn-cpusweep-<stamp>/.
#
# Before this: make ec2-up and make ec2-provision (the instance must carry
# builds/$EC2MAC_BUILD). Refuses while an ec2/phases.sh run is going there.
#
#   DRY_RUN=1 ec2mac/cpusweep.sh   print the plan and stop
set -euo pipefail
. "$(dirname "$0")/../ec2/config.sh"
MAC_HERE=$CODE/ec2mac
BUILD=${EC2MAC_BUILD:-release-5.0.0-beta.21}
SWEEP_CPUS=${SWEEP_CPUS:-2,4,8}
DRIVE_ENV=$(printf '%q ' "CHROME_ANGLE=--use-angle=gl-egl --use-gl=angle" "EXPECT_BUILD=$BUILD" \
  "BACKENDS=webgl" "CPUS=$SWEEP_CPUS" "CELLS=${CELLS:-cold-20x,cold-1000x,zoom-200x}" \
  "RUNS=${RUNS:-5}" "WARMUP=${WARMUP:-1}")

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY RUN: would read ec2/.state, refuse if ec2/phases.sh runs on the instance,"
  echo "  rsync the code (no --delete) to ubuntu@<ip>:$REMOTE_ROOT, serve builds/$BUILD on :8000,"
  echo "  and start ec2mac/drive.sh with: $DRIVE_ENV"
  exit 0
fi
load_state
REMOTE_USER=ubuntu
REMOTE_ENV=
RSYNC=(rsync -az -e "ssh ${SSH_OPTS[*]}")
. "$MAC_HERE/sync.sh"

if remote "pgrep -f '[e]c2/phases.sh' >/dev/null"; then
  echo "an ec2/phases.sh run is going on $IP; the CPU sweep waits for it" >&2
  exit 1
fi
remote "test -d $REMOTE_ROOT/builds/$BUILD" || { echo "builds/$BUILD missing on $IP: EC2_BUILD=$BUILD make ec2-provision" >&2; exit 1; }

if ! remote "$DRIVER"; then
  "${RSYNC[@]}" --exclude .git --exclude /.claude --exclude node_modules --exclude /data \
    --exclude /builds --exclude /results --exclude /flame --exclude /screenshots \
    --exclude /crosstool --exclude /ec2/ --exclude '/ec2mac/.state-*' \
    "$CODE/" "ubuntu@$IP:$REMOTE_ROOT/"
  remote "cd $REMOTE_ROOT || exit 1
    pkill -f 'http-server builds/' || true
    nohup npx http-server builds/$BUILD -p 8000 -s --cors >/dev/null 2>&1 </dev/null &
    sleep 5
    nproc; curl -fsS -o /dev/null localhost:8000/config.json && echo serving $BUILD"
fi
start_or_attach g4dn-cpusweep
sync_until_finished

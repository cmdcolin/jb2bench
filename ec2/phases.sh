#!/bin/bash
# Runs ON the instance, detached by ec2/run.sh, so a dropped ssh session cannot
# kill a phase that takes most of a day. Each phase logs to
# results/logs/ec2-<phase>.log and leaves results/.ec2/<phase>.done with its exit
# status; results/.ec2/finished marks the end of the list.
#
#   setsid nohup ec2/phases.sh crosstool-cold-paper crosstool-zoom &
set -uo pipefail
cd "$(dirname "$0")/.."
export CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle'
mkdir -p results/.ec2 results/logs
rm -f results/.ec2/finished
for phase in "$@"; do
  if [ -f "results/.ec2/$phase.done" ]; then
    echo "=== $phase already done ($(cat "results/.ec2/$phase.done")), skipping"
    continue
  fi
  echo "=== $phase started $(date -Is)"
  # The previous phase's Chrome can hold the load average over the gate's
  # ceiling for a minute, and a failed gate skips the whole phase.
  QUIET_TIMEOUT_MS=900000 make wait-quiet >"results/logs/ec2-$phase-wait.log" 2>&1 \
    || echo "gate still failing after 15 min; running $phase anyway"
  make "$phase" >"results/logs/ec2-$phase.log" 2>&1
  status=$?
  echo "exit $status at $(date -Is)" >"results/.ec2/$phase.done"
  echo "=== $phase exit $status $(date -Is)"
  uptime
done
date -Is >results/.ec2/finished

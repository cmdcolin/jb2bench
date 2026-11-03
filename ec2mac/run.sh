#!/bin/bash
# The hardware panel on the Mac: serve the build under test, probe which adapter
# headless Chrome reaches, run ec2mac/panel.ts detached, and pull results back
# into results/ec2mac/<host>-<stamp>/ until it finishes.
#
#   EC2MAC_CHROME_ANGLE  launch flags for every Chrome (default Metal ANGLE)
#   BACKENDS CELLS RUNS WARMUP   passed through to panel.ts
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state
. "$HERE/sync.sh"

ANGLE=${EC2MAC_CHROME_ANGLE:---use-angle=metal --enable-unsafe-webgpu}
# shellcheck disable=SC2034
DRIVE_ENV=$(printf '%q ' "CHROME_ANGLE=$ANGLE" "EXPECT_BUILD=$BUILD" \
  "BACKENDS=${BACKENDS:-webgpu,webgl,canvas2d}" "CELLS=${CELLS:-cold-20x,cold-1000x,zoom-200x}" \
  "RUNS=${RUNS:-5}" "WARMUP=${WARMUP:-1}")

if ! remote "$DRIVER"; then
  remote "$REMOTE_ENV cd $REMOTE_ROOT || exit 1
    pkill -f 'http-server builds/' || true
    nohup npx http-server builds/$BUILD -p 8000 -s --cors >/dev/null 2>&1 </dev/null &
    sleep 5
    curl -fsS -o /dev/null localhost:8000/config.json && echo serving $BUILD"
fi
start_or_attach "$MACHOST"
sync_until_finished
echo "next: make mac-down HOST=$MACHOST CONFIRM=1 (terminates now; the host release waits for 24 h)"

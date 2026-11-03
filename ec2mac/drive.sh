#!/bin/bash
# Runs ON the benchmark machine, detached by ec2mac/run.sh or ec2mac/cpusweep.sh,
# so a dropped ssh session cannot stop the panel. OUT, LABEL, BACKENDS, CELLS,
# CPUS, EXPECT_BUILD and CHROME_ANGLE arrive in the environment. Leaves
# results/.ec2mac/panel.done with the exit status and results/.ec2mac/finished
# at the end.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
mkdir -p results/.ec2mac "$OUT"
echo "=== gpu probe $(date -Is 2>/dev/null || date)"
if ! node --experimental-strip-types ec2mac/gpuprobe.ts | tee "$OUT/gpu.jsonl"; then
  if [ "${ALLOW_SOFTWARE:-0}" != 1 ]; then
    echo "RUN STOP: CHROME_ANGLE='$CHROME_ANGLE' gives a software WebGL2; every webgl number would be SwiftShader"
    echo "exit 3" >results/.ec2mac/panel.done
    date >results/.ec2mac/finished
    exit 3
  fi
  echo "software WebGL2, continuing because ALLOW_SOFTWARE=1; the panel still refuses those runs"
fi
echo "=== panel $(date)"
node --experimental-strip-types ec2mac/panel.ts
status=$?
echo "exit $status" >results/.ec2mac/panel.done
echo "=== panel exit $status $(date)"
uptime
date >results/.ec2mac/finished

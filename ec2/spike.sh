#!/bin/bash
# A small run on the instance, to decide whether its numbers are worth a full
# matrix: which GPU Chrome reaches, then two cold-load rows and two zoom rows,
# three runs each. Results land in results/ec2/<stamp>/ here.
#
# What to read in them:
#   gpu.jsonl       the harness flag set must report the NVIDIA GPU, not
#                   SwiftShader; otherwise every GPU timing is a software one
#   crosstool.md    per-cell spread across the three runs, and whether the
#                   order of the tools matches the workstation's
#   interaction.md  the zoom row should stay flat across 20x and 200x, as it
#                   does on the workstation
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

STAMP=$(date +%Y-%m-%d-%H%M)
OUT=$CODE/results/ec2/$STAMP
mkdir -p "$OUT"

remote "bash -s" <<EOF | tee "$OUT/spike.log"
set -uo pipefail
cd $REMOTE_ROOT && mkdir -p results
nvidia-smi -L
node --experimental-strip-types ec2/gpuprobe.ts | tee results/gpu.jsonl
if ! grep '"set":"harness"' results/gpu.jsonl | grep -q '"software":false'; then
  echo "SPIKE STOP: the harness flags land on a software renderer"
  exit 1
fi

pkill -f http-server || true
for pb in 8000:current 8001:release-4.3.0 8004:release-2.4.0; do
  nohup npx http-server builds/\${pb#*:} -p \${pb%%:*} -s --cors >/dev/null 2>&1 &
done
nohup npx http-server crosstool -p 8003 -s --cors >/dev/null 2>&1 &
sleep 3

WINDOWS=19kb,100kb CASES=20x-shortread-bam,200x-shortread-bam \
  TOOLS=jbrowse,jbrowse-release-2.4.0,igv,genomespy JBROWSE_PORTS=8000,8004 \
  RUNS=3 WARMUP=1 node --experimental-strip-types scripts/crosstool/runner.ts

MODES=in CASES=20x-shortread-bam,200x-shortread-bam \
  node --experimental-strip-types scripts/render/runner-interaction.ts
uptime
EOF

rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results/" "$OUT/"
echo "results in $OUT"

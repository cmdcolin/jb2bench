#!/bin/bash
# A small run on the instance, to decide whether its numbers are worth a full
# matrix: which GPU Chrome reaches, then two cold-load rows and two zoom rows,
# three runs each. Results land in results/ec2/<stamp>/ here.
#
# What to read in them:
#   gpu.jsonl       the `configured` set (CHROME_ANGLE) must report the
#                   NVIDIA GPU; otherwise every GPU timing is a software one
#   crosstool.md    per-cell spread across the three runs, and whether the
#                   order of the tools matches the workstation's
#   interaction.md  the structural zoom-in instrument, run twice: on the
#                   workstation it has read both 0 ms and ~165 ms for the
#                   build under test, so two runs show whether it is stable
#   crosstool-zoom.md  the pixel-settled zoom wait, which does not depend on
#                   what a build reports about itself
#
# EC2_BUILD names the builds/ entry served as the build under test (default
# current); provision.sh copies the same one.
#
# EC2_SPIKE=slow spikes the other half of the matrix instead: long reads, CRAM,
# the 1 Mb window and a pan, at the ten-minute ceiling. The fast spike answers
# whether the instance is worth a full run; this one answers how long that run
# takes, which is the question the fast cells cannot reach -- they finish in
# seconds while these are the cells that sit against the ceiling. Needs
# EC2_CORPUS=full on the provision, since the spike corpus has no long-read or
# CRAM files. One run per cell: this is a clock, not a measurement.
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

STAMP=$(date +%Y-%m-%d-%H%M)
OUT=$CODE/results/ec2/$STAMP
mkdir -p "$OUT"

remote "bash -s" <<EOF 2>&1 | tee "$OUT/spike.log"
set -uo pipefail
cd $REMOTE_ROOT && rm -rf results && mkdir -p results
exec 2>&1
export CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle'
nvidia-smi -L
node --experimental-strip-types ec2/gpuprobe.ts | tee results/gpu.jsonl
if ! grep '"set":"configured"' results/gpu.jsonl | grep -q '"hardware":true'; then
  echo "SPIKE STOP: CHROME_ANGLE does not reach a hardware WebGL2"
  exit 1
fi

pkill -f http-server || true
for pb in 8000:${EC2_BUILD:-current} 8001:release-4.3.0 8004:release-2.4.0; do
  nohup npx http-server builds/\${pb#*:} -p \${pb%%:*} -s --cors >/dev/null 2>&1 &
done
nohup npx http-server crosstool -p 8003 -s --cors >/dev/null 2>&1 &
sleep 3

if [ "${EC2_SPIKE:-fast}" = slow ]; then
  ARMS='TOOLS=jbrowse,jbrowse-release-2.4.0,igv,genomespy JBROWSE_PORTS=8000,8004'

  # 100 kb at the ceiling Methods states, on the cells that reach it.
  WINDOWS=100kb CASES=1000x-longread-bam,200x-longread-cram MAX_WAIT=600000 \
    \$ARMS RUNS=1 WARMUP=0 node --experimental-strip-types scripts/crosstool/runner.ts

  # The width axis, where 2.4.0 stopped settling at all in the 2026-09-06 run.
  WINDOWS=1mb CASES=100x-longread-bam MAX_WAIT=120000 \
    \$ARMS RUNS=1 WARMUP=0 node --experimental-strip-types scripts/crosstool/runner.ts

  MOTION=pan CASES=1000x-longread-bam \$ARMS \
    node --experimental-strip-types scripts/crosstool/panrunner.ts
else
  WINDOWS=19kb,100kb CASES=20x-shortread-bam,200x-shortread-bam \
    TOOLS=jbrowse,jbrowse-release-2.4.0,igv,genomespy JBROWSE_PORTS=8000,8004 \
    RUNS=3 WARMUP=1 node --experimental-strip-types scripts/crosstool/runner.ts

  MOTION=zoom CASES=20x-shortread-bam,200x-shortread-bam \
    TOOLS=jbrowse,jbrowse-release-2.4.0,igv,genomespy JBROWSE_PORTS=8000,8004 \
    node --experimental-strip-types scripts/crosstool/panrunner.ts

  for rep in 1 2; do
    MODES=in CASES=20x-shortread-bam,200x-shortread-bam \
      node --experimental-strip-types scripts/render/runner-interaction.ts
    cp results/interaction.md results/interaction-rep\$rep.md
  done
fi
uptime
EOF

rsync -az -e "ssh ${SSH_OPTS[*]}" "ubuntu@$IP:$REMOTE_ROOT/results/" "$OUT/"
echo "results in $OUT"

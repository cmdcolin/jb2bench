#!/usr/bin/env bash
# Stream the full graph once: save every node's length and the GRCh38 W lines
# (gzipped, for reruns), emit one `node<TAB>chrom` line per GRCh38 step, sort
# by node, and count nodes seen more than once. Every process under ulimit -v.
set -euo pipefail
cd "$(dirname "$0")/.."
GFA=~/hprc_multiway/build/hprc-v2.1-mc-grch38.gfa.gz
ulimit -v 20000000
mkdir -p nodes nodes/tmp
start=$(date +%s)
echo "start $(date -Is)"
pigz -dc "$GFA" \
  | awk -F'\t' '$1=="S" {print $2 "\t" length($3) | "gzip -1 > nodes/node_lengths.tsv.gz"} $1=="W" && $2=="GRCh38"' \
  | tee >(gzip -1 > nodes/grch38_walks.gfa.gz) \
  | python3 -I scripts/emit_steps.py \
  | LC_ALL=C sort -S 4G --parallel=2 -T nodes/tmp -k1,1 \
  | python3 -I scripts/count_sorted.py nodes/repeated_nodes.tsv > nodes/repeated_nodes.txt
echo "end $(date -Is), $(( $(date +%s) - start )) s wall"

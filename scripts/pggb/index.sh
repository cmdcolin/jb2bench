#!/usr/bin/env bash
# index.sh: index data/pggb/chrY.gfa on GRCh38 with gfa-to-tabix and record the
# graph's size, the wall time and the peak memory
set -euo pipefail
cd "$(dirname "$0")/../.."
dir=data/pggb
out=results/pggb/index-$(hostname -s)-$(date -u +%Y-%m-%d).json
mkdir -p results/pggb
nodes=$(grep -c '^S' "$dir/chrY.gfa")
links=$(grep -c '^L' "$dir/chrY.gfa")
/usr/bin/time -f '%e %M' -o "$dir/time.txt" "$dir/bin/gfa-to-tabix" "$dir/chrY.gfa" --reference GRCh38 -o "$dir/chrY"
read -r seconds peak_kb <"$dir/time.txt"
cat >"$out" <<JSON
{
  "date": "$(date -Is)",
  "host": "$(hostname -s)",
  "cpu": "$(lscpu | sed -n 's/^Model name: *//p')",
  "load": $(cut -d' ' -f1 /proc/loadavg),
  "tool": "$("$dir/bin/gfa-to-tabix" --version)",
  "gfaBytes": $(stat -c %s "$dir/chrY.gfa"),
  "nodes": $nodes,
  "links": $links,
  "seconds": $seconds,
  "peakGB": $(awk "BEGIN { printf \"%.1f\", $peak_kb / 1048576 }"),
  "indexBytes": $(stat -c %s "$dir/chrY.graph.bed.gz")
}
JSON
cat "$out"

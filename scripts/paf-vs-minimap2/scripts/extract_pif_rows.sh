#!/usr/bin/env bash
# The PIF's rows at the window, read from the target side: `tabix pif
# tGRCh38#0#chr1:WS-WE` returns the fine tier with the target in columns 1-4
# and the query in 6-9, and the cg:Z: as the source PAF spelled it (make-pif's
# t-row). Un-swap to standard PAF (haplotype as query) into pif/<hap>.paf, one
# file per haplotype, and check each against the raw PAF the PIF was built from.
set -euo pipefail
cd "$(dirname "$0")/.."
PIF=~/hprc_multiway/build/hprc_multiway_gfa.pif.gz
RAW=~/hprc_multiway/build/hprc_multiway_gfa.paf
WS=196640000; WE=196900000
mkdir -p pif
tabix "$PIF" "tGRCh38#0#chr1:$WS-$WE" > pif/window.t_rows.pif
awk -F'\t' 'BEGIN{OFS="\t"} {
  cg=""; for (i=13;i<=NF;i++) if ($i ~ /^cg:Z:/) cg=$i
  print $6,$7,$8,$9,$5,substr($1,2),$2,$3,$4,$10,$11,$12,cg }' pif/window.t_rows.pif \
  | sort -k1,1 -k8,8n > pif/window.paf
for hap in HG01109 HG01123 HG01960 HG02055 HG00097 HG00099 HG00128 HG00133; do
  awk -F'\t' -v h="$hap#1#" 'index($1,h)==1' pif/window.paf > "pif/$hap.1.paf"
  awk -F'\t' -v h="$hap#1#" -v ws=$WS -v we=$WE 'index($1,h)==1 && $6=="GRCh38#0#chr1" && $8<we && $9>ws' "$RAW" | sort -k1,1 -k8,8n > "pif/$hap.1.raw"
  if cmp -s "pif/$hap.1.paf" "pif/$hap.1.raw"; then echo "$hap#1: $(wc -l < "pif/$hap.1.paf") row(s), identical to the raw PAF"; rm "pif/$hap.1.raw"; else echo "$hap#1: DIFFERS from raw PAF"; fi
done
rm -f pif/*.JAHEPA* pif/*.CM0* pif/*.JBH*

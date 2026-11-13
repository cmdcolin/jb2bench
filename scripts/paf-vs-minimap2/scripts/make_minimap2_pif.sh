#!/usr/bin/env bash
# The minimap2 rows of the supplementary figure as a PIF: every primary
# (tp:A:P) row of the eight contigs' asm5 alignments to GRCh38 chr1, the target
# renamed to its PanSN name so the hosted config's assemblyNameToPanSN applies,
# cs tags dropped (the PIF carries cg:Z:). Needs the jbrowse CLI, bgzip, tabix.
#   bash scripts/make_minimap2_pif.sh            # writes pif/hprc_cfhr_minimap2.pif.gz{,.csi}
set -euo pipefail
cd "$(dirname "$0")/.."
cat mm2/*.asm5.paf | awk -F'\t' 'BEGIN{OFS="\t"} {
  p=0; for(i=13;i<=NF;i++) if($i=="tp:A:P") p=1; if(!p) next
  $6="GRCh38#0#"$6
  out=""; for(i=1;i<=NF;i++){ if(i>12 && substr($i,1,5)=="cs:Z:") continue; out=out (i==1?"":"\t") $i }
  print out }' > pif/hprc_cfhr_minimap2.paf
jbrowse make-pif pif/hprc_cfhr_minimap2.paf --csi --threads 2 --out pif/hprc_cfhr_minimap2.pif.gz

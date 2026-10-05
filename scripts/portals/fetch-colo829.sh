#!/bin/bash
# Fetch the COLO829 reads, callset and reference the variant portal run reads from local disk.
#   scripts/portals/fetch-colo829.sh <dir>
# ~242 GiB. Resumable: rerun to continue. The normal BAM comes down in 8 GiB range chunks over 3 connections.
set -euo pipefail
D=${1:?usage: fetch-colo829.sh <dir>}
mkdir -p "$D/chunks"
cd "$D"
ONT=https://ont-open-data.s3.amazonaws.com/colo829_2024.03
SUP=$ONT/wf_somatic_variation/sup
NORMAL=$ONT/basecalls/colo829bl/sup/PAU59807.d052sup4305mCG_5hmCGvHg38.bam
GENOMES=https://jbrowse.org/genomes/GRCh38

for u in $SUP/COLO829.wf-somatic-sv.vcf.gz $SUP/COLO829.wf-somatic-sv.vcf.gz.tbi \
         $SUP/COLO829_tumor.ht.cram.crai $NORMAL.bai \
         $GENOMES/fasta/hg38.prefix.fa.gz $GENOMES/fasta/hg38.prefix.fa.gz.fai \
         $GENOMES/fasta/hg38.prefix.fa.gz.gzi $GENOMES/hg38_aliases.txt; do
  curl -sSf -C - -O "$u"
done

curl -sSf -C - -O "$SUP/COLO829_tumor.ht.cram" &

SIZE=$(curl -sI "$NORMAL" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
F=$(basename "$NORMAL")
CH=$((8 * 1024 * 1024 * 1024))
N=$(( (SIZE + CH - 1) / CH ))
[ -f "$F" ] || truncate -s "$SIZE" "$F"

chunk() {
  local i=$1 s=$(($1 * CH)) e
  e=$((s + CH - 1)); [ $e -ge "$SIZE" ] && e=$((SIZE - 1))
  [ -f "chunks/$i.done" ] && return
  until curl -sSf -r "$s-$e" "$NORMAL" | dd of="$F" bs=4M oflag=seek_bytes seek="$s" conv=notrunc status=none \
        && [ "${PIPESTATUS[0]}" -eq 0 ]; do sleep 5; done
  touch "chunks/$i.done"
}
export -f chunk
export NORMAL F SIZE CH
seq 0 $((N - 1)) | xargs -P3 -I{} bash -c 'chunk {}'
wait

#!/usr/bin/env bash
# The corpus's only MULTI-GROUP modBAM, and its only dense-6mA one.
#
# Everything else in data/ is single-group `C+m` — one modification type on one
# canonical base — so nothing here could measure what a read with several MM
# groups costs, and the mod path's phase split turns out to depend heavily on it
# (parse is 46% of the per-read pipeline on the single-group fixture and 71% on
# this one, because `getModPositions` walks the read sequence once per group).
#
# This is a slice of ONT's public chromatin-accessibility run for HG002, which
# jbrowse-components already references as a demo track in
# test_data/config_demo.json. Sliced rather than mirrored: the source is 130 GB.
#
# What you get, at chr20:1,000,000-3,000,000:
#   8,166 reads carrying MM+ML, 72.8 Mbp of sequence, mean read 8.1 kb
#   21.81M MM deltas = 2,310 calls/read, ~26x the single-group fixture's 0.84M
#   112 cigar ops/read, one every 72 bases
#   EVERY read is `A+a.;C+h?;C+m?` — three groups, TWO of them on the same
#   canonical base, and NO combined code anywhere in the file
#
# That last line is the one worth reading twice. Dorado's 5mCG_5hmCG model emits
# 5mC and 5hmC as two SEPARATE MM groups on C, not as the combined `C+mh` code
# the SAM spec allows — so a corpus without this file will mis-model what the
# common ONT output actually looks like.
#
# Needs samtools (1.23.1 used). ~83 MB written, a couple of minutes.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p data

URL=https://ont-open-data.s3.amazonaws.com/chrom_acc_2025.06/basecalls/PAY22766/basecalls.bam
REGION=${REGION:-chr20:1000000-3000000}
OUT=data/ont.6ma.chr20.bam
BAI=.ont6ma.remote.bai

if [ -f "$OUT" ]; then
  echo "$OUT exists, nothing to do (delete it to re-slice)"
  exit 0
fi

# The remote index is 64 MB and samtools re-fetches it per invocation, so keep it
# for the duration and pass it explicitly with -X.
echo "fetching the remote index (64 MB)..."
curl -sfL -o "$BAI" "$URL.bai"

echo "slicing $REGION out of a 130 GB BAM..."
samtools view -b -o "$OUT" -X "$URL" "$BAI" "$REGION"
samtools index "$OUT"
rm -f "$BAI"

samtools view "$OUT" | awk '{
  b += length($10); n++
  for (i = 12; i <= NF; i++) if ($i ~ /^MM:Z:/) { m = $i; gsub(/[^,]/, "", m); c += length(m) }
} END {
  printf "  %d reads, %.1f Mbp, mean %d bp, %.2fM MM deltas = %.0f calls/read\n", n, b/1e6, b/n, c/1e6, c/n
}'
echo "wrote $OUT"

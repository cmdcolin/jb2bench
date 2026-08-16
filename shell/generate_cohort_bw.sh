#!/bin/bash
# Build the cohort BigWig corpus: N per-sample signal files over the benchmark
# contig, for ecosystem/cohort-bw.ts.
#
# The single-file BigWig comparison in versions.json is 1-3 ms and reports as
# flat — too small to say anything, as its own README admits. That is not
# because the library stopped mattering; it is because a per-file cost measured
# once is invisible. A signal panel pays it N times, so this corpus is N files.
#
#   ./generate_cohort_bw.sh [N]        # default 100
#
# Needs bedGraphToBigWig from UCSC's kent tools, the same dependency
# generate_alignments.sh already has for its coverage tracks. Takes well under a
# minute for 100 and needs no idle machine — nothing here is timed.
set -e
cd "$(dirname "$0")/.."

N=${1:-100}
OUT=data/cohort
GEN=shell/generate_cohort_bw.js

command -v bedGraphToBigWig >/dev/null || {
  echo "bedGraphToBigWig not on PATH (UCSC kent tools)" >&2
  exit 1
}

mkdir -p "$OUT"

# bedGraphToBigWig wants chrom sizes and the corpus has none for this contig —
# data/hg19_17.chrom.sizes is chr17, left over from other work. Derive it from
# the reference index so the two can never disagree.
CHROMSIZES="$OUT/chrom.sizes"
cut -f1,2 data/hg19mod.fa.fai >"$CHROMSIZES"

echo "generating $N cohort BigWigs into $OUT/"
for i in $(seq 0 $((N - 1))); do
  name=$(printf "sample%03d" "$i")
  node "$GEN" "$i" "$N" >"$OUT/$name.bedGraph"
  bedGraphToBigWig "$OUT/$name.bedGraph" "$CHROMSIZES" "$OUT/$name.bw"
  rm -f "$OUT/$name.bedGraph"
  if [ $((i % 20)) -eq 0 ]; then echo "  $name"; fi
done

echo
echo "$(ls "$OUT"/*.bw | wc -l) files, $(du -sh "$OUT" | cut -f1) total"

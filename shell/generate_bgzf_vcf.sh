#!/usr/bin/env bash
# The BGZF worker pool figure's VCF corpus: the same generated callset at three
# sample counts and both shapes, spanning the whole benchmark contig, bgzipped
# and tabix indexed.
#
# Separate from data/variants.<n>.<shape>.vcf, and the two must not be merged.
# That corpus covers one 19 kb window because the parser benchmark scales on
# samples and does not care where the records sit. This one is queried at five
# non-overlapping windows — jbrowse caches decoded records per region and raw
# bytes per 256 KiB chunk, so a window that reuses the previous one's bytes
# measures a cache hit rather than an inflate, and four of the five windows
# would be empty against the narrow file.
#
# Sample count is the axis, because every record carries one genotype field per
# sample: widening the file grows the per-line scan the pool cannot reach at the
# same rate as it grows the bytes the pool inflates. That is the whole reason
# tabix returns less than BAM, and one width cannot show it.
set -euo pipefail
cd "$(dirname "$0")/.."
GEN=shell/generate_variants.js

# Covers every window scripts/bgzfpool/windows.ts queries, with room either side.
START=20000
END=210000

for t in bgzip tabix; do
  command -v "$t" >/dev/null || { echo "$t not found (htslib)" >&2; exit 1; }
done

for n in 100 1000 3000; do
  for shape in gtonly wide; do
    plain="data/variants.pool.$n.$shape.vcf"
    out="$plain.gz"
    node "$GEN" "$n" "$shape" "$plain" "$START" "$END"
    # Sorted before indexing: tabix rejects an out-of-order file, and the
    # generator emits ascending positions but makes no promise of it. The
    # header has to survive the sort, hence the split.
    grep '^#' "$plain" > "/tmp/vcfhdr.$$"
    grep -v '^#' "$plain" | sort -k1,1 -k2,2n > "/tmp/vcfbody.$$"
    cat "/tmp/vcfhdr.$$" "/tmp/vcfbody.$$" | bgzip -c > "$out"
    rm -f "/tmp/vcfhdr.$$" "/tmp/vcfbody.$$" "$plain"
    tabix -p vcf -f "$out"
  done
done

echo
ls -la data/variants.pool.*.vcf.gz data/variants.pool.*.vcf.gz.tbi

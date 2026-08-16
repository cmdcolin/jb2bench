#!/bin/bash
# Fetch the corpus the 2019 cram-js paper benchmarked, for ecosystem/cram-samtools.ts.
#
# The URLs are the ones in ecosystem/paper-2019/bm_data_files.txt, which is the
# fetch list the paper's own harness used. Three of the six still serve; the E.
# coli BAM does not (see below). Everything lands in data/paper2019/, which is
# untracked and roughly 16 GB.
#
#   ./fetch_paper2019.sh              # everything still available
#   ./fetch_paper2019.sh human        # the two CRAMs and GRCh38 only
#   ./fetch_paper2019.sh ecoli        # the E. coli fixture only
#
# Resumable: every download is `curl -C -`, so an interrupted run continues
# where it stopped rather than starting the 8.6 GB file again. A file whose size
# already matches the server's is left alone, so a second run is a no-op.
#
# Needs samtools (for the .fai files, and to convert the E. coli BAM) and curl.
set -e
cd "$(dirname "$0")/.."

OUT=data/paper2019
WHICH=${1:-all}

FTP=https://ftp.1000genomes.ebi.ac.uk/vol1/ftp
LOW=$FTP/data_collections/1000_genomes_project/data/CEU/NA12878/alignment/NA12878.alt_bwamem_GRCh38DH.20150718.CEU.low_coverage.cram
EXOME=$FTP/data_collections/1000_genomes_project/data/CEU/NA12878/exome_alignment/NA12878.alt_bwamem_GRCh38DH.20150826.CEU.exome.cram
HUMAN_REF=$FTP/technical/reference/GRCh38_reference_genome/GRCh38_full_analysis_set_plus_decoy_hla.fa

# The paper fetched the E. coli reads from Illumina's public FTP. That host still
# resolves and no longer answers: a connection to it times out rather than being
# refused, so this is a dead service and not a moved file. Both directory names
# seen in the wild are tried before giving up, because the path in the paper's
# fetch list and the path in other 2011-era scripts disagree.
ECOLI_FTP=ftp://webdata:webdata@ussd-ftp.illumina.com
ECOLI_PATHS=(
  "$ECOLI_FTP/Data/SequencingRuns/DH10B/MiSeq_Ecoli_DH10B_110721_PF.bam"
  "$ECOLI_FTP/Data/35SequencingRuns/DH10B/MiSeq_Ecoli_DH10B_110721_PF.bam"
)
ECOLI_REF=https://raw.githubusercontent.com/allanroscoche/PathTree/master/data/DH10B_WithDup_FinalEdit_validated.fasta

command -v curl >/dev/null || { echo "curl not on PATH" >&2; exit 1; }
command -v samtools >/dev/null || { echo "samtools not on PATH" >&2; exit 1; }

mkdir -p "$OUT"

# The full set is ~16.4 GB and the conversion of the E. coli BAM wants room for
# its own output, so check before starting rather than dying 4 GB into an 8.6 GB
# download. Refuses rather than warns: a partial corpus produces a table with
# silently missing rows, which is worse than no table.
need_gb=17
[ "$WHICH" = ecoli ] && need_gb=3
have_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
if [ "$have_gb" -lt "$need_gb" ]; then
  echo "need ~${need_gb} GB free for '$WHICH', have ${have_gb} GB in $(pwd)" >&2
  echo "free space, or point data/paper2019 at another filesystem with a symlink" >&2
  exit 1
fi

# Skips a file already at its full size, resumes a partial one, and verifies the
# result against the length the server reported. Truncated corpus files are the
# failure mode that costs a whole benchmark run, and a CRAM missing its tail
# fails as a decode error deep in a query rather than as a download problem.
fetch() {
  local url=$1 dest=$OUT/$2
  local remote
  remote=$(curl -sIL --max-time 60 "$url" | tr -d '\r' |
    awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')
  if [ "$remote" -eq 0 ]; then
    echo "  ! $2: server did not report a size, skipping" >&2
    return 1
  fi
  local local_size=0
  [ -f "$dest" ] && local_size=$(stat -c %s "$dest")
  if [ "$local_size" -eq "$remote" ]; then
    echo "  = $2 ($(numfmt --to=iec "$remote"))"
    return 0
  fi
  echo "  > $2 ($(numfmt --to=iec "$remote"))"
  curl -fL -C - --retry 5 --retry-delay 10 -o "$dest" "$url"
  local got
  got=$(stat -c %s "$dest")
  if [ "$got" -ne "$remote" ]; then
    echo "  ! $2: got $got bytes, server said $remote — left in place, rerun to resume" >&2
    return 1
  fi
}

# .fai for both references, and a .crai for anything that arrived without one.
index_ref() {
  [ -f "$OUT/$1.fai" ] || { echo "  + $1.fai"; samtools faidx "$OUT/$1"; }
}

if [ "$WHICH" = all ] || [ "$WHICH" = human ]; then
  echo "1000 Genomes NA12878, GRCh38:"
  fetch "$LOW" NA12878.low_coverage.cram
  fetch "$LOW.crai" NA12878.low_coverage.cram.crai
  fetch "$EXOME" NA12878.exome.cram
  fetch "$EXOME.crai" NA12878.exome.cram.crai
  fetch "$HUMAN_REF" GRCh38_full_analysis_set_plus_decoy_hla.fa
  index_ref GRCh38_full_analysis_set_plus_decoy_hla.fa
fi

if [ "$WHICH" = all ] || [ "$WHICH" = ecoli ]; then
  echo "E. coli DH10B MiSeq:"
  fetch "$ECOLI_REF" DH10B.fasta && index_ref DH10B.fasta

  if [ -f "$OUT/MiSeq_Ecoli_DH10B.cram" ]; then
    echo "  = MiSeq_Ecoli_DH10B.cram"
  else
    got=
    for url in "${ECOLI_PATHS[@]}"; do
      echo "  > trying $url"
      if curl -f -C - --connect-timeout 30 --max-time 7200 \
        -o "$OUT/MiSeq_Ecoli_DH10B.bam" "$url"; then
        got=$url
        break
      fi
    done
    if [ -z "$got" ]; then
      cat >&2 <<'EOF'
  ! the E. coli BAM could not be fetched. ussd-ftp.illumina.com resolves but
    does not answer, and no mirror of MiSeq_Ecoli_DH10B_110721_PF.bam is known
    to this script. The other two fixtures are unaffected; cram-samtools.ts
    reports this one as missing rather than dropping it silently, and
    data/1000x.shortread.cram stands in for the high-coverage condition.
EOF
    else
      # The paper converted BAM to CRAM locally with exactly this, so the CRAM
      # under test is samtools' own output and not a redistributed file.
      echo "  + MiSeq_Ecoli_DH10B.cram (samtools view -C)"
      samtools view -h -C -T "$OUT/DH10B.fasta" \
        -o "$OUT/MiSeq_Ecoli_DH10B.cram" "$OUT/MiSeq_Ecoli_DH10B.bam"
      samtools index "$OUT/MiSeq_Ecoli_DH10B.cram"
    fi
  fi
fi

# What was fetched, from where, and how big — so a table generated months later
# can be traced back to bytes. Sizes rather than checksums: hashing 16 GB costs
# more than it settles, and the size check above already catches a truncated
# download, which is the failure that actually happens.
{
  echo "# fetched $(date -Is) by shell/fetch_paper2019.sh ($WHICH)"
  echo "# urls from ecosystem/paper-2019/bm_data_files.txt"
  for f in "$OUT"/*; do
    [ "$(basename "$f")" = MANIFEST.txt ] && continue
    echo "$(basename "$f") $(stat -c %s "$f")"
  done
} > "$OUT/MANIFEST.txt"

echo
echo "corpus in $OUT ($(du -sh "$OUT" | cut -f1))"
cat "$OUT/MANIFEST.txt"

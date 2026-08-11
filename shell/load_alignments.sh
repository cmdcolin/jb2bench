#!/bin/bash
# Load hg19mod assembly + alignment tracks into every build in builds/.
# Track ids match the <cov>.<readtype>.<fmt> naming the profiler URLs use.
# The assembly is copied into each build; the alignments are symlinked, so
# builds/ stays small and every build serves the same bytes out of data/.
set -e
cd "$(dirname "$0")/.."
REF=data/hg19mod.fa

for l in builds/*; do
  echo "=== $l ==="
  jbrowse add-assembly --load copy "$REF" --out "$l" --force --name hg19mod
  for k in shortread longread; do
    for cov in 20x 200x 1000x; do
      for fmt in bam cram; do
        # trackId stays the bare filename: the profiler URLs address tracks as
        # ?tracks=1000x.longread.bam, and the symlink lands under that name too.
        track="$cov.$k.$fmt"
        if [ -f "data/$track" ]; then
          jbrowse add-track "data/$track" --load symlink --out "$l" --trackId "$track" --force -a hg19mod >/dev/null
        fi
      done
    done
  done
  # modBAMs carry colorBy in the config rather than needing a session or a
  # click, so a profiler that only takes a URL still enters the modification
  # path.
  #
  # `--config` is a SHALLOW merge over the track it builds, so it must not name
  # `adapter`: passing `{"adapter":{"fetchSizeLimit":…}}` here replaces the whole
  # adapter and takes `bamLocation` and `index` with it, leaving a track that
  # loads and shows nothing. Raising fetchSizeLimit is a separate pass over
  # config.json — see the README.
  for cov in 20x 200x; do
    track="$cov.longread.mod.bam"
    if [ -f "data/$track" ]; then
      jbrowse add-track "data/$track" --load symlink --out "$l" \
        --trackId "$track" --force -a hg19mod \
        --config '{"displayDefaults":{"colorBy":{"type":"modifications"}}}' >/dev/null
    fi
  done
  echo "  tracks loaded"
done
echo "DONE loading alignments"

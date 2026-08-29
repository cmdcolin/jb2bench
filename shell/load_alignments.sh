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
  # One file per non-alignment format, for the capability matrix
  # (`scripts/crosstool/formatsupport.ts`) rather than for any timing run. They
  # are small and nothing times them; what they establish is that JBrowse was
  # pointed at the same file on the same static host as every other tool, so a
  # `no` in that table is about the tool and not about a track nobody added.
  #
  # These landed after the 2026-08-23 render matrix. They add roughly a kilobyte
  # to a config.json that is fetched once per page load, which is why that
  # matrix was not re-measured for them.
  for extra in 20x.shortread.bw variants.browser.vcf.gz; do
    if [ -f "data/$extra" ]; then
      jbrowse add-track "data/$extra" --load symlink --out "$l" --trackId "$extra" --force -a hg19mod >/dev/null
    fi
  done
  # The no-MD twin, for `scripts/crosstool/drawdetail.py` rather than for any
  # timing run. GenomeSpy and Gosling draw mismatches only where a BAM carries
  # MD tags, and say nothing when it does not; JBrowse and igv.js read the
  # reference instead. This track is what lets that be measured rather than
  # asserted, so JBrowse needs it for the same reason the other tools do — and
  # without it the comparison is JBrowse failing to resolve a trackId, which
  # scores as "drew nothing" and looks like a result.
  if [ -f "data/20x.shortread.nomd.bam" ]; then
    jbrowse add-track data/20x.shortread.nomd.bam --load symlink --out "$l" \
      --trackId 20x.shortread.nomd.bam --force -a hg19mod >/dev/null
  fi
  # Two adapter settings `add-track` cannot express: fetchSizeLimit, which
  # otherwise refuses the heavy windows outright, and the sequenceAdapter a 2.x
  # CRAM track needs. See shell/patch_adapters.js for what each looks like when
  # it is missing.
  node shell/patch_adapters.js "$l"
  echo "  tracks loaded"
done
echo "DONE loading alignments"

#!/bin/bash
# Clone and build every version named in sweep.json.
#
# setup.sh's sibling, and deliberately not the same script. setup.sh builds the
# two points versions.json names and treats a build failure as fatal, because a
# missing side means the comparison it gates cannot run at all. This one builds
# a curve, where one unbuildable point costs a marker on a chart and nothing
# else — so a failure here is recorded and the run continues.
#
# Builds land in .libs/<name>/sweep/<tag>/, alongside the old/ and new/ that
# setup.sh writes, so the two never collide and `./setup.sh --force` does not
# throw away half an hour of sweep builds.
#
#   ./setup-sweep.sh              # build anything missing, every library
#   ./setup-sweep.sh bam-js       # only that library
#   ./setup-sweep.sh --force      # re-clone and rebuild
#
# Budget: 32 clone+install+build cycles for the three libraries in sweep.json,
# which is tens of minutes the first time and seconds afterwards. It needs no
# idle machine — nothing is timed here.

set -uo pipefail
cd "$(dirname "$0")"

LIBS=".libs"
MANIFEST="$LIBS/sweep-manifest.txt"
FORCE=0
ONLY=""

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) ONLY="$arg" ;;
  esac
done

mkdir -p "$LIBS"
: >"$MANIFEST"

libcount=$(node -p "require('./sweep.json').libraries.length")
built=0
failed=0

for i in $(seq 0 $((libcount - 1))); do
  name=$(node -p "require('./sweep.json').libraries[$i].name")
  repo=$(node -p "require('./sweep.json').libraries[$i].repo")

  if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then
    continue
  fi

  vcount=$(node -p "require('./sweep.json').libraries[$i].versions.length")

  for j in $(seq 0 $((vcount - 1))); do
    tag=$(node -p "require('./sweep.json').libraries[$i].versions[$j].tag")
    dir="$LIBS/$name/sweep/$tag"

    if [ $FORCE -eq 1 ]; then rm -rf "$dir"; fi

    if [ -f "$dir/esm/index.js" ]; then
      echo "== $name $tag already built"
      built=$((built + 1))
      sha=$(cd "$dir" && git rev-parse HEAD)
      echo "$name $tag ok sha=$sha" >>"$MANIFEST"
      continue
    fi

    echo "== $name $tag: cloning"
    rm -rf "$dir"
    mkdir -p "$(dirname "$dir")"
    if ! git clone --quiet --depth 1 --branch "$tag" "$repo" "$dir" 2>/dev/null; then
      echo "   $name $tag: NO SUCH TAG"
      echo "$name $tag unbuildable reason=no-tag" >>"$MANIFEST"
      failed=$((failed + 1))
      continue
    fi

    # Old tags of these repos import packages they never declared and got away
    # with it under npm's flat node_modules. Same mechanism versions.json
    # records as extraDeps, same fix.
    (cd "$dir" && pnpm install --ignore-scripts --ignore-workspace \
      --no-frozen-lockfile >/dev/null 2>&1) || true
    extra=$(node -p "(require('./sweep.json').libraries[$i].versions[$j].extraDeps||[]).join(' ')")
    if [ -n "$extra" ]; then
      # shellcheck disable=SC2086
      (cd "$dir" && pnpm add --ignore-scripts --ignore-workspace $extra >/dev/null 2>&1) || true
    fi

    # Judged by whether output exists, not by exit code: these tags typecheck
    # against whatever @types/node resolves today and emit errors from inside
    # node_modules while still writing their JavaScript.
    (cd "$dir" && pnpm run build:esm >/dev/null 2>&1) || true

    if [ -f "$dir/esm/index.js" ]; then
      sha=$(cd "$dir" && git rev-parse HEAD)
      echo "   $name $tag: built"
      echo "$name $tag ok sha=$sha" >>"$MANIFEST"
      built=$((built + 1))
    else
      echo "   $name $tag: BUILD PRODUCED NO esm/index.js"
      echo "$name $tag unbuildable reason=no-esm-output" >>"$MANIFEST"
      failed=$((failed + 1))
    fi
  done
done

echo
echo "sweep builds: $built ok, $failed unbuildable"
echo "manifest: $MANIFEST"
[ $failed -gt 0 ] && grep unbuildable "$MANIFEST"
exit 0

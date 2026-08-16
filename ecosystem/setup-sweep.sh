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

# Record what actually got installed, not just what was asked for.
#
# Every clone is installed with --no-frozen-lockfile against dependency ranges
# written years ago, so the transitive tree resolves to whatever is current on
# the day setup runs. Two sweeps months apart can therefore differ in a
# dependency without differing in a single pin, and nothing would say so. The
# main setup.sh records each side's *declared* deps for this reason; declared is
# not enough here, because the point of a sweep is to attribute a difference to
# a version, and an unrecorded dependency bump is an alternative explanation
# that cannot be ruled out after the fact.
record_manifest() {
  local name=$1 tag=$2 dir=$3
  local sha
  sha=$(cd "$dir" && git rev-parse HEAD)
  echo "$name $tag ok sha=$sha" >>"$MANIFEST"
  # Top-level installed packages and their resolved versions, one line, sorted.
  # Every top-level entry under a pnpm node_modules is a symlink into its
  # content-addressed store, so a withFileTypes isDirectory() test sees only the
  # real `@scope` directories and silently drops every unscoped package —
  # including pako and generic-filehandle, which are the ones that matter here.
  # Read each package.json instead and let a missing one be the filter.
  node -e '
    const { readdirSync, readFileSync, existsSync } = require("fs")
    const root = process.argv[1] + "/node_modules"
    if (!existsSync(root)) { console.log(""); process.exit(0) }
    const out = []
    const names = []
    for (const name of readdirSync(root)) {
      if (name.startsWith(".")) continue
      if (name.startsWith("@")) {
        for (const sub of readdirSync(`${root}/${name}`)) names.push(`${name}/${sub}`)
      } else {
        names.push(name)
      }
    }
    for (const d of names) {
      try {
        const v = JSON.parse(readFileSync(`${root}/${d}/package.json`, "utf8")).version
        out.push(`${d}@${v}`)
      } catch {}
    }
    console.log(out.sort().join(" "))
  ' "$dir" | sed 's/^/  resolved=/' >>"$MANIFEST"
}

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
      record_manifest "$name" "$tag" "$dir"
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

    if [ ! -f "$dir/esm/index.js" ]; then
      # Two different facts wear the same missing file. A version whose
      # package.json has no build:esm script never shipped ESM at all — it
      # predates it — and building its CommonJS instead would fold a module
      # format and transpiler target into a curve that is supposed to be about
      # library code. A version that HAS the script and still produced nothing
      # is a build failure. Say which.
      if node -p "!!(require('./$dir/package.json').scripts||{})['build:esm']" 2>/dev/null | grep -q true; then
        echo "   $name $tag: BUILD PRODUCED NO esm/index.js"
        echo "$name $tag unbuildable reason=no-esm-output" >>"$MANIFEST"
      else
        echo "   $name $tag: predates the ESM build (no build:esm script)"
        echo "$name $tag unbuildable reason=no-esm-target" >>"$MANIFEST"
      fi
      failed=$((failed + 1))
      continue
    fi

    # An esm/index.js that exists is not the same as one that imports. cram
    # v3.0.7 produced a perfectly good build that threw on its first import,
    # from a dependency it never declared, and that only surfaced minutes into
    # a sweep as one blank row. Import it here instead.
    if ! node --experimental-strip-types \
      --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
      --import ./lib/legacy-resolve-register.mjs \
      -e "import('$PWD/$dir/esm/index.js')" >/dev/null 2>&1; then
      echo "   $name $tag: BUILT BUT WILL NOT IMPORT"
      echo "$name $tag unbuildable reason=import-failed" >>"$MANIFEST"
      failed=$((failed + 1))
      continue
    fi

    echo "   $name $tag: built"
    record_manifest "$name" "$tag" "$dir"
    built=$((built + 1))
  done
done

echo
echo "sweep builds: $built ok, $failed unbuildable"
echo "manifest: $MANIFEST"
[ $failed -gt 0 ] && grep unbuildable "$MANIFEST"
exit 0

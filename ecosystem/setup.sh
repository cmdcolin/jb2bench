#!/bin/bash
# Clone and build both sides of every library named in versions.json.
#
# Each side is a fresh clone from GitHub at a pinned tag, built from source with
# the repo's own tsconfig via its own `build:esm` script. Nothing here reads the
# developer's working checkouts, so a run on another machine sees the same code.
#
# The two sides keep separate node_modules: the 2023 releases depend on
# generic-filehandle/pako 1.x and the current ones on generic-filehandle2/
# pako-esm2, and those cannot share a tree.
#
#   ./setup.sh          # build anything missing
#   ./setup.sh --force  # re-clone and rebuild everything

set -euo pipefail
cd "$(dirname "$0")"

LIBS=".libs"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$LIBS"
: >"$LIBS/manifest.txt"

count=$(node -p "require('./versions.json').libraries.length")

for i in $(seq 0 $((count - 1))); do
  name=$(node -p "require('./versions.json').libraries[$i].name")
  repo=$(node -p "require('./versions.json').libraries[$i].repo")

  for side in old new; do
    tag=$(node -p "require('./versions.json').libraries[$i].$side.tag")
    dir="$LIBS/$name/$side"

    if [ $FORCE -eq 1 ]; then rm -rf "$dir"; fi

    # "Already built" has to mean "built at the tag we are asking for". It used
    # to mean only that an esm/index.js existed, so a repin left the old build
    # in place and the manifest recorded the NEW tag beside the OLD version --
    # a stale build wearing a fresh label, which is the one failure this whole
    # directory is arranged to prevent. Found on 2026-08-18, when moving the
    # old side to what v2.4.0 shipped produced `tag=v1.1.18 version=2.0.0`.
    built_ver=""
    if [ -f "$dir/package.json" ]; then
      built_ver=$(node -p "require('./$dir/package.json').version" 2>/dev/null || echo "")
    fi
    want="${tag#v}"

    if [ -f "$dir/esm/index.js" ] && [ "$built_ver" = "$want" ]; then
      echo "== $name/$side ($tag) already built"
    else
      if [ -f "$dir/esm/index.js" ]; then
        echo "== $name/$side: holds $built_ver, $tag is pinned -- re-cloning"
      fi
      echo "== $name/$side ($tag): cloning $repo"
      rm -rf "$dir"
      mkdir -p "$(dirname "$dir")"
      git clone --quiet --depth 1 --branch "$tag" "$repo" "$dir"

      echo "== $name/$side ($tag): installing"
      (cd "$dir" && pnpm install --ignore-scripts --ignore-workspace \
        --no-frozen-lockfile >/dev/null 2>&1)

      # Some old tags import a package they never declared, and got away with it
      # because npm's flat node_modules hoisted it. See extraDepsReason in
      # versions.json for each one.
      extra=$(node -p "(require('./versions.json').libraries[$i].$side.extraDeps||[]).join(' ')")
      if [ -n "$extra" ]; then
        echo "== $name/$side ($tag): adding undeclared deps: $extra"
        # shellcheck disable=SC2086
        (cd "$dir" && pnpm add --ignore-scripts --ignore-workspace $extra >/dev/null 2>&1)
      fi

      # The 2023 tags typecheck against whatever @types/node resolves today and
      # emit type errors from inside node_modules. tsc still writes its output,
      # so judge the build by whether the output exists, not by the exit code.
      echo "== $name/$side ($tag): building"
      (cd "$dir" && pnpm run build:esm >/dev/null 2>&1) || true

      if [ ! -f "$dir/esm/index.js" ]; then
        echo "FAILED: $name/$side ($tag) produced no esm/index.js" >&2
        exit 1
      fi
    fi

    # Record what actually got built, so a results file can be audited later.
    # A tag whose package.json disagrees with it is not fatal -- a release can
    # be cut before its version bump -- but it is marked, because every label
    # downstream comes from the tag and only this line knows what was built.
    sha=$(cd "$dir" && git rev-parse HEAD)
    ver=$(node -p "require('./$dir/package.json').version")
    mark=""
    if [ "$ver" != "$want" ]; then
      mark="  MISMATCH: package.json says $ver"
    fi
    echo "$name/$side tag=$tag version=$ver sha=$sha$mark" >>"$LIBS/manifest.txt"
    deps=$(cd "$dir" && node -p "JSON.stringify(require('./package.json').dependencies||{})")
    echo "  deps=$deps" >>"$LIBS/manifest.txt"
  done
done

echo
echo "Built:"
cat "$LIBS/manifest.txt"

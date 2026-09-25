#!/bin/bash
# Stage a tagged jbrowse-web release as a builds/ entry and wire it up, so that
# the build under test is a version a reader can fetch rather than a copy out of
# somebody's working checkout.
#
#   shell/stage_release.sh v5.0.0-beta.10
#
# Then serve it with `make serve BUILD=release-5.0.0-beta.10`, or on the
# instance with `EC2_BUILD=release-5.0.0-beta.10`, which provision.sh and run.sh
# both read.
#
# Re-running on a tag already staged replaces it. That is deliberate: a release
# workflow that re-runs on the same tag ships a different bundle under the same
# name, and a half-replaced build directory is worse than either.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=${1:-}
if [ -z "$TAG" ]; then
  echo "usage: shell/stage_release.sh <tag>   e.g. v5.0.0-beta.10" >&2
  exit 2
fi
REPO=${JB2_REPO:-GMOD/jbrowse-components}
NAME="release-${TAG#v}"
DEST="builds/$NAME"

# gh and not curl: the web bundle is not a public asset on the prerelease tags,
# so the plain download URL answers "Not Found" and leaves a 9-byte zip behind
# that unzip then rejects with a less obvious message.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "=== fetching $TAG from $REPO"
gh release download "$TAG" -p 'jbrowse-web-*.zip' -D "$TMP" -R "$REPO"
ZIP=$(ls "$TMP"/jbrowse-web-*.zip)

# Unpack beside builds/ and check before replacing anything, so a bundle that
# fails the check below leaves the staged build that is already there alone.
echo "=== unpacking $TAG"
unzip -q "$ZIP" -d "$TMP/build"

# servedbuild.ts resolves which build a port is serving by matching the
# content-hashed bundle in the served index against builds/*/index.html. Two
# entries with the same hash make that lookup ambiguous and the run would report
# a measurement under whichever name it happened to pick.
stamp() { grep -o 'main\.[a-z0-9]*\.js' "$1/index.html" 2>/dev/null | head -1; }
HASH=$(stamp "$TMP/build")
[ -n "$HASH" ] || { echo "no main.*.js in the bundle's index.html -- is this a web build?" >&2; exit 1; }
for other in builds/*/; do
  other=${other%/}
  [ "$other" = "$DEST" ] && continue
  if [ "$(stamp "$other")" = "$HASH" ]; then
    echo "$TAG and $other both stamp $HASH; servedbuild.ts cannot tell them apart" >&2
    exit 1
  fi
done

echo "=== staging $DEST"
rm -rf "$DEST"
mv "$TMP/build" "$DEST"

echo "=== wiring assembly and tracks"
PATH="$PWD/node_modules/.bin:$PATH" ./shell/load_alignments.sh "$DEST"

echo
echo "staged $NAME"
echo "  version.txt  $(cat "$DEST/version.txt" 2>/dev/null || echo '(absent)')"
echo "  bundle       $HASH"
echo "  tracks       $(node -e 'const t=require("./'"$DEST"'/config.json").tracks.map(t=>t.trackId);console.log(t.filter(x=>/^(20x|200x|1000x)\./.test(x)).length+" of the alignment matrix, "+t.length+" total")')"
echo
echo "serve it:  make serve BUILD=$NAME"
echo "on ec2:    EC2_BUILD=$NAME make ec2-provision ec2-run"

#!/usr/bin/env bash
# fetch.sh: the HPRC release 2 pggb graph of chrY and the gfa-to-tabix 4.0.0
# release binary, into data/pggb/
set -euo pipefail
cd "$(dirname "$0")/../.."
dir=data/pggb
mkdir -p "$dir/bin"
gfa=20251014_hprc25272.p98-k311.chrY.gfa.zst
url=https://s3-us-west-2.amazonaws.com/human-pangenomics/pangenomes/freeze/release2/pggb/gfas/by-chromosome/$gfa
[ -s "$dir/$gfa" ] || curl -fL -o "$dir/$gfa" "$url"
[ "$(stat -L -c %s "$dir/$gfa")" = 343308603 ] || { echo "$gfa: unexpected size" >&2; exit 1; }
[ -s "$dir/chrY.gfa" ] || zstd -dc "$dir/$gfa" >"$dir/chrY.gfa"
tool=gfa-to-tabix-x86_64-unknown-linux-musl.tar.gz
rel=https://github.com/GMOD/gfa-to-tabix/releases/download/v4.0.0
if [ ! -x "$dir/bin/gfa-to-tabix" ]; then
  curl -fsSL -o "$dir/bin/$tool" "$rel/$tool"
  curl -fsSL -o "$dir/bin/$tool.sha256" "$rel/$tool.sha256"
  (cd "$dir/bin" && sha256sum -c "$tool.sha256" && tar xzf "$tool" --strip-components=1)
fi
"$dir/bin/gfa-to-tabix" --version

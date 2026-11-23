#!/usr/bin/env bash
# index.sh: index data/pggb/chrY.gfa on GRCh38 with gfa-to-tabix into
# data/pggb/LAYOUT/ and record the graph's size, the command, the wall time,
# the peak memory and the files written.
# LAYOUT=contig (default): `gfa-to-tabix build`, which indexes a plain GFA in
# the contig layout. LAYOUT=anchored: the bare command, whose anchored layout
# files every node at its first pass on the reference, so on a graph whose
# reference revisits nodes a window's cut brings in material from far away.
set -euo pipefail
cd "$(dirname "$0")/../.."
LAYOUT=${LAYOUT:-contig}
dir=data/pggb
case $LAYOUT in
  contig) args=(build ../chrY.gfa --reference GRCh38 -o chrY) ;;
  anchored) args=(../chrY.gfa --reference GRCh38 -o chrY) ;;
  *) echo "LAYOUT is contig or anchored" >&2 && exit 1 ;;
esac
out=results/pggb/index-$LAYOUT-$(hostname -s)-$(date -u +%Y-%m-%d).json
mkdir -p results/pggb "$dir/$LAYOUT"
nodes=$(grep -c '^S' "$dir/chrY.gfa")
links=$(grep -c '^L' "$dir/chrY.gfa")
load=$(cut -d' ' -f1 /proc/loadavg)
touch "$dir/$LAYOUT/started"
(cd "$dir/$LAYOUT" && /usr/bin/time -f '%e %M' -o time.txt ../bin/gfa-to-tabix "${args[@]}" >index.log 2>&1)
read -r seconds peak_kb <"$dir/$LAYOUT/time.txt"
python3 -I - "$dir/$LAYOUT" <<PY >"$out"
import hashlib, json, os, sys
graph = sys.argv[1]
def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()
started = os.path.getmtime(os.path.join(graph, 'started'))
written = sorted(n for n in os.listdir(graph)
                 if n.startswith('chrY.') and os.path.getmtime(os.path.join(graph, n)) >= started)
print(json.dumps({
    'date': '$(date -Is)',
    'host': '$(hostname -s)',
    'cpu': '$(lscpu | sed -n 's/^Model name: *//p')',
    'load': $load,
    'loadAfter': $(cut -d' ' -f1 /proc/loadavg),
    'tool': '$("$dir/bin/gfa-to-tabix" --version)',
    'layout': '$LAYOUT',
    'command': 'gfa-to-tabix ${args[*]}',
    'gfaBytes': $(stat -c %s "$dir/chrY.gfa"),
    'nodes': $nodes,
    'links': $links,
    'seconds': $seconds,
    'peakGB': round($peak_kb / 1048576, 1),
    'files': {n: {'bytes': os.path.getsize(os.path.join(graph, n)), 'sha256': sha(os.path.join(graph, n))} for n in written},
    'log': open(os.path.join(graph, 'index.log')).read().splitlines(),
}, indent=1))
PY
cat "$out"

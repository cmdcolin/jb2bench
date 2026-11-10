#!/usr/bin/env bash
# trace.sh: open a graph view on each seeded 10 kb window of the indexed pggb
# chrY graph, ROUNDS times, served locally beside a staged JBrowse build
set -euo pipefail
cd "$(dirname "$0")/../.."
BUILD=${BUILD:-release-5.0.0-beta.21}
PLUGIN=${PLUGIN:-9.0.0}
ROUNDS=${ROUNDS:-3}
dir=data/pggb
out=results/pggb/windows-$(hostname -s)-$(date -u +%Y-%m-%d).jsonl
mkdir -p results/pggb
python3 -I - "$dir/config.json" "$PLUGIN" <<'PY'
import json, sys, urllib.request
path, plugin = sys.argv[1:]
hosted = json.load(urllib.request.urlopen('https://jbrowse.org/demos/hprc/config.json'))
track = next(t for t in hosted['tracks'] if t['trackId'] == 'hprc_minigraph_segments')
track.update(trackId='pggb_chrY', name='HPRC release 2 pggb chrY')
track['adapter'] = {'type': 'RgfaTabixAdapter', 'uri': 'http://localhost:8192/chrY', 'format': 2,
                    'assemblyNameToPanSN': {'hg38': 'GRCh38'}}
json.dump({
    'plugins': [{'name': 'GraphGenomeView', 'storePlugin': 'GraphGenomeView',
                 'esmUrl': f'https://jbrowse.org/plugins/jbrowse-plugin-graphgenomeviewer/{plugin}/dist/jbrowse-plugin-graphgenomeviewer.esm.js'}],
    'assemblies': [hosted['assemblies'][0]],
    'tracks': [track],
}, open(path, 'w'), indent=1)
PY
node_modules/.bin/http-server "builds/$BUILD" -p 8191 -s --cors &
app=$!
node_modules/.bin/http-server "$dir" -p 8192 -s --cors &
files=$!
trap 'kill $app $files' EXIT
sleep 5
mkdir -p "$dir/shots"
: >"$out"
for round in $(seq "$ROUNDS"); do
  node scripts/pggb/windows.mjs | while read -r start end; do
    CONFIG=http://localhost:8192/config.json APP=http://localhost:8191 DATA=http://localhost:8192/ \
      SETTLE_MS=2000 SHOT=$([ "$round" = 1 ] && echo "$dir/shots/$start.png") \
      node scripts/gbz/graph-trace.mjs pggb_chrY chrY "$start" "$end" >>"$out" </dev/null
  done
done
python3 -I scripts/pggb/summary.py "$out" results/pggb/index-*.json

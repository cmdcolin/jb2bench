#!/usr/bin/env bash
# trace.sh: open a graph view on each seeded 10 kb window of the pggb chrY
# graph indexed by index.sh in data/pggb/LAYOUT/, ROUNDS times, served locally
# beside a staged JBrowse build, with the plugin release PLUGIN pinned by URL;
# then count each window's GRCh38 steps and those the drawn graph holds
set -euo pipefail
cd "$(dirname "$0")/../.."
BUILD=${BUILD:-release-5.0.0-beta.22}
PLUGIN=${PLUGIN:-10.5.0}
LAYOUT=${LAYOUT:-contig}
ROUNDS=${ROUNDS:-3}
WINDOWS=${WINDOWS:-50}
dir=data/pggb
graph=$dir/$LAYOUT
stamp=$LAYOUT-$PLUGIN-$(hostname -s)-$(date -u +%Y-%m-%d)
out=results/pggb/windows-$stamp.jsonl
mkdir -p results/pggb "$graph/shots" "$graph/nodes"
python3 -I - "$graph" "$PLUGIN" <<'PY'
import json, os, sys, urllib.request
graph, plugin = sys.argv[1:]
data = 'http://localhost:8192/'
hosted = json.load(urllib.request.urlopen('https://jbrowse.org/demos/hprc/config.json'))
track = next(t for t in hosted['tracks'] if t['trackId'] == 'hprc_minigraph_segments')
track.update(trackId='pggb_chrY', name='HPRC release 2 pggb chrY')
written = os.path.join(graph, 'chrY.config.json')
adapter = (json.load(open(written))['tracks'][0]['adapter'] if os.path.exists(written)
           else {'type': 'RgfaTabixAdapter', 'uri': 'chrY', 'format': 2})
adapter['uri'] = data + adapter['uri']
if 'coarse' in adapter:
    adapter['coarse']['uri'] = data + adapter['coarse']['uri']
track['adapter'] = {**adapter, 'assemblyNameToPanSN': {'hg38': 'GRCh38'}}
config = {
    'plugins': [{'name': 'GraphGenomeView',
                 'esmUrl': f'https://jbrowse.org/plugins/jbrowse-plugin-graphgenomeviewer/{plugin}/dist/jbrowse-plugin-graphgenomeviewer.esm.js'}],
    'assemblies': [hosted['assemblies'][0]],
    'tracks': [track],
}
assert 'storePlugin' not in json.dumps(config)
json.dump(config, open(os.path.join(graph, 'trace-config.json'), 'w'), indent=1)
PY
node_modules/.bin/http-server "builds/$BUILD" -p 8191 -s --cors &
app=$!
node_modules/.bin/http-server "$graph" -p 8192 -s --cors &
files=$!
trap 'kill $app $files' EXIT
sleep 5
: >"$out"
for round in $(seq "$ROUNDS"); do
  node scripts/pggb/windows.mjs "$WINDOWS" | while read -r start end; do
    first=$([ "$round" = 1 ] && echo 1 || true)
    CONFIG=http://localhost:8192/trace-config.json APP=http://localhost:8191 DATA=http://localhost:8192/ \
      SETTLE_MS=2000 SHOT=${first:+$graph/shots/$start.png} NODES=${first:+$graph/nodes/$start.txt} \
      node scripts/gbz/graph-trace.mjs pggb_chrY chrY "$start" "$end" >>"$out" </dev/null
  done
done
steps=results/pggb/reference-steps-$stamp.jsonl
node scripts/pggb/windows.mjs "$WINDOWS" | nice -n 10 node scripts/pggb/reference-steps.mjs "$dir/chrY.gfa" "$graph/nodes" >"$steps"
python3 -I scripts/pggb/summary.py "$out" results/pggb/index-"$LAYOUT"-*.json "$steps"

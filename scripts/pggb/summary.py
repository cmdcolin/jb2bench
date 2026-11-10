"""python3 -I summary.py <windows.jsonl> [index.json...]

The pggb chrY numbers the paper quotes: the index build from the newest
index.json, then the browser windows grouped as no reference sequence (at most
four nodes: gaps and the masked PARs), drawn, or refused for passing the view's node limit.
"""
import json
import statistics
import sys

runs_path, *index_paths = sys.argv[1:]
if index_paths:
    index = json.load(open(sorted(index_paths)[-1]))
    print(f"index: {index['tool']} on {index['host']} ({index['cpu']}), "
          f"{index['gfaBytes'] / 1e9:.1f} GB GFA, {index['nodes'] / 1e6:.1f} M nodes, "
          f"{index['links'] / 1e6:.1f} M links, {index['seconds'] / 60:.1f} min, "
          f"{index['peakGB']} GB peak, load {index['load']}")

windows = {}
for line in open(runs_path):
    run = json.loads(line)
    windows.setdefault(run['start'], []).append(run)

empty, drawn, refused = [], [], []
for start, runs in sorted(windows.items()):
    nodes = runs[0]['nodes']
    row = {
        'start': start,
        'nodes': nodes,
        'cutMs': statistics.median(r['cutMs'] for r in runs),
        'requests': statistics.median(r['requests'] for r in runs),
        'MB': statistics.median(r['MB'] for r in runs),
        'runs': len(runs),
    }
    if any('too large' in (r.get('error') or '') for r in runs):
        refused.append(row)
    elif nodes <= 4:
        empty.append(row)
    else:
        drawn.append(row)

first = next(iter(windows.values()))[0]
loads = [r['load'] for runs in windows.values() for r in runs]
print(f"windows: {len(windows)} on {first['host']}, JBrowse {first.get('appVersion')}, "
      f"plugin {first['plugin']}, load {min(loads)}-{max(loads)}")
print(f"no reference sequence: {len(empty)}")


def spread(rows, field):
    values = [r[field] for r in rows]
    return f"median {statistics.median(values):g}, {min(values):g}-{max(values):g}"


if drawn:
    print(f"drawn: {len(drawn)}; nodes {spread(drawn, 'nodes')}; "
          f"cut ms {spread(drawn, 'cutMs')}; requests {spread(drawn, 'requests')}; "
          f"MB {spread(drawn, 'MB')}")
for row in refused:
    print(f"refused: chrY:{row['start']} with {row['nodes']} nodes")
for row in drawn + refused:
    print(json.dumps(row))

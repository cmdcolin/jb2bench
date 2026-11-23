"""python3 -I summary.py <windows.jsonl> [index.json...] [reference-steps.jsonl]

The pggb chrY numbers the paper quotes: the index build from the newest
index.json, then the browser windows grouped as no reference sequence (at most
four nodes: gaps and the masked PARs), drawn, or refused for passing the view's
node limit, with the median of each window's runs to loaded (cutMs) and to
drawn (drawnMs), and its GRCh38 steps and those the drawn graph holds.
"""
import json
import statistics
import sys

runs_path, *rest = sys.argv[1:]
index_paths = [p for p in rest if p.endswith('.json')]
steps = {}
for path in (p for p in rest if p.endswith('.jsonl')):
    for line in open(path):
        row = json.loads(line)
        if 'start' in row:
            steps[row['start']] = row
if index_paths:
    index = json.load(open(sorted(index_paths)[-1]))
    print(f"index: {index['tool']} on {index['host']} ({index['cpu']}), "
          f"{index.get('command', 'gfa-to-tabix')}, "
          f"{index['gfaBytes'] / 1e9:.1f} GB GFA, {index['nodes'] / 1e6:.1f} M nodes, "
          f"{index['links'] / 1e6:.1f} M links, {index['seconds'] / 60:.1f} min, "
          f"{index['peakGB']} GB peak, load {index['load']}")

windows = {}
for line in open(runs_path):
    run = json.loads(line)
    windows.setdefault(run['start'], []).append(run)


def median(runs, field):
    values = [r[field] for r in runs if r.get(field) is not None]
    return statistics.median(values) if values else None


empty, drawn, refused = [], [], []
for start, runs in sorted(windows.items()):
    nodes = runs[0]['nodes']
    row = {
        'start': start,
        'nodes': nodes,
        'links': runs[0].get('links'),
        'cutMs': median(runs, 'cutMs'),
        'drawnMs': median(runs, 'drawnMs'),
        'requests': median(runs, 'requests'),
        'MB': median(runs, 'MB'),
        'runs': len(runs),
        'sameCounts': len({(r['nodes'], r.get('links'), r['requests'], r['MB']) for r in runs}) == 1,
        **{k: steps[start][k] for k in ('steps', 'stepsDrawn', 'laterPassSteps', 'bpDrawn', 'nodesWithStepInWindow') if start in steps},
    }
    if any('too large' in (r.get('error') or '') for r in runs):
        refused.append(row)
    elif nodes <= 4:
        empty.append(row)
    else:
        drawn.append(row)

first = next(iter(windows.values()))[0]
loads = [r['load'] for runs in windows.values() for r in runs]
plugins = sorted({r['plugin'] for runs in windows.values() for r in runs})
builds = sorted({b for runs in windows.values() for r in runs for b in r.get('pluginBuilds', [])})
print(f"windows: {len(windows)} on {first['host']}, JBrowse {first.get('appVersion')}, "
      f"plugin {plugins} from {builds}, load {min(loads)}-{max(loads)} "
      f"(median {statistics.median(loads)})")
print(f"no reference sequence: {len(empty)}")


def spread(rows, field):
    values = [r[field] for r in rows if r[field] is not None]
    return f"median {statistics.median(values):g}, {min(values):g}-{max(values):g}" if values else 'none'


if drawn:
    print(f"drawn: {len(drawn)}; nodes {spread(drawn, 'nodes')}; links {spread(drawn, 'links')}; "
          f"to loaded ms {spread(drawn, 'cutMs')}; to drawn ms {spread(drawn, 'drawnMs')}; "
          f"requests {spread(drawn, 'requests')}; MB {spread(drawn, 'MB')}")
for row in refused:
    print(f"refused: chrY:{row['start']} with {row['nodes']} nodes")
for row in drawn + refused:
    print(json.dumps(row))

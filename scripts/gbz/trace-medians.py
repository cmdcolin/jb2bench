"""python3 -I trace-medians.py <runs.jsonl>...

Medians per window (graph-trace) or per track (lanes-trace).
"""
import json
import statistics
import sys

groups = {}
for path in sys.argv[1:]:
    for line in open(path):
        run = json.loads(line)
        if 'failed' in run:
            print('failed', run)
            continue
        key = run.get('loc') or f"{run['refName']}:{run['start']}-{run['end']}"
        groups.setdefault((path.split('/')[-1], run['trackId'], key), []).append(run)

for (path, track, key), runs in groups.items():
    def med(field):
        return statistics.median(r[field] for r in runs if r.get(field) is not None)
    timing = 'cutMs' if 'cutMs' in runs[0] else 'lastMs'
    print(json.dumps({
        'file': path,
        'track': track,
        'window': key,
        'runs': len(runs),
        'plugin': sorted({r.get('plugin') for r in runs}, key=str),
        'requests': med('requests'),
        'MB': med('MB'),
        'nodes': med('nodes') if 'nodes' in runs[0] else None,
        timing: med(timing),
        'load': [r['load'] for r in runs],
        'errors': [r['error'] for r in runs if r.get('error')],
        'urls': runs[-1]['urls'],
    }))

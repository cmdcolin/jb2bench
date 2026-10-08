import json, statistics, sys
# python3 walk-medians.py walk-window.jsonl > walk-window-medians.jsonl
# One line per file build, haplotype set, step budget, layout and window:
# the median of each number over the runs, with the first run's per-file
# request counts.
groups = {}
for line in open(sys.argv[1]):
    d = json.loads(line)
    if d.get('failed'):
        continue
    key = (d.get('files'), d['haplotypes'], d.get('walkStepBudget'), d['layoutMode'], d['refName'], d['start'], d['end'])
    groups.setdefault(key, []).append(d)
num = lambda v: v is not None and not isinstance(v, bool)
for (files, haplotypes, budget, layoutMode, refName, start, end), runs in sorted(groups.items(), key=lambda kv: (kv[0][0] or '', kv[0][2] or 0, kv[0][3], kv[0][1], kv[0][6])):
    out = {'layout': 'walks', **({'files': files} if files else {}), 'haplotypes': haplotypes, **({'walkStepBudget': budget} if budget else {}), 'layoutMode': layoutMode, 'refName': refName, 'start': start, 'end': end, 'runs': len(runs)}
    for k in ['cutMs', 'drawnMs', 'fetchMs', 'layoutMs', 'nodes', 'walks', 'requests', 'MB']:
        vals = [r[k] for r in runs if num(r.get(k))]
        out[k] = statistics.median(vals) if len(vals) == len(runs) else None
    errors = sorted({r['error'] for r in runs if r.get('error')})
    out['error'] = errors[0] if errors else None
    out['urls'] = runs[0]['urls']
    out['build'] = runs[0].get('build')
    print(json.dumps(out))

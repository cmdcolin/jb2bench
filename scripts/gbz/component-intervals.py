"""python3 -I component-intervals.py <anchored.graph.bed.gz> <out.csv> [refPrefix]

Reads a gfa-to-tabix format 2 anchored file and reports, per component of
non-reference nodes, the reference interval(s) its rows are filed under.
"""
import csv
import gzip
import json
import statistics
import sys

path, out_csv = sys.argv[1], sys.argv[2]
ref_prefix = sys.argv[3] if len(sys.argv) > 3 else 'GRCh38#'

parent = {}


def find(x):
    root = x
    while parent[root] != root:
        root = parent[root]
    while parent[x] != root:
        parent[x], x = root, parent[x]
    return root


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[max(ra, rb)] = min(ra, rb)


filed = {}
own = {}
attached = {}
header = None
with gzip.open(path, 'rt') as fh:
    for line in fh:
        if line.startswith('#'):
            header = header or line.strip()
            continue
        f = line.rstrip('\n').split('\t')
        if f[3] == 'N':
            node, rank = f[4], int(f[5])
            if rank != 0:
                parent.setdefault(node, node)
                filed.setdefault(node, set()).add((f[0], int(f[1]), int(f[2])))
                own[node] = (f[6], int(f[7]), int(f[8]))
        else:
            src, tgt = f[4][:-1], f[5][:-1]
            src_rank, tgt_rank = int(f[9]), int(f[13])
            if src_rank != 0 and tgt_rank != 0:
                parent.setdefault(src, src)
                parent.setdefault(tgt, tgt)
                union(src, tgt)
            elif src_rank != 0 or tgt_rank != 0:
                alt, ref_seq = (src, f[10]) if src_rank != 0 else (tgt, f[6])
                parent.setdefault(alt, alt)
                attached.setdefault(alt, set()).add(ref_seq)

components = {}
for node in parent:
    components.setdefault(find(node), []).append(node)

rows = []
for root, nodes in components.items():
    rows_filed = set().union(*(filed.get(n, set()) for n in nodes))
    ref_rows = {r for r in rows_filed if r[0].startswith(ref_prefix)}
    ref_attached = set().union(*(attached.get(n, set()) for n in nodes))
    per_seq = {}
    for seq, start, end in ref_rows:
        lo, hi = per_seq.get(seq, (start, end))
        per_seq[seq] = (min(lo, start), max(hi, end))
    lengths = [hi - lo for lo, hi in per_seq.values()]
    filing = 'anchored' if ref_rows else ('moved' if ref_attached else 'unattached')
    rows.append({
        'component': root,
        'nodes': len(nodes),
        'filing': filing,
        'ref_seqs': len(per_seq),
        'attached_ref_seqs': len(ref_attached),
        'seqs': ';'.join(sorted(per_seq)),
        'interval_bp': max(lengths) if lengths else '',
        'total_interval_bp': sum(lengths) if lengths else '',
    })

with open(out_csv, 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0]))
    w.writeheader()
    for r in sorted(rows, key=lambda r: (r['filing'], -r['nodes'])):
        w.writerow(r)


def pct(xs, p):
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


anchored = [r for r in rows if r['filing'] == 'anchored']
lens = sorted(r['interval_bp'] for r in anchored)
summary = {
    'file': path.split('/')[-1],
    'header': header,
    'components': len(rows),
    'by_filing': {k: sum(r['filing'] == k for r in rows) for k in ('anchored', 'moved', 'unattached')},
    'moved_nodes': [r['nodes'] for r in rows if r['filing'] == 'moved'],
    'non_reference_nodes': len(parent),
    'anchored_interval_bp': {
        'median': statistics.median(lens),
        'p90': pct(lens, 90),
        'p99': pct(lens, 99),
        'max': lens[-1],
        'over_100kb': sum(x > 100_000 for x in lens),
        'over_1Mb': sum(x > 1_000_000 for x in lens),
    },
    'filed_under_multiple_ref_seqs': sum(r['ref_seqs'] > 1 for r in anchored),
    'largest_intervals': [
        {k: r[k] for k in ('component', 'nodes', 'seqs', 'interval_bp')}
        for r in sorted(anchored, key=lambda r: -r['interval_bp'])[:5]
    ],
}
print(json.dumps(summary, indent=1))

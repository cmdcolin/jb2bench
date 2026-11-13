"""repeated_bp.py nodes/repeated_nodes.tsv nodes/node_lengths.tsv.gz nodes/grch38_walks.gfa.gz chr1:196640000-196900000

Lengths of the nodes GRCh38 visits more than once: total bp, bp per
chromosome (a node shared by two chromosomes counts for both), the longest
ones, and which of the nodes GRCh38 walks in the given window are repeated.
"""
import gzip
import re
import sys
from collections import Counter

rep_path, len_path, walks_path, window = sys.argv[1:5]
chrom, span = window.split(':')
wstart, wend = (int(x) for x in span.split('-'))

repeated = {}
with open(rep_path) as fh:
    next(fh)
    for line in fh:
        node, visits, chroms = line.rstrip('\n').split('\t')
        repeated[node] = (int(visits), chroms)

walk_nodes = []
with gzip.open(walks_path, 'rt') as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if f[3] == chrom:
            walk_nodes.append((int(f[4]), re.findall(r'([<>])([0-9]+)', f[6])))
window_ids = set()
for start, steps in walk_nodes:
    for o, node in steps:
        window_ids.add(node)
need = set(repeated) | window_ids

length = {}
with gzip.open(len_path, 'rt') as fh:
    for line in fh:
        node, n = line.split('\t')
        if node in need:
            length[node] = int(n)

total_bp = sum(length[n] for n in repeated)
extra_bp = sum(length[n] * (v - 1) for n, (v, c) in repeated.items())
per_chrom = Counter()
for n, (v, c) in repeated.items():
    for ch in c.split(','):
        per_chrom[ch] += length[n]
print(f'repeated nodes: {len(repeated)}, their lengths sum to {total_bp} bp; extra visits cover {extra_bp} bp')
longest = sorted(repeated, key=lambda n: -length[n])[:10]
print('longest repeated nodes (id, bp, visits, chromosomes): ' + '; '.join(f'{n} {length[n]} {repeated[n][0]} {repeated[n][1]}' for n in longest))
hist = Counter()
for n in repeated:
    L = length[n]
    hist['1 bp' if L == 1 else '2-9 bp' if L < 10 else '10-99 bp' if L < 100 else '100-999 bp' if L < 1000 else '>=1 kb'] += 1
print('repeated node length classes: ' + ', '.join(f'{k}: {hist[k]}' for k in ['1 bp', '2-9 bp', '10-99 bp', '100-999 bp', '>=1 kb']))
print()
print('chromosome\trepeated_node_bp')


def chrom_key(c):
    m = re.match(r'chr(\d+)$', c)
    return (0, int(m.group(1))) if m else (1, c)


for ch in sorted(per_chrom, key=chrom_key):
    print(f'{ch}\t{per_chrom[ch]}')
print()
in_window = []
n_window = 0
for start, steps in walk_nodes:
    pos = start
    for o, node in steps:
        L = length[node]
        if pos < wend and pos + L > wstart:
            n_window += 1
            if node in repeated:
                in_window.append((pos, pos + L, node, L, repeated[node]))
        pos += L
print(f'{window}: GRCh38 walks {n_window} nodes, {len(in_window)} of them visited more than once')
for pos, end, node, L, (v, c) in in_window:
    print(f'  {chrom}:{pos}-{end} node {node} {L} bp, {v} visits, {c}')

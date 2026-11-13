"""stdin: `node_id<TAB>chromosome` lines sorted by node id (LC_ALL=C sort).

argv[1]: path for a TSV of every node visited more than once
(node_id, visits, chromosomes). stdout: the summary table.
"""
import re
import sys
from collections import Counter

repeated_out = open(sys.argv[1], 'w')
repeated_out.write('node_id\tvisits\tchromosomes\n')
visits = Counter()
distinct = Counter()
repeated = Counter()
within_only = Counter()
cross = Counter()
pairs = Counter()
visit_hist = Counter()
total_visits = 0
total_distinct = 0
total_repeated = 0
max_visits = (0, None)


def flush(node, chroms):
    global total_distinct, total_repeated, max_visits
    total_distinct += 1
    n = len(chroms)
    u = set(chroms)
    for c in u:
        distinct[c] += 1
    if n > 1:
        total_repeated += 1
        visit_hist[n] += 1
        if n > max_visits[0]:
            max_visits = (n, node)
        for c in u:
            repeated[c] += 1
        if len(u) == 1:
            within_only[chroms[0]] += 1
        else:
            for c in u:
                cross[c] += 1
            pairs['+'.join(sorted(u))] += 1
        repeated_out.write(f'{node}\t{n}\t{",".join(sorted(u))}\n')


current = None
chroms = []
for line in sys.stdin:
    node, chrom = line.rstrip('\n').split('\t')
    total_visits += 1
    visits[chrom] += 1
    if node != current:
        if current is not None:
            flush(current, chroms)
        current = node
        chroms = []
    chroms.append(chrom)
if current is not None:
    flush(current, chroms)
repeated_out.close()

print(f'node visits in GRCh38 walks: {total_visits}')
print(f'distinct nodes: {total_distinct}')
print(f'nodes visited more than once: {total_repeated}')
print(f'extra visits (visits minus distinct): {total_visits - total_distinct}')
print(f'max visits of one node: {max_visits[0]} (node {max_visits[1]})')
print('visit-count histogram (visits: nodes): ' + ', '.join(f'{k}: {visit_hist[k]}' for k in sorted(visit_hist)))
print()
print('chromosome\tvisits\tdistinct\trepeated_nodes\trepeated_within_chrom_only\tshared_with_other_chrom')


def chrom_key(c):
    m = re.match(r'chr(\d+)$', c)
    return (0, int(m.group(1))) if m else (1, c)


for c in sorted(visits, key=chrom_key):
    print(f'{c}\t{visits[c]}\t{distinct[c]}\t{repeated[c]}\t{within_only[c]}\t{cross[c]}')
if pairs:
    print()
    print('nodes shared between chromosomes (chromosome set: nodes)')
    for k, v in pairs.most_common():
        print(f'{k}\t{v}')

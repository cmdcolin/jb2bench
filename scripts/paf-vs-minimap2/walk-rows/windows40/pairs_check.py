"""pairs_check.py pairs.jsonl asmdir reffa workdir [plant]

For each haplotype-against-haplotype record the walk file's lane aligner gave:
- are the bases of every '=' run identical in the two assemblies' FASTAs
- does minimap2, run on the two haplotypes' stretches, put the same bases on
  the same diagonal
plant: 'shift' moves every record's query by one base, 'swap' swaps I and D.
"""
import collections
import json
import os
import re
import subprocess
import sys

rows_path, asm_dir, ref_fa, work = sys.argv[1:5]
plant = sys.argv[5] if len(sys.argv) > 5 else ''
os.makedirs(work, exist_ok=True)
MARGIN = 20000
COMP = str.maketrans('ACGTNacgtn', 'TGCANtgcan')
CIG = re.compile(r'(\d+)([=XID])')

fasta_of = {}
for name in os.listdir(asm_dir):
    if name.endswith('.fai'):
        with open(os.path.join(asm_dir, name)) as fh:
            for line in fh:
                contig, length = line.split('\t')[:2]
                fasta_of[contig] = (os.path.join(asm_dir, name[:-4]), int(length))
with open(ref_fa + '.fai') as fh:
    for line in fh:
        contig, length = line.split('\t')[:2]
        fasta_of['GRCh38#0#' + contig] = (ref_fa, int(length))


def fetch(contig, lo, hi):
    path, _ = fasta_of[contig]
    name = contig.split('#')[-1] if contig.startswith('GRCh38#0#') else contig
    text = subprocess.run(
        ['samtools', 'faidx', path, f'{name}:{lo + 1}-{hi}'],
        check=True, capture_output=True, text=True).stdout
    return ''.join(text.split('\n')[1:]).upper()


def runs_of(t_start, q_start, q_end, strand, edits):
    """'=' runs as (target start, query position of the base paired with it, length)"""
    t = t_start
    q = q_start if strand == '+' else q_end
    out = []
    for op, n in edits:
        if op == '=':
            out.append((t, q if strand == '+' else q - 1, n))
        if op in '=XD':
            t += n
        if op in '=XI':
            q += n if strand == '+' else -n
    return out


def diagonals(runs, strand):
    by = collections.defaultdict(list)
    for t, q, n in runs:
        by[q - t if strand == '+' else q + t].append((t, t + n))
    return by


def merged(spans):
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def total(by):
    return sum(b - a for spans in by.values() for a, b in merged(spans))


def shared(x, y):
    bp = 0
    for key, spans in x.items():
        if key in y:
            a, b = merged(spans), merged(y[key])
            i = j = 0
            while i < len(a) and j < len(b):
                bp += max(0, min(a[i][1], b[j][1]) - max(a[i][0], b[j][0]))
                if a[i][1] < b[j][1]:
                    i += 1
                else:
                    j += 1
    return bp


groups = collections.defaultdict(list)
skipped = collections.Counter()
with open(rows_path) as fh:
    for line in fh:
        r = json.loads(line)
        if r['tName'] in fasta_of and r['qName'] in fasta_of:
            if plant == 'shift':
                r['qStart'] += 1
                r['qEnd'] += 1
            if plant == 'swap':
                r['edits'] = [[{'I': 'D', 'D': 'I'}.get(op, op), n] for op, n in r['edits']]
            groups[(r['kind'], r['locus'], r['tName'], r['qName'])].append(r)
        else:
            skipped[(r['kind'], r['locus'])] += 1

print('\t'.join(['kind', 'locus', 'target', 'query', 'records', 'reverse_records',
                 'walk_eq_bp', 'identical_in_fasta', 'mm2_eq_bp', 'same_diagonal',
                 'walk_only', 'mm2_only']))
sums = collections.defaultdict(lambda: [0] * 8)
for (kind, locus, t_name, q_name), recs in sorted(groups.items()):
    t_lo = max(0, min(r['tStart'] for r in recs) - MARGIN)
    t_hi = min(fasta_of[t_name][1], max(r['tEnd'] for r in recs) + MARGIN)
    q_lo = max(0, min(r['qStart'] for r in recs) - MARGIN)
    q_hi = min(fasta_of[q_name][1], max(r['qEnd'] for r in recs) + MARGIN)
    t_seq = fetch(t_name, t_lo, t_hi)
    q_seq = fetch(q_name, q_lo, q_hi)
    walk = {'+': collections.defaultdict(list), '-': collections.defaultdict(list)}
    eq = same = 0
    for r in recs:
        runs = runs_of(r['tStart'], r['qStart'], r['qEnd'], r['strand'], r['edits'])
        for key, spans in diagonals(runs, r['strand']).items():
            walk[r['strand']][key].extend(spans)
        for t, q, n in runs:
            eq += n
            a = t_seq[t - t_lo:t - t_lo + n]
            if r['strand'] == '+':
                b = q_seq[q - q_lo:q - q_lo + n]
            else:
                b = q_seq[q - n + 1 - q_lo:q + 1 - q_lo][::-1].translate(COMP)
            if len(a) != n or len(b) != n:
                raise SystemExit(f'run outside the fetched bases: {t_name} {q_name} {t} {q} {n}')
            same += sum(1 for x, y in zip(a, b) if x == y)
    tag = f'{locus}.{t_name}.{q_name}'.replace('#', '_')
    t_fa, q_fa = os.path.join(work, tag + '.t.fa'), os.path.join(work, tag + '.q.fa')
    with open(t_fa, 'w') as fh:
        fh.write(f'>t\n{t_seq}\n')
    with open(q_fa, 'w') as fh:
        fh.write(f'>q\n{q_seq}\n')
    paf = subprocess.run(['minimap2', '-t', '2', '-cx', 'asm5', '--eqx', t_fa, q_fa],
                         check=True, capture_output=True, text=True).stdout
    os.remove(t_fa)
    os.remove(q_fa)
    mm = {'+': collections.defaultdict(list), '-': collections.defaultdict(list)}
    for line in paf.split('\n'):
        f = line.split('\t')
        if len(f) > 12 and 'tp:A:P' in f:
            cigar = next(x for x in f if x.startswith('cg:Z:'))[5:]
            edits = [(op, int(n)) for n, op in CIG.findall(cigar)]
            runs = runs_of(int(f[7]) + t_lo, int(f[2]) + q_lo, int(f[3]) + q_lo, f[4], edits)
            runs = [(max(t, t_lo + MARGIN), q + (max(t, t_lo + MARGIN) - t) * (1 if f[4] == '+' else -1),
                     min(t + n, t_hi - MARGIN) - max(t, t_lo + MARGIN))
                    for t, q, n in runs if min(t + n, t_hi - MARGIN) > max(t, t_lo + MARGIN)]
            for key, spans in diagonals(runs, f[4]).items():
                mm[f[4]][key].extend(spans)
    walk_bp = total(walk['+']) + total(walk['-'])
    mm_bp = total(mm['+']) + total(mm['-'])
    both = shared(walk['+'], mm['+']) + shared(walk['-'], mm['-'])
    reverse = sum(1 for r in recs if r['strand'] == '-')
    vals = [len(recs), reverse, eq, same, mm_bp, both, walk_bp - both, mm_bp - both]
    print('\t'.join([kind, locus, t_name, q_name] + [str(v) for v in vals]), flush=True)
    for i, v in enumerate(vals):
        sums[(kind, locus)][i] += v
print()
for (kind, locus), v in sorted(sums.items()):
    print('\t'.join(['SUM', kind, locus, '', ''] + [str(x) for x in v]
                    + [f'identical={v[3] / max(1, v[2]):.6f}',
                       f'walk_on_mm2_diagonal={v[5] / max(1, v[2]):.5f}',
                       f'mm2_on_walk_diagonal={v[5] / max(1, v[4]):.5f}']))
for key, n in sorted(skipped.items()):
    print('SKIPPED (no FASTA for a contig)', key, n)

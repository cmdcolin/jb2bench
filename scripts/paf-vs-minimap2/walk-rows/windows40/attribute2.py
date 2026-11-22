"""attribute2.py pairs.jsonl steps.jsonl asmdir reffa workdir [plant]

For each pair of stretches, minimap2 run both ways and joined, then for each
aligner ('shipped', 'proto'):
- its '=' bases, how many are identical in the FASTAs, how many are on a
  minimap2 diagonal
- minimap2's matched bases sorted: the aligner reports them; both walks step
  the same node at that base and both bases have a ribbon to another copy;
  the same but one of the two bases has no ribbon at all; the other walk steps
  the node elsewhere; the other walk never steps it; outside the cut
plant 'shift' moves every proto record's query by one base.
"""
import bisect
import collections
import json
import os
import re
import subprocess
import sys

rows_path, steps_path, asm_dir, ref_fa, work = sys.argv[1:6]
plant = sys.argv[6] if len(sys.argv) > 6 else ''
os.makedirs(work, exist_ok=True)
MARGIN = 20000
COMP = str.maketrans('ACGTN', 'TGCAN')
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
    text = subprocess.run(['samtools', 'faidx', path, f'{name}:{lo + 1}-{hi}'],
                          check=True, capture_output=True, text=True).stdout
    return ''.join(text.split('\n')[1:]).upper()


def runs_of(t_start, q_start, q_end, strand, edits):
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


def merged(spans):
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


class Spans:
    def __init__(self, spans):
        self.spans = merged(spans)
        self.starts = [s[0] for s in self.spans]

    def overlap(self, a, b):
        bp = 0
        i = max(0, bisect.bisect_right(self.starts, a) - 1)
        while i < len(self.spans) and self.spans[i][0] < b:
            bp += max(0, min(b, self.spans[i][1]) - max(a, self.spans[i][0]))
            i += 1
        return bp

    def total(self):
        return sum(b - a for a, b in self.spans)


def minimap2(t_seq, q_seq, tag):
    t_fa, q_fa = os.path.join(work, tag + '.t.fa'), os.path.join(work, tag + '.q.fa')
    with open(t_fa, 'w') as fh:
        fh.write(f'>t\n{t_seq}\n')
    with open(q_fa, 'w') as fh:
        fh.write(f'>q\n{q_seq}\n')
    paf = subprocess.run(['minimap2', '-t', '2', '-cx', 'asm5', '--eqx', t_fa, q_fa],
                         check=True, capture_output=True, text=True).stdout
    os.remove(t_fa)
    os.remove(q_fa)
    out = []
    for line in paf.split('\n'):
        f = line.split('\t')
        if len(f) > 12 and 'tp:A:P' in f:
            cigar = next(x for x in f if x.startswith('cg:Z:'))[5:]
            edits = [(op, int(n)) for n, op in CIG.findall(cigar)]
            out.append((int(f[7]), int(f[2]), int(f[3]), f[4], edits))
    return out


walks = collections.defaultdict(list)
with open(steps_path) as fh:
    for line in fh:
        f = json.loads(line)
        pos = f['hapStart']
        for node, rev, length in zip(f['ids'], f['rev'], f['lens']):
            walks[(f['locus'], f['name'])].append((pos, pos + length, node, rev))
            pos += length
index = {}
for key, steps in walks.items():
    steps.sort()
    index[key] = ([s[0] for s in steps], steps, {s[2] for s in steps})


def step_at(key, pos):
    starts, steps, _ = index[key]
    i = bisect.bisect_right(starts, pos) - 1
    return steps[i] if i >= 0 and steps[i][1] > pos else None


groups = collections.defaultdict(list)
with open(rows_path) as fh:
    for line in fh:
        r = json.loads(line)
        if r['tName'] in fasta_of and r['qName'] in fasta_of:
            if plant == 'shift' and r['method'] == 'proto':
                r['qStart'] += 1
                r['qEnd'] += 1
            groups[(r['kind'], r['locus'], r['tName'], r['qName'])].append(r)

FIELDS = ['records', 'extra_records', 'eq_bp', 'identical', 'on_mm2_diagonal', 'not_on_mm2',
          'mm2_bp', 'reported', 'same_base_other_copy', 'same_base_no_ribbon',
          'node_elsewhere', 'node_not_stepped', 'outside_cut']
print('\t'.join(['method', 'kind', 'locus', 'target', 'query'] + FIELDS))
sums = collections.defaultdict(collections.Counter)
for (kind, locus, t_name, q_name), recs in sorted(groups.items()):
    t_lo = max(0, min(r['tStart'] for r in recs) - MARGIN)
    t_hi = min(fasta_of[t_name][1], max(r['tEnd'] for r in recs) + MARGIN)
    q_lo = max(0, min(r['qStart'] for r in recs) - MARGIN)
    q_hi = min(fasta_of[q_name][1], max(r['qEnd'] for r in recs) + MARGIN)
    t_seq = fetch(t_name, t_lo, t_hi)
    q_seq = fetch(q_name, q_lo, q_hi)
    tag = f'{locus}.{t_name}.{q_name}'.replace('#', '_')
    a_lo, a_hi = t_lo + MARGIN, t_hi - MARGIN
    mm = collections.defaultdict(list)

    def add(a, b_at_a, n, strand):
        lo, hi = max(a, a_lo), min(a + n, a_hi)
        if hi > lo:
            mm[(strand, b_at_a - a if strand == '+' else b_at_a + a)].append((lo, hi))

    for ts, qs, qe, strand, edits in minimap2(t_seq, q_seq, tag + '.ab'):
        for t, q, n in runs_of(ts + t_lo, qs + q_lo, qe + q_lo, strand, edits):
            add(t, q, n, strand)
    for ts, qs, qe, strand, edits in minimap2(q_seq, t_seq, tag + '.ba'):
        for b, a, n in runs_of(ts + q_lo, qs + t_lo, qe + t_lo, strand, edits):
            if strand == '+':
                add(a, b, n, strand)
            else:
                add(a - n + 1, b + n - 1, n, strand)
    mm = {k: Spans(v) for k, v in mm.items()}
    mm_bp = sum(s.total() for s in mm.values())
    t_key, q_key = (locus, t_name), (locus, q_name)
    q_nodes = index[q_key][2]
    for method in ['shipped', 'proto']:
        mine = [r for r in recs if r['method'] == method]
        c = collections.Counter(records=len(mine), mm2_bp=mm_bp,
                                extra_records=sum(1 for r in mine if r.get('piece') not in (None, 'backbone')))
        diag = collections.defaultdict(list)
        a_cov, b_cov = [], []
        for r in mine:
            for t, q, n in runs_of(r['tStart'], r['qStart'], r['qEnd'], r['strand'], r['edits']):
                plus = r['strand'] == '+'
                diag[(r['strand'], q - t if plus else q + t)].append((t, t + n))
                a_cov.append((t, t + n))
                b_cov.append((q, q + n) if plus else (q - n + 1, q + 1))
                a = t_seq[t - t_lo:t - t_lo + n]
                b = q_seq[q - q_lo:q - q_lo + n] if plus else \
                    q_seq[q - n + 1 - q_lo:q + 1 - q_lo][::-1].translate(COMP)
                if len(a) != n or len(b) != n:
                    raise SystemExit(f'run outside the fetched bases: {method} {t_name} {q_name} {t} {q} {n}')
                c['eq_bp'] += n
                c['identical'] += n if a == b else sum(1 for x, y in zip(a, b) if x == y)
        diag = {k: Spans(v) for k, v in diag.items()}
        a_cov, b_cov = Spans(a_cov), Spans(b_cov)
        for key, spans in diag.items():
            for a, b in spans.spans:
                lo, hi = max(a, a_lo), min(b, a_hi)
                if hi > lo:
                    on = mm[key].overlap(lo, hi) if key in mm else 0
                    c['on_mm2_diagonal'] += on
                    c['not_on_mm2'] += hi - lo - on
        for (strand, d), spans in mm.items():
            sign = 1 if strand == '+' else -1
            mine_here = diag.get((strand, d))
            for a, b in spans.spans:
                t = a
                while t < b:
                    q = d + t if sign == 1 else d - t
                    ts = step_at(t_key, t)
                    qs = step_at(q_key, q)
                    if ts is None or qs is None:
                        seg = 1
                        relation = 'outside_cut'
                    else:
                        q_left = qs[1] - q if sign == 1 else q - qs[0] + 1
                        seg = min(ts[1] - t, q_left, b - t)
                        t_off = t - ts[0] if not ts[3] else ts[1] - 1 - t
                        q_off = q - qs[0] if not qs[3] else qs[1] - 1 - q
                        same_way = (-1 if ts[3] else 1) == sign * (-1 if qs[3] else 1)
                        if ts[2] == qs[2] and t_off == q_off and same_way:
                            relation = 'same'
                        elif ts[2] in q_nodes:
                            relation = 'node_elsewhere'
                        else:
                            relation = 'node_not_stepped'
                    on = mine_here.overlap(t, t + seg) if mine_here else 0
                    off = seg - on
                    c['reported'] += on
                    if relation == 'same':
                        b_lo, b_hi = (q, q + seg) if sign == 1 else (q - seg + 1, q + 1)
                        both = max(0, min(a_cov.overlap(t, t + seg), b_cov.overlap(b_lo, b_hi)) - on)
                        both = min(both, off)
                        c['same_base_other_copy'] += both
                        c['same_base_no_ribbon'] += off - both
                    else:
                        c[relation] += off
                    t += seg
        print('\t'.join([method, kind, locus, t_name, q_name] + [str(c[f]) for f in FIELDS]), flush=True)
        sums[(method, kind, locus)].update(c)
print()
for (method, kind, locus), c in sorted(sums.items(), key=lambda kv: (kv[0][1], kv[0][2], kv[0][0])):
    m = max(1, c['mm2_bp'])
    print('\t'.join(['SUM', method, kind, locus, f"records={c['records']} extra={c['extra_records']}",
                     f"eq={c['eq_bp']} identical={c['identical'] / max(1, c['eq_bp']):.6f}",
                     f"not_on_mm2={c['not_on_mm2']} ({c['not_on_mm2'] / max(1, c['eq_bp']):.2%})",
                     f"mm2={c['mm2_bp']}"]
                    + [f"{f}={c[f] / m:.1%}" for f in FIELDS[7:]]))

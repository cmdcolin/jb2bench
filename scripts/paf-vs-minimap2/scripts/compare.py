"""compare.py --hap HG01109#1 --pif pif/X.paf --mm2 mm2/X.asm5.paf --ref ref/chr1.fa
              --qfa asm/X.fa --window chr1:196640000-196900000 --out out/X.asm5

Per reference base of the window, where the PIF (graph-derived) and minimap2
alignments put it on the haplotype. Writes <out>.summary.tsv (one row),
<out>.runs.tsv (every run of one status; runs >= 1 kb are the report's
disagreements) and <out>.per_base.tsv.gz is not written: the arrays are
recomputed from the PAFs. Both PAFs: cg:Z: with =/X/I/D (minimap2 --eqx),
CIGAR along the target's forward strand, the query walked backwards for '-'.
"""
import argparse
import gzip
import re
import subprocess
import sys

ap = argparse.ArgumentParser()
ap.add_argument('--hap', required=True)
ap.add_argument('--pif', required=True)
ap.add_argument('--mm2', required=True)
ap.add_argument('--ref', required=True)
ap.add_argument('--qfa', required=True)
ap.add_argument('--window', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--near', type=int, default=10)
args = ap.parse_args()

chrom, span = args.window.split(':')
wstart, wend = (int(x) for x in span.split('-'))
n = wend - wstart
CIG = re.compile(r'(\d+)([=XMIDNSH])')


def read_paf(path, primary_only):
    rows = []
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt') as fh:
        for line in fh:
            f = line.rstrip('\n').split('\t')
            if len(f) < 12:
                continue
            tags = {t[:2]: t[5:] for t in f[12:]}
            tname = f[5].rsplit('#', 1)[-1]
            if tname != chrom:
                continue
            tstart, tend = int(f[7]), int(f[8])
            if tend <= wstart or tstart >= wend:
                continue
            if primary_only and tags.get('tp', 'P') != 'P':
                continue
            rows.append({
                'qname': f[0], 'qlen': int(f[1]), 'qstart': int(f[2]), 'qend': int(f[3]), 'strand': f[4],
                'tstart': tstart, 'tend': tend, 'matches': int(f[9]), 'columns': int(f[10]),
                'cg': tags['cg'], 'tp': tags.get('tp', ''), 'line': line.rstrip('\n'),
            })
    return rows


def place(rows):
    """For each window base: (contig, qpos, strand, op) or None; covered: inside some alignment's span."""
    placed = [None] * n
    multi = [0] * n
    covered = bytearray(n)
    for r in rows:
        for t in range(max(r['tstart'], wstart), min(r['tend'], wend)):
            covered[t - wstart] = 1
        t = r['tstart']
        fwd = r['strand'] == '+'
        q = r['qstart'] if fwd else r['qend'] - 1
        step = 1 if fwd else -1
        for m in CIG.finditer(r['cg']):
            k, op = int(m.group(1)), m.group(2)
            if op in '=XM':
                lo, hi = max(t, wstart), min(t + k, wend)
                for tt in range(lo, hi):
                    i = tt - wstart
                    qq = q + (tt - t) * step
                    if placed[i] is None:
                        placed[i] = (r['qname'], qq, r['strand'], op)
                    else:
                        multi[i] += 1
                t += k
                q += k * step
            elif op in 'DN':
                t += k
            elif op in 'IS':
                q += k * step
    return placed, covered, multi


pif_rows = read_paf(args.pif, False)
mm2_rows = read_paf(args.mm2, True)
P, Pcov, Pmulti = place(pif_rows)
M, Mcov, Mmulti = place(mm2_rows)


def fasta_region(fa, name, lo, hi):
    out = subprocess.run(['samtools', 'faidx', fa, f'{name}:{lo + 1}-{hi}'], capture_output=True, text=True, check=True).stdout
    return ''.join(out.split('\n')[1:]).upper()


COMP = str.maketrans('ACGTN', 'TGCAN')
ref_seq = fasta_region(args.ref, chrom, wstart, wend)
qseqs = {}
for p in P:
    if p is not None:
        qseqs.setdefault(p[0], [p[1], p[1]])
        lo_hi = qseqs[p[0]]
        lo_hi[0] = min(lo_hi[0], p[1])
        lo_hi[1] = max(lo_hi[1], p[1])
qseq = {name: (lo, fasta_region(args.qfa, name, lo, hi + 1)) for name, (lo, hi) in qseqs.items()}


def qbase(p):
    lo, s = qseq[p[0]]
    b = s[p[1] - lo]
    return b if p[2] == '+' else b.translate(COMP)


status = [''] * n
counts = {}
pif_eq = pif_x = 0
pif_eq_same_base = pif_x_same_base = 0
mm2_eq = mm2_x = 0
mm2_x_on_pif_eq = 0
for i in range(n):
    p, m = P[i], M[i]
    if p is not None:
        if p[3] == '=':
            pif_eq += 1
            pif_eq_same_base += qbase(p) == ref_seq[i]
        else:
            pif_x += 1
            pif_x_same_base += qbase(p) == ref_seq[i]
    if m is not None:
        if m[3] == '=':
            mm2_eq += 1
        else:
            mm2_x += 1
    if p is None and m is None:
        s = 'neither'
    elif m is None:
        s = 'pif_only'
    elif p is None:
        s = 'mm2_only'
    elif p[:3] == m[:3]:
        s = 'exact'
        if p[3] == '=' and m[3] != '=':
            mm2_x_on_pif_eq += 1
    elif p[0] == m[0] and p[2] == m[2] and abs(p[1] - m[1]) <= args.near:
        s = 'within10'
    else:
        s = 'different'
    status[i] = s
    counts[s] = counts.get(s, 0) + 1

pif_placed = sum(1 for p in P if p is not None)
mm2_placed = sum(1 for m in M if m is not None)
both = counts.get('exact', 0) + counts.get('within10', 0) + counts.get('different', 0)
contig = ','.join(sorted({r['qname'] for r in pif_rows}))
summary = {
    'haplotype': args.hap, 'contig': contig, 'mm2': args.mm2.rsplit('.', 2)[-2],
    'window_bp': n, 'pif_placed': pif_placed, 'pif_eq': pif_eq, 'pif_X': pif_x,
    'mm2_placed': mm2_placed, 'mm2_eq': mm2_eq, 'mm2_X': mm2_x,
    'both_placed': both, 'exact': counts.get('exact', 0), 'within10': counts.get('within10', 0) + counts.get('exact', 0),
    'different': counts.get('different', 0), 'pif_only': counts.get('pif_only', 0), 'mm2_only': counts.get('mm2_only', 0),
    'neither': counts.get('neither', 0),
    'pif_eq_bases_identical': pif_eq_same_base, 'pif_X_bases_identical': pif_x_same_base,
    'mm2_X_where_pif_eq_same_base': mm2_x_on_pif_eq,
    'pif_rows': len(pif_rows), 'mm2_rows': len(mm2_rows),
    'pif_multi': sum(1 for x in Pmulti if x), 'mm2_multi': sum(1 for x in Mmulti if x),
}
with open(args.out + '.summary.tsv', 'w') as fh:
    fh.write('\t'.join(summary) + '\n')
    fh.write('\t'.join(str(v) for v in summary.values()) + '\n')


def describe(placed, covered, rows, i, j, what):
    a, b = placed[i], placed[j - 1]
    if a is not None and b is not None:
        d = f'{a[0].rsplit("#", 1)[-1]}:{a[1]:,}-{b[1] + 1:,}({a[2]})'
    elif covered[i] and covered[j - 1]:
        d = 'inside an alignment, reference-only (D)'
    else:
        inside = [r for r in rows if r['tstart'] < wstart + j and r['tend'] > wstart + i]
        d = 'between alignments' if not inside else 'partly inside an alignment, reference-only (D)'
        before = max((r for r in rows if r['tend'] <= wstart + i), key=lambda r: r['tend'], default=None)
        after = min((r for r in rows if r['tstart'] >= wstart + j), key=lambda r: r['tstart'], default=None)
        if before and after:
            qgap = after['qstart'] - before['qend'] if before['strand'] == '+' else before['qstart'] - after['qend']
            d += f': previous alignment ends ref {before["tend"]:,} query {before["qend"] if before["strand"] == "+" else before["qstart"]:,}, next starts ref {after["tstart"]:,} query {after["qstart"] if after["strand"] == "+" else after["qend"]:,}, query gap {qgap:,} bp'
    return d


with open(args.out + '.runs.tsv', 'w') as fh:
    fh.write('haplotype\tmm2\tstatus\tref_start\tref_end\tlength\tpif_says\tmm2_says\n')
    i = 0
    while i < n:
        j = i
        while j < n and status[j] == status[i]:
            j += 1
        fh.write('\t'.join([args.hap, summary['mm2'], status[i], str(wstart + i), str(wstart + j), str(j - i),
                            describe(P, Pcov, pif_rows, i, j, 'pif'), describe(M, Mcov, mm2_rows, i, j, 'mm2')]) + '\n')
        i = j
print('\t'.join(f'{k}={v}' for k, v in summary.items()))

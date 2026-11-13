"""compare_segments.py --pif A.paf --mm2 B.paf --sizes chrom.sizes --out prefix [--near 10]

Genome-wide version of compare.py without per-base arrays: each alignment's
=/X/M runs become diagonal segments (ref interval -> query contig, strand,
offset), and one sweep per chromosome over all segment ends classifies every
elementary interval: exact (same contig, strand and offset in both), within
<near> bp, shifted (same contig and strand, further than <near> bp), elsewhere
(another contig or strand), pif_only, mm2_only. Only minimap2 primary rows (tp:A:P)
count. Writes <out>.by_chrom.tsv and prints the genome total.
"""
import argparse
import gzip
import re
from collections import defaultdict

ap = argparse.ArgumentParser()
ap.add_argument('--pif', required=True)
ap.add_argument('--mm2', required=True)
ap.add_argument('--sizes', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--near', type=int, default=10)
args = ap.parse_args()
CIG = re.compile(r'(\d+)([=XMIDNSH])')


def segments(path, primary_only):
    segs = defaultdict(list)
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt') as fh:
        for line in fh:
            f = line.rstrip('\n').split('\t')
            if len(f) < 12:
                continue
            tags = {t[:2]: t[5:] for t in f[12:]}
            if primary_only and tags.get('tp', 'P') != 'P':
                continue
            chrom = f[5].rsplit('#', 1)[-1]
            t = int(f[7])
            fwd = f[4] == '+'
            q = int(f[2]) if fwd else int(f[3]) - 1
            key = (f[0], f[4])
            run_start = None
            run_off = None
            out = segs[chrom]
            for m in CIG.finditer(tags['cg']):
                k, op = int(m.group(1)), m.group(2)
                if op in '=XM':
                    off = q - t if fwd else q + t
                    if run_start is not None and off == run_off:
                        pass
                    else:
                        if run_start is not None:
                            out.append((run_start, t, key, run_off))
                        run_start, run_off = t, off
                    t += k
                    q += k if fwd else -k
                elif op in 'DN':
                    t += k
                elif op in 'IS':
                    q += k if fwd else -k
            if run_start is not None:
                out.append((run_start, t, key, run_off))
    return segs


pif = segments(args.pif, False)
mm2 = segments(args.mm2, True)
sizes = {l.split()[0].rsplit('#', 1)[-1]: int(l.split()[1]) for l in open(args.sizes)}
STATUSES = ['exact', 'within', 'shifted', 'elsewhere', 'pif_only', 'mm2_only', 'neither']


def sweep(chrom):
    events = []
    for i, (s, e, key, off) in enumerate(pif.get(chrom, [])):
        events.append((s, 1, 0, i))
        events.append((e, 0, 0, i))
    for i, (s, e, key, off) in enumerate(mm2.get(chrom, [])):
        events.append((s, 1, 1, i))
        events.append((e, 0, 1, i))
    events.sort()
    counts = dict.fromkeys(STATUSES, 0)
    active = ({}, {})
    pos = 0
    P, M = pif.get(chrom, []), mm2.get(chrom, [])
    for x, kind, which, i in events:
        if x > pos:
            length = x - pos
            if active[0] and active[1]:
                best = 'elsewhere'
                rank = {'elsewhere': 0, 'shifted': 1, 'within': 2, 'exact': 3}
                for pi in active[0]:
                    _, _, pkey, poff = P[pi]
                    for mi in active[1]:
                        _, _, mkey, moff = M[mi]
                        if pkey == mkey:
                            s = 'exact' if poff == moff else 'within' if abs(poff - moff) <= args.near else 'shifted'
                            if rank[s] > rank[best]:
                                best = s
                counts[best] += length
            elif active[0]:
                counts['pif_only'] += length
            elif active[1]:
                counts['mm2_only'] += length
            else:
                counts['neither'] += length
            pos = x
        if kind == 1:
            active[which][i] = True
        else:
            active[which].pop(i, None)
    counts['neither'] += max(0, sizes.get(chrom, pos) - pos)
    return counts


def chrom_key(c):
    m = re.match(r'chr(\d+)$', c)
    return (0, int(m.group(1))) if m else (1, c)


total = dict.fromkeys(STATUSES, 0)
with open(args.out + '.by_chrom.tsv', 'w') as fh:
    fh.write('chrom\tlength\tpif_placed\tmm2_placed\texact\twithin10\tshifted\telsewhere\tpif_only\tmm2_only\tneither\n')
    for chrom in sorted(set(pif) | set(mm2), key=chrom_key):
        c = sweep(chrom)
        for k in STATUSES:
            total[k] += c[k]
        pif_placed = c['exact'] + c['within'] + c['shifted'] + c['elsewhere'] + c['pif_only']
        mm2_placed = c['exact'] + c['within'] + c['shifted'] + c['elsewhere'] + c['mm2_only']
        fh.write(f'{chrom}\t{sizes.get(chrom, "")}\t{pif_placed}\t{mm2_placed}\t{c["exact"]}\t{c["exact"] + c["within"]}\t{c["shifted"]}\t{c["elsewhere"]}\t{c["pif_only"]}\t{c["mm2_only"]}\t{c["neither"]}\n')
c = total
pif_placed = c['exact'] + c['within'] + c['shifted'] + c['elsewhere'] + c['pif_only']
mm2_placed = c['exact'] + c['within'] + c['shifted'] + c['elsewhere'] + c['mm2_only']
print(f'total\tpif_placed={pif_placed}\tmm2_placed={mm2_placed}\texact={c["exact"]}\twithin10={c["exact"] + c["within"]}\tshifted={c["shifted"]}\telsewhere={c["elsewhere"]}\tpif_only={c["pif_only"]}\tmm2_only={c["mm2_only"]}')

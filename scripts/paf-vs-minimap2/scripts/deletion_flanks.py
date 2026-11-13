"""Mismatches between each carrier's 954 haplotype bases at the deletion and the
two GRCh38 copies they could align to: the PIF's placement (left copy,
chr1:196,758,495-196,759,449) and minimap2's (right copy, 196,843,179-196,844,133)."""
import subprocess


def seq(fa, reg):
    return ''.join(subprocess.run(['samtools', 'faidx', fa, reg], capture_output=True, text=True, check=True).stdout.split('\n')[1:]).upper()


left = seq('ref/chr1.fa', 'chr1:196758496-196759449')
right = seq('ref/chr1.fa', 'chr1:196843180-196844133')
print('left copy vs right copy: %d mismatches at offsets %s' % (sum(a != b for a, b in zip(left, right)), [i for i, (a, b) in enumerate(zip(left, right)) if a != b]))
carriers = {
    'HG01109#1#JAHEPA020000055.1': 49423087, 'HG01123#1#CM089081.1': 191910261,
    'HG01960#1#CM088644.1': 196599903, 'HG02055#1#CM092205.1': None,
}
for name, q in carriers.items():
    fa = 'asm/' + name.replace('#', '.') + '.fa'
    if q is None:
        row = [l.split('\t') for l in open('pif/' + name.split('#')[0] + '.1.paf')]
        q = int(row[0][3]) - 954
    h = seq(fa, f'{name}:{q + 1}-{q + 954}')
    ml = [i for i, (a, b) in enumerate(zip(h, left)) if a != b]
    mr = [i for i, (a, b) in enumerate(zip(h, right)) if a != b]
    print(f'{name} bases {q:,}-{q + 954:,}: vs left (PIF placement) {len(ml)} mismatches {ml}; vs right (minimap2 placement) {len(mr)} mismatches {mr}')

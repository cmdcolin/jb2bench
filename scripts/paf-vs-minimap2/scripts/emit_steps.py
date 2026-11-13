"""stdin: GRCh38 W lines of a GFA. stdout: one `node_id<TAB>chromosome` line per step."""
import re
import sys

out = sys.stdout
for line in sys.stdin:
    f = line.rstrip('\n').split('\t')
    if f[0] == 'W' and f[1] == 'GRCh38':
        chrom = f[3]
        out.write(''.join(f'{m}\t{chrom}\n' for m in re.findall(r'[0-9]+', f[6])))

#!/usr/bin/env bash
# The CFHR3-CFHR1 deletion's two breakpoint placements differ by 954 bp: the PIF
# puts the carriers' bases 49,423,087-49,424,041 (HG01109) at GRCh38
# chr1:196,758,495-196,759,449 and minimap2 puts them at 196,843,179-196,844,133.
# Are those two reference stretches identical copies, and do the haplotype
# bases match both? Extends the comparison to find the full identical stretch.
set -euo pipefail
cd "$(dirname "$0")/.."
left=$(samtools faidx ref/chr1.fa chr1:196758496-196759449 | grep -v '^>' | tr -d '\n' | tr a-z A-Z)
right=$(samtools faidx ref/chr1.fa chr1:196843180-196844133 | grep -v '^>' | tr -d '\n' | tr a-z A-Z)
hap=$(samtools faidx asm/HG01109.1.JAHEPA020000055.1.fa 'HG01109#1#JAHEPA020000055.1:49423088-49424041' | grep -v '^>' | tr -d '\n' | tr a-z A-Z)
echo "left 954 bp == right 954 bp: $([ "$left" = "$right" ] && echo yes || echo no)"
echo "HG01109 954 bp == left: $([ "$hap" = "$left" ] && echo yes || echo no); == right: $([ "$hap" = "$right" ] && echo yes || echo no)"
python3 -I - <<'PY'
import subprocess
def seq(fa, reg):
    return ''.join(subprocess.run(['samtools', 'faidx', fa, reg], capture_output=True, text=True, check=True).stdout.split('\n')[1:]).upper()
# how far does the identity between the two reference copies extend on either side of the 954 bp?
a0, b0 = 196758495, 196843179
L = 20000
a = seq('ref/chr1.fa', f'chr1:{a0 - L + 1}-{a0 + 954 + L}')
b = seq('ref/chr1.fa', f'chr1:{b0 - L + 1}-{b0 + 954 + L}')
i = L
while i > 0 and a[i - 1] == b[i - 1]:
    i -= 1
j = L + 954
while j < len(a) and a[j] == b[j]:
    j += 1
mm = sum(1 for k in range(i, j) if a[k] != b[k])
print(f'identical stretch between the two copies: chr1:{a0 - L + i}-{a0 - L + j} vs chr1:{b0 - L + i}-{b0 - L + j}, {j - i} bp, {mm} mismatches inside')
# any left/right position of the 84,684 bp deletion within the ambiguity gives the same haplotype sequence
PY

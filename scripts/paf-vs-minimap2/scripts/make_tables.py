"""make_tables.py out/summary.csv out/runs_1kb.tsv: markdown tables for results.md."""
import csv
import sys

rows = list(csv.DictReader(open(sys.argv[1])))
order = ['HG01109#1', 'HG01123#1', 'HG01960#1', 'HG02055#1', 'HG00097#1', 'HG00099#1', 'HG00128#1', 'HG00133#1']
for preset in sorted({r['mm2'] for r in rows}):
    print(f'\n### minimap2 -x {preset}\n')
    print('| haplotype | contig | PIF-placed bp | of which `=` / `X` | mm2-placed bp | both | exact | within 10 bp | different | PIF only | mm2 only | neither | PIF `=` pairs identical in FASTA | PIF `X` pairs identical |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for h in order:
        r = next((r for r in rows if r['haplotype'] == h and r['mm2'] == preset), None)
        if r is None:
            continue
        pp = int(r['pif_placed'])
        ex = int(r['exact'])
        w = int(r['within10'])
        print(f"| {h} | {r['contig'].split('#')[-1]} | {pp:,} | {int(r['pif_eq']):,} / {int(r['pif_X']):,} | {int(r['mm2_placed']):,} | {int(r['both_placed']):,} | {ex:,} ({100 * ex / pp:.3f}%) | {w:,} ({100 * w / pp:.3f}%) | {int(r['different']):,} | {int(r['pif_only']):,} | {int(r['mm2_only']):,} | {int(r['neither']):,} | {int(r['pif_eq_bases_identical']):,} / {int(r['pif_eq']):,} | {int(r['pif_X_bases_identical']):,} / {int(r['pif_X']):,} |")
print('\n### Runs of one status of 1 kb or more (all statuses but exact)\n')
print('| haplotype | mm2 | status | GRCh38 chr1 | length | PIF says | minimap2 says |')
print('|---|---|---|---|---|---|---|')
for r in csv.DictReader(open(sys.argv[2]), delimiter='\t'):
    print(f"| {r['haplotype']} | {r['mm2']} | {r['status']} | {int(r['ref_start']):,}-{int(r['ref_end']):,} | {int(r['length']):,} | {r['pif_says']} | {r['mm2_says']} |")

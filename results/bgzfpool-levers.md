# Where more BGZF pool speedup is available

Measured 2026-09-04 by `scripts/bgzfpool/levers.ts`, which writes
[`bgzfpool-levers.json`](bgzfpool-levers.json). Five 19 kb windows on
`chr22_mask`, min of five rounds, 16-core box, both arms in one page.

The standalone arm reports 1.65x for 1000x long-read BAM and that looked like
the pool underperforming its quoted 1.95x. It is not. **1.65x is the pool's
worst configuration**, and two independent levers each recover most of the gap.

## 1000x long-read BAM, the cell the 1.95x claim names

| workers | one query at a time | queries concurrent |
| --- | --- | --- |
| 2 | 1.37x | 1.82x |
| 4 (today's default) | **1.65x** | **2.08x** |
| 8 | 1.97x | 2.14x |
| 12 | 1.98x | 2.11x |

Both levers reproduce the quoted figure on their own: 8 workers sequentially is
1.97x, and 4 workers with queries in flight together is 2.08x. So the 1.95x was
never unreproducible — the standalone arm simply pins both levers to their
lowest setting, one query at a time through four workers, and that is the one
configuration a real pan never runs in.

## The same two levers elsewhere

| track | 4w seq | 4w conc | 8w seq | 8w conc |
| --- | --- | --- | --- | --- |
| 200x longread BAM | 1.54x | 1.69x | 1.82x | 1.81x |
| 200x shortread BAM | 1.23x | 1.42x | 1.31x | 1.45x |
| VCF 1,000 samples, full GT | 1.21x | 1.39x | 1.24x | 1.37x |

Concurrency is worth +15-20% almost everywhere and costs nothing to have — a
pan already issues its block queries together. More workers pay where the chunk
is big enough to divide: they are worth 0.3x on 1000x long read and almost
nothing on a small VCF query.

## What to do about it

**Raising the default pool from 4 workers to 8 is worth 1.65x -> 1.97x on the
heaviest BAM query**, and the returns stop there: 12 workers measured 1.98x, so
8 is the knee on a 16-core box and not a coincidence of this corpus.
`@gmod/bgzf-filehandle`'s own worker-pool doc already says four is not the
ceiling. Sizing it off `navigator.hardwareConcurrency` rather than a constant is
the obvious change, and this is the number to justify it.

The measurement to take before making it is the same one this repo still owes:
a box with fewer cores, where eight inflate workers compete with the RPC worker
and the main thread instead of running beside them.

## Cells that would not run

`1000x.shortread.bam` and `variants.pool.3000.wide.vcf.gz` fail both modes with
`Array buffer allocation failed`. Concurrent mode holds every window's records
at once — 1000x short read is ~153,000 records per window across five windows —
and the sequential arm here sums the same set. Not a pool result; a limit of
counting records in a browser tab.

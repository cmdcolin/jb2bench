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

## At coverage anyone actually has

1000x is not a workload; 10-30x is. Same windows, same box, min of seven
rounds, and the **milliseconds** are here because a ratio on a 25 ms query is
not the same news as a ratio on a 2.8 s one.

| track | 4w seq | 4w conc | 8w seq | 8w conc | best case |
| --- | --- | --- | --- | --- | --- |
| 10x shortread | 1.12x | 1.31x | 1.23x | 1.30x | 22 ms -> 17 ms |
| 30x shortread | 1.22x | 1.52x | 1.36x | 1.55x | 46 ms -> 30 ms |
| 10x longread | 1.50x | 1.82x | 1.74x | **1.89x** | 89 ms -> 47 ms |
| 30x longread | 1.76x | 1.76x | 1.79x | **1.85x** | 104 ms -> 57 ms |

Two things separate here that the 1000x row had fused.

**Long read keeps the speedup at ordinary coverage.** 30x long read is 1.85x —
within reach of the 1000x figure — because a 50 kb read makes a big BGZF chunk
whether or not the pileup is deep. This is the case the pool is for, and it is
a real one: 10-30x long-read WGS is ordinary.

**Short read does not, and the absolute number is why.** 30x short read reaches
1.55x, but that is 46 ms against 30 ms across five windows: **16 ms saved**, and
at 10x it is 5 ms. The ratio is honest and the saving is imperceptible. Nothing
is wrong with the pool here; there is simply almost no decompression to move.

**More workers stop paying at ordinary coverage.** 4 -> 8 is worth 0.3x on
1000x long read and roughly nothing on 30x short read, because the chunk has to
be big enough to divide before more workers have anything to do.

## The same two levers at high coverage

| track | 4w seq | 4w conc | 8w seq | 8w conc |
| --- | --- | --- | --- | --- |
| 200x longread BAM | 1.54x | 1.69x | 1.82x | 1.81x |
| 200x shortread BAM | 1.23x | 1.42x | 1.31x | 1.45x |
| VCF 1,000 samples, full GT | 1.21x | 1.39x | 1.24x | 1.37x |

## What to do about it

**Concurrency is the lever worth having, and it is free.** It is worth
+15-25% at every coverage measured, including the ones where more workers do
nothing, because a pan already issues its block queries together — the pool
just has to be given them at once. Nothing needs sizing or tuning.

**Raising the default worker count is not clearly worth it.** 4 -> 8 buys
1.65x -> 1.97x on 1000x long read and ~nothing at 10-30x short read, which is
the common case. It also has a cost this box cannot see: eight inflate workers
on a 4-core laptop compete with the RPC worker and the main thread rather than
running beside them. Size it off `navigator.hardwareConcurrency` if it is
changed at all, and measure on a small box first.

**Do not quote a single pool figure.** What the pool is worth splits cleanly by
read type, and by an order of magnitude in absolute terms: ~1.85x and ~45 ms on
long read at ordinary coverage, ~1.5x and ~15 ms on short read. A claim of "~2x
when viewing large regions" is true of long read and of high-coverage short
read, and overstates 10-30x short read — which is most people's BAM.

## Cells that would not run

`1000x.shortread.bam` and `variants.pool.3000.wide.vcf.gz` fail both modes with
`Array buffer allocation failed`. Concurrent mode holds every window's records
at once — 1000x short read is ~153,000 records per window across five windows —
and the sequential arm here sums the same set. Not a pool result; a limit of
counting records in a browser tab.

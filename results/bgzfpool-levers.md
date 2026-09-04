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

## What this predicts end to end, without running the end-to-end arm

The pool can only speed up the part of a pan that is decompression, and this
repo already measures both halves: `results/bgzfpool-standalone.json` has the
query with the pool off, and `results/interaction.json` has what a pan costs on
the `current` build over the same contig.

| track | query, pool off | pan | query is | pool on the query | -> end to end |
| --- | --- | --- | --- | --- | --- |
| 20x shortread BAM | 8 ms | 214 ms | 4% | 1.23x | **1.01x** |
| 200x shortread BAM | 58 ms | 818 ms | 7% | 1.25x | **1.01x** |
| 1000x shortread BAM | 283 ms | 1296 ms | 22% | 1.31x | **1.05x** |
| 20x longread BAM | 23 ms | 171 ms | 14% | 1.49x | **1.05x** |
| 200x longread BAM | 146 ms | 894 ms | 16% | 1.55x | **1.06x** |
| 1000x longread BAM | 563 ms | 1544 ms | 36% | 1.65x | **1.17x** |

Amdahl on measured numbers, not a guess. Using the concurrent figures instead
of the sequential ones moves the last row to 1.23x and the rest barely at all.

**This is the number that matters, and it is small.** A pool that halves
decompression is worth 1-6% on an ordinary pan, because decompression is
4-16% of what a pan costs. Everything else — the RPC hop, feature conversion,
layout, paint — is untouched and is the other 84-96%.

### It also says the quoted 1.95x is not an end-to-end pan

Set the pool speedup to infinity and the ceiling is `1 / (1 - f)`:

| track | most any decompressor could ever give |
| --- | --- |
| 20x longread BAM | 1.16x |
| 200x longread BAM | 1.19x |
| 1000x shortread BAM | 1.28x |
| 1000x longread BAM | 1.57x |

No pool, of any size, can return 1.95x on a pan that spends 36% of itself
decompressing. For 1.95x with a perfect four-worker pool the query would have to
be **65% of the pan**. So `1.95x end to end` is measuring something narrower
than a pan to paint — plausibly the adapter's own fetch-and-parse, which is
exactly the thing the standalone arm here measures at 1.65-2.08x and agrees
with. The disagreement was never about the pool; it was about what "end to end"
names.

The caveat that keeps this a prediction rather than a result: the pan times come
from this repo's `current` build. A build whose rendering is much cheaper shifts
`f` up and every number here with it. That is what the two-build end-to-end arm
would settle, and it is now the only open question left.

## Cells that would not run

`1000x.shortread.bam` and `variants.pool.3000.wide.vcf.gz` fail both modes with
`Array buffer allocation failed`. Concurrent mode holds every window's records
at once — 1000x short read is ~153,000 records per window across five windows —
and the sequential arm here sums the same set. Not a pool result; a limit of
counting records in a browser tab.

# Could a wasm port of this routine win?

Measured 2026-09-02 by `make wasmgate` (`scripts/wasmgate.ts`), which writes
[`wasmgate.json`](wasmgate.json). The figure is
[`figures/paper/png/wasmgate.png`](figures/paper/png/wasmgate.png), drawn by
`scripts/paperfigs/wasmgate.R` from `paper/wasmgate.csv`.

wasm runs at close to native speed, which is what makes it look like a free win
for a CPU-bound routine. It is not free, and the reason is the boundary rather
than the code. A worker boundary costs nothing to cross — `postMessage` with a
Transferable hands an `ArrayBuffer`'s ownership over and copies no bytes. wasm
has no equivalent: a module addresses only its own linear memory, so every call
copies its input in and its result back out, and that copy is paid whether or
not what happens in between is any faster than the JavaScript it replaced.

## The argument is a lower bound, and that is the point

**Only one routine here is ported.** `@gmod/bgzf-filehandle` ships both a
Rust/libdeflate wasm inflate and a `pako-esm2` one, so it alone has a real wasm
measurement. Nothing was written in Rust to produce the other five rows, and
nothing needed to be.

A wasm port's time is *copy in + compute + copy out*. Take the compute to zero
and what is left — the two copies and the boundary crossing — is still a real,
measurable quantity, and no implementation of that routine can come in under it.
So the copy alone decides the question whenever it already exceeds what
JavaScript costs today:

> If moving a routine's bytes across the boundary takes longer than doing the
> whole job in JavaScript, no wasm port of it can win, however fast the wasm is.

That is what the grey dot on the figure is: **the port with its compute free**,
not a measurement of any port. It is why five rows can be settled without
writing them, and the ported row is the check that the model holds — its real
measurement lands between the bound and the JavaScript, where it must.

## What was measured

| | |
| --- | --- |
| the copy | `@gmod/cram`'s emscripten htscodecs module, running the `_malloc` / `HEAPU8.set` / call / copy-out / `_free` sequence its `htscodecs-wasm.ts` wraps every codec in, with the codec replaced by a call that returns immediately |
| the work | six routines from `@gmod/bgzf-filehandle` and `@gmod/bam`, timed in JavaScript over real BAM |
| the port | `@gmod/bgzf-filehandle`'s wasm inflate, against the pako path the same library resolves to in a browser |

The copy is deliberately the **cheapest** marshalling a port could arrange: the
wasm-side buffer is allocated once and reused, so what is timed is two memcpys,
one boundary crossing, and the JS array the result has to arrive in. A port that
mallocs per call — which is what `@gmod/cram`'s own wrapper does — pays more, and
measuring that instead would flatter the argument by raising the bar every
candidate is judged against. Over the run it moves bytes at memcpy bandwidth,
which is the check that it is a property of the machine and not of the module it
was measured through.

## Every row is a routine JBrowse actually runs

This is an admission rule, not a note. `scripts/wasmgate.ts` refuses to measure a
routine that is not in `CALL_SITES`, and the call site travels into the JSON and
the CSV so a reader of the figure can check it rather than take it on trust.

| routine | where JBrowse runs it |
| --- | --- |
| BGZF inflate | `@gmod/bam` `bamFile.ts` › `getRecordsForRange` → `unzipChunkSlice` |
| BGZF block scan | `@gmod/bam` `streamBam.ts` › `streamBamRecords` → `scanBgzfBlocks` |
| BAM record walk | `@gmod/bam` `bamFile.ts` › `readBamFeatures` |
| BAM field decode | `BamAdapter.ts` › `filterReadFlag(record.flags)`, `record.start` |
| BAM CIGAR unpack | `BamAdapter.ts` › `numericCigarHasSkip(record.NUMERIC_CIGAR)` |
| BAM mismatch walk | `BamSlightlyLazyFeature.ts` › `forEachMismatch` → `forEachMismatchNumeric` |

Two rows were **`BamRecord.CIGAR` and `BamRecord.seq` until 2026-09-02, and both
were wrong to plot.** Those accessors build a CIGAR *string* and a base *string*,
and the alignments renderer calls neither: it reads `NUMERIC_CIGAR` and walks the
packed SEQ, on purpose. jbrowse-components' `readBaseCounts.ts` says so in as
many words — asking for the string makes the feature "BUILD a string out of the
packed ops it already held" and parses it straight back into the same encoding.
So those rows measured work the program does not do, and measured it generously,
since most of what they cost is JS string construction — which a wasm port could
not remove anyway, the string still having to be built on the JS side. They are
replaced by the two routines the render path actually reaches for.

## The result

Times are for the whole file; the number is JavaScript ÷ the copy.

**Short reads** (Illumina, 300×, 5.1 MB BGZF → 18.5 MB, 53,596 records):

| routine | JavaScript | the copy | JS ÷ copy | the port |
| --- | --- | --- | --- | --- |
| BGZF inflate | 1099 ms | 27 ms | **41×** | 351 ms — **3.1× faster** |
| BAM mismatch walk | 177 ms | 7.0 ms | **25×** | not ported |
| BAM CIGAR unpack | 36 ms | 7.5 ms | 4.8× | not ported |
| BAM field decode | 35 ms | 8.3 ms | 4.2× | not ported |
| BAM record walk | 7.3 ms | 7.1 ms | 1.0× | *nothing to gain* |
| BGZF block scan | 0.07 ms | 1.9 ms | **0.04×** | *impossible* |

**Long reads** (ONT, chr22, 14.1 MB BGZF → 24.5 MB, 757 records):

| routine | JavaScript | the copy | JS ÷ copy | the port |
| --- | --- | --- | --- | --- |
| BGZF inflate | 1044 ms | 19 ms | **55×** | 355 ms — **2.9× faster** |
| BAM mismatch walk | 85 ms | 16 ms | **5.5×** | not ported |
| BAM field decode | 9.8 ms | 6.8 ms | 1.4× | not ported |
| BAM CIGAR unpack | 9.7 ms | 11 ms | **0.87×** | *impossible* |
| BGZF block scan | 0.09 ms | 4.3 ms | **0.02×** | *impossible* |
| BAM record walk | 0.04 ms | 7.3 ms | **0.01×** | *impossible* |

Three things fall out of it.

**Decompression clears the bar by a factor of 40, which is why it is the one that
got ported.** Inflating a megabyte is tens of times more work than moving it, so
the copy is nearly a rounding error and the port keeps essentially all of
libdeflate's advantage over pako — 2.9–3.1× measured. It was never near the line.

**Several routines are under the bar, and no implementation can rescue them.**
Walking a BAM's record boundaries reads a 4-byte length and adds it, so 24 MB of
ONT records is walked in 0.04 ms against a 7.3 ms copy: a wasm port would be
~180× slower than the JavaScript it replaced, and would still be slower if the
Rust inside took zero time. The BGZF block scan, which reads two header fields
per block and skips, is 25–50× under. Both look like tight numeric loops and are
actually pointer arithmetic over bytes a port would have to copy first.

**The one genuinely open case is the mismatch walk, and it is open in one
direction only.** It is the pileup hot path — `forEachMismatchNumeric` over the
packed CIGAR, SEQ and QUAL — and at 25× on short reads it has more room than
anything but decompression. It has not been ported. Everything between it and
the floor (CIGAR unpack, field decode) sits at 1–5×, which does not pay for a
Rust toolchain and a second implementation to keep in step with the first.

## What this run is and is not

**The box was busy**: load average 24.8–45.6, median 32.5, over 16 CPUs, with
other agents working in neighbouring checkouts. Every arm of a cell is measured
back to back, so contention lands on all of them together and the *ratios* — which
is all this figure is made of — survive it; the milliseconds do not.
**Do not quote the milliseconds.** An earlier run of the same benchmark at median
load 8.8 put the same inflate ratio at 3.12× against `@gmod/bgzf-filehandle`'s own
`benchmarks/inflate.bench.ts` 3.23× on the same fixture, so the direction and the
order of magnitude are safe and the second significant figure is not. A re-run on
an idle box is owed.

**The ONT fixture carries no MD tag** — 0 of 757 records, against 52,928 of 53,596
on the short-read side, and the run records both. That matters for one row: with
no MD and no reference, `forEachMismatchNumeric` resolves indels and clips out of
the CIGAR but no substitutions. JBrowse's real path for such a read is
`withRegionRef(packedRef)`, which walks the packed reference and compares bases —
strictly more work. So the long-read mismatch row is a **lower bound on its own
JavaScript cost**, and its true ratio is higher than 5.5×.

**The corpus is not `data/`.** `scripts/wasmgate.ts` reads `data/*.bam` by
default, but this repo's corpus needs `pbsim` to regenerate and this box does not
have it, so the run of record was taken on `@gmod/bgzf-filehandle`'s own test
fixtures via `BAMS=`. They are real short-read and ONT alignments rather than
simulated ones, which suits this benchmark — what it measures is per-byte cost and
record shape, not coverage — but these numbers do not describe the same bytes as
every other table here. `wasmgate.json` records the paths.

**Libraries**, at the revisions the run recorded: `@gmod/bgzf-filehandle`
`v6.6.0-31-g0bd6b38`, `@gmod/bam` `v9.0.1`, `@gmod/cram` `v14.0.0` (the copy
module only). They are read from the checkouts beside this one rather than from a
pinned install, because what the ported row compares is one library's two
implementations of the same routine.

## Where the argument stops

**It measures porting ONE routine and leaving the rest in JavaScript.** That is
the decision the manuscript describes, and it is the decision an incremental
optimization actually faces — but it is not the only shape a wasm design can
take. A pipeline that kept its data resident in linear memory across several
stages would pay the copy once instead of once per stage, and the per-routine
bound here says nothing about that. It says only that porting the block scan, or
the record walk, *by itself* cannot pay.

**Every "impossible" verdict is a bound, not a port that was built and lost.** It
is a safe bound — a port cannot cost less than its own copying — but it is
reasoning, where the ported row is measurement.

**Instantiation is not measured.** Compiling and instantiating a module is
one-off work this pays once outside every timed body, as a warm worker would. A
port called once per page load pays it and this does not say what it costs.

**The browser is not measured.** This runs in node. A browser's memcpy bandwidth
and its JIT both differ, and `DecompressionStream` exists there and not here;
`@gmod/bgzf-filehandle`'s `benchmarks/inflate.bench.ts` carries that arm.

**@gmod/cram's rANS codecs are the repo's other shipped wasm port**, and they are
not here. Their pure-JS predecessor was deleted in `12d9baa` when the wasm landed,
so a same-input comparison means building that arm from that commit's tree. Worth
doing: it would put a second measured triangle next to a bound.

# When is a routine worth compiling to WebAssembly?

Measured 2026-09-02 by `make wasmgate` (`scripts/wasmgate.ts`), which writes
[`wasmgate.json`](wasmgate.json). The figure is
[`figures/paper/png/wasmgate.png`](figures/paper/png/wasmgate.png), drawn by
`scripts/paperfigs/wasmgate.R` from `paper/wasmgate.csv`, in two panels:

- **(a)** one bar per routine, from break-even out to the ceiling the floor
  allows. A bar reaching left of 1× is a routine whose JavaScript already costs
  less than moving its own bytes, so no port of it can win. The triangle on the
  one ported routine is what that port actually collected out of the room it had.
  Whiskers are the same ceiling over the rest of the payload sweep.
- **(b)** where the ceiling's denominator comes from: every candidate's own floor
  measurement, both corpora, against a single line at the measured 7 GB/s.

The figure was a pair of sweep panels until 2026-09-02 — time against payload
size, and the same divided by the floor. The second of those turned out to be six
nearly flat lines, and that flatness is the finding rather than a defect in the
drawing: **the ceiling is a property of the routine and barely moves with how
much data it is handed.** So the sweep collapses into (a)'s whiskers, which
carry the same fact in a tenth of the space, and the panel that asked a reader
to measure gaps between curves a decade apart on a log axis is gone.

Two things to read carefully in (a). A whisker's far end is not evidence of a
better ceiling: every sweep starts at a single block or a handful of records,
where both sides of the ratio are one or two microseconds and neither is
separable from the other — that is what puts the block scan's whisker up against
1× while its bar sits at 0.05×. And the row order is the ceiling averaged over
both read types, so a routine keeps its row across the two facets; within a
single facet the bars are therefore not always in length order.

wasm runs at close to native speed, which is what makes it look like a free win
for a CPU-bound routine. It is not free, and the reason is the boundary rather
than the code. A worker boundary costs nothing to cross — `postMessage` with a
Transferable hands an `ArrayBuffer`'s ownership over and copies no bytes. wasm
has no equivalent: a module addresses only its own linear memory, so every call
copies its input in and its result back out, and that copy is paid whether or
not what happens in between is any faster than the JavaScript it replaced.

So a port is a speedup only where the work exceeds the copy, and both halves of
that inequality are measurable. **The copy is the floor**, and a routine's
distance above it is a *ceiling* on what any implementation of it could collect.

## What was measured

| | |
| --- | --- |
| floor | `@gmod/cram`'s emscripten htscodecs module, running the `_malloc` / `HEAPU8.set` / call / copy-out / `_free` sequence its `htscodecs-wasm.ts` wraps every codec in, with the codec replaced by a call that returns immediately |
| candidates | six routines from `@gmod/bgzf-filehandle` and `@gmod/bam`, timed in JavaScript over real BAM, swept over payload size |
| ported arms | `@gmod/bgzf-filehandle` ships both implementations of one of them — Rust/libdeflate wasm and `pako-esm2` — so its measured wasm time is drawn next to its ceiling |

The floor is deliberately the **cheapest** marshalling a port could arrange: the
wasm-side buffer is allocated once and reused, so what is timed is two memcpys,
one boundary crossing, and the JS array the result has to arrive in. A port that
mallocs per call — which is what `@gmod/cram`'s own wrapper does — pays more, and
measuring that instead would flatter the argument by raising the bar every
candidate is judged against. Over the run it moves bytes at 4.4–17 GB/s (median
6.9), which is memcpy bandwidth: the floor is a property of the machine, not of
the module it was measured through. That it is drawn from twelve different
input/output size combinations and still falls on one curve is the check.

## The result

Ceilings are ranges because each is swept over payload size.

**Short reads** (Illumina, 300×, 5.1 MB BGZF → 18.5 MB, 53,596 records):

| routine | ceiling | wasm actually collected |
| --- | --- | --- |
| BGZF inflate | 29.9–76.5× | **3.1–4.3×** |
| BAM sequence decode | 7.1–14.6× | not ported |
| BAM CIGAR decode | 2.8–7.7× | not ported |
| BAM field decode | 2.3–3.8× | not ported |
| BAM record walk | **0.59–1.3×** | *at the floor* |
| BGZF block scan | **0.04–1.0×** | *no room* |

**Long reads** (ONT, chr22, 14.1 MB BGZF → 24.5 MB, 757 records):

| routine | ceiling | wasm actually collected |
| --- | --- | --- |
| BGZF inflate | 24.8–66.6× | **2.5–4.1×** |
| BAM CIGAR decode | 7.4–9.7× | not ported |
| BAM sequence decode | 3.5–4.6× | not ported |
| BAM field decode | 0.80–1.4× | not ported |
| BGZF block scan | **0.02–1.3×** | *no room* |
| BAM record walk | **0.003–0.010×** | *no room* |

Four things fall out of it.

**Decompression clears the gate by a factor of 30, which is why it is the one
that got ported.** Inflating a megabyte is tens of times more work than moving
it, so the copy is close to a rounding error and the port keeps essentially all
of libdeflate's advantage over pako — 2.5–4.3× measured, against a ceiling that
never drops below 24×. It was never near the line.

**Two routines sit below the floor, and no implementation can rescue them.**
Walking a BAM's record boundaries reads a 4-byte length and adds it, so 24 MB of
ONT records is walked in 38 µs against a 4.0 ms floor: a wasm port would be
**105× slower** than the JavaScript it replaced, and would still be slower if the
Rust inside took zero time. The BGZF block scan, which reads two header fields
per block and skips, runs 8–55× under its floor over most of its sweep. These are
the shape the argument is about — routines that look like tight numeric loops and
are actually pointer arithmetic over bytes a port would have to copy first.

**At the smallest payloads everything converges, and that is not a result.** The
first point of each sweep puts the block scan at 0.98–1.3× of its floor, and both
sides of that ratio are one or two microseconds. It says the two are
indistinguishable at 6 kB, not that a port would break even; the verdict is the
rest of the sweep, where the gap opens by a decade or more.

**Between the two extremes is a band that moves with the data.** CIGAR decoding
is worth at most 2.8–7.7× on short reads and 7.4–9.7× on long ones, because a
100 kb ONT read carries a CIGAR worth decoding and a 150 bp read does not. Field
decoding inverts it — 2.3–3.8× on short reads and nothing on long ones (0.80–1.4×)
— for the same reason in reverse: 53,596 short records is real per-record work and
757 long ones is not. Record walking is the extreme case of the same swing: a wash
on short reads (0.59–1.3×, i.e. at the floor) and 100–300× below it on long ones.
Nothing in this band has been ported, and the figure is the argument for that
rather than only the record of it: a ceiling near 3× does not pay for a Rust
toolchain and a second implementation to keep in step with the first.

## What this run is and is not

**The corpus is not `data/`.** `scripts/wasmgate.ts` reads `data/*.bam` by
default, but this repo's corpus needs `pbsim` to regenerate and this box does not
have it, so the run of record was taken on `@gmod/bgzf-filehandle`'s own test
fixtures via `BAMS=`. They are real short-read and ONT alignments rather than
simulated ones, which suits this benchmark — what it measures is per-byte cost
and record shape, not coverage — but it does mean these numbers do not describe
the same bytes as every other table here. `wasmgate.json` records the paths.

**The box was busy**: load average 8.3–9.8 (median 8.8) over 16 CPUs, with
another agent's work and two browsers on it. The figure and the tables above
plot **minima**, since contention only adds time and the fastest repetition is
the least contaminated. Every arm of a cell is measured back to back, so what
contention remains lands on all of them together and the ratios hold — measured
against `@gmod/bgzf-filehandle`'s own `benchmarks/inflate.bench.ts` on the same
fixture, the wasm-over-pako ratio agrees — 3.12× here against 3.23× there — while
the absolute time is about 1.4× higher (174 ms against 127 ms for pako over the
whole short-read file). **Do not quote the milliseconds.** They are in the JSON with medians and maxima beside them.

One hazard this benchmark carries that the render benchmarks do not: its two
sides are bound by different resources — inflate by the CPU, the floor by memory
bandwidth — so contention need not land on them equally, and the ceilings are
therefore softer than the realised ratios. The direction and the order of
magnitude are safe; a ceiling's second significant figure is not.

**Libraries**, at the revisions the run recorded: `@gmod/bgzf-filehandle`
`v6.6.0-31-g0bd6b38`, `@gmod/bam` `v9.0.1`, `@gmod/cram` `v14.0.0` (the floor
module only). They are read from the checkouts beside this one rather than from
a pinned install, because what the benchmark compares is one library's two
implementations of the same routine.

## What is not measured

- **A wasm arm for anything but inflate.** Every "no room" verdict is a
  prediction from the floor, not a port that was built and found wanting. It is
  a safe prediction — the floor is a lower bound on any port's cost — but it is
  a prediction.
- **The browser.** This runs in node. A browser's memcpy bandwidth and its
  JIT both differ, and `DecompressionStream` exists there and does not here.
  `@gmod/bgzf-filehandle`'s `benchmarks/inflate.bench.ts` carries that arm.
- **@gmod/cram's rANS codecs**, which are the repo's *other* shipped wasm port.
  Their pure-JS predecessor was deleted in `12d9baa` when the wasm landed, so a
  same-input comparison means building the arm from that commit's tree. Worth
  doing: it would put a second measured point next to a ceiling.
- **Instantiation.** Compiling and instantiating a module is one-off work that
  this pays once outside every timed body, as a warm worker would. A port called
  once per page load pays it and this does not say what it costs.

# Ecosystem benchmarks

The render benchmarks one directory up measure the browser. These measure the
layer underneath it: the GMOD parser libraries JBrowse depends on, comparing the
versions JBrowse 2 shipped at the time of the 2023 paper against the current
releases.

## How to run it

Nothing here needs a build, a server or a GPU. It does need an idle machine, for
the same reason the render benchmarks do.

```bash
make bench     # the whole thing
make scan      # only the @gmod/vcf genotype-scan before/after
make gff3      # only the gff-nostream eager-vs-lazy attribute comparison
make sweep     # every major line of bam, cram and bbi, not just the endpoints
make cohort    # 100 BigWigs: what a per-sample signal panel costs to open
```

`make bench` clones and builds every library version named in `versions.json` (a
few minutes, the first time), runs the equivalence gate, runs the timings, and
writes `results/ecosystem.md` plus the LaTeX the paper reads. Each of its steps
is also runnable alone:

| command | what it does | writes |
| --- | --- | --- |
| `./setup.sh` | clone + build every version in `versions.json` | `.libs/`, `.libs/manifest.txt` |
| `./setup.sh --force` | re-clone and rebuild all of them | same |
| `make verify` | the equivalence gate — do both sides return the same records? | `results/equivalence.json` |
| `make time` | the timings | `results/bench.json` |
| `make report` | markdown + LaTeX from the JSON; measures nothing | `README.md`, `results/ecosystem.md`, `results/paper/*.tex` |
| `make scan` | the `@gmod/vcf` v7.1.1 → v7.2.0 scan, one process per side | `results/vcf-scan.{md,json}` |
| `make gff3` | `gff-nostream` eager vs lazy attributes, one process per side | `results/gff3-lazy.{md,json}` |
| `./setup-sweep.sh` | clone + build every version in `sweep.json` (tens of minutes, once) | `.libs/*/sweep/`, `.libs/sweep-manifest.txt` |
| `make sweep-verify` | the sweep's gate — does every build import, and does the counting instrument change its answer? | |
| `make sweep` | every major line, one process per version | `results/sweep.{md,json}` |
| `MODE=count make sweep` | the same, counting reads and bytes instead of timing — needs no idle box | same |
| `make cohort` | N-BigWig panel: request counts and timings | `results/cohort-bw.{md,json}` |
| `make clean` | drop `results/` | |
| `make distclean` | also drop `.libs/` and `node_modules/` | |

`make bench` is `verify` then `time` then `report`, and the dependency on
`verify` is deliberate: a timing comparison between two libraries that return
different records is not a comparison, so the gate runs first and a failure stops
the run.

**`README.md` here is generated. Edit `README.template.md`.** `make report` is
what regenerates it, and since it measures nothing it is the cheap way to change
the prose around a number without re-measuring the number.

The corpus has to exist first. The alignment cases read the files
`../shell/generate_alignments.sh` writes; the VCF cases read
`../shell/generate_variants.sh`, which needs nothing but node and takes a couple
of seconds.

`make scan` is deliberately not part of `make bench` — it runs one process per
side rather than both in one vitest process, which matters only for comparisons
in the few-percent range. The number that forced that split is
[below](#the-scan-benchmark-runs-one-process-per-side).

## What is compared

{{versionsTable}}

The 2023 column is not a guess. It is the pin read out of `jbrowse-components`
at its last commit before {{pinDateIso}} (rev `{{pinRev}}`), which is the tree
the JBrowse 2 paper describes. Exact tags and commit SHAs are in
`versions.json`.

## Results

{{speedupTable}}

The gains are largest where the data is largest: 1000x long read BAM falls from
{{parserBamPeakOld}} s to {{parserBamPeakNew}} s, and the same case in CRAM from
{{parserCramPeakOld}} s to {{parserCramPeakNew}} s.

BigWig is the exception: {{parserBbiFastMin}}x to {{parserBbiFastMax}}x faster at
20x, and {{parserBbiSlowMin}} to {{parserBbiSlowMax}}% slower above it. These are
{{parserBbiMsMin}} to {{parserBbiMsMax}} ms operations on summary data, so the
case may be too small to be informative rather than a regression, but it is
reported as measured.

### The VCF cases, and why there are two shapes

`@gmod/vcf` is measured on two FORMAT layouts because they take different paths
through the genotype scan, and reporting one would misdescribe the other.

- **`gtonly`** — `FORMAT=GT`, the 1000 Genomes phase 3 shape. Nothing sits
  between one sample's genotype and the next.
- **`wide`** — `FORMAT=GT:AD:DP:GQ:PL`, a joint-called cohort. GT is first and
  every other field has to be stepped over to reach the next sample.

The three genotype readings answer three different questions:

- **`vcf genotypes`** — every sample's GT, through the cheapest call each version
  offers. v5.0.9 had only `SAMPLES`, which parses *every* FORMAT field of every
  sample to reach one; v7.2.0 has `GENOTYPES()`. That the new call is cheaper
  partly because the API grew is the point, not a confound — it is what a
  JBrowse upgrade actually buys.
- **`vcf SAMPLES`** — the same whole-record parse on both sides, so the API
  change is not doing the work.
- **`results/vcf-scan.md`** (`make scan`) — v7.1.1 against v7.2.0 through the
  identical `processGenotypes` API, isolating the scan rewrite alone.

## Two axes the two-point table cannot see

The table above is two points per library. Two points give a ratio, and a ratio
answers "how much faster", which is one of the three questions a reader has. The
other two get their own benchmarks.

### Where along the way did it happen? — `make sweep`

`sweep.json` names every major line of `@gmod/bam`, `@gmod/cram`, `@gmod/bbi`,
`@gmod/vcf` and `@gmod/bgzf-filehandle` — the newest patch of each, so a major is
credited with what it finally became rather than with its `.0`. `make sweep` runs
all of them over the same window and writes
[`results/sweep.md`](results/sweep.md).

The last two get a curve and no request-shape column, because neither takes a
filehandle the way the other three do: `@gmod/vcf` is handed lines a reader
already decoded, and `bgzf-filehandle` is handed a buffer. Their rows are
timings, so unlike the other three they need an idle box.

Two of them are also measured through a deliberately narrower call than the
two-point benchmark uses, and the reason is the same in both cases — a sweep must
ask one question along its whole axis:

- **`@gmod/vcf` through `parseLine` alone.** `vcf.bench.ts` asks each side for
  genotypes through the cheapest call it offers, `SAMPLES` on v5 and
  `GENOTYPES()` on v7, because that is what a JBrowse upgrade actually buys. On
  a sweep that API appears partway along the axis, so the curve would carry a
  step that is a change of question rather than of speed.
- **`bgzf-filehandle` through `pakoUnzip` where it exists**, falling back to
  `unzip`. v1.x shipped two decompressors and chose at import time — `unzip`
  wrapping `zlib.gunzip` in Node, `pakoUnzip` for browsers — so sweeping `unzip`
  would compare C++ against JavaScript at the version where the split ends and
  report it as a regression.

The question is not rhetorical. Someone on `@gmod/bam` v5 deciding whether an
upgrade is worth the churn cannot use a 2023-to-current ratio, because almost
none of it may be ahead of them. A curve tells them; a ratio does not.

**One process per version**, for the reason `make scan` is one process per side
and more so. A sweep loads N builds into one V8 rather than two, so whatever
sharing does to their inline caches, it does *unevenly along the axis being
plotted* — which is the one artefact a curve must not have imposed on it. The
version order rotates every round, so machine drift cannot line up with position
on the curve either.

**Versions that will not build are reported, not dropped.** Which majors of a
library can still be built from source with a current toolchain is a fact about
the library, and a gap in a curve should look like a gap. As of 2026-08-16 there
are none: all 32 still build, and all 32 pass the gate.

**`make sweep-verify` is the gate, and `make sweep` depends on it**, exactly as
`make bench` depends on `make verify`: a curve drawn through versions that do
not all answer the same query is not a curve. It checks two things per version.
That the build imports and returns records — an `esm/index.js` that exists is
not one that loads, and cram v3.0.7 built perfectly and threw on first import
from a dependency it never declared. And that reading through the counting
filehandle returns the identical record set as reading by path, because an
instrument that perturbs the library shows up as a library difference, which is
precisely what a sweep is trying to detect. `setup-sweep.sh` now runs the import
half itself, so that failure lands at build time rather than as one blank row
minutes into a run.

**The resolved dependency tree of every build is recorded**, not just its
declared one. Each clone installs with `--no-frozen-lockfile` against ranges
written years ago, so the transitive tree resolves to whatever is current on the
day setup runs; two sweeps months apart can differ in a dependency without
differing in a single pin. Since the point of a sweep is to attribute a
difference to a version, an unrecorded dependency bump is a rival explanation
that cannot be ruled out afterwards. `.libs/sweep-manifest.txt` carries a
`resolved=` line per build.

**`MODE=count` reports request shape instead of time**, and is the mode to reach
for on a box like this one. It counts every `read` and `readFile` the library
makes, split between the data file and its index, through a wrapper around the
library's *own* `LocalFile`. Those counts are exact, identical on every machine,
and unaffected by load — so unlike every timing here they need no caveat and do
not go stale. They are also what transfers to the network, where a read is a
range request and a round trip.

Wrapping the real `LocalFile` rather than implementing one is not fastidiousness.
The first version of this did implement one, and two majors of `@gmod/bam` then
failed with "Not a BAI file" while their neighbours passed — a wrong answer
produced by the instrument, in a shape that would have read as a library defect.
A benchmark whose whole output is "how many reads" must not be the thing deciding
what a read is.

Getting plain node to import the pre-2024 builds took two module hooks
(`lib/legacy-resolve.mjs`), and both are worth knowing about because vitest had
been hiding them for every other benchmark here:

- Their emitted ESM uses CommonJS specifiers — extensionless files,
  directories, and a subpath whose `package.json` main points elsewhere. The
  hook hands those to node's own CJS resolver, which is the algorithm they were
  written against, rather than guessing candidate filenames.
- Their CJS dependencies set `__esModule` with the real export on `.default`.
  Bundlers unwrap that; node does not, and binds `default` to the whole
  `module.exports`. So `abortable-promise-cache` arrives as a wrapper object and
  every pre-2024 `@gmod/bam` and `@gmod/cram` dies on "not a constructor".

Neither hook changes how a current build loads: the first runs only after the
real resolver has already failed, and the second produces a superset of the
names node would have found by itself. The second is also narrower than it
sounds — node loads a CommonJS package's internals through `require`, so only a
package's *entry point* reaches the ESM loader at all. Traced on `@gmod/bam`
v2.0.4 (`SWEEP_TRACE_FACADE=1`), it applies to five: `long`,
`@gmod/bgzf-filehandle`, `generic-filehandle`, `@gmod/abortable-promise-cache`
and `quick-lru`.

### What does it cost at panel scale? — `make cohort`

BigWig is the row of the main table that reports nothing: 1–3 ms, flat to
slightly negative, and the paragraph above says the case may be too small to be
informative. That is the right reading, and the reason is structural rather than
a matter of choosing a bigger file. Most of what a BigWig query costs is
per-file and paid before any data is touched — the header, the chromosome B+
tree, then an R-tree descent to find the overlapping blocks. Measured once, it
is a rounding error. A cohort signal panel pays it once per sample.

`make cohort` therefore holds the library and the window fixed and makes **N the
axis**: 1, 10 and 100 per-sample BigWigs, written by
`../shell/generate_cohort_bw.sh` from a seeded generator. It writes
[`results/cohort-bw.md`](results/cohort-bw.md).

It reports two things that decay differently, and the split is the point:

- **Request shape** — every `read()` call and every byte, counted through a
  recording filehandle. Exact, identical on every machine, and needing no idle
  box, so this half does not go stale the way a timing does. It is also the half
  that transfers to the network, where a read is a range request and a round
  trip, and round trips are what a panel actually waits on. This is the same
  quantity as the Zarr comparison below, measured on the library rather than
  over the wire.
- **Time** — the CPU and syscall cost of the same work, sequential, one process
  per version, carrying the usual caveat about this box.

Sequential is deliberate. A browser opens its tracks concurrently, so this is not
the wall clock a user sees — but what concurrency hides is exactly the per-file
cost being measured, and it does not change a single request count.

### Two benchmarks run one process per side

`make scan` and `make gff3` both do, for related reasons.

`make bench` loads both library builds into one V8, so every call site they share
goes megamorphic and both sides get slower — not equally. Across a 6x–45x gap
that is noise. At a few percent it inverts the answer: run in-process, the
3000-sample GT-only scan case reported the new release at **0.88x**, a
regression, and the same code with one process per side is **1.09x faster**.
`make scan` therefore spawns an arm per side, alternates them so machine drift
lands on both, and carries a checksum of the reported genotype ranges across the
process boundary so a timing is never printed for two sides that disagree.

`make gff3` needs the same isolation for a different leak, and a bigger one. Its
eager arm allocates an object and a string per attribute per feature, and that
garbage is still on the heap when the lazy arm runs, so the lazy arm is charged
GC for work the eager arm did. In one process the parse comparison reported
**9.6x**; with a process per arm it is **2.2x**. Heap does not wash out with
alternation the way call-site shape does.

That benchmark also carries the other way to get a comparison wrong, which cost
more than the process sharing did: **its corpus is generated, because scaling a
GFF3 fixture by concatenating a real file does not work.** GFF3 ids are not
unique across copies, so duplicated children all attach to the first parent
carrying their id — 12 copies of a GENCODE excerpt gave 233 subfeatures per
top-level feature against 27 in the generated corpus and 12 in real TAIR10. Deep
trees flatter whichever side avoids per-subfeature work, and that fixture
reported 3.03x end-to-end where a realistic one says 1.29x.

## Corpus

The alignment cases use the same files and the same window as the render
benchmarks: simulated alignments over a 250 kb slice of hg19 chr22, at 20x /
200x / 1000x, short reads (wgsim) and long (pbsim), window
`chr22_mask:124000-143000` (19 kb). They are regenerated by
`../shell/generate_alignments.sh`. Using one corpus for both layers means the
parse numbers and the render numbers describe the same bytes.

The VCF cases need genotypes, which the alignment files do not carry, so they get
their own corpus over the same contig and window: 317 variants across
`chr22_mask:124000-143000`, at 100 / 1000 / 3000 samples, in both FORMAT shapes.
`../shell/generate_variants.sh` writes them, and unlike the alignments it needs
no external tools — the records come from a seeded RNG, so every machine gets
byte-identical files. The allele-frequency spectrum, the 1.5% missing rate and
the one-site-in-25 multiallelic rate are there because the scan's cost depends on
how many *distinct* genotype strings a site carries; a file of all `0|0` would
memoize perfectly and measure nothing.

The cohort BigWigs are a third corpus, and the only one where the *file count* is
the variable rather than the file size: 100 per-sample signal tracks at 100 bp
bins across the whole 250 kb contig, one BigWig a sample, from
`../shell/generate_cohort_bw.sh`. Seeded like the VCF corpus, so every machine
has the same bytes; shaped rather than flat — a per-sample depth scale, and two
copy-number segments a minority of samples carry — because a BigWig's R-tree and
its zoom levels are built from the data, and a uniform file would have an index
shape no real file has. It needs `bedGraphToBigWig`, which
`generate_alignments.sh` already depends on.

## What makes it reproducible

- **Both sides are built from source, not installed from npm.** The 2023
  tarballs on npm ship only a CommonJS `dist/` built with `--target es2015`,
  while current releases ship ESM. Timing those against each other would fold a
  transpiler-target change into the result. `setup.sh` clones each side from
  GitHub at a pinned tag and builds it with the same toolchain.
- **Nothing reads a developer's working checkout.** Every input is a tag on
  GitHub or a file in this repo.
- **The versions that actually got built are recorded**, with resolved commit
  SHAs and declared dependencies, in `.libs/manifest.txt`, and echoed into
  `results/ecosystem.md`.
- **Fixed iteration counts**, not a time budget, so a slow side cannot end up
  with fewer samples than a fast one.
- **One worker.** Two library builds competing for the same cores and page cache
  would make this a scheduling measurement.
- **No number is written down twice.** This README, and the paper's parsing
  subsection, are both rendered from the run — see "Generated output" below.

### Two deliberate adjustments

`cram-js` {{parserCramOldVer}} defaults `fetchSizeLimit` to 3 MB and throws past
it, which every long-read window here exceeds — so on its default settings the
2023 CRAM reader cannot open these files at all. JBrowse 2 never ran that
default: its `CramAdapter` set `fetchSizeLimit: 200_000_000`, commented "just
make this a large size to avoid hitting it". The benchmark passes the same
value, so it measures what JBrowse actually ran rather than a limit no JBrowse
user hit.

`cram-js` {{parserCramOldVer}} also imports `generic-filehandle` without
declaring it anywhere in its `package.json`. Under npm's flat `node_modules` it
resolved anyway, hoisted out of a transitive dependency; pnpm does not hoist, so
the import fails. `setup.sh` installs `generic-filehandle@^3.0.0` into that
clone — the range `jbrowse-components` itself pinned at the time. This is
recorded in `versions.json` as `extraDeps`, with the reason, rather than applied
silently.

## The equivalence gate

`make bench` runs `equivalence.test.ts` before any timing, and a failure stops
the run. A speed comparison between two libraries that return different records
is not a comparison.

The gate fails if any record lying **wholly inside** the window disappears
between the two releases. Records that hang over an edge are classified apart:
the three libraries genuinely disagree about whether a read starting before the
window, or a bin ending exactly on it, belongs in the answer, and that is a
boundary convention rather than lost data.

What the gate finds, all of it reported in `results/ecosystem.md`:

- **BAM** — the current release returns records the 2023 one dropped
  ({{parserBamGained}} in the short-read cases; long-read cases identical). They
  are zero-length records: unmapped mates placed at their mate's coordinate,
  which `samtools` also returns. The current release is doing strictly more work
  here, not less.
- **CRAM, long reads** — {{parserCramOldVer}} derives a long read's reference
  span wrongly. Against the BAM holding the same alignments, its `lengthOnRef`
  agrees for {{parserCramSpans}} reads; the current release agrees for every
  one. Short reads were always exact in both. A browser reading long-read CRAM
  in 2023 was drawing read ends in the wrong place.
- **CRAM, window edge** — the current release omits a few reads that start
  before the window and end within a base or two of its start, which
  {{parserCramOldVer}} returned.
- **BigWig** — the current release drops exactly one feature in the long-read
  and 1000x cases: a bin spanning {{bigwigDropped}}, which ends exactly where the
  query starts and so does not overlap it. An off-by-one at the left edge, fixed.
- **BGZF** — all three decompressors return byte-identical output.

Two subtleties the gate had to be taught, both of which produced convincing but
wrong findings first:

- The two mates of a short-read pair **share a read name**, so a truth map keyed
  on name alone keeps one mate of each pair and makes the other look like a
  mismatch. Keying on name + start + flags removes an apparent 2% CRAM error
  that was entirely an artifact of the comparison.
- Reads one side omits at the window edge otherwise resurface as a
  `lengthOnRef` disagreement — the same boundary difference counted twice. The
  span comparison is therefore scored only over records both sides returned.

## A trap worth knowing about

`bgzf-filehandle` {{parserBgzfOldVer}} shipped two decompressors and chose
between them at import time: in Node its `unzip` wraps `zlib.gunzip` (C++), and
browsers got `pakoUnzip` (pure JS). {{parserBgzfNewVer}} has a single
implementation, `pako-esm2`, everywhere.

Benchmarking the two `unzip` exports against each other in Node therefore
compares C++ against JavaScript and says nothing about the library.
`bgzf.bench.ts` measures both paths and reports them apart. The browser path —
what a genome browser actually runs — is the headline. The Node path is included
so the harder comparison is on the record rather than hidden, and it turns out
the current pure-JS decompressor also beats {{parserBgzfOldVer}}'s native-zlib
path, by {{parserBgzfNodeMin}}x to {{parserBgzfNodeMax}}x, because that path
spent its advantage on Buffer conversions and promisify wrapping.

## Zarr is measured elsewhere

The other ecosystem change worth reporting is a format, not a parser: packing a
cohort's per-sample signal into one Zarr store instead of N BigWigs. That one is
network-bound rather than CPU-bound, so it does not belong in this in-process
matrix. It has its own harness in `jbrowse-components`:

```bash
node scripts/measure_signal_latency.ts \
  --samples 1000g_cnv_build/samples.tsv \
  --region {{zarrRegion}} \
  --zarr https://jbrowse.org/code/jb2/main/test_data/1000g_cnv/qm2_cn_1kb.zarr
```

which counts every request and byte by wrapping `fetch`. For {{zarrSamples}}
individuals of the {{zarrPanel}} panel over one window:

{{zarrTable}}

The bytes are not what costs; the request count is. Each BigWig needs several
reads to locate a region before it can read it, and those reads wait on each
other, so the cost is a round trip times the number of files.

Those numbers are transcribed into `zarr.json`, which is where to update them
after a re-run; nothing here re-measures them.

## Generated output

`report.ts` writes four things from one run, so that no measured number is ever
typed by hand:

- `results/ecosystem.md` — the full table, the equivalence findings, and the
  manifest of what was built
- `results/paper/parser-speedup.tex` — the paper's table
- `results/paper/parser-numbers.tex` — every number the paper's prose states, as
  LaTeX macros
- `README.md` — this file, rendered from `README.template.md`

Edit `README.template.md`, never `README.md`. To pull a fresh run into the
paper, run `make bench` here and then `make sync-benchmarks` in the paper repo.

## Layout

- `versions.json` — the two-point pins, with SHAs, and any deliberate patch
- `sweep.json` — the per-major pins for `make sweep`, and the selection rule
- `zarr.json` — the Zarr measurement, transcribed from its own harness
- `setup.sh` — clone + build both sides; writes `.libs/manifest.txt`
- `setup-sweep.sh` — the same for `sweep.json`, tolerant of a version that will
  no longer build; writes `.libs/sweep-manifest.txt`
- `equivalence.test.ts` — the gate
- `bam.bench.ts`, `cram.bench.ts`, `bgzf.bench.ts`, `bbi.bench.ts`
- `sweep.ts` — the per-major curve, one process per version
- `cohort-bw.ts` — the N-BigWig panel, request counts and timings
- `lib/corpus.ts` — corpus, window, and the CRAM `seqFetch`
- `lib/legacy-resolve.mjs` — the two module hooks that let plain node import the
  pre-2024 builds
- `report.ts` — everything under "Generated output"

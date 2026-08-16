# What this repo compares, and what it does not

`README.md` describes each benchmark. This file is the map above them: which
comparisons exist, which axis each one varies, and which of them are missing.
It exists because the repo now holds a dozen benchmark families and "do we
compare against X" had become a question you could only answer by reading all of
them.

Written 2026-08-16. The gaps at the bottom are ordered by what they would do for
the paper, not by size.

## The axes

Every benchmark here varies exactly one thing and holds the rest fixed. Grouping
them by *what varies* rather than by what they measure is what makes the
coverage legible:

| axis varied | benchmarks | what it answers |
| --- | --- | --- |
| **request shape** | `ecosystem/results/sweep.md` (counts), `cohort-bw.md` | how many reads and bytes, and how does that change with version and with file count? |
| **JBrowse version** | `results/alignments.md`, `results/interaction.md` | what did this release, and the three years since the published one, do for a user? |
| **renderer backend** | `results/backends.md` | how much of that is the GPU path rather than everything else? |
| **library version, 2 points** | `ecosystem/results/ecosystem.md` | how much faster are the parsers than in 2023? |
| **library version, every major** | `ecosystem/results/sweep.md` | *where along the way* did that happen? |
| **one library change** | `ecosystem/results/vcf-scan.md`, `gff3-lazy.md` | what did this specific rewrite buy? |
| **file count** | `ecosystem/results/cohort-bw.md` | what does a cohort panel cost to open? |
| **row count** | `results/rowsweep` (no run of record) | is row count paid once at upload or every frame? |
| **track count** | `scripts/render/multibam.ts` | what does a multi-track pan cost? |
| **tool, cold load** | `results/crosstool.md` | how do we compare to igv.js on the same bytes? |
| **tool, interaction** | `results/crosstool-pan.md` | and with application startup out of the number? |
| **compute substrate** | `results/ld-gpu-vs-cpu.md` | is the LD compute shader worth it? |
| **implementation language** | `ecosystem/vcf-crosslang.json` (transcribed) | how does our parser stand beside htslib? |
| **the instrument itself** | `results/quiescence.md` | which completion detector, and how far apart are they? |

Two of those rows are the reason the set is worth having rather than a single
headline. The **two-point** and **every-major** parser comparisons answer
different questions from the same corpus, and a reader on an intermediate
version can only use the second. The **file count** row exists because the
two-point BigWig comparison reports nothing — 1–3 ms, flat — and that is a
property of measuring a per-file cost once, not of the library.

## What is measured on the same bytes, and what is not

The strongest property this repo has is that the render benchmarks and the
parser benchmarks read the same corpus, so the two layers describe the same
files. Three things sit outside that and should never be presented as if they
did not:

- **The cohort BigWigs** are their own corpus (`data/cohort/`), because file
  count is the variable and the alignment corpus has one file per case.
- **The VCF and GFF3 corpora** are their own, for the reasons their own sections
  give — genotypes and feature counts do not fit in a 19 kb alignment window.
- **The Zarr comparison** is transcribed from a harness in `jbrowse-components`
  and re-measures nothing here.
- **The cross-language VCF table** (`ecosystem/vcf-crosslang.json`) is someone
  else's harness on someone else's corpus, transcribed. Its `@gmod/vcf` figure
  is for v5.0.2, so it describes the 2023 parser and not the current one.

## Cross-tool coverage, honestly

| tool | reads our corpus? | harness | state |
| --- | --- | --- | --- |
| igv.js 3.8.5 | yes, same indexed BAM over range requests | `crosstool/index.html` | **runs**, cold load and pan |
| igv.js 2.12.1 | yes | same, `?igv=2.12.1` | loads; the version the 2023 paper timed |
| GenomeSpy 0.82.0 | yes — native `bam` lazy source | `crosstool/genomespy.html` | **draws nothing**; five causes ruled out |
| HiGlass + `higlass-pileup` | yes, client-side indexed BAM | none written | not started |
| JBrowse 1 v1.16.11 | yes | `~/src/dont_care/jb2profile/jb1web` | prior art, not wired up here |
| `@jbrowse/react-linear-genome-view` | yes | `~/src/dont_care/jb2profile/jb2lgv` | prior art, not wired up here |

### One layer down: the parser against other languages

The table above is browsers. At the *parser* layer there is exactly one
cross-language comparison and it is someone else's:
[brentp/vcf-bench](https://github.com/brentp/vcf-bench) times eleven bindings on
"iterate rows, pull an INFO integer, report the mean". `@gmod/vcf` comes in at
**24 s against C htslib's 18 s**, ahead of pysam (28 s) and plain cyvcf2 (29 s) —
a JavaScript parser between the C family and the Python bindings.

**That figure is for `@gmod/vcf` v5.0.2**, the 2023-era parser, so it predates
the 7.2.0 rewrites. `ecosystem/sweep.ts`'s vcf arm now runs that exact operation
on every major so the v5-to-v7 ratio can be carried onto the published scale;
`ecosystem/vcf-crosslang.json` transcribes the table and the caveats. Two of
those matter most: the task never touches a genotype, which is the part a
variant display renders and the part 7.2.0 rewrote; and the JS entry was
contributed by this project's author, so it is self-reported within someone
else's harness.

The register to keep: **igv.js confounds parser and renderer** because it
maintains its own readers, while **GenomeSpy shares our decoder** (`@gmod/bam`
`^7.1.19`), so a GenomeSpy comparison largely isolates the render path. That
makes GenomeSpy the more informative of the two and the one most worth
unblocking — and a loss there would be a cleaner result than a win against igv.

`higlass-pileup` pins `@gmod/bam` **1.1.8**, six majors back. That is usually
stated as a reason the three tools are not one controlled matrix, which is true.
It is now also something we can *price*: `make sweep` builds v1.1.18, so the
cost of that pin is a row in `results/sweep.md` and needs no HiGlass harness at
all.

## Gaps, ordered by what they would do for the paper

### 1. Extend the cross-tool pan past the two cases it has run

**Done, and it needed a new instrument.** `scripts/crosstool/panrunner.ts` →
`results/crosstool-pan.md`, which is where the numbers are; repeating them here
is how the README's copy went stale within an hour.

The shape, from the clean run of 2026-08-16 (load 0.5–1.5): **the two tools cross
between 20x and 200x**. igv is faster at 20x short read; JBrowse is several times
faster at 200x and an order of magnitude faster at 1000x. That is not a wash — it
is the difference between a cost that scales with read count and one that does
not, and the earlier claim here that JBrowse led at every short-read case came
from the broken detector described below.

Three findings from building it are worth carrying into anything else here:

- **Screenshot polling cannot resolve an interaction.** A `page.screenshot()` on
  this box costs 43–161 ms, so the detector's floor is 450–1100 ms against
  interactions of about that length. Anything here that measures an *interaction*
  by screenshot polling inherits that; cold load is long enough not to care.
- **"Both tools must fetch" was an assumption and is false at some steps.**
  JBrowse reads 256 KiB blocks, so at low coverage a one-viewport pan can land
  inside what it already holds — 3 of 5 steps at 20x-shortread, none at 1000x.
  The runner counts requests per step and restricts the headline to steps that
  fetched.
- **A completion rule built on quiet is a rule that cannot tell finished from
  pausing.** The first pan detector waited 400 ms for drawing to stop; JBrowse's
  own `LGVCoarseDynamicBlocks` debounce is 500 ms, so the gate opened inside it
  and reported **42 ms for 2.3 s of work**. Worse, firing before the fetch began
  also left the request counter at zero, so those steps were recorded as cache
  hits — which is where the inflated caching figure above came from. The window
  is now set from two measured constants rather than picked, and what is reported
  is the timestamp of a canvas draw rather than the moment of confidence.
- **The detector needed its own harness**, which is now
  `scripts/crosstool/quiescheck.ts` → `results/quiescence.md`. It falsified two
  claims within a run of being written: that screenshot cost is a property of
  the page (it tracks machine load — the two harnesses swapped places between
  runs), and that canvas draws necessarily read earlier than screen paint (on a
  JBrowse cold load, draws read 2779 ms against paint's 2213 ms, because the page
  keeps drawing after the visible result settles). Both had already been written
  down as mechanism before being measured.

What is still owed: the four remaining cases (`1000x-shortread`, and the three
long-read rows), `RUNS=3` rather than 1, and an idle box.

### 1a. Older prior art: `~/src/dont_care/jb2profile`

The benchmark this repo replaced. Worth knowing about for two reasons, and worth
**not** cross-quoting for a third:

- It carries baselines this repo does not have: **JBrowse 1** (v1.16.11) and
  **`@jbrowse/react-linear-genome-view`** embedded, each as its own harness app
  (`jb1web`, `jb2lgv`, `igvjs`). If the paper ever wants a JBrowse-1 comparison,
  the harness already exists there.
- It measured **frames per second** during interaction, which is a different
  question from either time-to-content or per-frame main-thread cost.
- **Its numbers are not commensurable with this repo's.** `results/*.json` there
  are hyperfine whole-process wall-clock timings — 4.33 s for 20x-shortread BAM —
  which include the ~3 s constant browser launch that this repo's in-page
  navigation→render-complete metric deliberately excludes. Quoting one against
  the other would read as a regression that is entirely the change of metric.

### 2. Extend request-shape counting beyond the three swept libraries

**The counting itself now exists** — `MODE=count make sweep` reports reads and
bytes for every major of `@gmod/bam`, `@gmod/cram` and `@gmod/bbi`, and
`make cohort` does it across file count. Those numbers are exact,
machine-independent and do not decay, so they are the one part of this
repository that a box at load 11 can still produce honestly. Given how much of
`NEXT_STEPS.md` is blocked on an idle machine, that property is worth spending
more on.

What it is worth spending on next:

- **`@gmod/vcf` and `bgzf-filehandle`** have no request-shape number, because
  they are not in `sweep.json` yet (gap 5).
- **The equivalence gate does not adjudicate the intermediate versions.** The
  sweep flags a version whose record set differs from the newest; only the
  2023-vs-current pair has anything that says which side is right.
- **The counter watches `read` and `readFile`.** That was enough to find that
  every `@gmod/bam` slurps the whole `.bai` rather than ranging into it — a
  counter watching only `read` reported zero index requests and made the index
  look free. Any future method that fetches bytes needs adding to that set.

### 3. Refresh the "current" pins before quoting them

`versions.json` pins current at `@gmod/bam` v7.8.1, `@gmod/cram` v10.4.0,
`@gmod/bbi` v10.0.2. npm as of 2026-08-16 has **8.11.0, 13.4.1 and 11.2.1**. The
paper's parser numbers therefore understate the current releases by one, three
and one major respectively. `sweep.json` already names the newest of each, so
the sweep and the two-point table currently disagree about what "current" means —
which is fine as long as it is deliberate, and is worth reconciling before
submission.

### 4. Sweep the application the way the libraries are now swept

`builds/` holds 2.4.0, 4.1.15, 4.3.0 and current — four points, and the paper's
§7a already asks for three of them to be shown as a trajectory. The 2.4.0 work
proved the cheap path: releases ship a prebuilt web bundle, so adding 3.x and
4.0 is a download and a `load_alignments.sh`, not a build from a 2023 toolchain.
The parser sweep and the application sweep would then answer the same question
at two layers.

### 5. Build the `@gmod/vcf` and `@gmod/bgzf-filehandle` sweeps

**Added to `sweep.json` and to `sweep.ts`'s arms**; what is left is running
`./setup-sweep.sh` for them (7 and 6 versions) and then `make sweep`. Both get a
curve and no request-shape column — neither takes a filehandle the way the other
three do — so unlike those three they need an idle box.

Each is measured through a narrower call than the two-point benchmark uses, for
the same reason in both cases: a sweep has to ask one question along its whole
axis. `@gmod/vcf` goes through `parseLine` rather than each version's cheapest
genotype call, because that call appears partway along the axis. `bgzf` prefers
`pakoUnzip` over `unzip`, because v1.x chose between a C++ and a pure-JS
decompressor at import time and sweeping `unzip` would report the end of that
split as a regression.

### 6. Unblock GenomeSpy, or write it up as blocked

It draws nothing, five causes are ruled out, and the leading account —
`BamSource` touching `this.genome` in its constructor, before
`assemblyPreflight` is awaited — is **plausible and unverified**. The corpus is
a made-up contig with no published `chrom.sizes`, so this exercises an
inline-genome path GenomeSpy's own examples do not. Next concrete step is to run
GenomeSpy's *own* published BAM example unmodified, which separates "our spec"
from "this version", and only then consider reporting upstream.

### 7. Error bars on the interaction table

`results/alignments.md` carries ±stddev over 6 runs; `results/interaction.md`
carries a median of five steps measured once. Between two runs of the same
build, `200x-shortread` moved 1818 → 1310 ms. Running each cell three times and
reporting a median of medians would close the gap, at roughly 3× the pan mode's
~12 minutes.

## The standing constraint

Everything above that produces a *timing* needs a machine this one has not been
for weeks — load was 8.2 at the start of this session's work and 15 during it,
against the 4.0 ceiling `results/` applies and the 1.5–2.9 a clean run wants.
Check `pgrep -c claude`, not just `uptime`.

That is the argument for counting. A benchmark whose output is a count rather
than a duration is one this box can still produce honestly, and the two that now
exist — `MODE=count make sweep` and `make cohort` — are the only results here
taken since July that need no caveat about the machine at all.

What they found, on that basis:

- **`@gmod/cram` v8 cut the 200x-longread query from 728 reads over 35 MB to 44
  reads over 17.5 MB.** That is the same major where the timing curve steps, so
  the CRAM speedup is at least partly a change in request shape rather than in
  decode speed.
- **`@gmod/bam` v7 went the other way on this corpus**: 4 reads and 569 KB
  became 8 reads and 772 KB at 20x shortread, while getting several times
  faster. More requests, more bytes, less time.
- **`@gmod/bbi` splits one 56-byte header read into two** between v4 and v10,
  which is an extra round trip per file — 100 of them across a cohort panel.

None of those three is visible in a timing, and the first two are invisible in
the two-point table as well.

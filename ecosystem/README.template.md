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

### The scan benchmark runs one process per side

`make bench` loads both library builds into one V8, so every call site they share
goes megamorphic and both sides get slower — not equally. Across a 6x–45x gap
that is noise. At a few percent it inverts the answer: run in-process, the
3000-sample GT-only scan case reported the new release at **0.88x**, a
regression, and the same code with one process per side is **1.09x faster**.
`make scan` therefore spawns an arm per side, alternates them so machine drift
lands on both, and carries a checksum of the reported genotype ranges across the
process boundary so a timing is never printed for two sides that disagree.

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

- `versions.json` — the pins, with SHAs, and any deliberate patch
- `zarr.json` — the Zarr measurement, transcribed from its own harness
- `setup.sh` — clone + build both sides; writes `.libs/manifest.txt`
- `equivalence.test.ts` — the gate
- `bam.bench.ts`, `cram.bench.ts`, `bgzf.bench.ts`, `bbi.bench.ts`
- `lib/corpus.ts` — corpus, window, and the CRAM `seqFetch`
- `report.ts` — everything under "Generated output"

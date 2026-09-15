# jb2bench

Benchmarks for JBrowse 2, at two layers:

- **The browser** — how fast a track renders and how it behaves under
  interaction, comparing the `webgl-poc` branch (GPU/WebGL2 renderer) against
  released versions (old block renderer). That is what this directory measures.
- **The parser libraries underneath it** — `@gmod/bam`, `cram-js`,
  `bgzf-filehandle`, `@gmod/bbi`, `@gmod/vcf`, `gff-nostream`, comparing the
  versions JBrowse 2 shipped at the 2023 paper against current releases. That lives in
  [`ecosystem/`](ecosystem/README.md) and has its own README.

Both layers read the same corpus in `data/`, so the parse numbers and the render
numbers describe the same bytes.

## Layout

| path | what |
| --- | --- |
| `data/` | the corpus: reference + simulated alignments — [`docs/corpus.md`](docs/corpus.md) |
| `scripts/render/` | the render and zoom-interaction benchmarks |
| `scripts/flamegraph/` | CPU-profile capture and the flamegraph toolkit |
| `scripts/bgzfpool/` | the BGZF inflate pool on vs off, measured twice: the query on its own and the same query through a jbrowse pan |
| `scripts/crosstool/` | the igv.js comparison: paint-quiescence profiler and matrix |
| `scripts/pif/` | a coarsened PIF's two tiers: what each costs to fetch, and how far a coarsened record draws from the alignment it stands for |
| `crosstool/` | the igv.js and GenomeSpy harness pages, plus symlinks to `data/` and the tool bundles |
| `scripts/probe.ts`, `scripts/gpucheck.ts` | dev helpers: render testids, GPU backend |
| `scripts/wasmgate.ts` | the wasm admission test: a routine's cost in JS against the cost of copying its bytes across the wasm boundary |
| `shell/` | regenerate the corpus (alignments and variants), load it into the builds |
| `builds/` | the jbrowse-web builds under test (untracked, staged by hand) — [`docs/builds.md`](docs/builds.md) |
| `results/` | every measured table, plus the raw JSON and run logs behind it |
| `flame/` | CPU profiles and the findings drawn from them |
| `ecosystem/` | the parser-library benchmarks, self-contained |
| `screenshots/` | puppeteer verify/probe output (untracked) |
| `Makefile`, `scripts/gate.ts` | every benchmark in one place, and the preflight that decides whether a timing is worth keeping |
| `scripts/paperfigs/`, `results/figures/paper/` | the ggplot2 figures, laid out like the 2023 paper's Fig 8 |

Full documentation lives in [`docs/`](docs/):

- [`docs/corpus.md`](docs/corpus.md) — what's in `data/` and how to regenerate it
- [`docs/benchmarks.md`](docs/benchmarks.md) — what each benchmark measures and why
- [`docs/builds.md`](docs/builds.md) — the `builds/` under test, including the 2023-paper baseline
- [`docs/methodology.md`](docs/methodology.md) — how measurements are kept fair, and caveats on any external claim
- [`docs/running.md`](docs/running.md) — idle-machine requirements and the full `make`/CLI reference

## Where the conclusions are

Every number lives in a file; nothing is summarized only here.

| document | question it answers |
| --- | --- |
| [`results/alignments.md`](results/alignments.md) | how long does a cold initial render take? |
| [`results/alignments-1mb.md`](results/alignments-1mb.md) | and at a 1 Mb window — is a megabase reachable at all? |
| [`results/interaction.md`](results/interaction.md) | how long does a zoom make you wait? |
| [`results/interaction-cpu.md`](results/interaction-cpu.md) | where does per-frame main-thread time go during a zoom? |
| [`results/crampool.md`](results/crampool.md) | does @gmod/cram's slice worker pool make a pan faster? (no run of record yet) |
| [`results/bgzfpool-levers.md`](results/bgzfpool-levers.md) | how much more is left in the pool — worker count against query concurrency? |
| [`results/bgzfpool.md`](results/bgzfpool.md) | does the BGZF inflate pool make a pan faster, for BAM and for tabix VCF? (no run of record yet) |
| [`flame/FINDINGS.md`](flame/FINDINGS.md) | why is 1000x-shortread a regression? |
| [`flame/ZOOM_SETTLE.md`](flame/ZOOM_SETTLE.md) | why does a zoom take 0.8 s to stop changing? |
| [`flame/WORKER_FINDINGS.md`](flame/WORKER_FINDINGS.md) | which worker-side plugin optimizations are worth doing? |
| [`results/crosstool.md`](results/crosstool.md) | how does the render time compare against igv.js? |
| [`results/crosstool-pan.md`](results/crosstool-pan.md) | and how does a *pan* compare, with startup out of the number? |
| [`results/crosstool-zoom.md`](results/crosstool-zoom.md) | and a *zoom*, where nothing has to be fetched at all? |
| [`results/wasmgate.md`](results/wasmgate.md) | is a routine worth compiling to wasm, or does the copy cost more than the work? |
| [`results/quiescence.md`](results/quiescence.md) | which completion detector, and what does being wrong cost? |
| [`ecosystem/README.md`](ecosystem/README.md) | how much faster did the parser libraries get since 2023? |
| [`ecosystem/results/sweep.md`](ecosystem/results/sweep.md) | *where* along the majors did the parsers get faster? |
| [`ecosystem/results/cohort-bw.md`](ecosystem/results/cohort-bw.md) | what does a 100-sample BigWig panel cost to open? |
| [`ecosystem/results/vcf-scan.md`](ecosystem/results/vcf-scan.md) | what did the @gmod/vcf 7.2.0 genotype-scan rewrite buy? |
| [`ecosystem/results/gff3-lazy.md`](ecosystem/results/gff3-lazy.md) | is deferring GFF3 attribute parsing worth it, and to whom? |
| [`ecosystem/results/cram-samtools.md`](ecosystem/results/cram-samtools.md) | where does @gmod/cram stand against samtools now, on the 2019 paper's own benchmark? (no run of record yet) |

## Quick start

```bash
pnpm install
npx puppeteer browsers install chrome   # the pinned measurement browser

# serve the builds under test — 8000 is whichever new build you are testing
npx http-server builds/current       -p 8000 -s --cors &
npx http-server builds/release-4.3.0 -p 8001 -s --cors &

node scripts/gpucheck.ts headless             # confirm hardware acceleration
node scripts/render/runner.ts                 # → results/alignments.{md,json}
node scripts/render/runner-interaction.ts     # → results/interaction.{md,json}

make            # lists every benchmark target
make gate       # is this machine fit to measure on right now?
make all        # gate, counts, timings, figures, report
```

The parser-library benchmarks need no build, server or GPU:

```bash
cd ecosystem && make bench
```

See [`docs/running.md`](docs/running.md) for the full command reference,
per-benchmark flags, and why the machine must be idle before any timing run.

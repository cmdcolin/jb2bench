# Every benchmark in this repo, in an order that makes sense, with the preflight
# that decides whether the result is worth keeping.
#
#   make            what each target does
#   make gate       is this machine fit to measure on right now?
#   make counts     everything that needs no idle box (request counts, equivalence)
#   make timings    everything that does
#   make all        gate, counts, timings, figures, report
#
# Two rules this file exists to enforce, both learned the expensive way:
#
#   1. Nothing is timed before `make gate` passes. A run started at load 3.15
#      finished at 35 and reported 25187 ms and then 56452 ms for the same work.
#   2. Counting and timing are separate targets. A count is exact on any machine;
#      a timing is worthless on a busy one. Splitting them means a loaded box can
#      still produce a result rather than nothing.
#
# What this file does NOT do is stage builds/ or start the http-servers — those
# are `make serve`, and which build sits on which port is a decision, not a
# default. See "Running it" in README.md.
NODE := node --experimental-strip-types
STAMP := $(shell date +%Y-%m-%d)
LOGDIR := results/logs

.PHONY: help gate counts timings all figures report serve serve-stop \
        corpus corpus-paper render render-1mb interaction crosstool crosstool-cold \
        crosstool-zoom crosstool-pan crosstool-bundles \
        parsers parsers-count cram-samtools multibam backends clean-logs \
        formats toolcheck shots paper-tables paper-figs paper-data wait-quiet \
        backends-webgpu \
        wasmgate bgzfpool bgzfpool-standalone bgzfpool-endtoend pif

help:
	@echo "preflight"
	@echo "  make gate            load, agents, disk, corpus, ports, sweep builds"
	@echo "  make wait-quiet      block until it passes, to chain a run behind"
	@echo "  make serve           http-servers for the three builds + crosstool"
	@echo "  make serve-stop      stop them"
	@echo "  make crosstool-bundles  build the Gosling harness bundle"
	@echo ""
	@echo "corpus (generate once, then leave alone)"
	@echo "  make corpus          alignments, variants, GFF3, modBAM, cohort BigWigs, bgzf VCFs"
	@echo "  make corpus-paper    the 2019 cram-js paper's own corpus (~16 GB, network)"
	@echo ""
	@echo "measure — no idle box needed"
	@echo "  make counts          parser equivalence gate + request-shape counts"
	@echo "  make formats         tool x format capability matrix"
	@echo "  make toolcheck       do the cross-tool harness pages still draw?"
	@echo ""
	@echo "measure — needs an idle box (make gate first)"
	@echo "  make timings         render, interaction, cross-tool, parsers"
	@echo "  make render          cold load, both formats x both read types"
	@echo "  make render-1mb      the same, at a 1 Mb window: 20x and 100x over 2 Mb"
	@echo "  make interaction     zoom and pan time-to-content"
	@echo "  make crosstool       against igv.js: cold load, zoom and pan, all four arms"
	@echo "  make crosstool-cold  just the cold-load matrix"
	@echo "  make crosstool-zoom  just the zoom"
	@echo "  make crosstool-pan   just the pan"
	@echo "  make parsers         the parser libraries, 2023 vs current, + the sweep"
	@echo "  make cram-samtools   @gmod/cram against samtools, the 2019 paper's benchmark"
	@echo "  make wasmgate        is a routine worth compiling to wasm, or is the copy bigger?"
	@echo "  make bgzfpool        the BGZF inflate pool on vs off, query alone and end to end"
	@echo "  make pif PIF=f.pif.gz what a coarsened PIF's tiers cost, and how far they draw off"
	@echo "  make multibam        multi-track pan"
	@echo "  make backends        webgl vs webgpu vs canvas"
	@echo "  make backends-webgpu the same + a WebGPU rung, 19kb/100kb/1mb, headed firefox"
	@echo ""
	@echo "present"
	@echo "  make figures         ggplot2 figures from the recorded JSON"
	@echo "  make paper-tables    the render tables as \\input files for the paper"
	@echo "  make paper-figs      the manuscript figures, from results/paper/*.csv"
	@echo "  make paper-data      refresh results/paper/*.csv from results/"
	@echo "  make report          results/report.html"
	@echo "  make all             gate, counts, timings, figures, report"

# ------------------------------------------------------------------ preflight

gate:
	@$(NODE) scripts/gate.ts

# `gate` asked on a loop, for a run that starts itself when the box frees up:
#   make wait-quiet && make crosstool-cold
wait-quiet:
	@$(NODE) scripts/waitquiet.ts

$(LOGDIR):
	@mkdir -p $(LOGDIR)

# Serving is backgrounded and deliberately not a dependency of anything: a
# benchmark target that starts its own servers would also have to decide which
# build goes where, and that decision belongs to whoever staged builds/.
serve: crosstool-bundles
	npx http-server builds/current       -p 8000 -s --cors &
	npx http-server builds/release-4.3.0 -p 8001 -s --cors &
	npx http-server builds/release-2.4.0 -p 8004 -s --cors &
	npx http-server crosstool            -p 8003 -s --cors &
	@sleep 2 && $(NODE) scripts/gate.ts --warn

serve-stop:
	-pkill -f "http-server builds/" || true
	-pkill -f "http-server crosstool" || true

# -------------------------------------------------------------------- corpus

corpus:
	shell/generate_alignments.sh
	shell/generate_1mb.sh
	shell/generate_modbam.sh
	shell/generate_variants.sh
	shell/generate_gff3.sh
	shell/generate_cohort_bw.sh
	shell/generate_bgzf_vcf.sh
	shell/load_alignments.sh
	shell/load_bgzf_tracks.sh

corpus-paper:
	shell/fetch_paper2019.sh

# --------------------------------------------------------- counts (any box)
#
# Exact on any machine, because a request count does not care what else is
# running. These are the only results here that need no caveat about the box.

counts: | $(LOGDIR)
	$(MAKE) -C ecosystem verify 2>&1 | tee $(LOGDIR)/equivalence-$(STAMP).log
	MODE=count $(MAKE) -C ecosystem sweep 2>&1 | tee $(LOGDIR)/sweep-count-$(STAMP).log
	$(MAKE) -C ecosystem cohort 2>&1 | tee $(LOGDIR)/cohort-$(STAMP).log
	$(MAKE) formats 2>&1 | tee $(LOGDIR)/format-support-$(STAMP).log

# Which tool opens which format off a plain static host. It drives a browser,
# but the answer is a boolean and not a duration, so a loaded box gives the same
# table a quiet one does — which is why it sits with the counts. `make toolcheck`
# is the narrower question behind it: do the harness pages still work at all.
formats:
	$(NODE) scripts/crosstool/formatsupport.ts

toolcheck: crosstool-bundles
	$(NODE) scripts/crosstool/toolcheck.ts

# What each arm actually DRAWS at one window, into screenshots/crosstool/.
# `toolcheck` asks whether a page drew anything from corpus bytes; a page of
# flat rectangles passes that as cleanly as a full pileup, which is how the
# GenomeSpy arm spent its first weeks being timed on a picture nobody else was
# drawing. Not a timing, so it does not need an idle box.
shots: crosstool-bundles
	$(NODE) scripts/crosstool/shots.ts
	TRACK=20x.shortread.nomd.bam $(NODE) scripts/crosstool/shots.ts
	@python3 scripts/crosstool/drawdetail.py screenshots/crosstool/*.png

# ------------------------------------------------------- timings (idle box)

render: gate | $(LOGDIR)
	$(NODE) scripts/render/runner.ts 2>&1 | tee $(LOGDIR)/render-$(STAMP).log

# The width axis. Everything else here is measured at 19 kb on a 250 kb contig,
# so depth is the only variable it can move; this arm holds depth at what people
# actually have (20x, 100x) and moves the window to 1 Mb instead. Its own
# assembly and its own results file — see scripts/render/cases.ts.
render-1mb: gate | $(LOGDIR)
	SCALE=1mb $(NODE) scripts/render/runner.ts 2>&1 | tee $(LOGDIR)/render-1mb-$(STAMP).log

interaction: gate | $(LOGDIR)
	$(NODE) scripts/render/runner-interaction.ts 2>&1 | tee $(LOGDIR)/interaction-$(STAMP).log

# Every figure in results/figures draws the same four arms: v2.4.0 (what the
# 2023 paper benchmarked), v4.3.0 (the last release), the build under test, and
# igv.js. So every cross-tool target serves all three JBrowse ports rather than
# only 8000 — a matrix with one JBrowse column cannot draw those figures, and a
# figure set where each panel has different arms is not a figure set.
ARMS := JBROWSE_PORTS=8000,8001,8004

# Two arm lists, because the two runners can drive different numbers of tools.
#
# Cold load is a page load, so any harness page that draws can be an arm.
# Pan and zoom are *motions*, and panrunner.ts moves each tool through its own
# API -- `kind: 'jbrowse' | 'igv' | 'genomespy'` -- so an arm there costs a
# driver per tool. GenomeSpy gained one on 2026-09-02 and is in both lists now;
# Gosling has none, so naming it in a motion run would have it silently filtered
# out and quietly narrow the table.
TOOLARMS := TOOLS=jbrowse,jbrowse-release-4.3.0,jbrowse-release-2.4.0,igv,igv-deep,genomespy,gosling
MOTIONARMS := TOOLS=jbrowse,jbrowse-release-4.3.0,jbrowse-release-2.4.0,igv,igv-deep,genomespy

# The Gosling harness is the one arm that needs a build step. gosling.js ships
# ESM with bare specifiers, so a browser cannot load it out of node_modules the
# way it loads the igv.js and GenomeSpy bundles that crosstool/ symlinks into
# place. The runner refuses to start without this file rather than letting the
# arm paint an empty frame -- which, under a paint-quiescence instrument, would
# report the best number in the table.
# Two bundles: stock Gosling, and the same build with its 20 kb tile-width cap
# raised so the wide window renders at all. The patched one is a separate arm and
# never a substitute for the stock column -- see the script's header.
crosstool-bundles: crosstool/gosling.bundle.js

crosstool/gosling.bundle.js crosstool/gosling-patched.bundle.js &: \
    crosstool/gosling-entry.js scripts/crosstool/goslingbundle.ts package.json
	$(NODE) scripts/crosstool/goslingbundle.ts

crosstool: crosstool-cold crosstool-zoom crosstool-pan

# `toolcheck` and not just `gate`: the gate says the corpus is reachable through
# the harness port, and toolcheck says the pages then draw it. On 2026-09-06
# toolcheck reported NOTHING DRAWN for all six non-JBrowse arms at the 1 Mb
# window and the matrix ran regardless, because nothing depended on it. It reads
# the same WINDOWS/TRACKS as the run it now guards, so it preflights the windows
# about to be measured and no others.
crosstool-cold: gate toolcheck crosstool-bundles | $(LOGDIR)
	$(ARMS) $(TOOLARMS) $(NODE) scripts/crosstool/runner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-cold-$(STAMP).log

crosstool-zoom: gate toolcheck | $(LOGDIR)
	MOTION=zoom $(ARMS) $(MOTIONARMS) $(NODE) scripts/crosstool/panrunner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-zoom-$(STAMP).log

crosstool-pan: gate toolcheck | $(LOGDIR)
	MOTION=pan $(ARMS) $(MOTIONARMS) $(NODE) scripts/crosstool/panrunner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-pan-$(STAMP).log

multibam: gate | $(LOGDIR)
	$(NODE) scripts/render/multibam.ts 2>&1 | tee $(LOGDIR)/multibam-$(STAMP).log

backends: gate | $(LOGDIR)
	$(NODE) scripts/render/backends.ts 2>&1 | tee $(LOGDIR)/backends-$(STAMP).log

# The same comparison with a WebGPU rung in it, swept over the three windows.
#
# Firefox Nightly, because Chrome's WebGPU canvas is blank on this box: the
# frame fails Dawn validation after submit, and the app only consoles that
# error rather than surfacing it, so the run looks like a fast render of
# nothing. scripts/render/backends.ts has the detail.
#
# All three windows sit on the chr22_2mb corpus so width is the only thing that
# varies across them; pairing the deep 19 kb arm with the 1 Mb one would vary
# contig and depth ladder too.
#
# HEADED: Firefox windows take over :0 for hours. Not a run to start on a
# machine someone is using.
backends-webgpu: gate | $(LOGDIR)
	for s in 19kb-wide 100kb-wide 1mb; do \
	  SCALE=$$s $(NODE) scripts/render/backends.ts --browser=firefox --runs=5 \
	    2>&1 | tee $(LOGDIR)/backends-firefox-$$s-$(STAMP).log; \
	done

# What the BGZF inflate pool is worth, measured twice over the same files and
# the same windows: once with nothing above the query and once through a real
# jbrowse pan. The gap between them is the point — the first is a ceiling a user
# never reaches, and quoting it alone is the mistake results/crampool.md records
# this repo already making about the CRAM slice pool.
#
# The end-to-end half needs a build carrying the `useBgzfWorkerPool` config slot
# and a `.nopool` twin of every bgzip-backed track (`shell/load_bgzf_tracks.sh`,
# which `make corpus` runs). Against a build without the slot both arms run
# pooled and the run reports ~1.00x; the blob-worker count it prints is what
# says so rather than leaving it to be inferred from a flat number.
#
# Out of `timings` deliberately. It needs a build the other targets do not, and
# it is long: twelve tracks x five reps x two arms x six page loads.
bgzfpool: bgzfpool-standalone bgzfpool-endtoend

# JB2 (below, by paper-data) names the jbrowse-components checkout. This arm
# bundles @gmod/bam, @gmod/tabix and @gmod/bgzf-filehandle out of it rather than
# out of this repo's node_modules, where they arrive as igv.js's transitive deps
# four majors behind — so that both arms of the figure are the same code.
bgzfpool-standalone: gate | $(LOGDIR)
	JBROWSE=$(JB2) $(NODE) scripts/bgzfpool/standalone.ts 2>&1 \
	  | tee $(LOGDIR)/bgzfpool-standalone-$(STAMP).log

bgzfpool-endtoend: gate | $(LOGDIR)
	$(NODE) scripts/bgzfpool/endtoend.ts 2>&1 \
	  | tee $(LOGDIR)/bgzfpool-endtoend-$(STAMP).log

parsers: gate | $(LOGDIR)
	$(MAKE) -C ecosystem bench 2>&1 | tee $(LOGDIR)/parsers-$(STAMP).log
	$(MAKE) -C ecosystem sweep 2>&1 | tee $(LOGDIR)/sweep-$(STAMP).log
	$(MAKE) -C ecosystem scan  2>&1 | tee $(LOGDIR)/vcf-scan-$(STAMP).log
	$(MAKE) -C ecosystem gff3  2>&1 | tee $(LOGDIR)/gff3-$(STAMP).log

cram-samtools: gate | $(LOGDIR)
	$(MAKE) -C ecosystem cram-samtools 2>&1 | tee $(LOGDIR)/cram-samtools-$(STAMP).log

# Order matters: the render matrix is the longest and the most sensitive to a
# machine going busy, so it runs first, while the box is known good. The parser
# arms are process-isolated and shorter, so a late load spike damages fewer
# cells there.
timings: render interaction crosstool parsers cram-samtools

# What a coarsened PIF costs and how far it draws off the alignment. The file is
# not in data/ -- a two-tier whole-genome PIF is ~130 MB -- so it is named:
#
#   make pif PIF=~/data/hs1ToMm39/hs1ToMm39.over.chain.pif.gz
#
# coarsening.ts reads the index alone and is instant; deviation.ts walks every
# CIGAR in the file and takes a few minutes, writing the CSVs the figure draws.
PIF ?=
pif:
	@[ -n "$(PIF)" ] || { echo "set PIF=<file.pif.gz>"; exit 1; }
	$(NODE) scripts/pif/coarsening.ts $(PIF) --json results/pif-coarsening.json
	$(NODE) --max-old-space-size=12000 scripts/pif/deviation.ts $(PIF)

# ------------------------------------------------------------------ present

# The four render tables the manuscript prints, as \input files. Same rule as
# the parser tables ecosystem/report.ts writes: nothing measured is typed by
# hand. They land in results/paper/ beside the CSVs `make paper-data` writes.
paper-tables:
	$(NODE) scripts/render/papertables.ts

# The ecosystem sweep curves. This target used to draw two more sets into
# results/figures/ -- scripts/render/charts.R's four-arm render charts and
# scripts/crosstool/panchart.R's zoom/pan pair -- and both were deleted on
# 2026-09-02: the manuscript figures under results/figures/paper/ draw the same
# JSON and carry more (GenomeSpy, igv.js at both windows, the foreign-CPU gate),
# so the older set was a second answer to the same question that nobody read.
figures:
	Rscript ecosystem/sweepchart.R

# The manuscript figures, ported from the paper repo when the manuscript moved
# to a Google Doc, and since 2026-09-02 the only figures this repo draws of the
# render and cross-tool runs. They carry what the deleted four-arm set did not:
# igv.js at both windows, GenomeSpy, and a foreign-CPU gate that drops a
# contended cell rather than plotting it.
#
# Two targets, because the scripts are written as two halves. `paper-data`
# re-reads results/ and rewrites the CSVs, and is what a fresh benchmark
# invalidates; `paper-figs` redraws from the committed CSVs and needs no run.
# So a figure change is one command and cannot silently pick up a new
# measurement with it.
paper-figs:
	Rscript scripts/paperfigs/perf-coldload.R
	Rscript scripts/paperfigs/perf-coldload-windows.R
	Rscript scripts/paperfigs/perf-downsampling.R
# Sources perf-coldload.R for its panels, so it redraws that script's three
# figures on the way through. Idempotent, and about fifteen seconds.
	Rscript scripts/paperfigs/perf-coldload-ab.R
	Rscript scripts/paperfigs/width.R
	Rscript scripts/paperfigs/perf-interaction.R
	Rscript scripts/paperfigs/perf-crosstool-zoom.R
	Rscript scripts/paperfigs/parser.R
	Rscript scripts/paperfigs/cluster-endtoend.R
	Rscript scripts/paperfigs/cluster.R
	Rscript scripts/paperfigs/wasmgate.R
	Rscript scripts/paperfigs/pif-deviation.R
	@if [ -f results/paper/bgzfpool.csv ]; then \
	   Rscript scripts/paperfigs/bgzfpool.R; \
	 else echo "no results/paper/bgzfpool.csv; run make bgzfpool then make paper-data"; fi

# The cluster pair reads jbrowse-components, not this repo, so it is skipped
# rather than fatal when that checkout is not beside us: the other four are the
# ones a benchmark run here invalidates.
JB2 ?= $(HOME)/src/jbrowse-components
paper-data:
	Rscript scripts/paperfigs/perf-data.R .
# The wide arm, whose own results file the reader above does not touch.
	@if [ -f results/alignments-1mb.json ]; then \
	   Rscript scripts/paperfigs/width-data.R .; \
	 else echo "no 1 Mb run on disk; width.csv is left as committed"; fi
	Rscript scripts/paperfigs/parser-data.R .
	Rscript scripts/paperfigs/wasmgate-data.R .
# Standalone alone is enough: that arm needs no staged build, and the figure
# draws it as a single series until an end-to-end run exists beside it.
	@if [ -f results/bgzfpool-standalone.json ]; then \
	   Rscript scripts/paperfigs/bgzfpool-data.R .; \
	 else echo "no bgzfpool run on disk; bgzfpool.csv is left as committed"; fi
	@if [ -d $(JB2) ]; then \
	   Rscript scripts/paperfigs/cluster-data.R $(JB2); \
	   Rscript scripts/paperfigs/clusterphases-data.R . $(JB2) \
	     || echo "clusterphases.csv left as committed, for the reason above"; \
	 else echo "no $(JB2); the clustering CSVs are left as committed"; fi

# What a wasm port has to beat before it is worth writing: the cost of copying
# its input into the wasm heap and its result back out. Reads BAM through the
# GMOD checkouts beside this one rather than through a pinned install, because
# what it compares is one library's two implementations of the same routine --
# @gmod/bgzf-filehandle ships both the Rust/libdeflate inflate and the pako one.
# GMOD= names where those checkouts are; the run records each one's git rev.
#
# Under `timings` rather than `counts`: it is a timing, and this one carries the
# extra hazard that its two sides are bound by different resources -- inflate by
# the CPU, the floor by memory bandwidth -- so contention need not land on them
# equally. Run it on an idle box or read only the direction.
GMOD ?= $(HOME)/src/gmod
wasmgate: | $(LOGDIR)
	GMOD=$(GMOD) $(NODE) scripts/wasmgate.ts 2>&1 | tee $(LOGDIR)/wasmgate-$(STAMP).log

report:
	$(NODE) scripts/render/report.ts > results/report.html
	@echo "wrote results/report.html"

all: gate counts timings figures report

clean-logs:
	rm -rf $(LOGDIR)

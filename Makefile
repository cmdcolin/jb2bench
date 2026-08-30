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
        corpus corpus-paper render interaction crosstool crosstool-cold \
        crosstool-zoom crosstool-pan crosstool-bundles \
        parsers parsers-count cram-samtools multibam backends clean-logs \
        formats toolcheck shots paper-tables paper-figs paper-data wait-quiet

help:
	@echo "preflight"
	@echo "  make gate            load, agents, disk, corpus, ports, sweep builds"
	@echo "  make wait-quiet      block until it passes, to chain a run behind"
	@echo "  make serve           http-servers for the three builds + crosstool"
	@echo "  make serve-stop      stop them"
	@echo "  make crosstool-bundles  build the Gosling harness bundle"
	@echo ""
	@echo "corpus (generate once, then leave alone)"
	@echo "  make corpus          alignments, variants, GFF3, modBAM, cohort BigWigs"
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
	@echo "  make interaction     zoom and pan time-to-content"
	@echo "  make crosstool       against igv.js: cold load, zoom and pan, all four arms"
	@echo "  make crosstool-cold  just the cold-load matrix"
	@echo "  make crosstool-zoom  just the zoom"
	@echo "  make crosstool-pan   just the pan"
	@echo "  make parsers         the parser libraries, 2023 vs current, + the sweep"
	@echo "  make cram-samtools   @gmod/cram against samtools, the 2019 paper's benchmark"
	@echo "  make multibam        multi-track pan"
	@echo "  make backends        webgl vs webgpu vs canvas"
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
	shell/generate_modbam.sh
	shell/generate_variants.sh
	shell/generate_gff3.sh
	shell/generate_cohort_bw.sh
	shell/load_alignments.sh

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
# API -- `kind: 'jbrowse' | 'igv'` -- so an arm there costs a driver per tool.
# GenomeSpy and Gosling have no driver yet, so naming them in a motion run would
# have them silently filtered out and quietly narrow the table.
TOOLARMS := TOOLS=jbrowse,jbrowse-release-4.3.0,jbrowse-release-2.4.0,igv,igv-deep,genomespy,gosling
MOTIONARMS := TOOLS=jbrowse,jbrowse-release-4.3.0,jbrowse-release-2.4.0,igv,igv-deep

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

crosstool-cold: gate crosstool-bundles | $(LOGDIR)
	$(ARMS) $(TOOLARMS) $(NODE) scripts/crosstool/runner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-cold-$(STAMP).log

crosstool-zoom: gate | $(LOGDIR)
	MOTION=zoom $(ARMS) $(MOTIONARMS) $(NODE) scripts/crosstool/panrunner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-zoom-$(STAMP).log

crosstool-pan: gate | $(LOGDIR)
	MOTION=pan $(ARMS) $(MOTIONARMS) $(NODE) scripts/crosstool/panrunner.ts 2>&1 \
	  | tee $(LOGDIR)/crosstool-pan-$(STAMP).log

multibam: gate | $(LOGDIR)
	$(NODE) scripts/render/multibam.ts 2>&1 | tee $(LOGDIR)/multibam-$(STAMP).log

backends: gate | $(LOGDIR)
	$(NODE) scripts/render/backends.ts 2>&1 | tee $(LOGDIR)/backends-$(STAMP).log

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

# ------------------------------------------------------------------ present

# The four render tables the manuscript prints, as \input files. Same rule as
# the parser tables ecosystem/report.ts writes: nothing measured is typed by
# hand. They land in results/paper/ beside the CSVs `make paper-data` writes.
paper-tables:
	$(NODE) scripts/render/papertables.ts

figures:
	Rscript scripts/render/charts.R
	Rscript scripts/crosstool/panchart.R
	Rscript ecosystem/sweepchart.R

# The manuscript figures, ported from the paper repo when the manuscript moved
# to a Google Doc. Separate from `figures` above, which draws this repo's own
# four-arm charts into results/figures/: these carry the comparators that set
# does not (igv.js at both windows, GenomeSpy) and are gated on foreign CPU
# per cell. Both draw the same JSON, so a conclusion should not depend on which
# one you read; where they disagree, these are the ones the manuscript quotes.
#
# Two targets, because the scripts are written as two halves. `paper-data`
# re-reads results/ and rewrites the CSVs, and is what a fresh benchmark
# invalidates; `paper-figs` redraws from the committed CSVs and needs no run.
# So a figure change is one command and cannot silently pick up a new
# measurement with it.
paper-figs:
	Rscript scripts/paperfigs/perf-coldload.R
	Rscript scripts/paperfigs/perf-interaction.R
	Rscript scripts/paperfigs/perf-motion.R
	Rscript scripts/paperfigs/parser.R
	Rscript scripts/paperfigs/ldband.R
	Rscript scripts/paperfigs/cluster-endtoend.R
	Rscript scripts/paperfigs/cluster.R

# The cluster pair reads jbrowse-components, not this repo, so it is skipped
# rather than fatal when that checkout is not beside us: the other four are the
# ones a benchmark run here invalidates.
JB2 ?= $(HOME)/src/jbrowse-components
paper-data:
	Rscript scripts/paperfigs/perf-data.R .
	Rscript scripts/paperfigs/parser-data.R .
	Rscript scripts/paperfigs/ldband-data.R .
	@if [ -d $(JB2) ]; then \
	   Rscript scripts/paperfigs/cluster-data.R $(JB2); \
	   Rscript scripts/paperfigs/clusterphases-data.R . $(JB2) \
	     || echo "clusterphases.csv left as committed, for the reason above"; \
	 else echo "no $(JB2); the clustering CSVs are left as committed"; fi

report:
	$(NODE) scripts/render/report.ts > results/report.html
	@echo "wrote results/report.html"

all: gate counts timings figures report

clean-logs:
	rm -rf $(LOGDIR)

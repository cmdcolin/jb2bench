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
        corpus corpus-paper render interaction crosstool parsers \
        parsers-count cram-samtools multibam backends clean-logs

help:
	@echo "preflight"
	@echo "  make gate            load, agents, disk, corpus, ports, sweep builds"
	@echo "  make serve           http-servers for the four builds + crosstool"
	@echo "  make serve-stop      stop them"
	@echo ""
	@echo "corpus (generate once, then leave alone)"
	@echo "  make corpus          alignments, variants, GFF3, modBAM, cohort BigWigs"
	@echo "  make corpus-paper    the 2019 cram-js paper's own corpus (~16 GB, network)"
	@echo ""
	@echo "measure — no idle box needed"
	@echo "  make counts          parser equivalence gate + request-shape counts"
	@echo ""
	@echo "measure — needs an idle box (make gate first)"
	@echo "  make timings         render, interaction, cross-tool, parsers"
	@echo "  make render          cold load, both formats x both read types"
	@echo "  make interaction     zoom and pan time-to-content"
	@echo "  make crosstool       against igv.js"
	@echo "  make parsers         the parser libraries, 2023 vs current, + the sweep"
	@echo "  make cram-samtools   @gmod/cram against samtools, the 2019 paper's benchmark"
	@echo "  make multibam        multi-track pan"
	@echo "  make backends        webgl vs webgpu vs canvas"
	@echo ""
	@echo "present"
	@echo "  make figures         ggplot2 figures from the recorded JSON"
	@echo "  make report          results/report.html"
	@echo "  make all             gate, counts, timings, figures, report"

# ------------------------------------------------------------------ preflight

gate:
	@$(NODE) scripts/gate.ts

$(LOGDIR):
	@mkdir -p $(LOGDIR)

# Serving is backgrounded and deliberately not a dependency of anything: a
# benchmark target that starts its own servers would also have to decide which
# build goes where, and that decision belongs to whoever staged builds/.
serve:
	npx http-server builds/current       -p 8000 -s --cors &
	npx http-server builds/release-4.3.0 -p 8001 -s --cors &
	npx http-server builds/release-4.1.15 -p 8002 -s --cors &
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

# ------------------------------------------------------- timings (idle box)

render: gate | $(LOGDIR)
	$(NODE) scripts/render/runner.ts 2>&1 | tee $(LOGDIR)/render-$(STAMP).log

interaction: gate | $(LOGDIR)
	$(NODE) scripts/render/runner-interaction.ts 2>&1 | tee $(LOGDIR)/interaction-$(STAMP).log

crosstool: gate | $(LOGDIR)
	$(NODE) scripts/crosstool/panrunner.ts 2>&1 | tee $(LOGDIR)/crosstool-pan-$(STAMP).log

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

figures:
	Rscript scripts/render/charts.R
	Rscript ecosystem/sweepchart.R

report:
	$(NODE) scripts/render/report.ts > results/report.html
	@echo "wrote results/report.html"

all: gate counts timings figures report

clean-logs:
	rm -rf $(LOGDIR)

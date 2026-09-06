#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-downsampling.pdf, from results/paper/perf.csv.
#
# igv.js at its default samplingDepth (500 reads per 100 bp window) against the
# same run with the downsampler effectively off (samplingDepth=10000, igv's own
# MAXIMUM_SAMPLING_DEPTH) -- the control crosstool/index.html and
# scripts/crosstool/runner.ts already carry as `igv-deep`. perf-coldload.R and
# perf-coldload-windows.R never draw this arm; it exists to check whether
# downsampling is what makes igv fast in THOSE figures, not to add a seventh
# line to them.
#
# EVERY WINDOW, one figure, because that is the question 2026-09-06 raised: the
# 19 kb and 100 kb rows already show default and no-downsampling agreeing within
# a few percent across the whole 20x-1000x ladder (results/crosstool.md has the
# numbers), so downsampling was ruled out there before this figure existed. The
# 1 Mb row is the one window that control was never run at until now -- this
# figure is what answers whether the same holds there, instead of the two
# columns sitting unread as sixteen more rows in a CSV.
#
# The 1 Mb panels are the SECOND attempt at that answer. The first, earlier on
# 2026-09-06, had both igv arms opening a page whose corpus 404'd, so the two
# columns agreed to within a few percent by both drawing nothing -- see
# scripts/crosstool/servedharness.ts. They agree here because they render the
# same reads, which is a different fact with the same shape.
#
# BAM ONLY, same reason as perf-coldload-windows.R: window is already the facet
# column, and a downsampling check does not need the format axis to answer its
# one question. The 1 Mb CRAM cells the 2026-09-06 re-run added say the same
# thing as its BAM ones -- default and no-downsampling within a few percent.
#
#   Rscript scripts/paperfigs/perf-downsampling.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

DRAWN <- c("igv.js 3.8.5", "igv.js 3.8.5, no downsampling")

# A local palette rather than PERF_SERIES: that list is sized to the series
# every headline figure shares, and ggplot's default hue palette is spaced by
# level COUNT, not by name -- adding this control arm as a seventh level shifted
# every colour after it (Release 4.3.0 on down) on every figure that still
# shares the list. "igv.js 3.8.5" keeps the blue it has everywhere else
# (hue_pal()(6)[5], the colour PERF_SERIES already gives it); the control gets
# its own colour because it is never drawn beside anything PERF_SERIES orders.
DOWNSAMPLING_COLOURS <- c("igv.js 3.8.5" = "#619CFF",
                         "igv.js 3.8.5, no downsampling" = "#D55E00")

all <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
all <- subset(all, panel == "Cold load" & session == "cross-tool" &
                   format == "BAM" & series %in% DRAWN)

all$coverage <- as.numeric(sub("x .*", "", all$case))
all$reads <- factor(sub("^[0-9]+x ", "", all$case),
                    levels = c("short read", "long read"))
all$series <- factor(all$series, levels = DRAWN)
all$window <- factor(all$window, levels = c("19kb", "100kb", "1mb"),
                     labels = c("19 kb", "100 kb", "1 Mb"))
all$s <- all$ms / 1000
all$lo_s <- all$lo / 1000
all$hi_s <- all$hi / 1000

dropped <- unique(subset(all, !usable)[, c("reads", "window")])
d <- subset(all, usable)
meas <- subset(d, !censored)

CELL <- c("reads", "window")
# Reference is the default arm, not "This work": the question this figure
# answers is whether turning downsampling off moves igv, not how either compares
# to this build. A ratio near 1x is the answer "no"; nothing on
# perf-coldload.pdf changes because of what this figure shows either way.
labels <- coldload_labels(d, meas, CELL, reference = "igv.js 3.8.5")

note <- if (nrow(dropped)) {
  geom_text(data = dropped, label = "gap: cell measured under external load",
            x = Inf, y = -Inf, hjust = 1.04, vjust = -0.8, size = POINT_LABEL,
            inherit.aes = FALSE)
}

fig <- ggplot(d, aes(x = coverage, y = s, colour = series)) +
  geom_line(data = meas, linewidth = LINE_W) +
  geom_linerange(data = meas, aes(ymin = lo_s, ymax = hi_s),
                 linewidth = 0.4, na.rm = TRUE, show.legend = FALSE) +
  geom_point(data = meas, size = POINT_S) +
  geom_point(data = subset(d, censored), size = POINT_S, shape = 1) +
  endpoint_repel(labels) +
  note +
  facet_grid(reads ~ window) +
  scale_x_log10(breaks = c(20, 100, 200, 1000),
                labels = c("20×", "100×", "200×", "1000×"),
                guide = guide_axis(n.dodge = 2),
                expand = expansion(mult = c(0.18, 0.24))) +
  time_scale_y("time (log scale)",
               breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
               expand = expansion(mult = c(0.17, 0.3))) +
  scale_colour_manual(values = DOWNSAMPLING_COLOURS, breaks = DRAWN) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(title = "igv.js default sampling vs no downsampling, by window size",
       x = "coverage", colour = NULL) +
  paper_theme()

ggsave("results/figures/paper/pdf/perf-downsampling.pdf", fig,
       width = 260, height = 200, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-downsampling.pdf\n")

ggsave("results/figures/paper/png/perf-downsampling.png", fig,
       width = 260, height = 200, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-downsampling.png\n")

# ---- draft caption ----------------------------------------------------------
#   igv.js 3.8.5 at its default samplingDepth (500 reads per 100 bp window)
#   against the same run with downsampling effectively off (samplingDepth
#   10000), across all three benchmarked windows. Bold labels give the
#   no-downsampling arm's time at its last coverage and its ratio to the
#   default at the same point -- a ratio near 1x says downsampling is not what
#   the default column's speed comes from at that window.

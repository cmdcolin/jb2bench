#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-coldload-windows.pdf, from
# results/paper/perf.csv.
#
# The same "Cold load" cross-tool numbers as perf-coldload.R's three individual
# figures (19 kb, 100 kb, 1 Mb), drawn once with window as a facet column
# instead of a figure boundary. perf-coldload.R argues against exactly this
# facet for itself -- format still carries two levels at 19 kb and 100 kb, so
# adding window there means a fourth grid dimension -- and that argument still
# holds for the format comparison. What changes it here is dropping format:
# the individual figures are still where a reader goes for BAM against CRAM,
# and this one is where they go to see cost grow with window size without
# walking between three files.
#
# BAM ONLY, and now by choice rather than by necessity. CRAM sits a few percent
# above BAM at every window, including 1 Mb since the re-run of 2026-09-06
# measured it there -- so this figure could carry it, and does not: window is
# already the facet column, and adding format would put four factors on a grid
# whose every point is labelled. The individual figures drawn by
# perf-coldload.R are where a reader goes for BAM against CRAM.
#
# ONE COVERAGE AXIS FOR ALL THREE WINDOWS, because the point of the facet is a
# reader comparing panels left to right, and a shared x scale is what makes
# that comparison honest. The 1 Mb column only measures 20x/100x -- the deep
# sweep's 200x/1000x points don't exist there, not a run that failed -- so its
# panel draws two points against the other columns' three, on the union of
# both breaks rather than a scale rescaled to fit.
#
#   Rscript scripts/paperfigs/perf-coldload-windows.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

# Same set perf-coldload.R draws, for the same reason: the comparator a reader
# can place is the published release plus the two other renderers measured
# alongside it in one session.
DRAWN <- c("Release 2.4.0", "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")

all <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
all <- subset(all, panel == "Cold load" & session == "cross-tool" &
                   format == "BAM" & series %in% DRAWN)

all$coverage <- as.numeric(sub("x .*", "", all$case))
all$reads <- factor(sub("^[0-9]+x ", "", all$case),
                    levels = c("short read", "long read"))
all$series <- factor(all$series, levels = PERF_SERIES)
all$window <- factor(all$window, levels = c("19kb", "100kb", "1mb"),
                     labels = c("19 kb", "100 kb", "1 Mb"))
all$s <- all$ms / 1000
all$lo_s <- all$lo / 1000
all$hi_s <- all$hi / 1000

dropped <- unique(subset(all, !usable)[, c("reads", "window")])
d <- subset(all, usable)
meas <- subset(d, !censored)

CELL <- c("reads", "window")
labels <- coldload_labels(d, meas, CELL, reference = "This work")

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
  # 100x and 200x sit 0.3 decades apart, close enough that their labels
  # collide in the two columns that draw both. Dodged onto two rows rather
  # than dropped -- each window uses a different half of this shared axis, so
  # every break earns its label somewhere.
  scale_x_log10(breaks = c(20, 100, 200, 1000),
                labels = c("20×", "100×", "200×", "1000×"),
                guide = guide_axis(n.dodge = 2),
                expand = expansion(mult = c(0.18, 0.22))) +
  time_scale_y("time (log scale)",
               breaks = c(1, 2, 5, 10, 20, 60, 120, 600, 900),
               expand = expansion(mult = c(0.17, 0.28))) +
  scale_colour_discrete(drop = FALSE,
                        breaks = intersect(PERF_SERIES,
                                           unique(as.character(d$series)))) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(title = "Navigating to a genomic region, by window size",
       x = "coverage", colour = NULL) +
  paper_theme()

ggsave("results/figures/paper/pdf/perf-coldload-windows.pdf", fig,
       width = 260, height = 200, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-coldload-windows.pdf\n")

ggsave("results/figures/paper/png/perf-coldload-windows.png", fig,
       width = 260, height = 200, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-coldload-windows.png\n")

# ---- draft caption ----------------------------------------------------------
#   Cold load of a single alignment track, BAM only, across three window
#   sizes: navigation to render-complete, median of three interleaved rounds
#   in one session. Bold labels give that tool's time at its last coverage and
#   how many times slower that is than this work at the same point. A hollow
#   marker is a run abandoned at the 120 s paint ceiling -- a lower bound
#   rather than a measurement. The 1 Mb column only measures 20x and 100x
#   coverage; the deeper points on the other two columns are a different run,
#   not a gap in this one.

#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-coldload-combined.pdf, from
# results/paper/perf.csv.
#
# Combines the two perf-coldload.R panels (19 kb and 100 kb windows) into one
# 8-panel facet: reads (2 rows) x window x format (4 columns), grouped so the
# left half of the grid is the 19 kb window and the right half is the 100 kb
# window, each split into its own BAM/CRAM pair. perf-coldload.R argues at
# length for keeping window out of the grid -- see its header -- this script
# is the requested override of that call, not a replacement for it;
# perf-coldload.R still owns the two individual figures.
#
#   Rscript scripts/paperfigs/perf-coldload-combined.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

DRAWN <- c("Release 2.4.0", "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")

all <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
all <- subset(all, panel == "Cold load" & session == "cross-tool" &
                   series %in% DRAWN)

all$coverage <- as.numeric(sub("x .*", "", all$case))
all$reads <- factor(sub("^[0-9]+x ", "", all$case),
                    levels = c("short read", "long read"))
all$series <- factor(all$series, levels = PERF_SERIES)
all$format <- factor(all$format, levels = c("BAM", "CRAM"))
all$window <- factor(all$window, levels = c("19kb", "100kb"),
                     labels = c("viewing 19 kbp region", "viewing 100 kbp region"))
all$s <- all$ms / 1000

d <- all

dropped <- unique(subset(d, !usable)[, c("reads", "format", "window")])
d <- subset(d, usable)

meas <- subset(d, !censored)

CELL <- c("reads", "format", "window")
labels <- coldload_labels(d, meas, CELL, reference = "This work")

note <- if (nrow(dropped)) {
  geom_text(data = dropped, label = "gap: cell measured under external load",
            x = Inf, y = -Inf, hjust = 1.04, vjust = -0.8, size = POINT_LABEL,
            inherit.aes = FALSE)
}

fig <- ggplot(d, aes(x = coverage, y = s, colour = series)) +
  geom_line(data = meas, linewidth = LINE_W) +
  geom_point(data = meas, size = POINT_S) +
  # An arm abandoned at the paint ceiling is drawn hollow and left off the line,
  # as it is in perf-coldload.R: dropping the row instead leaves a curve that
  # simply stops, and a reader cannot tell a cell nobody measured from one the
  # tool gave up on. This is why the labels come from the shared
  # coldload_labels() rather than a copy of it -- the copy is what dropped them.
  geom_point(data = subset(d, censored), size = POINT_S, shape = 1) +
  endpoint_repel(labels) +
  note +
  facet_grid(reads ~ window + format) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.22, 0.22))) +
  time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
               expand = expansion(mult = c(0.22, 0.28))) +
  scale_colour_discrete(drop = FALSE,
                        breaks = intersect(PERF_SERIES,
                                           unique(as.character(d$series))),
                        labels = function(x) {
                          x <- ifelse(x == "GenomeSpy 0.85.0", "GenomeSpy 0.85.0*", x)
                          x <- ifelse(x == "Release 2.4.0", "JBrowse 2.4.0", x)
                          ifelse(x == "This work", "JBrowse 5.0.0", x)
                        }) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(x = "coverage", colour = NULL,
       caption = paste("* no CRAM support. Bold: that tool's time at its last coverage,",
                       "and how many times slower that is than JBrowse 5.0.0 at the same point.",
                       "Hollow: gave up at the paint ceiling.")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, colour = "grey30"))

ggsave("results/figures/paper/pdf/perf-coldload-combined.pdf", fig,
       width = 360, height = 225, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-coldload-combined.pdf\n")

ggsave("results/figures/paper/png/perf-coldload-combined.png", fig,
       width = 360, height = 225, units = "mm", dpi = 300,
       device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-coldload-combined.png\n")

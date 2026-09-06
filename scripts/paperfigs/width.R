#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-width.pdf, from results/paper/width.csv.
#
# Navigation to render-complete on a cold load of a 1 Mb window: this work
# against release 2.4.0, over both container formats and both read lengths.
#
# DRAWN TO OVERLAY perf-coldload.pdf. Same axes, same colours, same label
# placement, same title sentence with a different width in it — 19 kb, 100 kb,
# 1 Mb. That is how the window axis is read here: three figures a reader can put
# side by side, rather than a window facet that would take a third dimension of
# a grid whose two are already spent on read length and format.
#
# TWO ARMS, and not the cross-tool set the other cold-load figures carry. The
# igv.js and GenomeSpy harness pages are wired to the 250 kb assembly the rest
# of this corpus sits on, so at 1 Mb there is nothing to compare against yet.
# What the two arms do bracket is the question the wide corpus was built for:
# whether a megabase view is reachable at all, and how far it has moved since
# the version the 2023 paper describes.
#
# TWO POINTS PER CURVE, because 20x and 100x is the coverage ladder here. The
# deep arm sweeps three decades of coverage through a fixed 19 kb window and
# answers what depth costs; this one holds depth at what people actually have
# and moves the window instead. A segment is a thin curve, so every point
# carries its own duration and the log axis carries only the shape.
#
#   Rscript scripts/paperfigs/width.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/width.csv", stringsAsFactors = FALSE)

d$coverage <- as.numeric(sub("x .*", "", d$case))
d$reads <- factor(sub("^[0-9]+x ", "", d$case),
                  levels = c("short read", "long read"))
d$series <- factor(d$series, levels = PERF_SERIES)
d$format <- factor(d$format, levels = c("BAM", "CRAM"))
d$s <- d$ms / 1000
d$lo_s <- d$lo / 1000
d$hi_s <- d$hi / 1000

# A cell measured under external load truncates its series rather than being
# drawn: a point nobody can vouch for is worse on a figure than a gap, because
# the gap is visible and the point is not.
dropped <- unique(subset(d, !usable)[, c("reads", "format")])
d <- subset(d, usable)
meas <- subset(d, !censored)

CELL <- c("reads", "format")
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
  endpoint_repel(labels) +
  note +
  facet_grid(reads ~ format) +
  scale_x_log10(breaks = c(20, 100), labels = c("20×", "100×"),
                expand = expansion(mult = c(0.22, 0.26))) +
  time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60),
               expand = expansion(mult = c(0.17, 0.28))) +
  # drop = FALSE so both arms keep the colour they have on every other figure
  # here, which is the whole point of drawing this one to overlay them.
  scale_colour_discrete(drop = FALSE,
                        breaks = intersect(PERF_SERIES,
                                           unique(as.character(d$series)))) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(title = "Navigating to a 1 Mb genomic region",
       x = "coverage", colour = NULL) +
  paper_theme()

ggsave("results/figures/paper/pdf/perf-width.pdf", fig,
       width = 200, height = 200, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-width.pdf\n")

ggsave("results/figures/paper/png/perf-width.png", fig,
       width = 200, height = 200, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-width.png\n")

# ---- draft caption ----------------------------------------------------------
# Kept beside the figure so the words that make it readable travel with it.
#
#   Cold load of a single alignment track at a 1 Mb window: navigation to
#   render-complete, median of six runs, over both container formats. The
#   corpus is 20x and 100x simulated coverage over a 2 Mb contig, so a
#   megabase of reads is on screen at once — 666k short reads at 100x. Bold
#   labels give release 2.4.0's time at 100x and how many times slower that is
#   than this work at the same point. Vertical bars are the range of the six
#   runs. Axes, colours and label placement match the 19 kb and 100 kb cold-load
#   figures, which this one is meant to be read against.

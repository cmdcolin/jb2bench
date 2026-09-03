#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-crosstool-zoom.pdf, from results/paper/perf.csv.
#
# A 2x zoom in, JBrowse against igv.js on one instrument that belongs to
# neither: the draws-and-network clock of scripts/crosstool/drawclock.ts. The
# figure the cross-tool motion run has never had -- perf-data.R has extracted
# these rows as session "cross-tool motion" since 2026-08-29 and nothing has
# drawn them since panchart.R went on 2026-09-02.
#
# It answers the question the JBrowse-only perf-interaction.pdf cannot: whether
# a zoom that costs seconds is what a genome browser costs, or what JBrowse
# cost. igv.js redraws in 54-1300 ms where the two older JBrowse builds take
# 1.1-7.5 s, so the answer is the second one.
#
# Two rows, because on this motion the wait and the work are different numbers.
# JBrowse's wait is flat at ~510 ms across a fifty-fold range of coverage, which
# is not the shape of work: it is the 500 ms LGVCoarseDynamicBlocks debounce
# (plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts), with a
# sub-millisecond redraw inside it. Publishing that one number as a render time
# is a mistake this repo made once and retracted, so both travel.
#
# THE BOTTOM ROW DROPS THE TWO OLDER JBROWSE BUILDS, and the reason is not that
# they look bad there -- they look impossibly good. The block renderer paints in
# a worker and the main thread only composites the finished tile, so the draw
# clock times a drawImage and reads 0.0-0.1 ms underneath a 7.5 s wait.
# drawclock patches the page's canvas prototypes and cannot reach a worker's own
# global scope. results/crosstool-zoom.md prints those cells with a dagger and
# tells the reader to compare only the un-daggered ones; a figure has no dagger,
# so it carries the arms the column can actually compare and says why in the
# caption. The current renderer draws on the main thread through WebGL and igv
# through the 2D API, and for those two this is the rasterization itself.
#
#   Rscript scripts/paperfigs/perf-crosstool-zoom.R
#
# Endpoint labels are plain durations, no ratios. The claim here is a shape --
# one arm flat, one rising with depth, two in seconds -- and the one ratio the
# bottom row would carry is this work against igv's rasterizer, which is a
# different and louder claim than the one the figure is for.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
d <- subset(d, session == "cross-tool motion" & panel == "Zoom in, both hold the data")
d$s <- d$ms / 1000

d$coverage <- as.numeric(sub("x .*", "", d$case))
d$reads <- factor(sub("^[0-9]+x ", "", d$case), levels = c("short read", "long read"))
d$series <- factor(d$series, levels = PERF_SERIES)

WORKER_RENDERERS <- c("Release 2.4.0", "Release 4.3.0")
ROWS <- c("What the reader waits", "The redraw alone")
d$row <- factor(ifelse(d$metric == "what the user waits", ROWS[1], ROWS[2]),
                levels = ROWS)
d <- subset(d, !(row == ROWS[2] & series %in% WORKER_RENDERERS))

ends <- d[order(-d$coverage), ]
ends <- ends[!duplicated(ends[c("row", "reads", "series")]), ]
ends$label <- fmt_time(ends$s)

fig <- ggplot(d, aes(x = coverage, y = s, colour = series)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S) +
  geom_text_repel(data = ends, aes(label = label), direction = "y",
                  nudge_x = ENDPOINT_NUDGE, hjust = 0, size = ENDPOINT_LABEL,
                  fontface = "bold", seed = REPEL_SEED, show.legend = FALSE,
                  min.segment.length = 0.3, segment.size = 0.25,
                  segment.alpha = 0.5, box.padding = 0.25) +
  facet_grid(row ~ reads, scales = "free_y") +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.08, 0.3))) +
  time_scale_y(name = NULL, breaks = c(0.001, 0.01, 0.1, 1, 10)) +
  scale_colour_discrete(drop = FALSE,
                        breaks = c("Release 2.4.0", "Release 4.3.0", "This work",
                                   "igv.js 3.8.5")) +
  labs(x = "coverage", colour = NULL,
       caption = paste(
         "2× zoom in, median of five steps, one instrument belonging to neither tool. No arm made a",
         "network request on any step, so every difference is redraw and not fetch. Top: what the reader",
         "waits — igv.js never pays the multi-second zoom, so the outlier is the older JBrowse and not",
         "the web. This work's flat ~510 ms is the 500 ms navigation debounce and not work. Bottom: the",
         "draw burst alone, without the two older builds — they rasterize in a worker, where a page-side",
         "clock times the compositing blit rather than the rendering.",
         sep = "\n")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, face = "italic",
                                    lineheight = 1.25, margin = margin(t = 8)))

ggsave("results/figures/paper/pdf/perf-crosstool-zoom.pdf", fig,
       width = 240, height = 205, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-crosstool-zoom.pdf\n")

ggsave("results/figures/paper/png/perf-crosstool-zoom.png", fig,
       width = 240, height = 205, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-crosstool-zoom.png\n")

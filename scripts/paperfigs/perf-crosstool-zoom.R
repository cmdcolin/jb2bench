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
# cost. igv.js redraws in 34-1300 ms where the two older JBrowse builds take
# 1.1-7.5 s, so the answer is the second one.
#
# A GenomeSpy column draws itself the run it is measured -- the arm landed in
# panrunner.ts on 2026-09-02 and the legend is computed from the data rather
# than listed. It is the second foreign tool the claim wants, and the more
# telling one: it decodes BAM through the same @gmod/bam this build does, so it
# is a renderer beside a renderer where igv confounds parser with renderer.
#
# TWO LINES PER TOOL, because on this motion the wait and the work are different
# numbers. JBrowse's wait is flat at ~510 ms across a fifty-fold range of
# coverage, which is not the shape of work: it is the 500 ms
# LGVCoarseDynamicBlocks debounce
# (plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts) around a
# sub-millisecond redraw. Publishing that one number as a render time is a
# mistake this repo made once and retracted, so both travel.
#
# Solid and dashed in one panel rather than a panel each. As two faceted rows
# the same data made the reader carry a value across the figure to compare it
# with itself, and the relation between the rows -- the second is a PART of the
# first -- is the one thing a facet strip cannot say. Drawn together the gap
# between a tool's own two lines is the part of its wait that was not drawing,
# read off directly: igv's two lines coincide, and this work's are three decades
# apart.
#
# ONLY TWO TOOLS HAVE A DASHED LINE, and the reason is not that the others look
# bad with one -- they look impossibly good. The block renderer paints in a
# worker and the main thread only composites the finished tile, so the draw
# clock times a drawImage and reads 0.0-0.1 ms underneath a wait of seconds.
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
# figure would carry is this work's rasterizer against igv's, which is a
# different and louder claim than the one it is for. igv's dashed line is
# unlabelled because it lands on its solid one, and two labels on one curve read
# as two measurements.

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
MEASURES <- c("the wait", "the drawing")
d$measure <- factor(ifelse(d$metric == "what the user waits", MEASURES[1], MEASURES[2]),
                    levels = MEASURES)
d <- subset(d, !(measure == MEASURES[2] & series %in% WORKER_RENDERERS))

ends <- d[order(-d$coverage), ]
ends <- ends[!duplicated(ends[c("measure", "reads", "series")]), ]
ends <- subset(ends, measure == MEASURES[1] | series == "This work")
ends$label <- fmt_time(ends$s)

fig <- ggplot(d, aes(x = coverage, y = s, colour = series, linetype = measure)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S, show.legend = FALSE) +
  geom_text_repel(data = ends, aes(label = label), direction = "y",
                  nudge_x = ENDPOINT_NUDGE, hjust = 0, size = ENDPOINT_LABEL,
                  fontface = "bold", seed = REPEL_SEED, show.legend = FALSE,
                  min.segment.length = 0.3, segment.size = 0.25,
                  segment.alpha = 0.5, box.padding = 0.25) +
  facet_wrap(~reads) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.08, 0.3))) +
  time_scale_y(name = NULL, breaks = c(0.001, 0.01, 0.1, 1, 10)) +
  scale_linetype_manual(values = c("solid", "22")) +
  # drop = FALSE keeps every series the colour it is on the cold-load figure;
  # `breaks` then limits the legend to the arms this run measured, computed
  # rather than listed so a GenomeSpy column appears the run it is measured and
  # a legend key never stands for a curve that is not on the page.
  scale_colour_discrete(drop = FALSE,
                        breaks = PERF_SERIES[PERF_SERIES %in% d$series]) +
  # Two rows for the colour keys. GenomeSpy became a sixth arm on 2026-09-03
  # and seven keys on one row run off both ends of a 240 mm canvas, which
  # clipped "Release 2.4.0" and the linetype pair rather than shrinking to fit.
  guides(colour = guide_legend(order = 1, nrow = 2),
         linetype = guide_legend(order = 2,
                                 override.aes = list(linewidth = 0.6))) +
  labs(x = "coverage", colour = NULL, linetype = NULL,
       caption = paste(
         "2× zoom in, median of five steps, on one instrument belonging to neither tool. No arm made a network",
         "request on any step, so every difference here is drawing and not fetching. Solid is the wait; dashed is",
         "the drawing inside it. igv.js's two lines coincide — its wait is its redraw — while this work spends half",
         "a second in a navigation debounce around 0.6 ms of drawing. The two older builds have no dashed line:",
         "they rasterize in a worker, where a page-side clock times the compositing blit and not the rendering.",
         sep = "\n")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, face = "italic",
                                    lineheight = 1.25, margin = margin(t = 8)))

ggsave("results/figures/paper/pdf/perf-crosstool-zoom.pdf", fig,
       width = 240, height = 168, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-crosstool-zoom.pdf\n")

ggsave("results/figures/paper/png/perf-crosstool-zoom.png", fig,
       width = 240, height = 168, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-crosstool-zoom.png\n")

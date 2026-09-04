#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-crosstool-zoom.pdf, from results/paper/perf.csv.
#
# A 2x zoom in, JBrowse against igv.js and GenomeSpy on one instrument that
# belongs to none of them: the draws-and-network clock of
# scripts/crosstool/drawclock.ts. It answers the question the JBrowse-only
# perf-interaction.pdf cannot: whether a zoom that costs seconds is what a
# genome browser costs, or what JBrowse cost. The foreign arms redraw in
# 8-1300 ms where the two older JBrowse builds take 1.1-7.7 s, so the answer is
# the second one. GenomeSpy is the more telling of the two: it decodes BAM
# through the same @gmod/bam this build does, so it is a renderer beside a
# renderer where igv confounds parser with renderer.
#
# TWO PANELS, because the run measures two different numbers per tool and only
# some tools have both.
#
# The top panel is the result: what a user waits after the zoom, one line per
# arm, one legend. Every JBrowse arm sits above igv.js and GenomeSpy on this
# motion and the axis says so without a caption's help.
#
# The bottom panel is the caveat that keeps the top one honest. JBrowse's wait
# is flat at ~510 ms across a fifty-fold range of coverage, which is not the
# shape of work: it is the 500 ms LGVCoarseDynamicBlocks debounce
# (plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts) around a
# sub-millisecond redraw. Publishing that 0.6 ms as a render time is a mistake
# this repo made once and retracted, so it travels underneath the wait rather
# than instead of it -- and in its own panel, where the gap between a tool's two
# lines is the whole subject and the label on each line can be a sentence.
#
# Drawn as one figure the two measures needed two legends, a fourth decade of y
# axis for a 500 us dashed line, and a reader who had to work out which arms the
# dashed keys applied to. Split, each panel makes one claim and carries only the
# keys it uses.
#
# ONLY TWO ARMS ARE IN THE BOTTOM PANEL, and the reason is not that the others
# look bad there -- they look impossibly good. The block renderer paints in a
# worker and the main thread only composites the finished tile, so the draw
# clock times a drawImage and reads 0.0-0.1 ms underneath a wait of seconds.
# drawclock patches the page's canvas prototypes and cannot reach a worker's own
# global scope. results/crosstool-zoom.md prints those cells with a dagger and
# tells the reader to compare only the un-daggered ones; a figure has no dagger,
# so the panel carries the arms the clock can actually compare and says why in
# the caption. The current renderer draws on the main thread through WebGL and
# igv through the 2D API, and for those two this is the rasterization itself.
#
#   Rscript scripts/paperfigs/perf-crosstool-zoom.R
#
# Endpoint labels are plain durations, no ratios. The claim here is a shape --
# one arm flat, one rising with depth, two in seconds -- and the one ratio the
# figure would carry is this work's rasterizer against igv's, which is a
# different and louder claim than the one it is for. igv's drawing line is
# unlabelled because it lands on its wait line, and two labels on one curve read
# as two measurements.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
  library(patchwork)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
d <- subset(d, session == "cross-tool motion" & panel == "Zoom in, both hold the data")
d$s <- d$ms / 1000

d$coverage <- as.numeric(sub("x .*", "", d$case))
d$lo_s <- d$lo / 1000
d$hi_s <- d$hi / 1000
d$reads <- factor(sub("^[0-9]+x ", "", d$case), levels = c("short read", "long read"))
d$series <- factor(d$series, levels = PERF_SERIES)

WAIT <- "the whole wait"
DRAW <- "the drawing inside it"
d$measure <- factor(ifelse(d$metric == "what the user waits", WAIT, DRAW),
                    levels = c(WAIT, DRAW))

# The arms whose rasterizer runs in a WORKER, where a page-side clock times the
# compositing blit and not the rendering -- they read 0.0-0.1 ms underneath a
# wait of seconds. Everything else draws on the main thread and is measured for
# real.
#
# An EXCLUDE list, and that is the point rather than a style choice. This was an
# include list (`CLOCKED <- c("This work", "igv.js 3.8.5")`) for one day, and in
# that day it silently dropped GenomeSpy: its motion arm landed on 2026-09-02,
# the panel split rewrote the filter on 2026-09-03, and nobody added the new arm
# to the new list. Excluding by the stated reason puts every future arm in the
# panel by default and leaves one out only where the instrument cannot see it.
#
# GenomeSpy is the arm this panel most wants, which is what made losing it
# costly: it decodes BAM through the same @gmod/bam this build does, so against
# it the comparison is a renderer beside a renderer, where igv confounds parser
# with renderer.
WORKER_RENDERERS <- c("Release 2.4.0", "Release 4.3.0")

endpoints <- function(df) {
  e <- df[order(-df$coverage), ]
  e <- e[!duplicated(e[c("measure", "reads", "series")]), ]
  e$label <- fmt_time(e$s)
  e
}

# Everything the two panels share: the curves, their endpoint labels, and the
# axes. `breaks` limits the colour legend to the arms a panel draws, computed
# rather than listed so a GenomeSpy column appears the run it is measured;
# drop = FALSE keeps every series the colour it has on the cold-load figure.
zoom_panel <- function(df, ends, y_breaks) {
  ggplot(df, aes(x = coverage, y = s, colour = series, linetype = measure)) +
    geom_line(linewidth = LINE_W) +
    # The three runs behind each point, as their range.
    #
    # `geom_linerange` and not `geom_errorbar`, because an errorbar's cap width
    # is measured in DATA space and this x axis is log10: a constant width draws
    # a cap fifty times wider at 1000x than at 20x, and making it proportional
    # (`width = coverage * k`) puts a width aesthetic into the scale's own
    # training data and collapses the axis -- every point onto one x, every
    # break label on top of the others. Capless is the honest trade: a cap is
    # decoration, and the range on most of these cells is smaller than the
    # marker anyway, which the caption says.
    #
    # `na.rm` because a cell whose plotted statistic has no per-run array
    # recorded gets no bar -- see MOTION_RUNS in perf-data.R.
    geom_linerange(aes(ymin = lo_s, ymax = hi_s),
                   linewidth = 0.4, na.rm = TRUE, show.legend = FALSE) +
    geom_point(size = POINT_S, show.legend = FALSE) +
    geom_text_repel(data = ends, aes(label = label), direction = "y",
                    nudge_x = ENDPOINT_NUDGE, hjust = 0, size = ENDPOINT_LABEL,
                    fontface = "bold", seed = REPEL_SEED, show.legend = FALSE,
                    min.segment.length = 0.3, segment.size = 0.25,
                    segment.alpha = 0.5, box.padding = 0.25) +
    facet_wrap(~reads) +
    scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                  expand = expansion(mult = c(0.08, 0.3))) +
    time_scale_y(name = NULL, breaks = y_breaks) +
    scale_linetype_manual(values = c("solid", "22"), drop = FALSE) +
    scale_colour_discrete(drop = FALSE,
                          breaks = PERF_SERIES[PERF_SERIES %in% df$series]) +
    labs(x = "coverage", colour = NULL, linetype = NULL) +
    paper_theme() +
    theme(plot.title = element_text(size = rel(1), face = "bold",
                                    margin = margin(b = 6)))
}

wait <- subset(d, measure == WAIT)
top <- zoom_panel(wait, endpoints(wait), c(0.01, 0.1, 1, 10)) +
  # Two rows for the colour keys: six arms on one row run off both ends of a
  # 240 mm canvas, which clipped "Release 2.4.0" rather than shrinking to fit.
  guides(colour = guide_legend(nrow = 2), linetype = "none") +
  labs(title = "What the user waits for", x = NULL)

inside <- subset(d, !(series %in% WORKER_RENDERERS))
# Label every wait endpoint, and a drawing endpoint only where it is separated
# from its own arm's wait: igv's two lines coincide -- its wait IS its redraw --
# and two labels on one curve read as two measurements. Computed from the values
# rather than named per arm, because a list of arms is what dropped GenomeSpy
# from this panel in the first place.
LABEL_SEPARATION <- 2
inside_ends <- endpoints(inside)
inside_waits <- subset(inside_ends, measure == WAIT)
inside_ends$wait_s <- inside_waits$s[match(
  paste(inside_ends$reads, inside_ends$series),
  paste(inside_waits$reads, inside_waits$series))]
inside_ends <- subset(inside_ends,
                      measure == WAIT | s * LABEL_SEPARATION < wait_s)

bottom <- zoom_panel(inside, inside_ends, c(0.001, 0.01, 0.1, 1)) +
  guides(colour = "none",
         linetype = guide_legend(override.aes = list(linewidth = 0.6))) +
  labs(title = "Inside that wait, for the arms drawing on the main thread") +
  theme(strip.text = element_blank())

fig <- top / bottom +
  plot_layout(heights = c(1, 1)) +
  plot_annotation(theme = theme(text = element_text(size = PAPER_BASE)))

ggsave("results/figures/paper/pdf/perf-crosstool-zoom.pdf", fig,
       width = 240, height = 238, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-crosstool-zoom.pdf\n")

ggsave("results/figures/paper/png/perf-crosstool-zoom.png", fig,
       width = 240, height = 238, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-crosstool-zoom.png\n")

# ---- draft caption ----------------------------------------------------------
# Kept here so the figure and the words that make it readable travel together;
# the figure itself carries no explanatory text.
#
#   A 2x zoom in, median of five steps, timed by one instrument belonging to no
#   tool on the figure. No arm made a network request on any step, so every
#   difference here is drawing and not fetching. The upper panel is what a user
#   waits for after the zoom. The lower panel opens that wait for the three arms
#   whose rasterizer a page-side clock can see: igv.js's two lines coincide --
#   its wait is its redraw -- while this work spends half a second in a
#   navigation debounce around 0.6 ms of drawing, and GenomeSpy about 8 ms
#   around 0.8 ms. This work and GenomeSpy rasterize in the same order of time;
#   what separates their waits is not the drawing. The two release arms have no
#   drawing line because they rasterize in a worker, where the clock times the
#   compositing blit and not the rendering. GenomeSpy's long-read line stops at
#   200x: no 1000x step on that arm returned a usable measurement. Vertical bars
#   are the range of the three runs behind each point, and on most cells are
#   shorter than the marker -- the widest of the six "This work" wait cells
#   spans 6.5 ms about a 517 ms median. The lower panel has no bars: its per-run
#   draw values were not recorded before 2026-09-03.

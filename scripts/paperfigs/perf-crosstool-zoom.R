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
# arm, one legend. The build under test and GenomeSpy sit at the bottom of it,
# the two releases at the top, and the axis says so without a caption's help.
#
# The bottom panel is what the wait is made of. It earned its place answering a
# sharper question than it answers now: the JBrowse wait used to be flat at
# ~510 ms across a fifty-fold range of coverage, which is not the shape of work,
# and the drawing inside it was sub-millisecond. That gap was the 500 ms
# LGVCoarseDynamicBlocks throttle
# (plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts), reached
# because the benchmark drove the per-frame chokepoint rather than the discrete
# path a UI control takes; scripts/crosstool/panprofile.ts fixed that on
# 2026-09-04 and the wait fell to 7-30 ms.
#
# The panel stays because the two numbers are still different -- 8 ms of wait
# around 2 ms of drawing at 20x short read -- and because publishing the drawing
# alone as a render time is a mistake this repo made once and retracted. It
# travels underneath the wait rather than instead of it, in its own panel, where
# the gap between a tool's two lines is the whole subject and the label on each
# line can be a sentence.
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

# What each arm's renderer IS, shown in the legend instead of the bare tool name.
# The figure's subject is architecture: three of them, three orders of magnitude,
# in that order down the panel. Named here, a reader who has never opened either
# codebase can see why the lines sit where they do; named as tools only, the
# vertical order is a fact about brands and the reader has to already know which
# renderer each one ships to read it as anything else.
#
# A relabel and not a rename: PERF_SERIES levels and their colours are shared
# with the cold-load and interaction figures so a tool keeps its colour across
# the set, and renaming here would fork that.
ARCH <- c(
  "Release 2.4.0"    = "Release 2.4.0 \u2014 worker tiles, re-rasterized",
  "Release 4.1.15"   = "Release 4.1.15",
  "Release 4.3.0"    = "Release 4.3.0 \u2014 worker tiles, re-rasterized",
  "This work"        = "This work \u2014 GPU, batched",
  "igv.js 3.8.5"     = "igv.js 3.8.5 \u2014 2D canvas, per read",
  "GenomeSpy 0.85.0" = "GenomeSpy 0.85.0 \u2014 GPU"
)

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
    scale_colour_discrete(drop = FALSE, labels = function(x) unname(ARCH[x]),
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
  guides(colour = guide_legend(nrow = 3), linetype = "none") +
  labs(title = "What the user waits for",
       # The premise, on the figure rather than only in the caption. Without it
       # a reader assumes fetching is in these numbers and reads the spread as
       # a comparison of network stacks; the run establishes the opposite, and
       # it is the fact that makes this a redraw comparison at all.
       subtitle = "No arm fetched a byte on any zoom step \u2014 every difference here is drawing",
       x = NULL)

inside <- subset(d, !(series %in% WORKER_RENDERERS))

# THE BOTTOM PANEL IS A RATIO, not a second copy of the top one.
#
# It used to plot the wait and the drawing as two lines per arm, and it existed
# to expose a 500 ms navigation throttle sitting on top of 0.6 ms of drawing --
# a gap so large that drawing it twice was the clearest way to say it. The
# discrete-drive fix of 2026-09-04 removed the throttle, and with it the reason:
# the solid lines became duplicates of the panel above, and the message shrank to
# a gap the reader had to eyeball between two nearly-coincident curves.
#
# What survives is worth one number rather than two lines. Of the time a user
# waits, how much was the tool actually drawing? igv.js sits at ~1: its wait IS
# its redraw, it is busy the whole time. The GPU arms sit far below it, because
# what they wait on is not rasterization. That is the same claim the two-line
# version made, stated once, on an axis a reader can read directly.
#
# The releases are absent for the reason they were absent before: their
# rasterizer runs in a worker and a page-side clock times the compositing blit,
# so a ratio for them would divide a real wait by a number that is not drawing.
ratio <- reshape(inside[c("series", "reads", "coverage", "measure", "s")],
                 idvar = c("series", "reads", "coverage"),
                 timevar = "measure", direction = "wide")
names(ratio) <- sub("^s\\.", "", names(ratio))
ratio$frac <- ratio[[WAIT]] / ratio[[WAIT]]  # placeholder, replaced below
ratio$frac <- ratio[[DRAW]] / ratio[[WAIT]]
ratio <- subset(ratio, is.finite(frac))

ratio_ends <- ratio[order(-ratio$coverage), ]
ratio_ends <- ratio_ends[!duplicated(ratio_ends[c("reads", "series")]), ]
ratio_ends$label <- paste0(round(ratio_ends$frac * 100), "%")

bottom <- ggplot(ratio, aes(x = coverage, y = frac, colour = series)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S, show.legend = FALSE) +
  geom_text_repel(data = ratio_ends, aes(label = label), direction = "y",
                  nudge_x = ENDPOINT_NUDGE, hjust = 0, size = ENDPOINT_LABEL,
                  fontface = "bold", seed = REPEL_SEED, show.legend = FALSE,
                  min.segment.length = 0.3, segment.size = 0.25,
                  segment.alpha = 0.5, box.padding = 0.25) +
  facet_wrap(~reads) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20\u00d7", "200\u00d7", "1000\u00d7"),
                expand = expansion(mult = c(0.08, 0.3))) +
  # Verified against the data rather than assumed: the largest ratio in this
  # run is 0.997, so nothing is clipped. A drawing time above its own wait would
  # be a bug in one of the two clocks, not a cell to plot.
  scale_y_continuous(name = NULL, limits = c(0, 1.02),
                     breaks = c(0, 0.25, 0.5, 0.75, 1),
                     labels = c("0", "25%", "50%", "75%", "all of it")) +
  scale_colour_discrete(drop = FALSE, labels = function(x) unname(ARCH[x]),
                        breaks = PERF_SERIES[PERF_SERIES %in% ratio$series]) +
  labs(x = "coverage", colour = NULL,
       title = "How much of that wait was the tool drawing?",
       subtitle = "Main-thread rasterizers only \u2014 a page-side clock cannot see a worker draw") +
  guides(colour = "none") +
  paper_theme() +
  theme(plot.title = element_text(size = rel(1), face = "bold",
                                  margin = margin(b = 2)),
        plot.subtitle = element_text(size = rel(0.8), margin = margin(b = 6)),
        strip.text = element_blank())

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
# the figure itself carries no explanatory text beyond its two subtitles.
#
#   A 2x zoom in, median of five steps, timed by one instrument belonging to no
#   tool on the figure. No arm made a network request on any step, so every
#   difference here is drawing and not fetching. The upper panel is what a user
#   waits for; each key names the arm's renderer, because the subject is
#   architecture and not brand -- three architectures, three orders of
#   magnitude, in that order down the panel. The lower panel asks how much of
#   that wait the tool spent drawing: igv.js is at 95-100%, its wait IS its
#   redraw, while this work and GenomeSpy are at 4-28%, so what they wait on is
#   not rasterization. The two release arms have no ratio because they
#   rasterize in a worker, where a page-side clock times the compositing blit
#   and not the rendering. GenomeSpy's long-read line stops at 200x: no 1000x
#   step on that arm returned a usable measurement, and it reads no CRAM at all.
#   Vertical bars are the range of the three runs behind each point and on most
#   cells are shorter than the marker.
#
# This figure was wrong until 2026-09-04 and the shape of the error is worth
# keeping. The upper panel read a flat ~507 ms for this work at every coverage,
# and the lower panel existed to expose that as a 500 ms navigation throttle
# wrapped around 0.6 ms of drawing. The throttle was the benchmark's, not the
# browser's: the runner drove `zoomTo`, the per-frame chokepoint a gesture
# writes through, where every discrete placer in the LGV model ends with
# `settleCoarseBlocks`. Fixed, the wait is 7-30 ms and rises with coverage. The
# lower panel became a ratio at that point, because two lines per arm was a way
# of drawing a gap that no longer needed a whole panel to be visible.

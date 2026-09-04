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
# ONE PANEL, one claim: what a user waits after the zoom, one line per arm.
#
# It was two until 2026-09-04. The lower one showed what the wait was made of,
# and it earned that space against a very different number -- the JBrowse wait
# was then a flat ~510 ms across a fifty-fold range of coverage, which is not
# the shape of work, wrapped around sub-millisecond drawing. That gap was the
# 500 ms LGVCoarseDynamicBlocks throttle
# (plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts), reached
# because the benchmark drove the per-frame chokepoint rather than the discrete
# path a UI control takes. scripts/crosstool/panprofile.ts fixed that and the
# wait fell to 7-30 ms; the panel outlived the gap it was drawn to expose, and
# neither of the two forms it was given afterwards was worth half a canvas.
# The comment above WAIT below has that account.
#
# What the lower panel guarded against is still real: publishing a drawing time
# as if it were the wait, or the wait as if it were a render cost, is a mistake
# this repo made once and retracted. results/crosstool-zoom.md now carries that
# guard, in two tables where each column can be labelled with a sentence and a
# dagger can mark the arms whose rasterizer the clock cannot see. A figure has
# no dagger.
#
#   Rscript scripts/paperfigs/perf-crosstool-zoom.R
#
# Endpoint labels are plain durations, no ratios. The claim here is a shape --
# two arms flat and fast, one rising with depth, two in seconds -- and the one
# ratio the figure would carry is this work against igv, which is a louder claim
# than the one it is for.

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
d$lo_s <- d$lo / 1000
d$hi_s <- d$hi / 1000
d$reads <- factor(sub("^[0-9]+x ", "", d$case), levels = c("short read", "long read"))
d$series <- factor(d$series, levels = PERF_SERIES)

# perf.csv carries two metrics per cell -- the wait, and the span of the final
# burst of canvas draw calls inside it. This figure plots the wait only.
#
# The second one had a panel of its own until 2026-09-04 and lost it for being
# unreadable rather than for being wrong. As a pair of lines it existed to show
# a 500 ms throttle sitting on 0.6 ms of drawing; once the throttle was fixed
# the lines were duplicates of this panel. As a ratio it was worse: "how much of
# the wait was the tool drawing" reads as a share of rasterization cost, and it
# is not that. It is the span from a step's first canvas call to its last, so
# for this work at 1000x long read the "4%" was 1.1 ms of draw calls with 28.1 ms
# of JS work ahead of them -- work that is also the tool getting ready to draw.
# A number nobody can state in one sentence does not belong on a figure.
#
# What that measure is actually good for is `results/crosstool-zoom.md`, which
# prints it beside the wait in two tables, and the draw COUNTS underneath it:
# one zoom step costs this work 18-20 batched WebGL calls and igv.js up to
# 882,597 through the 2D API. That is the architecture the legend here names,
# and it is a better second panel than the ratio was if this figure ever wants
# one again.
WAIT <- "the whole wait"
d <- subset(d, metric == "what the user waits")
d$measure <- factor(WAIT, levels = WAIT)

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

# The curves, their endpoint labels and the axes. `breaks` limits the colour
# legend to the arms actually drawn, computed rather than listed so a GenomeSpy
# column appears the run it is measured;
# drop = FALSE keeps every series the colour it has on the cold-load figure.
zoom_panel <- function(df, ends, y_breaks) {
  ggplot(df, aes(x = coverage, y = s, colour = series)) +
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
    scale_colour_discrete(drop = FALSE, labels = function(x) unname(ARCH[x]),
                          breaks = PERF_SERIES[PERF_SERIES %in% df$series]) +
    labs(x = "coverage", colour = NULL) +
    paper_theme()
}

wait <- subset(d, measure == WAIT)
top <- zoom_panel(wait, endpoints(wait), c(0.01, 0.1, 1, 10)) +
  # Two rows for the colour keys: six arms on one row run off both ends of a
  # 240 mm canvas, which clipped "Release 2.4.0" rather than shrinking to fit.
  guides(colour = guide_legend(nrow = 3)) +
  # No subtitle. That no arm fetched a byte on any zoom step is the premise --
  # it is what makes this a redraw comparison rather than a comparison of
  # network stacks -- but it belongs to the caption, which is where the rest of
  # the run's conditions already live. Stating it on the raster put one of the
  # figure's several conditions above the others for no reason but that it was
  # the one being argued about the week it was added.
  # "Redraw" and not "render": every arm already holds the reads, no arm fetched
  # a byte on any step, so what is timed is the second and later drawings of
  # data already in hand. "Render" would let a reader fold in the cold load,
  # which is a different figure. The clock stops at the last canvas draw call
  # rather than at screen paint -- a draw precedes the compositor, so this reads
  # slightly earlier than the eye, which the caption says.
  labs(title = "Time to redraw after a 2\u00d7 zoom in")

fig <- top + theme(text = element_text(size = PAPER_BASE))

ggsave("results/figures/paper/pdf/perf-crosstool-zoom.pdf", fig,
       width = 240, height = 150, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-crosstool-zoom.pdf\n")

ggsave("results/figures/paper/png/perf-crosstool-zoom.png", fig,
       width = 240, height = 150, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-crosstool-zoom.png\n")

# ---- draft caption ----------------------------------------------------------
# Kept here so the figure and the words that make it readable travel together;
# the figure itself carries no explanatory text beyond its subtitle.
#
#   A 2x zoom in, median of five steps, timed by one instrument belonging to no
#   tool on the figure. No arm made a network request on any step -- every arm
#   already holds the reads -- so what is timed is redrawing data in hand, and
#   every difference here is drawing and not fetching. The clock stops at the
#   last canvas draw call rather than at screen paint, so it reads slightly
#   earlier than the eye. Each key names the arm's
#   renderer, because the subject is architecture and not brand: three
#   architectures, three orders of magnitude, in that order down the panel. The
#   two GPU arms sit together at 8-29 ms; igv.js rasterizes each read through
#   the 2D canvas API and pays 47 ms to 1.2 s for it; the block renderer does
#   not redraw at all but re-rasterizes its tiles, at 1.1 to 9.0 s. One zoom
#   step costs this work 18-20 batched WebGL calls and igv.js up to 882,597
#   through the 2D API, which is the same fact stated in the units that cause
#   it. GenomeSpy's long-read line stops at 200x: no 1000x step on that arm
#   returned a usable measurement, and it reads no CRAM at all. Vertical bars
#   are the range of the three runs behind each point and on most cells are
#   shorter than the marker.
#
# This figure was wrong until 2026-09-04 and the shape of the error is worth
# keeping. It read a flat ~507 ms for this work at every coverage, and carried a
# second panel whose job was to expose that as a 500 ms navigation throttle
# wrapped around 0.6 ms of drawing. The throttle was the benchmark's, not the
# browser's: the runner drove `zoomTo`, the per-frame chokepoint a gesture
# writes through, where every discrete placer in the LGV model ends with
# `settleCoarseBlocks`. Fixed, the wait is 7-30 ms and rises with coverage --
# the shape of work, where the old column was flat across a fifty-fold range
# because a constant dominated it. The second panel went with the throttle: what
# it had left to say was a quantity nobody could state in one sentence.

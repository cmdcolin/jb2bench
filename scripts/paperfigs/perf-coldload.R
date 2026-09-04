#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-coldload.pdf and results/figures/paper/pdf/perf-coldload-100kb.pdf, from
# results/paper/perf.csv.
#
# Navigation to render-complete on a cold load: this release, the published
# release 2.4.0, igv.js 3.8.5 and GenomeSpy 0.85.0, over the same files, window,
# machine and browser build. The numbers behind the manuscript's cross-tool
# table, and behind results/crosstool.md.
#
# Half of what used to be perf-summary.pdf; see perf-interaction.R for
# the other half and for why they are two figures now.
#
# ONE SESSION, so there is no session dimension on the figure. The old panel
# drew two runs at once -- the version sweep in alignments.json and the
# cross-tool run in crosstool.json -- separated by linetype and labelled "version
# sweep" and "cross-tool", which is jb2bench's vocabulary and not a reader's. It
# had to: neither run held every series. crosstool.json now measures three
# JBrowse builds interleaved with three other tools in one harness on one day, so
# every point here is comparable with every other point here and the linetype is
# free to carry read length instead. The sweep is still the source of the
# initial-render table, and still the only run that measures release
# 4.1.15; it is not plotted, because plotting it means asking the reader to hold
# two instruments apart.
#
# Release 4.3.0 is measured in this run and left out on purpose. The comparator
# a reader can place is the published one, and the panel already carries five
# series across two read lengths.
#
# BAM and CRAM as of 2026-08-25, since the alignments/interaction readers'
# reason to stay one format doesn't apply here: cross-tool's own JSON keys
# every case by format already, so leaving CRAM unplotted was throwing away
# half of what this run measured, not narrowing what the panel means. The two
# formats sit close together in cost (CRAM decode adds a few percent, not a
# multiple), so they share the fixed y scale the two read lengths already did.
#
# ONE WINDOW PER FIGURE, and two figures, because the run of 2026-08-29 added a
# second window. Window is not a facet here: reads and format already take both
# dimensions of the grid, and a third factor would either make eight panels of a
# figure whose every point is labelled, or push format into a linetype the
# reader has to hold in mind while reading a duration off. Two figures with the
# same axes, the same colours and the same label placement compare by overlay
# instead.
#
#   Rscript scripts/paperfigs/perf-coldload.R
#
# Stock discrete colour scale; type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

# Gosling 1.0.7 is measured and not drawn. Its BAM fetcher declines a tile
# wider than 20 kb, so it has no arm at 100 kb at all, and at 19 kb the run of
# 2026-08-30 left it one settled cell: it reads no CRAM, and it failed to reach
# a stable paint inside the 120 s ceiling at 1000x short read and at every
# long-read depth. A legend entry, a colour and two lines of subtitle for a
# single point is a comparator the figure asserts and does not show, so the
# ceiling result is stated in the prose instead. results/crosstool.md in
# jb2bench keeps the cells.
DRAWN <- c("Release 2.4.0", "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")

# GenomeSpy reads no CRAM. perf-data.R drops those cells rather than recording a
# zero, so the series simply stops where its capability does. Said on the figure,
# because a panel missing a curve otherwise reads as a run that failed.
ABSENT <- "GenomeSpy reads no CRAM, so it has no curve in the right-hand panels."

all <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
all <- subset(all, panel == "Cold load" & session == "cross-tool" &
                   series %in% DRAWN)

# Coverage is the sweep, so it goes on an axis rather than into a row label, and
# the read length is the other factor rather than half of a compound category
# name: "1000x long read" is two variables spelled as one.
all$coverage <- as.numeric(sub("x .*", "", all$case))
all$reads <- factor(sub("^[0-9]+x ", "", all$case),
                    levels = c("short read", "long read"))
all$series <- factor(all$series, levels = PERF_SERIES)
all$format <- factor(all$format, levels = c("BAM", "CRAM"))
all$s <- all$ms / 1000
all$lo_s <- all$lo / 1000
all$hi_s <- all$hi / 1000

# Every point carries its own duration, because a log axis is the right shape for
# this data and the wrong thing to read a number off: its gridlines are a decade
# apart, so a reader who wants to know what 200x actually cost has to interpolate
# logarithmically by eye. The axis keeps the shape and the labels carry the
# values, in the unit a person would say out loud.
#
# ONE REPELLED LAYER carries every text node -- the durations and the bold
# ratios together -- rather than a fixed offset per series. Fixed offsets are
# what this figure used while it drew three curves, and four defeats them: at
# 20x the measurement is mostly application startup, so the series land within a
# fraction of a decade of each other and every direction one label could take is
# a direction another one needs. Repulsion is only correct if it sees ALL the
# text, which is why the ratios share the layer instead of being placed
# separately -- two layers cannot avoid each other, and the ratio is the node
# that must not be ambiguous. Each label keeps its series' colour and grows a
# leader line to its own point, so displacement never costs attribution.
#
# The layer itself is built by common.R's coldload_labels() and drawn by its
# endpoint_repel().
draw <- function(win, out, width_label) {
  d <- subset(all, window == win)

  # A dropped point truncates its series rather than interpolating across the
  # gap: a line drawn through a cell nobody measured is a claim nobody made. The
  # gate is per row, since contention on one arm invalidates the pair and not
  # just the point.
  dropped <- unique(subset(d, !usable)[, c("reads", "format")])
  d <- subset(d, usable)

  # An arm abandoned at the paint ceiling knows only that it took LONGER than
  # the ceiling, so it is drawn hollow, labelled with a ">", and left off the
  # line: joining it to the curve would draw the bound as though it were the
  # measurement.
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
    # The three runs behind each point, as their range. Capless: an errorbar's
    # cap width is in data space and this x axis is log10, so a fixed width
    # draws fifty times wider at 1000x than at 20x and a proportional one
    # collapses the scale. Censored points carry no bar -- they plot the
    # ceiling a run was abandoned at, which is a bound and not a median.
    geom_linerange(data = meas, aes(ymin = lo_s, ymax = hi_s),
                   linewidth = 0.4, na.rm = TRUE, show.legend = FALSE) +
    geom_point(data = meas, size = POINT_S) +
    geom_point(data = subset(d, censored), size = POINT_S, shape = 1) +
    endpoint_repel(labels) +
    note +
    facet_grid(reads ~ format) +
    scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                  expand = expansion(mult = c(0.16, 0.2))) +
    # More labelled breaks than the shared default, for the same reason the
    # points are labelled: three decades carrying one gridline each is not a
    # scale a reader can place a value on.
    time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
                 expand = expansion(mult = c(0.17, 0.28))) +
    # drop = FALSE keeps every series the colour it has in the other figure and
    # in the other window, which is the whole point of a shared PERF_SERIES:
    # these two figures are meant to be compared by overlay. `breaks` then
    # limits the legend to the series THIS window actually draws -- computed
    # from the data rather than from DRAWN, because the contention gate can
    # empty a series out of one window and not the other, and naming it in a
    # legend that has no curve for it prints a key with no glyph beside it.
    scale_colour_discrete(drop = FALSE,
                          breaks = intersect(PERF_SERIES,
                                             unique(as.character(d$series)))) +
    guides(colour = guide_legend(nrow = 1)) +
    # Below the panels, not above them, and in the same place as on every other
    # figure here: three lines of provenance between the reader and the legend
    # read as a title, and the eye has to cross them before reaching the data.
    labs(x = "coverage", colour = NULL) +
    paper_theme()

  ggsave(sprintf("results/figures/paper/pdf/%s.pdf", out), fig,
         width = 200, height = 200, units = "mm", device = cairo_pdf)
  cat(sprintf("wrote results/figures/paper/pdf/%s.pdf\n", out))

  ggsave(sprintf("results/figures/paper/png/%s.png", out), fig,
         width = 200, height = 200, units = "mm", dpi = 300,
         device = ragg::agg_png)
  cat(sprintf("wrote results/figures/paper/png/%s.png\n", out))
}

draw("19kb", "perf-coldload", "19 kb")
draw("100kb", "perf-coldload-100kb", "100 kb")

# ---- draft caption ----------------------------------------------------------
# Kept here so the figure and the words that make it readable travel together;
# the figure itself carries no explanatory text. `draw()` renders one of these
# per window, so the width the caption names is the window that figure was drawn
# for -- 19 kb or 100 kb.
#
#   Cold load of a single alignment track: navigation to render-complete, median
#   of three interleaved rounds in one session, over both container formats.
#   Bold labels give that tool's time at its last coverage and how many times
#   slower that is than this work at the same point. A hollow marker is a run
#   abandoned at the paint ceiling -- a lower bound rather than a measurement,
#   so it carries no range bar. Vertical bars are the range of the three rounds.
#   GenomeSpy reads no CRAM, so it has no curve in the right-hand panels.

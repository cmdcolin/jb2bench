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
# Stock ggplot2 throughout: default theme, default discrete colour scale, no
# bespoke palette or typography.

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

# Which comparators carry a bold ratio against this work. igv.js is the tool a
# reader is most likely to have used; GenomeSpy is the one that decodes BAM
# through the same @gmod/bam this work does, so its ratio is much closer to a
# comparison of render paths alone.
RATIO_ARMS <- c("igv.js 3.8.5", "GenomeSpy 0.85.0")

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
# Seeded, because the repel solver starts from a random jitter: without it a
# rebuild reshuffles every label and the figure is a different picture each
# time it is drawn.
REPEL_SEED <- 7

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

  txt <- function(df, label, face) {
    data.frame(coverage = df$coverage, s = df$s, reads = df$reads,
               format = df$format, series = df$series, label = label,
               face = face, stringsAsFactors = FALSE)
  }

  # ggrepel pushes a label off other LABELS and off the POINTS of its own layer,
  # and knows nothing about the lines joining them -- so left alone it settles
  # bold ratios neatly into the gaps between points and straight through the
  # curves, which is the one place a number must not sit. Sampling each segment
  # into empty-labelled rows puts the curve into the layer as a row of obstacles
  # it does understand. An empty string has no box, so these push labels away
  # without drawing anything themselves.
  on_line <- function(df) {
    seg <- split(df, list(df$series, df$reads, df$format), drop = TRUE)
    do.call(rbind, lapply(seg, function(g) {
      if (nrow(g) < 2) return(NULL)
      g <- g[order(g$coverage), ]
      i <- seq_len(nrow(g))
      at <- seq(1, nrow(g), length.out = 40)
      txt(data.frame(coverage = 10^approx(i, log10(g$coverage), xout = at)$y,
                     s = 10^approx(i, log10(g$s), xout = at)$y,
                     reads = g$reads[1], format = g$format[1],
                     series = g$series[1]),
          "", "plain")
    }))
  }

  # The ratio is a comparator's own node -- its colour, its point -- so it is
  # unambiguous which curve it belongs to.
  #
  # Picked by series name rather than by reshape: reshape orders its wide
  # columns by first appearance in the data, and "This work" appears first here,
  # so naming them in series order silently inverted every ratio.
  cell <- function(x) paste(x$coverage, x$reads, x$format)
  mine <- subset(meas, series == "This work")
  rat <- subset(meas, series %in% RATIO_ARMS)
  rat$this_work <- mine$s[match(cell(rat), cell(mine))]
  rat <- subset(rat, !is.na(this_work))

  labels <- rbind(
    txt(d, ifelse(d$censored, paste0(">", fmt_time(d$s)), fmt_time(d$s)), "plain"),
    txt(rat, fmt_ratio(rat$s / rat$this_work), "bold"),
    on_line(meas)
  )

  note <- if (nrow(dropped)) {
    geom_text(data = dropped, label = "gap: cell measured under external load",
              x = Inf, y = -Inf, hjust = 1.04, vjust = -0.8, size = 2.1,
              inherit.aes = FALSE)
  }

  fig <- ggplot(d, aes(x = coverage, y = s, colour = series)) +
    geom_line(data = meas) +
    geom_point(data = meas, size = 1.6) +
    geom_point(data = subset(d, censored), size = 1.6, shape = 1) +
    geom_text_repel(data = labels, aes(label = label, fontface = face),
                    size = 2.15, seed = REPEL_SEED, show.legend = FALSE,
                    box.padding = 0.22, point.padding = 0.1,
                    min.segment.length = 0.25, segment.size = 0.2,
                    segment.alpha = 0.5, max.overlaps = Inf,
                    max.time = 1.5, max.iter = 20000) +
    note +
    facet_grid(reads ~ format) +
    scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                  expand = expansion(mult = c(0.3, 0.3))) +
    # More labelled breaks than the shared default, for the same reason the
    # points are labelled: three decades carrying one gridline each is not a
    # scale a reader can place a value on.
    time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
                 expand = expansion(mult = c(0.17, 0.15))) +
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
    labs(x = "coverage", colour = NULL,
         subtitle = paste(
           sprintf("%s window, navigation to render-complete, median of three interleaved rounds in one session.", width_label),
           "Bold: comparator divided by this work. Hollow: gave up at the paint ceiling.",
           ABSENT, sep = "\n")) +
    theme(legend.position = "top",
          legend.text = element_text(size = 8.5),
          plot.subtitle = element_text(size = 7.6, lineheight = 1.3))

  ggsave(sprintf("results/figures/paper/pdf/%s.pdf", out), fig,
         width = 180, height = 185, units = "mm", device = cairo_pdf)
  cat(sprintf("wrote results/figures/paper/pdf/%s.pdf\n", out))

  ggsave(sprintf("results/figures/paper/png/%s.png", out), fig,
         width = 180, height = 185, units = "mm", dpi = 300,
         device = ragg::agg_png)
  cat(sprintf("wrote results/figures/paper/png/%s.png\n", out))
}

draw("19kb", "perf-coldload", "19 kb")
draw("100kb", "perf-coldload-100kb", "100 kb")

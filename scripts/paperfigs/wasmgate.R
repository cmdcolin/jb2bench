#!/usr/bin/env Rscript
# results/figures/paper/pdf/wasmgate.pdf, from results/paper/wasmgate.csv.
#
# How much room does compiling a routine to WebAssembly have, before it is
# written?
#
# A worker boundary is free to cross -- postMessage transfers an ArrayBuffer's
# ownership and copies nothing. wasm has no equivalent: it addresses only its own
# linear memory, so a call copies its input in and its result back out whether or
# not the code inside is any faster. That copy is a floor under every port, and a
# routine's JavaScript time divided by it is a CEILING on the speedup any
# implementation of that routine could reach.
#
#   (a) is that ceiling, one bar per routine: from break-even out to what the
#       floor allows. A bar reaching left of 1x is a routine whose JavaScript
#       already costs less than moving its own bytes, so no port of it can win.
#       One routine here is ported, and the triangle on its bar is what the port
#       actually collected out of the room the floor said it had.
#
#   (b) is where that floor comes from, and the check on it: the same measurement
#       over both corpora, falling on one line at memory-bandwidth speed. It is a
#       memcpy pair and a property of the machine, not of the module it was
#       measured through.
#
# This was a pair of sweep panels until 2026-09-02 -- time against payload size,
# and the same divided by the floor -- and the second of those was six nearly
# flat lines. That flatness is the finding rather than a defect in the drawing:
# the ceiling is a property of the ROUTINE and barely moves with how much data it
# is handed. So the sweep collapses into (a)'s whiskers, which carry the same
# fact in a tenth of the space, and the panel that needed a reader to measure
# gaps between curves a decade apart on a log axis is gone.
#
# The whisker's high end is not evidence of a better ceiling. Every sweep starts
# at a single block or a handful of records, where both sides of the ratio are
# one or two microseconds and neither is separable from the other; that is what
# puts the block scan's whisker up against 1x while its bar sits at 0.05x. The
# bar is the full file, which is the payload a real query resolves to.
#
# Minima, not medians. The run of record was taken on a box under load, where
# contention only ever adds time and the fastest repetition is the least
# contaminated one. Every arm of a cell is measured back to back, so what
# contention survives lands on all of them together and the ratios this figure is
# made of hold. See results/wasmgate.md.
#
#   Rscript scripts/paperfigs/wasmgate.R
#
# cowplot stacks the two panels; type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
  library(cowplot)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/wasmgate.csv", stringsAsFactors = FALSE)
# The ceiling: the floor is a lower bound on what a port must pay, so the JS time
# over it is an upper bound on what any port could return. `realised` is what the
# one shipped port actually returns, in the same units -- both are speedups over
# the same JavaScript, which is what lets them share an axis.
d$ceiling <- d$js_ms / d$floor_ms
d$realised <- d$js_ms / d$wasm_ms

# Panels are named for what they hold rather than for the fixture, since read
# length is the thing that changes the answer: a 100 kb ONT read carries a CIGAR
# worth decoding and a 150 bp read does not.
panel_of <- c("shortreads_300x.bam" = "short reads (Illumina, 300×)",
              "chr22_nanopore_subset.bam" = "long reads (ONT, chr22)")
named <- ifelse(is.na(panel_of[d$file]), d$file, panel_of[d$file])
d$panel <- factor(named, levels = unique(named[order(match(d$file, names(panel_of)))]))

# ------------------------------------------------------- one row per routine

#' The full-file ceiling, and the span the rest of the sweep took.
#'
#' The bar is the last point rather than an average over the sweep: a query
#' resolves to a run of blocks, and the whole file is the end of that range and
#' the only point every routine is measured at the same payload on.
rows <- do.call(rbind, lapply(split(d, list(d$panel, d$candidate), drop = TRUE), function(g) {
  g <- g[order(g$marshalled), ]
  last <- g[nrow(g), ]
  data.frame(panel = last$panel, candidate = last$candidate,
             ceiling = last$ceiling, realised = last$realised,
             lo = min(g$ceiling), hi = max(g$ceiling),
             stringsAsFactors = FALSE)
}))

# Ordered by the ceiling averaged over both read types, so a routine keeps its
# row in both facets and the two panels can be read across. Geometric, because
# these are ratios: BAM CIGAR decode is 2.8x on one side and 9.7x on the other,
# and an arithmetic mean of a ratio and its reciprocal-scale twin is not one.
order_by <- tapply(log(rows$ceiling), rows$candidate, mean)
rows$candidate <- factor(rows$candidate, levels = names(sort(order_by)))

rows$verdict <- ifelse(rows$ceiling >= 1, "room for a port", "no room: the copy costs more")
rows$verdict <- factor(rows$verdict, levels = c("room for a port",
                                                "no room: the copy costs more"))
VERDICT_FILL <- c("room for a port" = "#3573b9",
                  "no room: the copy costs more" = "#9aa0a6")

rows$label <- ifelse(rows$ceiling < 1, sprintf("%.2f×", rows$ceiling),
                     fmt_ratio(rows$ceiling))
# Labels sit outside the bar, so which side "outside" is depends on which way the
# bar points from break-even -- and outside the WHISKER too, which overruns the
# bar in whichever direction the sweep went. Anchored on that outer end rather
# than on the bar, or the whisker draws straight through the number.
rows$label_at <- ifelse(rows$ceiling >= 1, pmax(rows$ceiling, rows$hi),
                        pmin(rows$ceiling, rows$lo))
rows$hjust <- ifelse(rows$ceiling >= 1, -0.25, 1.25)

ported <- rows[is.finite(rows$realised), ]
ported$label <- sprintf("%s collected", fmt_ratio(ported$realised))

SPEEDUP_BREAKS <- 10^(-3:2)
SPEEDUP_LABELS <- c("0.001×", "0.01×", "0.1×", "1×", "10×", "100×")
XLIM <- range(c(rows$lo, rows$hi, rows$ceiling))

verdict <- ggplot(rows, aes(y = candidate)) +
  annotate("rect", fill = "grey92", ymin = -Inf, ymax = Inf,
           xmin = XLIM[1] / 3, xmax = 1) +
  geom_segment(aes(x = 1, xend = ceiling, yend = candidate, colour = verdict),
               linewidth = 5.5, lineend = "butt") +
  # The sweep, behind the bar: how far the ceiling moved across payload size.
  geom_linerange(aes(xmin = lo, xmax = hi), linewidth = 0.7, colour = "grey25") +
  geom_point(aes(x = lo), size = 1.4, colour = "grey25") +
  geom_point(aes(x = hi), size = 1.4, colour = "grey25") +
  geom_vline(xintercept = 1, linewidth = LINE_W * 1.4) +
  geom_text(aes(x = label_at, label = label, hjust = hjust),
            size = ENDPOINT_LABEL, fontface = "bold") +
  geom_point(data = ported, aes(x = realised), shape = 17, size = POINT_S * 1.9,
             colour = "black") +
  # Below the bar, not above it: the ported routine has the largest ceiling and
  # so sits in the top row, where "above" is the facet strip.
  geom_text(data = ported, aes(x = realised, label = label),
            size = POINT_LABEL, fontface = "italic", vjust = 2.3, hjust = -0.12) +
  facet_wrap(~panel) +
  scale_x_log10(name = "speedup over the same routine in JavaScript",
                breaks = SPEEDUP_BREAKS, labels = SPEEDUP_LABELS,
                minor_breaks = c(outer(c(2, 5), 10^(-4:2))),
                limits = XLIM, oob = scales::squish,
                # Wider on the left: the two sub-floor routines carry their
                # labels on that side, and the leftmost sits at 0.003x.
                expand = expansion(mult = c(0.3, 0.22))) +
  scale_colour_manual(values = VERDICT_FILL) +
  labs(y = NULL, colour = NULL,
       title = "a  What a wasm port of each routine could gain, at most") +
  paper_theme() +
  theme(plot.title = element_text(face = "bold", size = rel(0.95), hjust = 0),
        panel.grid.major.y = element_blank(),
        legend.position = "top")

# ------------------------------------------------------------------ the floor

# Not faceted. The floor is the machine's, so the two corpora measure the same
# quantity and drawing them on one panel makes that a thing the reader can see
# rather than a claim in a caption.
floor_pts <- data.frame(marshalled = d$marshalled, s = d$floor_ms / 1000,
                        corpus = d$panel)

bandwidth <- median(d$marshalled / 1e9 / (d$floor_ms / 1000))

# A reference line at the measured bandwidth, not a fit: one constant, stated in
# the annotation, that the points either scatter about or do not. A regression
# through them would be a new quantity the figure does not otherwise carry.
reference <- data.frame(marshalled = range(floor_pts$marshalled))
reference$s <- reference$marshalled / (bandwidth * 1e9)

floor_panel <- ggplot(floor_pts, aes(x = marshalled, y = s)) +
  geom_line(data = reference, linewidth = LINE_W * 1.2, colour = "grey55") +
  geom_point(aes(shape = corpus), size = POINT_S * 0.9, colour = "grey20",
             fill = "white", stroke = 0.7) +
  annotate("text", x = min(floor_pts$marshalled) * 1.5, y = max(floor_pts$s) * 0.3,
           hjust = 0, size = POINT_LABEL, fontface = "italic", colour = "grey25",
           label = sprintf(paste("every candidate's own floor measurement, both corpora,",
                                 "against one line at %.0f GB/s:\nthe copy is a memcpy pair,",
                                 "so this is the machine's number and not the wasm module's."),
                           bandwidth)) +
  scale_x_log10(name = "bytes crossing the wasm boundary (input + result)",
                breaks = 10^(4:8),
                labels = c("10 kB", "100 kB", "1 MB", "10 MB", "100 MB"),
                minor_breaks = c(outer(c(2, 5), 10^(3:8))),
                expand = expansion(mult = 0.06)) +
  time_scale_y("time to copy", breaks = c(1e-6, 1e-5, 1e-4, 1e-3, 1e-2),
               expand = expansion(mult = 0.1)) +
  scale_shape_manual(values = c(21, 24)) +
  labs(shape = NULL, title = "b  Where that ceiling comes from: the price of crossing") +
  paper_theme() +
  theme(plot.title = element_text(face = "bold", size = rel(0.95), hjust = 0),
        legend.position = "top")

# --------------------------------------------------------------------- assembly

caption <- cowplot::ggdraw() +
  cowplot::draw_label(
    paste("Bar: the whole file.  Whisker: the same ceiling across the payload sweep; its far end is",
          "the single-block cell, where both sides are a microsecond apart.",
          "\nTriangle: @gmod/bgzf-filehandle's shipped Rust/libdeflate inflate, against the pako",
          "path the same library resolves to in a browser.",
          "\nMinima over 21 repetitions on a loaded box — read the ratios, not the milliseconds."),
    size = 10.5, fontface = "italic", lineheight = 1.2)

fig <- cowplot::plot_grid(verdict, floor_panel, caption, ncol = 1,
                          rel_heights = c(1, 0.62, 0.2))

ggsave("results/figures/paper/pdf/wasmgate.pdf", fig,
       width = 250, height = 205, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/wasmgate.pdf\n")

ggsave("results/figures/paper/png/wasmgate.png", fig,
       width = 250, height = 205, units = "mm", dpi = 200, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/wasmgate.png\n")

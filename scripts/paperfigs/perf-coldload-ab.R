#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-coldload-ab.pdf, a two-part figure: the 19 kb
# window as A, the 1 Mb window as B.
#
# The narrowest and the widest window this benchmark measures, side by side and
# labelled, for the place in a manuscript that wants one figure rather than a
# pointer to two. It is not a replacement for either: perf-coldload.pdf and
# perf-coldload-1mb.pdf stay, because a reader comparing a single window against
# the 100 kb one in between still needs them at full size.
#
# 100 kb is deliberately not here. Three parts of this density is a figure
# nobody can read at column width, and the two ends are what carry the claim --
# the middle window says the same thing about the same tools at a size between
# them. perf-coldload-windows.pdf is the all-three view, at the cost of dropping
# the format facet to make room.
#
# THE PANELS COME FROM perf-coldload.R, not from a copy of its spec. Sourcing it
# redraws its own three figures as a side effect, which is idempotent and about
# fifteen seconds; a second copy of a sixty-line plot definition would be free
# today and wrong within a month.
#
# ONE LEGEND, lifted off panel A and placed above both. The two windows draw the
# same four series -- checked below rather than assumed, because the contention
# gate can empty a series out of one window and not the other, and a shared
# legend naming a series that panel B has no curve for is a key with no glyph.
#
#   Rscript scripts/paperfigs/perf-coldload-ab.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(cowplot)
  library(ragg)
})

# Defines draw(), DRAWN and the prepared `all`; writes its own figures on the way
# through.
source("scripts/paperfigs/perf-coldload.R")

a <- draw("19kb", NULL, "19 kb", save = FALSE)
b <- draw("1mb", NULL, "1 Mb",
          cov_breaks = c(20, 100), cov_labels = c("20×", "100×"),
          time_breaks = c(1, 2, 5, 10, 20, 60, 120), save = FALSE)

series_of <- function(win) {
  d <- subset(all, window == win & usable)
  intersect(PERF_SERIES, unique(as.character(d$series)))
}
if (!identical(series_of("19kb"), series_of("1mb"))) {
  stop("19 kb and 1 Mb draw different series; a shared legend would mislabel one:\n",
       "  19kb: ", paste(series_of("19kb"), collapse = ", "), "\n",
       "  1mb:  ", paste(series_of("1mb"), collapse = ", "))
}

# get_plot_component rather than the older get_legend: under ggplot2 3.5 and up
# the guide box is a named component, and get_legend returns the wrong grob
# often enough that it is worth naming the one wanted.
# return_all defaults FALSE and must stay that way: with it TRUE this returns a
# LIST of matching components, and plot_grid renders a list on a black ground
# with the legend floating in it.
legend <- get_plot_component(a + theme(legend.position = "top"),
                             "guide-box-top")

strip <- function(p) p + theme(legend.position = "none")

# align = "h" and a shared axis: the two panels carry the same y scale in the
# same units, so their plotting regions line up and a reader can carry a height
# across the gap. Their x axes differ -- B sweeps 20x-100x where A sweeps
# 20x-1000x -- which is why this is two labelled parts and not one facet.
parts <- plot_grid(strip(a), strip(b),
                   labels = c("A", "B"), label_size = 22, label_fontface = "bold",
                   nrow = 1, align = "h", axis = "tb")

fig <- plot_grid(legend, parts, ncol = 1, rel_heights = c(0.06, 1))

# bg = "white", and the single-window figures do not need it. paper_theme paints
# a plot.background across a ggplot's whole canvas, so those come out opaque; a
# cowplot composite is a bare canvas with two painted plots on it, and the strip
# around the collected legend keeps the device default of alpha 0. Nothing looks
# wrong until a viewer composites the transparency onto black, at which point
# the figure has a black band across the top.
ggsave("results/figures/paper/pdf/perf-coldload-ab.pdf", fig,
       width = 400, height = 210, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/perf-coldload-ab.pdf\n")

ggsave("results/figures/paper/png/perf-coldload-ab.png", fig,
       width = 400, height = 210, units = "mm", dpi = 300, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/perf-coldload-ab.png\n")

# ---- draft caption ----------------------------------------------------------
#   Cold load of a single alignment track at the two ends of the window sweep:
#   (A) a 19 kb window on a 250 kb contig, 20x-1000x; (B) a 1 Mb window on its
#   own 2 Mb contig, 20x-100x. Navigation to render-complete, median of three
#   interleaved rounds in one session, by container format and read length.
#   Bold labels give each tool's time at its last coverage and how many times
#   slower that is than this work at the same point. A hollow marker is a run
#   abandoned at the 120 s paint ceiling -- a lower bound, not a measurement.
#   The two panels share a colour key but not an x axis: B's corpus carries
#   20x and 100x where A's carries 20x, 200x and 1000x.

#!/usr/bin/env Rscript
# results/figures/paper/pdf/pif-deviation.pdf, from results/paper/pif-deviation.csv
# and results/paper/pif-deviation-summary.csv, written by scripts/pif/deviation.ts.
#
# Whether a coarsened PIF record draws where the alignment it stands for goes.
# A coarsened record replaces the CIGAR with kept indels and straight runs, so a
# reader interpolates across each run; `make-pif --coarse` promises the
# interpolated path is never more than the bound away from the real one. The
# trace is that gap along one record, in pixels at the zoom the coarse tier is
# served.
#
# Pixels, not base pairs, and that is the whole point of the figure. The bound
# is stated in bp and the switch is stated in bp per pixel, and the reason those
# two numbers are allowed to be the same number is that one pixel is the unit
# where a deviation stops being invisible. Drawing it in bp would leave the
# reader to do that division for every point on the curve.
#
# Two encodings, because the bound belongs to this one and not to coarsening in
# general. The alternative -- cut at every large indel and drop the CIGAR --
# leaves the sub-threshold indels in place with nothing bounding what they do to
# the straight line across a piece, and the second curve is what that costs.
# `rb break-paf` produces that shape upstream, and it is what PIF's own coarse
# tier did before 2026-09-02, so it is the alternative a reader is most likely
# to have in mind rather than a strawman.
#
# One record, and which one is not a free choice: it is the record where the
# COARSENED encoding is at its worst across the whole file. Featuring the split
# encoding's worst record would flatter us, and picking one at random would not
# show the bound being approached at all. The summary CSV carries the
# distribution over all records, and the subtitle states it, so the single trace
# is an illustration of a number the reader is also given.
#
#   Rscript scripts/paperfigs/pif-deviation.R
#
# Type sizes come from common.R's paper_theme; the shaded band is the one-pixel
# envelope, drawn behind the curves.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})

source("scripts/paperfigs/common.R")

trace <- read.csv("results/paper/pif-deviation.csv")
summ <- read.csv("results/paper/pif-deviation-summary.csv")
feat <- read.csv("results/paper/pif-deviation-featured.csv")
# the label carries raw coordinates; a caption reads them in Mb
feat$pretty <- sub("([0-9]+)-([0-9]+)", "", feat$label)
feat$pretty <- with(feat, sprintf("%s (%.1f Mb)", sub(":[0-9]+-[0-9]+", "", label),
                                  own_span_bp / 1e6))

# The legend names the encodings the way the manuscript does, and carries each
# one's worst case over the whole file rather than over the drawn record -- the
# curve shows the shape, the key shows the claim.
label_for <- function(key) {
  row <- summ[summ$encoding == key, ]
  sprintf("%s — worst %.2f px over %s records",
          switch(key,
                 coarsened = "Coarsened record (cr:Z:)",
                 split = "Split at large indels, CIGAR dropped"),
          row$max_px, format(row$records, big.mark = ","))
}
trace$series <- factor(vapply(trace$encoding, label_for, character(1)),
                       levels = vapply(c("split", "coarsened"), label_for, character(1)))

bound_px <- summ$bound_bp[1] / summ$bp_per_px[1]
over <- summ$over_bound[summ$encoding == "split"]

fig <- ggplot(trace, aes(mb, px, colour = series)) +
  # the envelope first, so the curves sit on top of it
  annotate("rect", xmin = -Inf, xmax = Inf, ymin = -bound_px, ymax = bound_px,
           fill = "#10b981", alpha = 0.10) +
  geom_hline(yintercept = 0, colour = "grey55", linewidth = 0.3) +
  geom_line(linewidth = 0.35) +
  scale_colour_manual(values = setNames(c("#dc2626", "#2563eb"),
                                        levels(trace$series))) +
  scale_y_continuous(breaks = scales::breaks_width(2)) +
  labs(
    title = "Where a coarsened alignment record draws, against the alignment it stands for",
    subtitle = sprintf(
      paste0("%s, the record whose coarsened encoding deviates most.\n",
             "Drawn at %s bp per pixel, the zoom the coarse tier is served at; ",
             "the shaded band is one pixel."),
      feat$pretty[1],
      format(summ$bp_per_px[1], big.mark = ",")),
    x = "position along the record's first genome (Mb)",
    y = "deviation on the second genome (pixels)",
    colour = NULL) +
  paper_theme() +
  theme(legend.position = "top") +
  guides(colour = guide_legend(nrow = 2, byrow = TRUE,
                               override.aes = list(linewidth = 1.2)))

ggsave("results/figures/paper/pdf/pif-deviation.pdf", fig,
       width = 250, height = 145, units = "mm", device = cairo_pdf, bg = "white")

ggsave("results/figures/paper/png/pif-deviation.png", fig,
       width = 250, height = 145, units = "mm", dpi = 200, device = ragg::agg_png,
       bg = "white")

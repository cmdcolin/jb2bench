#!/usr/bin/env Rscript
# results/figures/paper/pdf/pif-deviation.pdf, from results/paper/pif-deviation.csv
# and results/paper/pif-deviation-summary.csv, written by scripts/pif/deviation.ts.
#
# Whether a coarsened PIF record draws where the alignment it stands for goes.
# JBrowse draws each run of a coarsened record as a straight line, and
# `make-pif --coarse` promises that line is never more than the bound away from
# the real path. The trace is that gap along one record, in pixels at the zoom
# the coarse tier is served, since one pixel is where a deviation becomes
# visible.
#
# The second curve cuts the alignment at every indel of at least the bound and
# draws each piece straight, as make-pif's coarse tier did from 2026-05-28 to
# 2026-09-02. Nothing bounds what the smaller indels do to that line.
#
# The record drawn is the one where the COARSENED encoding is at its worst.
# Featuring the split encoding's worst record would flatter us. The trace keeps
# the largest deviation in each of deviation.ts's 2,000 buckets, so its peaks
# are the record's peaks; the legend carries the worst over all records, which
# is a different number for the split curve.
#
#   Rscript scripts/paperfigs/pif-deviation.R
#
# deviation.ts reads the t rows, whose first genome is the PIF's target.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})

source("scripts/paperfigs/common.R")

GENOMES <- c(target = "hs1", query = "mm39")

trace <- read.csv("results/paper/pif-deviation.csv")
summ <- read.csv("results/paper/pif-deviation-summary.csv")
feat <- read.csv("results/paper/pif-deviation-featured.csv")
parts <- regmatches(feat$label, regexec("^([^:]+):[0-9]+-[0-9]+ vs (.+)$", feat$label))[[1]]
record <- sprintf("%s %s (%.1f Mb) against %s %s", GENOMES[["target"]], parts[2],
                  feat$own_span_bp / 1e6, GENOMES[["query"]], parts[3])

label_for <- function(key) {
  row <- summ[summ$encoding == key, ]
  sprintf("%s (worst of all %s records: %.2f px)",
          switch(key,
                 coarsened = "Coarsened record",
                 split = "Cut at indels of 10 kb or more, no CIGAR"),
          format(row$records, big.mark = ","), row$max_px)
}
trace$series <- factor(vapply(trace$encoding, label_for, character(1)),
                       levels = vapply(c("split", "coarsened"), label_for, character(1)))

bound_px <- summ$bound_bp[1] / summ$bp_per_px[1]

fig <- ggplot(trace, aes(mb, px, colour = series)) +
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
      record,
      format(summ$bp_per_px[1], big.mark = ",")),
    x = sprintf("position along the record on %s (Mb)", GENOMES[["target"]]),
    y = sprintf("deviation on %s (pixels)", GENOMES[["query"]]),
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

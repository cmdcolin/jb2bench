#!/usr/bin/env Rscript
# results/figures/paper/pdf/bubble-intervals.pdf, from
# results/paper/hprc-sv-rgfa-component-intervals.csv, written by the graph-track
# trace of 2026-11-03 (results/graph-track/): one row per bubble of the HPRC
# v2.1 SV rGFA as gfa-to-tabix files it, with the reference interval it is
# filed under. A bubble that links two distant reference nodes is filed under
# the whole stretch between them, so every window inside it reads the bubble.
#
# The one bubble filed under its own nodes' coordinates rather than a reference
# interval (22,501 nodes, over the 10,000-node limit) has no interval and is
# left out; the subtitle says so.
#
#   Rscript scripts/paperfigs/bubble-intervals.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})

source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/hprc-sv-rgfa-component-intervals.csv")
moved <- d[d$filing != "anchored", ]
d <- d[d$filing == "anchored", ]

q <- quantile(d$interval_bp, c(0.5, 0.9, 0.99))
over_1mb <- sum(d$interval_bp > 1e6)

fmt_bp <- function(bp) {
  ifelse(bp >= 1e6, sprintf("%g Mb", bp / 1e6),
  ifelse(bp >= 1e3, sprintf("%g kb", bp / 1e3), sprintf("%g bp", bp)))
}

marks <- data.frame(
  x = as.numeric(q),
  label = sprintf("%s: %s", c("median", "90%", "99%"), fmt_bp(signif(q, 2))))

fig <- ggplot(d, aes(interval_bp)) +
  geom_histogram(bins = 60, fill = "#2563eb", colour = "white", linewidth = 0.2) +
  geom_vline(data = marks, aes(xintercept = x), linetype = "dashed",
             colour = "grey30", linewidth = 0.4) +
  geom_label(data = marks, aes(x = x, y = Inf, label = label), vjust = 1.3,
             hjust = c(1.05, 1.05, -0.05), size = POINT_LABEL, colour = "grey20",
             linewidth = 0, fill = "white", alpha = 0.85) +
  scale_x_log10(breaks = 10^(1:7), labels = fmt_bp(10^(1:7)),
                minor_breaks = as.vector(outer(c(2, 5), 10^(0:7)))) +
  scale_y_continuous(labels = scales::label_comma(), expand = expansion(c(0, 0.05))) +
  labs(
    title = "Reference interval each bubble of the HPRC v2.1 SV rGFA is filed under",
    subtitle = sprintf(
      paste0("%s bubbles; %d are filed under more than 1 Mb, the widest %s on %s.\n",
             "One bubble of %s nodes is filed under its own coordinates and is not drawn."),
      format(nrow(d), big.mark = ","), over_1mb,
      fmt_bp(signif(max(d$interval_bp), 3)),
      sub("GRCh38#0#", "", d$seqs[which.max(d$interval_bp)]),
      format(moved$nodes[1], big.mark = ",")),
    x = "reference interval (bp, log scale)",
    y = "bubbles") +
  paper_theme()

ggsave("results/figures/paper/pdf/bubble-intervals.pdf", fig,
       width = 250, height = 120, units = "mm", device = cairo_pdf, bg = "white")

ggsave("results/figures/paper/png/bubble-intervals.png", fig,
       width = 250, height = 120, units = "mm", dpi = 200, device = ragg::agg_png,
       bg = "white")

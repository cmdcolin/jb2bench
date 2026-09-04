#!/usr/bin/env Rscript
# results/figures/paper/pdf/parser-time.pdf, from results/paper/parser.csv.
#
# The measured runtimes behind the manuscript's parser-speedup table: parsing one 19 kb
# window through the current release of each reader and through the version
# JBrowse 2 shipped in 2023. The table is the ratio of the two curves; this is
# the two curves, which is what says the ratio grows with the input rather than
# holding constant across it.
#
# The two alignment readers only. bgzf and bbi are measured and sit in the CSV,
# and they were panels here until 2026-08-25: bgzf because it is the layer BAM
# reads through, so its panel restated BAM's shape one stage down, and bbi
# because its whole content is that its two curves coincide at 1-3 ms, which a
# reader takes in from the table and does not need a panel for. The paper quotes
# both in prose.
#
# Coverage is a sweep, so it goes on an axis and is drawn as a line. Read length
# is the other factor and gets its own row of panels rather than a linetype:
# with four curves to a panel the linetype was carrying half of what
# distinguished them, and the two read lengths are not being compared with each
# other anyway -- each is a workload, and what is compared inside it is the two
# releases.
#
# One shared log time axis across all four cells rather than a free scale per
# cell, so a cell's height on the page means the same thing everywhere: short
# reads at 20x really are two decades cheaper than long reads at 1000x, and a
# free axis would flatten every cell to the same visual span.
#
# Every point then carries its own duration, as on the cold-load and interaction
# figures: four decades of log axis are the right shape for this data and the
# wrong thing to read a value off, since a reader who wants to know what the
# 2023 reader actually cost at 200x has to interpolate logarithmically by eye.
# The axis keeps the shape, the labels carry the numbers, and the speedup stops
# being a claim the reader has to take on trust from the gap between two lines.
#
#   Rscript scripts/paperfigs/parser.R
#
# Stock discrete colour scale; type sizes come from common.R's paper_theme.
# cowplot stitches the two readers together
# because each carries its own version pair -- see the note above panel_plot().

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
  library(cowplot)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/parser.csv", stringsAsFactors = FALSE)
d$s <- d$ms / 1000

panels <- c("@gmod/bam", "@gmod/cram")
d <- subset(d, package %in% panels)
d$package <- factor(d$package, levels = panels)

# Baseline first, so the stock discrete scale gives the comparator its first
# colour and the current release its second, here and in every other figure.
d$arm <- factor(d$arm, levels = c("2023", "current"))
d$reads <- factor(d$reads, levels = c("short read", "long read"))

# One speedup range per cell, over that cell's three coverages. Per-curve labels
# ride at the geometric mean of the pair they describe, which puts them on the
# points they are labelling; the range is the three ratios
# the parser-speedup table lists for that reader and read length, which is what
# the label is for -- the table has each one, the figure has their span.
span <- do.call(rbind, lapply(split(d, list(d$package, d$reads)), function(g) {
  old <- g$s[g$arm == levels(d$arm)[1]]
  new <- g$s[g$arm == levels(d$arm)[2]]
  r <- range(old / new)
  data.frame(package = g$package[1], reads = g$reads[1],
             lab = sprintf("%s–%s", sub("×", "", fmt_ratio(r[1])), fmt_ratio(r[2])))
}))

# Each reader compares a different version pair, so one shared legend cannot
# name both -- it would need four entries to say two things. cowplot stitches
# one sub-plot per reader instead, each with its own two-entry legend carrying
# that reader's versions; the package name that used to sit in the column strip
# becomes that sub-plot's title. The y axis is still fixed across both, so a
# cell's height means the same thing in either sub-plot.

# The two curves in a cell are a decade apart at worst and a third of one at
# best, so each release's labels ride on its own side of its curve -- baseline
# above, current below -- and the pair never competes for the same strip. Repel
# then only has to settle labels against their neighbours along a curve, with
# common.R's sampled curve obstacles keeping them off the lines themselves.
# In log10 seconds.
LABEL_LIFT <- 0.16

# The shared limits carry that lift as headroom, because a scale limit CLIPS
# rather than pads: set to the bare data range, it drops the label on the
# cheapest and the dearest point in the whole figure -- the two a reader most
# wants the number for.
y_range <- range(d$s) * 10^(c(-1, 1) * (LABEL_LIFT + 0.14))

panel_plot <- function(pkg) {
  dp <- droplevels(subset(d, package == pkg))
  vers <- unique(dp[, c("arm", "version")])
  arm_labels <- sprintf("%s (%s)", levels(dp$arm),
                         vers$version[match(levels(dp$arm), vers$arm)])
  dp$arm <- factor(dp$arm, levels = levels(dp$arm), labels = arm_labels)
  dp$series <- dp$arm

  labels <- rbind(label_rows(dp, "reads", fmt_time(dp$s), "plain"),
                  curve_obstacles(dp, "reads"))
  labels$nudge_y <- ifelse(labels$label == "", 0,
                           ifelse(labels$series == arm_labels[1],
                                  LABEL_LIFT, -LABEL_LIFT))

  ggplot(dp, aes(x = coverage, y = s, colour = arm)) +
    geom_line(linewidth = LINE_W) +
    geom_point(size = POINT_S) +
    ggrepel::geom_text_repel(
      data = labels, aes(label = label, colour = series),
      size = POINT_LABEL, nudge_y = labels$nudge_y, seed = REPEL_SEED,
      show.legend = FALSE, box.padding = 0.3, point.padding = 0.2,
      force = 3, force_pull = 0.5, min.segment.length = 0.3,
      segment.size = 0.25, segment.alpha = 0.5, max.overlaps = Inf,
      max.time = 5, max.iter = 60000) +
    geom_text(data = subset(span, package == pkg), aes(label = paste(lab, "faster")),
              x = -Inf, y = Inf, hjust = -0.15, vjust = 1.5, size = ENDPOINT_LABEL,
              fontface = "bold", inherit.aes = FALSE) +
    facet_grid(reads ~ .) +
    scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                  expand = expansion(mult = 0.2)) +
    time_scale_y("time (log scale)", breaks = c(0.01, 0.1, 1, 10),
                 limits = y_range, expand = expansion(mult = 0.02)) +
    labs(x = "coverage", colour = NULL, title = pkg) +
    paper_theme() +
    theme(plot.title = element_text(hjust = 0.5, face = "bold", size = rel(1.05)))
}

grid <- cowplot::plot_grid(plotlist = lapply(panels, panel_plot), nrow = 1)

fig <- grid

ggsave("results/figures/paper/pdf/parser-time.pdf", fig,
       width = 220, height = 145, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/parser-time.pdf\n")

ggsave("results/figures/paper/png/parser-time.png", fig,
       width = 220, height = 145, units = "mm", dpi = 300, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/parser-time.png\n")

# ---- draft caption ----------------------------------------------------------
# Kept here so the figure and the words that make it readable travel together;
# the figure itself carries no explanatory text.
#
#   Parsing one 19 kb window, the current release against the 2023 version, one
#   panel per package. Each point carries its measured time; bold labels give
#   the speedup over that panel's three coverages.

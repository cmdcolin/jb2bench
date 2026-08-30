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
#   Rscript scripts/paperfigs/parser.R
#
# Stock ggplot2 throughout: default theme, default discrete colour scale, no
# bespoke palette or typography. cowplot stitches the two readers together
# because each carries its own version pair -- see the note above panel_plot().

suppressPackageStartupMessages({
  library(ggplot2)
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
y_range <- range(d$s)

panel_plot <- function(pkg) {
  dp <- droplevels(subset(d, package == pkg))
  vers <- unique(dp[, c("arm", "version")])
  arm_labels <- sprintf("%s (%s)", levels(dp$arm),
                         vers$version[match(levels(dp$arm), vers$arm)])
  dp$arm <- factor(dp$arm, levels = levels(dp$arm), labels = arm_labels)

  ggplot(dp, aes(x = coverage, y = s, colour = arm)) +
    geom_line() +
    geom_point(size = 1.5) +
    geom_text(data = subset(span, package == pkg), aes(label = lab),
              x = -Inf, y = Inf, hjust = -0.25, vjust = 1.5, size = 2.6,
              fontface = "bold", inherit.aes = FALSE) +
    facet_grid(reads ~ .) +
    scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                  expand = expansion(mult = 0.13)) +
    time_scale_y("time (log scale)", breaks = c(0.01, 0.1, 1, 10),
                 limits = y_range, expand = expansion(mult = 0.12)) +
    labs(x = "coverage", colour = NULL, title = pkg) +
    theme(legend.position = "top", legend.text = element_text(size = 8),
          legend.key.size = unit(4, "mm"),
          plot.title = element_text(hjust = 0.5, face = "bold", size = 11))
}

grid <- cowplot::plot_grid(plotlist = lapply(panels, panel_plot), nrow = 1)

caption <- cowplot::ggdraw() +
  cowplot::draw_label(
    paste("parsing one 19 kb window, current release against the 2023 version;",
          "bold: times faster, over that panel's three coverages", sep = "\n"),
    size = 8, fontface = "italic", lineheight = 1.1)

fig <- cowplot::plot_grid(grid, caption, ncol = 1, rel_heights = c(1, 0.13))

ggsave("results/figures/paper/pdf/parser-time.pdf", fig,
       width = 170, height = 112, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/parser-time.pdf\n")

ggsave("results/figures/paper/png/parser-time.png", fig,
       width = 170, height = 112, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/parser-time.png\n")

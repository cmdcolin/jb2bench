#!/usr/bin/env Rscript
# results/figures/paper/pdf/bgzfpool.pdf, from results/paper/bgzfpool.csv.
#
# What the BGZF inflate pool is worth, measured twice over the same files, the
# same windows and the same four workers: once with nothing above the query,
# and once through a real jbrowse pan.
#
# The gap between the two series is the figure's subject. A pool speedup quoted
# from the library alone is an upper bound a user never experiences — jbrowse
# still pays the RPC hop, feature conversion, layout and paint around every
# query — and quoting the two together is what makes the end-to-end number
# checkable rather than merely asserted.
#
# Coverage and sample count are different units, so they are different panels
# rather than one axis whose label would have to mean both. What they have in
# common is the direction: both grow the chunk a query resolves to, and the
# pool has nothing to divide until that chunk is a few hundred KB.
#
#   Rscript scripts/paperfigs/bgzfpool.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/bgzfpool.csv", stringsAsFactors = FALSE)

PANELS <- c("BAM, short read", "BAM, long read",
            "Tabix VCF, full genotypes", "Tabix VCF, genotypes only")
d$panel <- factor(d$panel, levels = PANELS)

# A discrete x rather than a shared log axis. Coverage and sample count both
# run through 1000 meaning different things, so one numeric scale puts two
# panels' breaks on every panel and labels the ones that do not belong there
# NA. Free discrete scales drop the levels a panel has no data for, which is
# the behaviour wanted; the axis loses its spacing, which it was not carrying
# an argument.
levs <- unique(d[order(grepl("VCF", d$panel), d$x), c("xlab")])
d$xf <- factor(d$xlab, levels = levs)
d$series <- factor(d$series, levels = c("query alone", "in jbrowse, end to end"))

# A dropped point truncates its series rather than interpolating across the gap:
# a line drawn through a cell nobody measured is a claim nobody made.
plotted <- subset(d, usable)
dropped <- unique(subset(d, !usable)[, c("panel", "note")])
drop_note <- if (nrow(dropped)) {
  geom_text(data = dropped, aes(label = note), x = Inf, y = -Inf,
            hjust = 1.04, vjust = -0.8, size = POINT_LABEL, inherit.aes = FALSE)
}

# The rightmost point of each series carries its own ratio, which is the number
# a reader would otherwise have to measure off the axis.
ends <- plotted[order(-plotted$x), ]
ends <- ends[!duplicated(ends[c("panel", "series")]), ]
ends$label <- fmt_ratio(ends$speedup)

fig <- ggplot(plotted, aes(x = xf, y = speedup, colour = series, group = series)) +
  # 1.0 is the whole verdict on a point: above it the pool paid, below it the
  # round trip cost more than the parallelism returned. Drawn under the data.
  geom_hline(yintercept = 1, linetype = "dashed", linewidth = 0.4,
             colour = "grey40") +
  geom_linerange(aes(ymin = lo, ymax = hi), linewidth = 0.5, alpha = 0.6) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S) +
  geom_text_repel(data = ends, aes(label = label), direction = "y",
                  nudge_x = 0.25, hjust = 0, size = ENDPOINT_LABEL,
                  fontface = "bold", seed = 7, show.legend = FALSE,
                  min.segment.length = 0.3, segment.size = 0.25,
                  segment.alpha = 0.5, box.padding = 0.25) +
  drop_note +
  facet_wrap(~panel, nrow = 2, scales = "free_x") +
  scale_x_discrete(expand = expansion(add = c(0.35, 1.1))) +
  scale_y_continuous(expand = expansion(mult = c(0.08, 0.12))) +
  labs(x = "coverage (BAM)  ·  samples (VCF)", y = "speedup, pool on ÷ pool off",
       colour = NULL,
       caption = paste(
         "Same files, same 19 kb windows, same four workers, measured twice.",
         "Bars: p25–p75 of the paired per-pan ratios end to end, and the range across windows for the query alone.",
         "Dashed line is no effect. Bold: the ratio at the largest point of each series.",
         sep = "\n")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, face = "italic",
                                    lineheight = 1.25, margin = margin(t = 8)))

ggsave("results/figures/paper/pdf/bgzfpool.pdf", fig,
       width = 220, height = 170, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/bgzfpool.pdf\n")

ggsave("results/figures/paper/png/bgzfpool.png", fig,
       width = 220, height = 170, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/bgzfpool.png\n")

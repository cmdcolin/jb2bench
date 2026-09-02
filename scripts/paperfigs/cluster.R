#!/usr/bin/env Rscript
# results/figures/paper/pdf/cluster-speedup.pdf, from results/paper/cluster.csv.
#
# The sample-by-sample distance build behind row clustering, on real 1000
# Genomes windows, as the pure-JS implementation JBrowse shipped with
# (greenelab/hclust), the wasm that replaced it, and a deliberately naive
# WebGPU kernel that keeps the wasm merge behind it.
#
# results/paper/cluster.csv also carries the pre-rewrite wasm build (hclust
# 5.0.0); the figure draws only the current one. Two wasm curves a fixed
# factor apart made the reader pick which wasm the GPU is being compared
# against, and only one of them is the build anybody runs.
#
# One panel per row count, because the two dimensions of the matrix do not cost
# the same. The distance build is O(n^2 v): doubling the columns doubles the
# work, doubling the rows quadruples it, and the measurements say so — at
# v ~ 2,300 the wasm build goes 2.1 s -> 9.3 s across the row doubling, and at
# v ~ 22,400 it goes 23 s -> 98 s, both a factor of about four. A single axis of
# n x v cannot show that: it moves the haplotype cases right by 2x when their
# work went up by 4x, so the curve slopes it draws are not the algorithm's.
# Holding n fixed within a panel leaves v as the only variable, and within a
# panel the cost is then linear in it, which is what the near-unit slope shows.
#
#   Rscript scripts/paperfigs/cluster.R
#
# Stock discrete colour scale; type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/cluster.csv", stringsAsFactors = FALSE)

# Slowest first, so the stock discrete scale walks its colours in the same
# direction the measurements improve.
SERIES <- c("greenelab/hclust (JS)", "hclust (wasm)", "hybrid WebGPU + wasm")
d$series <- c("greenelab/hclust (JS)" = SERIES[1], "hclust 5.1.0 (wasm)" = SERIES[2],
              "WebGPU kernel" = SERIES[3])[d$series]
d <- d[!is.na(d$series), ]
d$series <- factor(d$series, levels = SERIES)

# The 5,008-row cases are the same 2,504 individuals phased into haplotypes, so
# the panel names the unit as well as the count: the row doubling is a modelling
# choice a reader makes, not a bigger cohort.
unit <- ifelse(grepl("haplotypes", d$case), "haplotypes", "samples")
d$rows <- factor(sprintf("%s %s", format(d$n, big.mark = ","), unit),
                 levels = unique(sprintf("%s %s", format(d$n, big.mark = ","), unit)[order(d$n)]))

# Two ratios per column, both against the GPU, because "how much faster" has
# two honest answers here and neither subsumes the other: "vs wasm" is the
# choice a reader actually faces, since nobody runs the JS baseline any more;
# "vs JS" is where the whole system started. The wasm badge sits at the geometric mean of the pair it compares,
# which on a log axis is the midpoint of the gap it measures; the JS badge
# would sit far above it if placed the same way, so it goes below the GPU
# point instead, in the margin the axis already carries for the point's own
# time label above it.
#
# The "vs wasm"/"vs JS" tag names the comparator only on the widest column of
# each panel: that column sits alone on the right with room to spell it out,
# while the two narrow-window columns sit close enough in v that a second full
# tag collides with the first. A bare number reads fine there once the wide
# column has taught the reader what it means.
w <- reshape(d[, c("case", "v", "rows", "series", "s")], idvar = c("case", "v", "rows"),
             timevar = "series", direction = "wide")
widest <- ave(w$v, w$rows, FUN = function(x) x == max(x))
tag <- function(s) ifelse(widest == 1, paste("", s), "")
ratio_wasm <- data.frame(v = w$v, rows = w$rows,
                         mid = sqrt(w$`s.hybrid WebGPU + wasm` * w$`s.hclust (wasm)`),
                         lab = paste0(fmt_ratio(w$`s.hclust (wasm)` / w$`s.hybrid WebGPU + wasm`), tag("vs wasm")))
ratio_js <- data.frame(v = w$v, rows = w$rows,
                       mid = w$`s.hybrid WebGPU + wasm` / 1.8,
                       lab = paste0(fmt_ratio(w$`s.greenelab/hclust (JS)` / w$`s.hybrid WebGPU + wasm`), tag("vs JS")))

# A line chart, not bars: geom_col draws from zero, which under log10 is minus
# infinity, so ggplot starts the bars at 1 and the 310 ms GPU measurement
# renders as a bar hanging DOWNWARD from 1 s, reading as a negative quantity.
# Both axes are logarithmic, so a slope of one is linear cost in columns and the
# vertical gap between two curves is their ratio at every size.
fig <- ggplot(d, aes(x = v, y = s, colour = series)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S) +
  geom_text_repel(aes(label = fmt_time(s)), nudge_y = 0.13, direction = "y",
                  size = POINT_LABEL, seed = 7, segment.colour = NA,
                  box.padding = 0.1, show.legend = FALSE) +
  geom_text(data = ratio_wasm, aes(x = v, y = mid, label = lab),
            size = ENDPOINT_LABEL, fontface = "bold", inherit.aes = FALSE) +
  geom_text(data = ratio_js, aes(x = v, y = mid, label = lab),
            size = ENDPOINT_LABEL, fontface = "bold", inherit.aes = FALSE) +
  facet_wrap(~rows) +
  time_scale_y("time (log scale)", breaks = c(0.1, 1, 10, 60, 600, 3600),
               expand = expansion(mult = c(0.1, 0.14))) +
  # Round breaks rather than one per measurement: the two 1 Mb MAF 0.05 windows
  # differ in width by 2%, so their own values would print as two overlapping
  # labels saying the same thing.
  scale_x_log10(breaks = c(2500, 5000, 10000, 20000),
                labels = function(x) format(x, big.mark = ",", scientific = FALSE, trim = TRUE),
                expand = expansion(mult = c(0.12, 0.16))) +
  labs(x = "variant columns (log scale)", colour = NULL) +
  paper_theme()

ggsave("results/figures/paper/pdf/cluster-speedup.pdf", fig,
       width = 240, height = 140, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/cluster-speedup.pdf\n")

# PNG at the same geometry, for the documents and slides that will not take a
# PDF. Written beside the PDF and named for its subject; see the note in
# scripts/paperfigs/ldband.R.
ggsave("results/figures/paper/png/cluster-speedup.png", fig,
       width = 240, height = 140, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/cluster-speedup.png\n")

# ---- draft caption ----------------------------------------------------------
#   The distance build behind row clustering, on five 1000 Genomes windows, for
#   the pure-JS implementation JBrowse shipped with (greenelab/hclust 0.0.1),
#   the wasm build that replaced it (hclust 5.1.0), and a deliberately naive
#   WebGPU compute kernel, which replaces only the distance build and leaves
#   the agglomerative merge in the same wasm library, hence "hybrid". The build is O(n^2 v), so the panels split on
#   the row count n and each panel sweeps the variant columns v; the 5,008-row
#   cases are the same 2,504 individuals phased into haplotypes. Both axes are
#   logarithmic and the time ticks are round durations, so within a panel a
#   slope of one is cost linear in the columns, and a fixed vertical distance
#   anywhere is a fixed factor. The bold labels give the WebGPU kernel's
#   margin over two comparators, one per column: the wasm build, which is the
#   choice a reader actually faces; and the original JS implementation, where
#   the whole system started. Both are named in full
#   only on each panel's widest column, which has the room; the narrower
#   columns carry the bare number. Comparing the panels at matched v gives the
#   row cost: about 4x for a 2x row count, at both window widths. The
#   JS-to-wasm step is a steady 7-9x across every window; the widening gap
#   below it is what the compute shader adds.

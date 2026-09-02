#!/usr/bin/env Rscript
# results/figures/paper/pdf/cluster-endtoend.pdf, from results/paper/clusterphases.csv.
#
# "Cluster by genotype" on a 1000 Genomes window, end to end: the time a user
# waits between asking for a clustered matrix and seeing one, for each of the
# three implementations of the distance build.
#
# This was three panels — distance, merge, end to end — and the phase split did
# not earn them. The merge panel's whole content was that the wasm and WebGPU
# runs share one merge, so its two points coincided; the distance panel was a
# near-copy of the total, the distance build being nearly all of it. Two panels
# of setup for one number the reader wants. The phase split is still in
# results/paper/clusterphases.csv and the prose quotes it; the figure is the total.
#
#   Rscript scripts/paperfigs/cluster-endtoend.R
#
# Stock discrete colour scale; type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/clusterphases.csv", stringsAsFactors = FALSE)
total <- aggregate(s ~ matrix + n + v + config, d, sum)

# The compute shader only ever runs the distance build; the merge that follows
# it is the same wasm merge the wasm row runs. Calling the row "WebGPU" alone
# would read as GPU end to end, so the label keeps "+ wasm" to say the merge
# did not move.
total$config <- factor(total$config, levels = c("JS", "wasm", "WebGPU + wasm"),
                       labels = c("JS", "wasm", "WebGPU + wasm"))
total <- total[order(total$config), ]

# A line chart in the conventional orientation: the three implementations are an
# ordered progression, so they read left to right along the bottom and time goes
# up the side. Each step's drop IS its speedup, because distance on a log axis is
# ratio, and the two steps can therefore be compared with each other by eye.
#
# Bars would be the obvious alternative and are impossible here, for arithmetic
# rather than taste: geom_col draws from zero, which under log10 is minus
# infinity, so ggplot starts the bars at 1 and the 449 ms WebGPU run renders as a
# bar hanging DOWNWARD from 1 s, which reads as a negative quantity.
step <- do.call(rbind, lapply(seq_len(nrow(total) - 1), function(i) {
  data.frame(x = i + 0.5, mid = sqrt(total$s[i] * total$s[i + 1]),
             lab = fmt_ratio(total$s[i] / total$s[i + 1]))
}))
headline <- fmt_ratio(total$s[total$config == "JS"] / min(total$s))

fig <- ggplot(total, aes(x = config, y = s)) +
  geom_line(aes(group = 1), colour = "grey60", linewidth = LINE_W) +
  geom_point(aes(colour = config), size = POINT_S + 0.5, show.legend = FALSE) +
  geom_text(aes(label = fmt_time(s)), vjust = -1.3, size = POINT_LABEL) +
  geom_text(data = step, aes(x = x, y = mid, label = lab), hjust = -0.25,
            size = ENDPOINT_LABEL, fontface = "bold", inherit.aes = FALSE) +
  annotate("text", x = Inf, y = Inf, hjust = 1.06, vjust = 1.6, size = ENDPOINT_LABEL,
           fontface = "bold", label = paste(headline, "vs JS, end to end")) +
  time_scale_y("time (log scale)", expand = expansion(mult = c(0.12, 0.2))) +
  scale_x_discrete(expand = expansion(add = 0.65)) +
  labs(x = "distance-build implementation",
       subtitle = sprintf("clustering a %s matrix,\nsamples × ALT-allele columns",
                          total$matrix[1])) +
  paper_theme() +
  theme(plot.subtitle = element_text(size = rel(0.8)))

# Not 180 mm like its siblings. Three points do not need the full column width,
# and stretched to it the panel becomes a letterbox strip with the data spread
# thin across it. Include this one at its natural width rather than at
# \linewidth, or the type comes out larger than in every other figure.
ggsave("results/figures/paper/pdf/cluster-endtoend.pdf", fig,
       width = 115, height = 100, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/cluster-endtoend.pdf\n")
ggsave("results/figures/paper/png/cluster-endtoend.png", fig,
       width = 115, height = 100, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/cluster-endtoend.png\n")

# ---- draft caption ----------------------------------------------------------
#   "Cluster by genotype" on a 1000 Genomes window, end to end. All three
#   configurations cluster the identical matrix, 2,504 samples by 3,105 columns
#   (chr22:20-21 Mb, one column per ALT allele), and each time is the whole
#   operation: the sample-by-sample Euclidean distance build followed by the
#   agglomerative merge. Rows are named for the distance build, which is the only
#   phase that differs — JS is greenelab/hclust 0.0.1, the reference JavaScript
#   implementation; wasm is @gmod/hclust; WebGPU replaces the distance build with
#   a compute shader and keeps the wasm merge. All are timed on the first call in
#   a fresh process, the one a user waits on. The time axis is logarithmic and
#   its ticks are round durations, so a fixed vertical distance anywhere on it is
#   a fixed factor; the labels between points give each step's speedup.
#
#   The step from JS to wasm is larger than the distance build alone accounts
#   for, because it also replaces a merge loop that rescans every cluster pair
#   and recomputes averageDistance over the index sets: the merge is 77% of the
#   JavaScript run and 1% of the wasm one. Once that is gone the distance build
#   is effectively the whole cost, which is what the compute shader then
#   addresses.
#
#   These shares are specific to this matrix width. The merge works on the N x N
#   distance matrix and so does not scale with the number of columns, while the
#   distance build does; at a wider window the same merge is a far smaller share
#   of a much longer JavaScript run.

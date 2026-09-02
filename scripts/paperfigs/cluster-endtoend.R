#!/usr/bin/env Rscript
# results/figures/paper/pdf/cluster-endtoend.pdf, from results/paper/clusterphases.csv.
#
# "Cluster by genotype" on a 1000 Genomes window, end to end: the time a user
# waits between asking for a clustered matrix and seeing one, across four
# implementations.
#
# The optimized-JS point is the one that makes the figure an argument rather
# than a list. Without it the reader sees JS -> wasm and reads the whole drop
# as what WebAssembly bought, which it is not: the reference JS also rescans
# every cluster pair and recomputes averageDistance over the index sets, so
# most of that step is an algorithm nobody would write today. The middle point
# is that same algorithm the wasm uses, in plain JavaScript (see
# scripts/cluster/optimized-hclust.mjs, checked against the wasm for an
# identical tree), which splits the step in two and lets each half be read off
# the axis: the algorithm, then the runtime.
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
#
# Two lines per tick, because these names on one line are wide enough that the
# four of them collide at this panel width, and abbreviating them is worse:
# "reference" and "optimized" are the entire distinction the figure is drawing.
CONFIGS <- c("JS reference", "JS optimized", "wasm", "WebGPU + wasm")
total$config <- factor(total$config, levels = CONFIGS,
                       labels = sub(" ", "\n", CONFIGS))
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
# Each step carries what it bought as well as how much, because the three are
# different in kind and a column of bare ratios invites reading them as three
# helpings of the same thing. The names are the argument: the first step is an
# algorithm, and it is available to anyone who never leaves JavaScript.
STEPS <- c("algorithm", "runtime", "hardware")
step <- do.call(rbind, lapply(seq_len(nrow(total) - 1), function(i) {
  data.frame(x = i + 0.5, mid = sqrt(total$s[i] * total$s[i + 1]),
             lab = paste0(fmt_ratio(total$s[i] / total$s[i + 1]), "\n", STEPS[i]))
}))
headline <- fmt_ratio(max(total$s) / min(total$s))

fig <- ggplot(total, aes(x = config, y = s)) +
  geom_line(aes(group = 1), colour = "grey60", linewidth = LINE_W) +
  geom_point(aes(colour = config), size = POINT_S + 0.5, show.legend = FALSE) +
  geom_text(aes(label = fmt_time(s)), vjust = -1.3, size = POINT_LABEL) +
  # Below the segment, not beside it. The step label sits at the geometric
  # midpoint, which is ON the line, so it has to be pushed off; pushing it
  # right walks it into the next point's own time label, which is what
  # "4.5x runtime" and "3.3 s" did to each other. The line descends, so the
  # wedge under each segment is the one piece of the panel nothing else uses.
  geom_text(data = step, aes(x = x, y = mid, label = lab), vjust = 1.25,
            lineheight = 0.9, size = ENDPOINT_LABEL, fontface = "bold",
            inherit.aes = FALSE) +
  annotate("text", x = Inf, y = Inf, hjust = 1.06, vjust = 1.6, size = ENDPOINT_LABEL,
           fontface = "bold", label = paste(headline, "vs the JS reference")) +
  time_scale_y("time (log scale)", expand = expansion(mult = c(0.12, 0.2))) +
  scale_x_discrete(expand = expansion(add = 0.65)) +
  labs(x = "implementation",
       subtitle = sprintf("clustering a %s matrix,\nsamples × ALT-allele columns",
                          total$matrix[1])) +
  paper_theme() +
  theme(plot.subtitle = element_text(size = rel(0.8)))

# Not 180 mm like its siblings. Four points do not need the full column width,
# and stretched to it the panel becomes a letterbox strip with the data spread
# thin across it. Include this one at its natural width rather than at
# \linewidth, or the type comes out larger than in every other figure. The
# fourth point and its two-line step labels bought 35 mm over the three-point
# version; the height goes up with it to keep the panel from flattening.
ggsave("results/figures/paper/pdf/cluster-endtoend.pdf", fig,
       width = 150, height = 110, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/cluster-endtoend.pdf\n")
ggsave("results/figures/paper/png/cluster-endtoend.png", fig,
       width = 150, height = 110, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/cluster-endtoend.png\n")

# ---- draft caption ----------------------------------------------------------
#   "Cluster by genotype" on a 1000 Genomes window, end to end. All four
#   configurations cluster the identical matrix, 2,504 samples by 3,105 columns
#   (chr22:20-21 Mb, one column per ALT allele), and each time is the whole
#   operation: the sample-by-sample Euclidean distance build followed by the
#   agglomerative merge. JS reference is greenelab/hclust 0.0.1, the JavaScript
#   implementation JBrowse shipped with. JS optimized is the algorithm the wasm
#   uses — a full float32 distance matrix, Lance-Williams UPGMA, a cached
#   nearest neighbour per cluster — written in plain JavaScript, and verified
#   against the wasm to produce an identical tree, so the two differ only in
#   what runs them. wasm is @gmod/hclust. WebGPU replaces the distance build
#   with a compute shader and keeps the wasm merge, hence "+ wasm". Each is
#   timed on the first call in a fresh process, one process per configuration:
#   that is the call a user waits on, and running them together would let one
#   configuration's garbage inflate the next. The time axis is logarithmic and
#   its ticks are round durations, so a fixed vertical distance anywhere on it
#   is a fixed factor.
#
#   The three steps are different in kind, which is why the figure separates
#   them rather than reporting the 313x product. The first is an algorithm: the
#   reference implementation rescans every cluster pair each iteration and
#   recomputes averageDistance over the index sets, so its merge alone is 104 s
#   of the 138 s, against 0.2 s for the same merge done by recurrence. That
#   9.3x needs no WebAssembly and is available to anyone who stays in
#   JavaScript. Only the remaining 4.5x is what the runtime buys, and it is
#   almost entirely the distance build (14.6 s to 3.3 s), where wasm's SIMD has
#   no JavaScript equivalent. The last 7.5x is the GPU, on the same phase again.
#   Reading the JS-to-wasm drop as a single 42x understates the algorithm and
#   overstates the runtime.
#
#   These shares are specific to this matrix width. The merge works on the N x N
#   distance matrix and so does not scale with the number of columns, while the
#   distance build does; at a wider window the same merge is a far smaller share
#   of a much longer JavaScript run, and the algorithm step shrinks with it.

#!/usr/bin/env Rscript
# results/figures/paper/pdf/ldband.pdf, from results/paper/ldband.csv.
#
# One panel per LD method: measured time per window, GPU against plain CPU.
#
# This had a second panel plotting the output matrix size against the device's
# binding limit. It is gone because it contained no MEASUREMENT — matrix size is
# `cells * 4` and cells is arithmetic on the window, so the panel drew a formula
# next to a limit. The one fact it carried that the reader needs, how big each
# matrix is and hence why the largest cannot be dispatched, is one number per row
# and now rides in the axis label.
#
# The two panels are the LD twin of the clustering figure's 2,504-samples
# against 5,008-haplotypes pair: one cohort, phased or not, and what that
# modelling choice costs. It lands somewhere completely different here.
# Clustering builds a samples-by-samples matrix, so phasing doubles n and
# QUADRUPLES the work — which is why that figure needs a panel per row count to
# keep the slopes honest. LD builds a variants-by-variants matrix: phasing
# doubles the depth of each cell's reduction and leaves the output matrix
# byte-for-byte the same size. Bit-packed, most of even that depth disappears:
# the phased kernel reads four planes per variant against the composite one's
# three and spends eight popcounts per 32-sample word against nine, so the two
# differ by plane COUNT rather than by sample count. The panels therefore land
# close but not on top of each other — within about 10% on the CPU, 1.3x to
# 1.8x apart on the GPU, against the 4x the same phasing step costs the
# distance build. The axis limits are shared so that the near-miss is legible;
# free scales would draw two identical-looking panels and hide it.
#
# The figure carries DATA only, and only MEASURED data. The benchmark will
# extrapolate a CPU row from a per-cell rate rather than run it when the
# prediction exceeds its --cpu-budget; this plots no such row. Everything
# explanatory — what the window is, why the top row is absent — belongs in the
# manuscript caption, and the draft of it is at the foot of this file so the two
# stay together.
#
#   Rscript scripts/paperfigs/ldband.R
#
# Stock ggplot2 throughout: default theme, default discrete colour scale, no
# bespoke palette or typography.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/ldband.csv", stringsAsFactors = FALSE)
d <- d[order(d$units, d$band), ]
d$gpu_s <- d$gpu_ms / 1000
d$cpu_s <- d$cpu_ms / 1000

# The panel names the estimator AND what it reduces over, because the count is
# the whole point of the comparison and "phased" alone does not carry it. Fewest
# units first, matching the clustering figure's samples-before-haplotypes order.
d$panel <- factor(sprintf("%s — %s %s", d$method,
                          format(d$units, big.mark = ","), d$unit_name),
                  levels = unique(sprintf("%s — %s %s", d$method,
                                          format(d$units, big.mark = ","),
                                          d$unit_name)[order(d$units)]))

# A line chart, not bars and not a row of connected dots: the window is a knob
# with an ordering and a magnitude, so it belongs on an axis rather than as a
# category, and once it is on one the measurements are two curves. The vertical
# gap between them is then the speedup at every window, at one scale across the
# panel, because distance on a log axis is ratio.
#
# Bars are impossible here anyway, and for arithmetic rather than taste:
# geom_col draws from zero, which under log10 is minus infinity, so ggplot
# starts the bars at 1 and the 456 ms GPU measurement renders as a bar hanging
# DOWNWARD from 1 s, reading as a negative quantity.
long <- rbind(
  data.frame(band = d$band, panel = d$panel, series = "GPU", s = d$gpu_s),
  # Only the CPU rows that were actually run. An extrapolation from a per-cell
  # rate is a lower bound rather than a time — the calibration matrix fits in
  # cache and the real ones do not — and drawn on the same curve as a
  # measurement it does not merely need a footnote, it reads WRONG: an estimate
  # can land below the measured time for a NARROWER window, and the baseline
  # then slopes downward while the work doubles. A curve that reads false is
  # worse than a curve that stops, so it stops. Every window in the current run
  # is measured and nothing is dropped here; the guard is what keeps that true
  # if the benchmark is ever re-run under a budget too tight to run them all.
  data.frame(band = d$band, panel = d$panel, series = "CPU",
             s = ifelse(d$cpu_measured, d$cpu_s, NA_real_))
)
# A refused dispatch has no time either; dropping the row leaves the point
# absent rather than drawn at zero, which would read as "instant".
long <- subset(long, !is.na(s))

# The full triangle is excluded from the plot, not hidden: it has no GPU point
# to compare against, the dispatch being refused. The caption carries it.
long <- subset(long, band %in% d$band[!d$declined])
# Panels share one x axis, so an empty level would still draw a strip.
long$panel <- droplevels(long$panel)
# Baseline first, so the stock discrete scale gives it the first colour and the
# GPU the second, as in every other figure here.
long$series <- factor(long$series, levels = c("CPU", "GPU"))

# The ratio rides between the two curves, at the geometric mean of the pair it
# describes, which on a log axis is the midpoint of the gap it measures.
# A ratio needs both of its terms measured, so it appears only where the CPU
# curve does.
ratio <- subset(data.frame(band = d$band, panel = d$panel,
                           mid = sqrt(d$gpu_s * d$cpu_s),
                           lab = fmt_ratio(d$cpu_s / d$gpu_s),
                           keep = !d$declined & d$cpu_measured),
                keep)

# One tick per window rather than one per (window, method): both panels sweep
# the same windows, and the matrix a window produces is a property of the window
# alone — the estimator changes what each cell costs, not how many there are.
axis <- unique(subset(d, !declined, select = c("band", "window", "output_mib")))
axis <- axis[order(axis$band), ]

fig <- ggplot(long, aes(x = band, y = s, colour = series)) +
  geom_line() +
  geom_point(size = 2.2) +
  geom_text(aes(label = fmt_time(s)), vjust = -1.1, size = 2.2,
            show.legend = FALSE) +
  geom_text(data = ratio, aes(x = band, y = mid, label = lab), hjust = -0.2,
            size = 2.3, fontface = "bold", inherit.aes = FALSE) +
  # Shared scales, deliberately: the panels are here to be compared with each
  # other, and free scales would hide that they land in the same place.
  facet_wrap(~panel, nrow = 1) +
  time_scale_y("time (log scale)", expand = expansion(mult = c(0.1, 0.12))) +
  scale_x_log10(breaks = axis$band,
                labels = sprintf("%s\n%s MiB", axis$window,
                                 format(round(axis$output_mib), big.mark = ",")),
                expand = expansion(mult = 0.12)) +
  # Same omission the clustering figure had: without this the reader cannot tell
  # whether "24 s" describes a thousand variants or a million.
  labs(x = "pair-separation window (variants), and the matrix it produces",
       colour = NULL,
       subtitle = sprintf("r² for %s variants across %s samples, %s",
                          format(d$num_snps[1], big.mark = ","),
                          format(d$num_samples[1], big.mark = ","),
                          toupper(d$adapter[1]))) +
  theme(legend.position = "top")

ggsave("results/figures/paper/pdf/ldband.pdf", fig,
       width = 180, height = 88, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/ldband.pdf\n")

# PNG at the same geometry, for the documents and slides that will not take a
# PDF. Written beside the PDF and named for its subject, so either format is
# reachable by name rather than by whatever order a manuscript happens to
# reference it in.
ggsave("results/figures/paper/png/ldband.png", fig,
       width = 180, height = 88, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/ldband.png\n")

# ---- draft caption ----------------------------------------------------------
# Kept here so the figure and the words that make it readable travel together;
# the figure itself carries no explanatory text.
#
#   Restricting the pair-separation window makes the linkage-disequilibrium
#   matrix tractable at cohort scale, and phasing the cohort costs almost
#   nothing. r2 was computed for 50,000 variants across 2,504 samples on an AMD
#   RDNA-1 GPU, at four pair-separation windows; each tick gives the window and
#   the size of the r2 matrix it produces. Time to compute the matrix is shown
#   for the GPU and for a single CPU core, with labels giving the CPU:GPU ratio.
#   The two panels are one cohort under the two estimators the display
#   implements: composite LD over the 2,504 genotype dosages, and haplotypic LD
#   over the 5,008 haplotypes the same samples phase into. These are different
#   statistics rather than two routes to one number — they coincide only under
#   Hardy-Weinberg — but they are computed from the same calls, the dosages
#   being the haplotype pairs collapsed. Panels share both axes, because how
#   close they land is the result: unlike the sample-by-sample distance build,
#   where the haplotype split doubles n and so quadruples the work, phasing an
#   LD matrix leaves the number of cells untouched and only doubles the depth of
#   each cell's reduction, which bit-packed popcounts largely absorb. What
#   remains is a difference in packing rather than in cohort size — the phased
#   kernel reads four bit planes per variant where the composite one reads three
#   — and it costs within about 10% on the CPU and between 1.3x and 1.8x on the
#   GPU, where the kernels are bandwidth-bound. Every point plotted is a
#   measurement; the single-core baseline was run at all four windows rather
#   than extrapolated. The full triangle, all n(n-1)/2 pairs, is off the right
#   of both panels: at 4,768 MiB it exceeds both the 2 GiB storage-buffer
#   binding limit of the test device and the 128 MiB limit the WebGPU
#   specification requires every conformant device to provide, so no dispatch is
#   issued and the CPU is the only path. That ceiling is on the output matrix,
#   which is why it falls in the same place under both estimators. The 95 MiB
#   and 38 MiB matrices fall below the specification floor and are therefore
#   computable on any conformant GPU. The vertical axis is logarithmic; its
#   ticks are round durations, so a fixed vertical distance anywhere on it is a
#   fixed factor, and the gap between the two curves is the speedup.

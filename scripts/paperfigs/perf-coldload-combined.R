#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-coldload-combined.pdf, from
# results/paper/perf.csv.
#
# Combines the two perf-coldload.R panels (19 kb and 100 kb windows) into one
# 8-panel facet: reads (2 rows) x window x format (4 columns), grouped so the
# left half of the grid is the 19 kb window and the right half is the 100 kb
# window, each split into its own BAM/CRAM pair. perf-coldload.R argues at
# length for keeping window out of the grid -- see its header -- this script
# is the requested override of that call, not a replacement for it;
# perf-coldload.R still owns the two individual figures.
#
#   Rscript scripts/paperfigs/perf-coldload-combined.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

DRAWN <- c("Release 2.4.0", "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")
REPEL_SEED <- 7
# In log10 coverage units: how far right of its point an endpoint label starts.
ENDPOINT_NUDGE <- 0.16
# In log10 seconds: how far below its point a reference-curve label starts.
REFERENCE_DROP <- -0.12

all <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
all <- subset(all, panel == "Cold load" & session == "cross-tool" &
                   series %in% DRAWN)

all$coverage <- as.numeric(sub("x .*", "", all$case))
all$reads <- factor(sub("^[0-9]+x ", "", all$case),
                    levels = c("short read", "long read"))
all$series <- factor(all$series, levels = PERF_SERIES)
all$format <- factor(all$format, levels = c("BAM", "CRAM"))
all$window <- factor(all$window, levels = c("19kb", "100kb"),
                     labels = c("viewing 19 kbp region", "viewing 100 kbp region"))
all$s <- all$ms / 1000

d <- all

dropped <- unique(subset(d, !usable)[, c("reads", "format", "window")])
d <- subset(d, usable)

meas <- subset(d, !censored)

txt <- function(df, label, face) {
  data.frame(coverage = df$coverage, s = df$s, reads = df$reads,
             format = df$format, window = df$window, series = df$series,
             label = label, face = face, stringsAsFactors = FALSE)
}

on_line <- function(df) {
  seg <- split(df, list(df$series, df$reads, df$format, df$window), drop = TRUE)
  do.call(rbind, lapply(seg, function(g) {
    if (nrow(g) < 2) return(NULL)
    g <- g[order(g$coverage), ]
    i <- seq_len(nrow(g))
    at <- seq(1, nrow(g), length.out = 40)
    txt(data.frame(coverage = 10^approx(i, log10(g$coverage), xout = at)$y,
                   s = 10^approx(i, log10(g$s), xout = at)$y,
                   reads = g$reads[1], format = g$format[1],
                   window = g$window[1], series = g$series[1]),
        "", "plain")
  }))
}

# Every comparator's last point carries its ratio to this work at that cell,
# bold and pushed to the right of the curve so it reads as the series' verdict
# rather than as one more number on the point.
CELL <- c("reads", "format", "window")
ends <- endpoint_labels(meas, cell = CELL,
                        x = "coverage", y = "s", series = "series",
                        reference = "This work", ratio = fmt_slower_terse)
ends <- subset(ends, series != "This work")
inner <- meas[!is_endpoint(meas, ends, CELL, "coverage", "series"), ]

labels <- rbind(
  txt(inner, fmt_time(inner$s), "plain"),
  txt(ends, ends$label, "bold"),
  on_line(meas)
)
labels$nudge <- ifelse(labels$face == "bold", ENDPOINT_NUDGE,
                       ifelse(labels$label == "", 0, -0.07))
# This work is the bottom curve in every cell, so its own times start below it,
# in the empty band under the curve, rather than in the same strip as the
# comparators' bold verdicts at the same x.
labels$nudge_y <- ifelse(labels$series == "This work" & labels$label != "",
                         REFERENCE_DROP, 0)

note <- if (nrow(dropped)) {
  geom_text(data = dropped, label = "gap: cell measured under external load",
            x = Inf, y = -Inf, hjust = 1.04, vjust = -0.8, size = POINT_LABEL,
            inherit.aes = FALSE)
}

fig <- ggplot(meas, aes(x = coverage, y = s, colour = series)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S) +
  geom_text_repel(data = labels, aes(label = label, fontface = face,
                                     size = face),
                  nudge_x = labels$nudge, nudge_y = labels$nudge_y,
                  lineheight = 0.9,
                  seed = REPEL_SEED, show.legend = FALSE,
                  box.padding = 0.35, point.padding = 0.15,
                  force = 3, force_pull = 0.4,
                  min.segment.length = 0.25, segment.size = 0.25,
                  segment.alpha = 0.5, max.overlaps = Inf,
                  max.time = 5, max.iter = 60000) +
  scale_size_manual(values = c(plain = POINT_LABEL, bold = ENDPOINT_LABEL),
                    guide = "none") +
  note +
  facet_grid(reads ~ window + format) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.22, 0.22))) +
  time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
               expand = expansion(mult = c(0.22, 0.28))) +
  scale_colour_discrete(drop = FALSE,
                        breaks = intersect(PERF_SERIES,
                                           unique(as.character(d$series))),
                        labels = function(x) {
                          x <- ifelse(x == "GenomeSpy 0.85.0", "GenomeSpy 0.85.0*", x)
                          x <- ifelse(x == "Release 2.4.0", "JBrowse 2.4.0", x)
                          ifelse(x == "This work", "JBrowse 5.0.0", x)
                        }) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(x = "coverage", colour = NULL,
       caption = paste("* no CRAM support. Bold: that tool's time at its last coverage,",
                       "and how many times slower that is than JBrowse 5.0.0 at the same point.")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, colour = "grey30"))

ggsave("results/figures/paper/pdf/perf-coldload-combined.pdf", fig,
       width = 360, height = 190, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-coldload-combined.pdf\n")

ggsave("results/figures/paper/png/perf-coldload-combined.png", fig,
       width = 360, height = 190, units = "mm", dpi = 300,
       device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-coldload-combined.png\n")

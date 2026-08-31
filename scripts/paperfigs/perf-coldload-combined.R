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
RATIO_ARMS <- c("igv.js 3.8.5", "GenomeSpy 0.85.0")
REPEL_SEED <- 7

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

cell <- function(x) paste(x$coverage, x$reads, x$format, x$window)
mine <- subset(meas, series == "This work")
rat <- subset(meas, series %in% RATIO_ARMS)
rat$this_work <- mine$s[match(cell(rat), cell(mine))]
rat <- subset(rat, !is.na(this_work))

labels <- rbind(
  txt(meas, fmt_time(meas$s), "plain"),
  txt(rat, fmt_ratio(rat$s / rat$this_work), "bold"),
  on_line(meas)
)

note <- if (nrow(dropped)) {
  geom_text(data = dropped, label = "gap: cell measured under external load",
            x = Inf, y = -Inf, hjust = 1.04, vjust = -0.8, size = 2.1,
            inherit.aes = FALSE)
}

fig <- ggplot(meas, aes(x = coverage, y = s, colour = series)) +
  geom_line() +
  geom_point(size = 1.6) +
  geom_text_repel(data = labels, aes(label = label, fontface = face),
                  size = 2.15, seed = REPEL_SEED, show.legend = FALSE,
                  box.padding = 0.22, point.padding = 0.1,
                  min.segment.length = 0.25, segment.size = 0.2,
                  segment.alpha = 0.5, max.overlaps = Inf,
                  max.time = 1.5, max.iter = 20000) +
  note +
  facet_grid(reads ~ window + format) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.3, 0.3))) +
  time_scale_y("time (log scale)", breaks = c(1, 2, 5, 10, 20, 60, 120, 600),
               expand = expansion(mult = c(0.17, 0.15))) +
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
       caption = "* no CRAM support") +
  theme(legend.position = "top",
        legend.text = element_text(size = 8.5),
        plot.caption = element_text(size = 7.5, hjust = 0, colour = "grey30"))

ggsave("results/figures/paper/pdf/perf-coldload-combined.pdf", fig,
       width = 320, height = 150, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-coldload-combined.pdf\n")

ggsave("results/figures/paper/png/perf-coldload-combined.png", fig,
       width = 320, height = 150, units = "mm", dpi = 300,
       device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-coldload-combined.png\n")

#!/usr/bin/env Rscript
# results/figures/paper/{pdf,png}/perf-spread and
# results/figures/paper/tex/perf-spread-table.tex, from results/paper/perf.csv
# and perf-runs.csv.
#
# Each run of each plotted cell, as its distance from the cell's median. On the
# cold-load figures' log axes the runs sit inside the median's marker, so this
# figure gives them a linear axis of their own. The table gives every cold-load
# cell its median and range in seconds.
#
#   Rscript scripts/paperfigs/perf-spread.R

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})
source("scripts/paperfigs/common.R")

DRAWN <- c("Release 2.4.0", "This work", "igv.js 3.8.5", GENOMESPY)
WINDOWS <- c("19kb" = "19 kb", "100kb" = "100 kb", "1mb" = "1 Mb")

cells <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
runs <- read.csv("results/paper/perf-runs.csv", stringsAsFactors = FALSE)

cold <- function(d) subset(d, panel == "Cold load" & session == "cross-tool" &
                              series %in% DRAWN & window %in% names(WINDOWS))
zoom <- function(d) subset(d, panel == "Zoom in, both hold the data" &
                              session == "cross-tool motion" &
                              metric == "what the user waits" & series %in% DRAWN)

cell_key <- function(d) paste(d$panel, d$case, d$series, d$format, d$window)

facet_of <- function(d) {
  ifelse(d$panel == "Cold load",
         paste("Cold load,", WINDOWS[d$window]),
         "Zoom, 19 kb")
}

plotted <- rbind(cold(cells), zoom(cells))
plotted <- subset(plotted, usable & !censored)
r <- rbind(cold(runs), zoom(runs))
r <- subset(r, usable)
r$median <- plotted$ms[match(cell_key(r), cell_key(plotted))]
r <- subset(r, !is.na(median))
r$pct <- 100 * (r$ms / r$median - 1)
r$facet <- factor(facet_of(r), levels = c(paste("Cold load,", WINDOWS), "Zoom, 19 kb"))
r$series <- factor(r$series, levels = PERF_SERIES)

fig <- ggplot(r, aes(x = series, y = pct, colour = series)) +
  geom_hline(yintercept = 0, colour = "grey40", linewidth = 0.4) +
  geom_point(position = position_jitter(width = 0.25, height = 0, seed = REPEL_SEED),
             size = 1.6, alpha = 0.7) +
  facet_wrap(~facet, nrow = 1) +
  scale_x_discrete(labels = NULL) +
  scale_y_continuous(labels = function(x) paste0(ifelse(x > 0, "+", ""), x, "%")) +
  perf_colour_scale(breaks = intersect(PERF_SERIES, unique(as.character(r$series)))) +
  guides(colour = guide_legend(nrow = 1, override.aes = list(size = 3, alpha = 1))) +
  labs(title = "Each run's distance from the median of its cell",
       x = NULL, y = "difference from the median", colour = NULL) +
  paper_theme() +
  theme(axis.ticks.x = element_blank(), legend.position = "top")

ggsave("results/figures/paper/pdf/perf-spread.pdf", fig,
       width = 280, height = 130, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-spread.pdf\n")
ggsave("results/figures/paper/png/perf-spread.png", fig,
       width = 280, height = 130, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-spread.png\n")

widest <- aggregate(pct ~ facet + case + series + format,
                    data = transform(r, pct = abs(pct)), FUN = max)
for (f in levels(r$facet)) {
  w <- subset(widest, facet == f)
  top <- w[which.max(w$pct), ]
  cat(sprintf("%s: %d cells; every run within 5%% of its median in %d, within 10%% in %d; widest %s %s %s, %.0f%%\n",
              f, nrow(w), sum(w$pct <= 5), sum(w$pct <= 10),
              top$series, top$case, top$format, top$pct))
}

secs <- function(ms) {
  s <- ms / 1000
  ifelse(s < 10, sprintf("%.2f", s), ifelse(s < 100, sprintf("%.1f", s), sprintf("%.0f", s)))
}

tab <- subset(cold(cells), TRUE)
tab$coverage <- as.numeric(sub("x .*", "", tab$case))
tab$reads <- sub("^[0-9]+x ", "", tab$case)
tab$text <- ifelse(!tab$usable, "--",
            ifelse(tab$censored, sprintf("$>$%s", secs(tab$ms)),
            ifelse(is.na(tab$lo), secs(tab$ms),
                   sprintf("%s (%s--%s)", secs(tab$ms), secs(tab$lo), secs(tab$hi)))))

rows <- unique(tab[c("window", "reads", "coverage", "format")])
rows <- rows[order(match(rows$window, names(WINDOWS)),
                   match(rows$reads, c("short read", "long read")),
                   rows$coverage, rows$format), ]
series_cols <- intersect(PERF_SERIES, DRAWN)

line_for <- function(i) {
  k <- rows[i, ]
  vals <- vapply(series_cols, function(s) {
    hit <- tab$text[tab$window == k$window & tab$reads == k$reads &
                    tab$coverage == k$coverage & tab$format == k$format &
                    tab$series == s]
    if (length(hit)) hit else "n/a"
  }, character(1))
  paste(c(WINDOWS[[k$window]], k$reads, sprintf("%g$\\times$", k$coverage),
          k$format, vals), collapse = " & ")
}

body <- vapply(seq_len(nrow(rows)), line_for, character(1))
breaks <- c(FALSE, rows$window[-1] != rows$window[-nrow(rows)])
body <- paste0(ifelse(breaks, "\\midrule\n", ""), body, " \\\\")
header <- paste(c("Window", "Reads", "Coverage", "Format", series_cols), collapse = " & ")
tex <- c("\\begin{tabular}{@{}llrl" , paste(rep("r", length(series_cols)), collapse = ""), "@{}}",
         "\\toprule", paste(header, "\\\\"), "\\midrule", body, "\\bottomrule",
         "\\end{tabular}")
tex <- c(paste0(tex[1], tex[2], tex[3]), tex[-(1:3)])
dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(tex, "results/figures/paper/tex/perf-spread-table.tex")
cat("wrote results/figures/paper/tex/perf-spread-table.tex,", nrow(rows), "rows\n")

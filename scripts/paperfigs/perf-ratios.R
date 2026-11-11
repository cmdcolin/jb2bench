#!/usr/bin/env Rscript
# results/figures/paper/tex/ratio-macros.tex from results/paper/perf.csv: the
# cold-load ratios the abstract and the Results quote, as TeX macros, so none is
# typed into the manuscript. A ratio is the other build's or tool's median over
# v5.0.0's, in cells where both finished; a run abandoned at the ceiling is left
# out, since its time is a lower bound. RatioOthersUnfinishedHundredKbFloor is
# that bound: the ceiling over v5.0.0's median, the smallest across the 100 kb
# cells another tool abandoned.
#
#   Rscript scripts/paperfigs/perf-ratios.R

suppressPackageStartupMessages(library(ggplot2))
source("scripts/paperfigs/common.R")

perf <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
cold <- subset(perf, panel == "Cold load" & session == "cross-tool" & usable & !censored)
cold$coverage <- as.numeric(sub("x .*", "", cold$case))
cold$reads <- sub("^[0-9]+x ", "", cold$case)

ratios <- function(window, series, keep = function(d) rep(TRUE, nrow(d)), base = "This work") {
  d <- cold[cold$window == window, ]
  d <- d[keep(d), ]
  b <- d[d$series == base, ]
  o <- d[d$series %in% series, ]
  o$ratio <- o$ms / b$ms[match(paste(o$case, o$format), paste(b$case, b$format))]
  o$ratio[!is.na(o$ratio)]
}
fmt <- function(x) ifelse(x < 10, sprintf("%.1f", x), sprintf("%.0f", x))
range_of <- function(r) sprintf("%s--%s", fmt(min(r)), fmt(max(r)))

others <- c(IGV, GENOMESPY)
low <- function(d) d$coverage == 20
high <- function(d) d$coverage >= 200
short20 <- function(d) d$coverage == 20 & d$reads == "short read"
all100 <- ratios("100kb", others)

unfinished <- subset(perf, panel == "Cold load" & session == "cross-tool" & usable & censored &
                       window == "100kb" & series %in% others)
ours100 <- cold[cold$window == "100kb" & cold$series == "This work", ]
unfinished_floor <- unfinished$ms /
  ours100$ms[match(paste(unfinished$case, unfinished$format), paste(ours100$case, ours100$format))]

macros <- c(
  RatioOldHundredKb = range_of(ratios("100kb", "Release 2.4.0")),
  RatioOthersLowHundredKb = range_of(ratios("100kb", others, low)),
  RatioOthersHighHundredKb = range_of(ratios("100kb", others, high)),
  RatioOthersHundredKb = range_of(all100),
  RatioOthersHundredKbMax = fmt(max(all100)),
  RatioOthersUnfinishedHundredKbFloor = sprintf("%d", floor(min(unfinished_floor))),
  RatioOthersNineteenKbShort = range_of(ratios("19kb", others, short20)),
  RatioIgvEveryRowHundredKb = range_of(ratios("100kb", paste0(IGV, ", every row"), base = IGV)))
tex <- sprintf("\\newcommand{\\%s}{%s}", names(macros), macros)
dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(tex, "results/figures/paper/tex/ratio-macros.tex")
cat(tex, sep = "\n")

slower <- vapply(c("19kb", "100kb", "1mb"), function(w) {
  r <- ratios(w, others)
  sprintf("%s: v5.0.0 faster than igv.js and GenomeSpy in %d of %d finished pairs (%s), median %s",
          w, sum(r > 1), length(r), range_of(r), fmt(median(r)))
}, character(1))
cat(slower, sep = "\n")

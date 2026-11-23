#!/usr/bin/env Rscript
# results/figures/paper/tex/graph-macros.tex from results/paper/{graph-windows,
# pggb-windows,pggb-index}.csv: the graph-view numbers the Results quote for the
# Figure 5 window, chr17, the whole MHC and the pggb graph of chromosome Y.
# A pggb window holding at most four nodes has no reference sequence (gaps and
# the masked pseudoautosomal regions).
#
#   Rscript scripts/paperfigs/graph-macros.R

g <- read.csv("results/paper/graph-windows.csv", stringsAsFactors = FALSE)
p <- read.csv("results/paper/pggb-windows.csv", stringsAsFactors = FALSE)
idx <- read.csv("results/paper/pggb-index.csv", stringsAsFactors = FALSE)

one <- function(x) sprintf("%.1f", x)
count <- function(x) format(x, big.mark = ",", trim = TRUE)
at <- function(ref, start, end) {
  r <- g[g$refName == ref & g$start == start & g$end == end, ]
  stopifnot(nrow(r) == 1)
  r
}
fig5 <- at("chr1", 196640000, 196900000)
chr17 <- at("chr17", 0, 1000000)
mhc <- at("chr6", 29600000, 33400000)
empty <- p$nodes <= 4
drawn <- p[!empty & !p$refused, ]
repeated <- drawn[drawn$laterPassSteps > 0, ]
stopifnot(nrow(repeated) == 1)

window <- function(name, r) c(
  sprintf("\\newcommand{\\Graph%sNodes}{%s}", name, count(r$nodes)),
  sprintf("\\newcommand{\\Graph%sRequests}{%d}", name, as.integer(r$requests)),
  sprintf("\\newcommand{\\Graph%sMB}{%s}", name, one(r$MB)),
  sprintf("\\newcommand{\\Graph%sLoaded}{%s}", name, one(r$loadedS)),
  sprintf("\\newcommand{\\Graph%sDrawn}{%s}", name, one(r$drawnS)))
macros <- c(
  window("FigFive", fig5), window("ChrSeventeen", chr17), window("Mhc", mhc),
  sprintf("\\newcommand{\\GraphRuns}{%d}", min(g$runs)),
  sprintf("\\newcommand{\\GraphPlugin}{%s}", paste(unique(g$plugin), collapse = " and ")),
  sprintf("\\newcommand{\\PggbGfaGB}{%s}", one(idx$gfaBytes / 1e9)),
  sprintf("\\newcommand{\\PggbNodesMillion}{%s}", one(idx$nodes / 1e6)),
  sprintf("\\newcommand{\\PggbIndexMin}{%s}", one(idx$seconds / 60)),
  sprintf("\\newcommand{\\PggbIndexPeakGB}{%s}", one(idx$peakGB)),
  sprintf("\\newcommand{\\PggbWindows}{%d}", nrow(p)),
  sprintf("\\newcommand{\\PggbEmptyWindows}{%d}", sum(empty)),
  sprintf("\\newcommand{\\PggbDrawnWindows}{%d}", nrow(drawn)),
  sprintf("\\newcommand{\\PggbRefusedWindows}{%d}", sum(p$refused)),
  sprintf("\\newcommand{\\PggbNodesMin}{%s}", count(min(drawn$nodes))),
  sprintf("\\newcommand{\\PggbNodesMax}{%s}", count(max(drawn$nodes))),
  sprintf("\\newcommand{\\PggbDrawnMedian}{%s}", one(median(drawn$drawnS))),
  sprintf("\\newcommand{\\PggbDrawnMin}{%s}", one(min(drawn$drawnS))),
  sprintf("\\newcommand{\\PggbDrawnMax}{%s}", one(max(drawn$drawnS))),
  sprintf("\\newcommand{\\PggbRepeatMb}{%.2f}", repeated$start / 1e6),
  sprintf("\\newcommand{\\PggbRepeatStepsDrawn}{%s}", count(repeated$stepsDrawn)),
  sprintf("\\newcommand{\\PggbRepeatSteps}{%s}", count(repeated$steps)))
dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(macros, "results/figures/paper/tex/graph-macros.tex")
cat("wrote results/figures/paper/tex/graph-macros.tex\n")
cat(sprintf("claims: Figure 5 window %s nodes read %s s drawn %s s; chr17 %s / %s s; MHC %s / %s s from %s MB\n",
            fig5$nodes, one(fig5$loadedS), one(fig5$drawnS), one(chr17$loadedS), one(chr17$drawnS),
            one(mhc$loadedS), one(mhc$drawnS), one(mhc$MB)))
cat(sprintf("claims: pggb index %s min %s GB; %d of %d windows drawn in median %s s (%s-%s), %d refused\n",
            one(idx$seconds / 60), one(idx$peakGB), nrow(drawn), nrow(p), one(median(drawn$drawnS)),
            one(min(drawn$drawnS)), one(max(drawn$drawnS)), sum(p$refused)))

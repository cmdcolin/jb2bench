#!/usr/bin/env Rscript
# results/figures/paper/tex/{memory-peak-table,nogpu-table,memory-macros}.tex,
# from results/paper/memory-peak.csv, nogpu.csv and perf.csv.
#
# The memory table is Supplementary Table S11, the no-GPU table S12, and the
# macros carry the numbers the Results sentences beside them quote, so none is
# typed into the manuscript. The claims those sentences make are printed at the
# end, to be checked after any rerun.
#
#   Rscript scripts/paperfigs/perf-memory.R

suppressPackageStartupMessages(library(ggplot2))
source("scripts/paperfigs/common.R")

mem <- read.csv("results/paper/memory-peak.csv", stringsAsFactors = FALSE)
perf <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
nogpu <- read.csv("results/paper/nogpu.csv", stringsAsFactors = FALSE)

TOOLS <- c("Release 2.4.0", "This work", IGV, paste0(IGV, ", every row"), GENOMESPY)
COLUMN <- c("v2.4.0", "v5.0.0", "igv.js", "igv.js, every row", "GenomeSpy")
cold <- subset(perf, panel == "Cold load" & session == "cross-tool" & window == "100kb")
cells <- subset(mem, case != "blank page")
runs <- max(cells$n + cells$early)

gb <- function(mb) {
  g <- mb / 1024
  ifelse(g < 10, sprintf("%.2f", g), sprintf("%.1f", g))
}

cell_text <- function(case, format, series) {
  m <- cells[cells$case == case & cells$format == format & cells$series == series, ]
  t <- cold[cold$case == case & cold$format == format & cold$series == series, ]
  if (nrow(m) && m$n > 0) {
    paste0(gb(m$peak_mb), if (m$n < runs) sprintf("$^{%d}$", m$n) else "")
  } else if (!nrow(t) || !t$usable) {
    "n/a"
  } else if (t$censored) {
    sprintf("$>$%g min", t$ms / 60000)
  } else {
    "--"
  }
}

keys <- unique(cells[c("case", "format")])
keys$coverage <- as.numeric(sub("x .*", "", keys$case))
keys$reads <- sub("^[0-9]+x ", "", keys$case)
keys <- keys[order(match(keys$reads, c("short read", "long read")),
                   keys$coverage, keys$format), ]
body <- vapply(seq_len(nrow(keys)), function(i) {
  k <- keys[i, ]
  vals <- vapply(TOOLS, function(s) cell_text(k$case, k$format, s), character(1))
  paste(c(sub(" read$", "", k$reads), sprintf("%g$\\times$", k$coverage), k$format, vals),
        collapse = " & ")
}, character(1))
mem_tex <- c(sprintf("\\begin{tabular}{@{}lrl%s@{}}", strrep("r", length(TOOLS))),
             "\\toprule",
             paste(paste(c("Reads", "Cov.", "Format", COLUMN), collapse = " & "), "\\\\"),
             "\\midrule", paste(body, "\\\\"), "\\bottomrule", "\\end{tabular}")

webgl_cold <- function(k) {
  cold$ms[cold$case == k & cold$format == "BAM" & cold$series == "This work"]
}
webgl_zoom <- subset(perf, panel == "Zoom in, both hold the data" &
                       metric == "what the user waits" & case == "200x short read" &
                       format == "BAM" & series == "This work")$ms
canvas <- function(k) nogpu$ms[nogpu$cell == k & nogpu$backend == "canvas2d"]
NOGPU <- data.frame(
  label = c("Cold load, 100 kb, 20$\\times$ short-read BAM",
            "Cold load, 100 kb, 1000$\\times$ short-read BAM",
            "Zoom, 19 kb, 200$\\times$ short-read BAM"),
  webgl = c(webgl_cold("20x short read"), webgl_cold("1000x short read"), webgl_zoom),
  canvas = c(canvas("cold-20x"), canvas("cold-1000x"), canvas("zoom-200x")),
  unit = c("s", "s", "ms"))
fmt <- function(ms, unit) {
  if (unit == "s") sprintf("%.2f s", ms / 1000) else sprintf("%.0f ms", ms)
}
nogpu_tex <- c("\\begin{tabular}{@{}lrr@{}}", "\\toprule",
               "Cell & WebGL 2, T4 GPU & Canvas 2D, no GPU \\\\", "\\midrule",
               sprintf("%s & %s & %s \\\\", NOGPU$label,
                       mapply(fmt, NOGPU$webgl, NOGPU$unit),
                       mapply(fmt, NOGPU$canvas, NOGPU$unit)),
               "\\bottomrule", "\\end{tabular}")

macros <- c(
  sprintf("\\newcommand{\\BlankPagePeakGB}{%s}", gb(subset(mem, case == "blank page")$peak_mb)),
  sprintf("\\newcommand{\\NoGpuZoomCanvasMs}{%.0f}", NOGPU$canvas[3]),
  sprintf("\\newcommand{\\NoGpuZoomWebglMs}{%.0f}", NOGPU$webgl[3]))

dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(mem_tex, "results/figures/paper/tex/memory-peak-table.tex")
writeLines(nogpu_tex, "results/figures/paper/tex/nogpu-table.tex")
writeLines(macros, "results/figures/paper/tex/memory-macros.tex")
cat("wrote results/figures/paper/tex/{memory-peak-table,nogpu-table,memory-macros}.tex\n")

wide <- reshape(cells[c("case", "format", "series", "peak_mb")], idvar = c("case", "format"),
                timevar = "series", direction = "wide")
v5 <- wide[["peak_mb.This work"]]
others <- c(IGV, paste0(IGV, ", every row"), GENOMESPY)
below_others <- all(vapply(others, function(s) {
  o <- wide[[paste0("peak_mb.", s)]]
  all(is.na(o) | is.na(v5) | v5 < o)
}, logical(1)))
cat(sprintf("v5.0.0 below igv.js and GenomeSpy wherever both were measured: %s\n", below_others))
old <- wide[["peak_mb.Release 2.4.0"]]
cat(sprintf("v5.0.0 below v2.4.0 in %d of %d cells; above in: %s\n",
            sum(v5 < old, na.rm = TRUE), sum(!is.na(v5 - old)),
            paste(with(wide[!is.na(v5 - old) & v5 >= old, ], paste(case, format)),
                  collapse = ", ")))
thin <- subset(cells, n < runs & n > 0)
cat("cells with fewer than", runs, "runs:",
    paste(sprintf("%s %s %s (%d)", thin$series, thin$case, thin$format, thin$n),
          collapse = "; "), "\n")
cat(sprintf("Canvas 2D / WebGL 2: cold 20x %.2f, cold 1000x %.2f, zoom %.1f\n",
            NOGPU$canvas[1] / NOGPU$webgl[1], NOGPU$canvas[2] / NOGPU$webgl[2],
            NOGPU$canvas[3] / NOGPU$webgl[3]))

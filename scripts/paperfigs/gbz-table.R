#!/usr/bin/env Rscript
# results/figures/paper/tex/{gbz-requests-table,gbz-macros}.tex from
# results/paper/gbz.csv: Supplementary Table S5, and the numbers the Discussion
# and the supplement's Limits paragraph quote for the Figure 5 window.
#
#   Rscript scripts/paperfigs/gbz-table.R

d <- read.csv("results/paper/gbz.csv", stringsAsFactors = FALSE)
FIGURE5 <- "chr1:196640000-196900000"

window <- function(bp) {
  ifelse(bp >= 1e6, sprintf("%g~Mb", round(bp / 1e6)), sprintf("%g~kb", round(bp / 1e3)))
}
one <- function(x) sprintf("%.1f", x)
cells <- function(r) {
  c(sprintf("%g", r$requests), one(r$MB), paste0(one(r$seconds), if (r$limit) "*" else ""))
}
gbz <- d[d$route == "GBZ-base", ]
pif <- d[d$route == "PIF", ]
body <- vapply(seq_len(nrow(gbz)), function(i) {
  p <- pif[pif$loc == gbz$loc[i], ]
  paste(c(window(gbz$bp[i]), cells(gbz[i, ]), cells(p)), collapse = " & ")
}, character(1))
tex <- c("\\begin{tabular}{@{}lrrrrrr@{}}", "\\toprule",
         "& \\multicolumn{3}{c}{GBZ-base} & \\multicolumn{3}{c}{PIF} \\\\",
         "\\cmidrule(lr){2-4}\\cmidrule(lr){5-7}",
         "Window & Requests & MB & s & Requests & MB & s \\\\", "\\midrule",
         paste(body, "\\\\"), "\\bottomrule", "\\end{tabular}")

at <- function(route) d[d$route == route & d$loc == FIGURE5, ]
g <- at("GBZ-base")
p <- at("PIF")
w <- at("walks")
macros <- c(
  sprintf("\\newcommand{\\GbzFigFiveSeconds}{%s}", one(g$seconds)),
  sprintf("\\newcommand{\\GbzFigFiveRequests}{%g}", g$requests),
  sprintf("\\newcommand{\\PifFigFiveSeconds}{%s}", one(p$seconds)),
  sprintf("\\newcommand{\\PifFigFiveRequests}{%g}", p$requests),
  sprintf("\\newcommand{\\WalkFigFiveRequests}{%g}", w$requests),
  sprintf("\\newcommand{\\WalkFigFiveMB}{%.2f}", w$MB),
  sprintf("\\newcommand{\\GbzRunDate}{%s}", format(as.Date(g$date), "%-d %B %Y")),
  sprintf("\\newcommand{\\GbzPluginVersion}{%s}", g$plugin),
  sprintf("\\newcommand{\\GbzRuns}{%d}", min(d$runs)))
dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(tex, "results/figures/paper/tex/gbz-requests-table.tex")
writeLines(macros, "results/figures/paper/tex/gbz-macros.tex")
cat("wrote results/figures/paper/tex/{gbz-requests-table,gbz-macros}.tex\n")
limit <- d[d$limit, ]
if (nrow(limit)) cat("node limit reached:", paste(limit$route, limit$loc), "\n")

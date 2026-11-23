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
  c(sprintf("%g", r$requests), sprintf("%.2f", r$MB), paste0(one(r$seconds), if (r$limit) "*" else ""))
}
ROUTES <- c("Walk file" = "walks", "PIF" = "PIF", "GBZ-base" = "GBZ-base")
locs <- unique(d$loc[order(d$bp)])
body <- vapply(locs, function(loc) {
  rows <- lapply(ROUTES, function(route) d[d$route == route & d$loc == loc, ])
  paste(c(window(rows[[1]]$bp), unlist(lapply(rows, cells))), collapse = " & ")
}, character(1))
tex <- c("\\begin{tabular}{@{}lrrrrrrrrr@{}}", "\\toprule",
         paste0("& ", paste(sprintf("\\multicolumn{3}{c}{%s}", names(ROUTES)), collapse = " & "), " \\\\"),
         "\\cmidrule(lr){2-4}\\cmidrule(lr){5-7}\\cmidrule(lr){8-10}",
         paste0("Window", strrep(" & Requests & MB & s", length(ROUTES)), " \\\\"), "\\midrule",
         paste(body, "\\\\"), "\\bottomrule", "\\end{tabular}")

at <- function(route) d[d$route == route & d$loc == FIGURE5, ]
g <- at("GBZ-base")
p <- at("PIF")
w <- at("walks")
widest <- function(route) d[d$route == route & d$bp == max(d$bp), ]
macros <- c(
  sprintf("\\newcommand{\\GbzFigFiveSeconds}{%s}", one(g$seconds)),
  sprintf("\\newcommand{\\GbzFigFiveRequests}{%g}", g$requests),
  sprintf("\\newcommand{\\PifFigFiveSeconds}{%s}", one(p$seconds)),
  sprintf("\\newcommand{\\PifFigFiveRequests}{%g}", p$requests),
  sprintf("\\newcommand{\\WalkFigFiveRequests}{%g}", w$requests),
  sprintf("\\newcommand{\\WalkFigFiveSeconds}{%s}", one(w$seconds)),
  sprintf("\\newcommand{\\WalkFigFiveMB}{%.2f}", w$MB),
  sprintf("\\newcommand{\\WalkWidestSeconds}{%s}", one(widest("walks")$seconds)),
  sprintf("\\newcommand{\\PifWidestSeconds}{%s}", one(widest("PIF")$seconds)),
  sprintf("\\newcommand{\\GbzBuild}{%s}", g$build),
  sprintf("\\newcommand{\\GbzRunDate}{%s}", format(as.Date(g$date), "%-d %B %Y")),
  sprintf("\\newcommand{\\GbzPluginVersion}{%s}", gsub(",", " and ", g$plugin)),
  sprintf("\\newcommand{\\GbzRuns}{%d}", min(d$runs)))
dir.create("results/figures/paper/tex", showWarnings = FALSE, recursive = TRUE)
writeLines(tex, "results/figures/paper/tex/gbz-requests-table.tex")
writeLines(macros, "results/figures/paper/tex/gbz-macros.tex")
cat("wrote results/figures/paper/tex/{gbz-requests-table,gbz-macros}.tex\n")
limit <- d[d$limit, ]
if (nrow(limit)) cat("node limit reached:", paste(limit$route, limit$loc), "\n")

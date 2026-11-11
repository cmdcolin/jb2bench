#!/usr/bin/env Rscript
# Reduce the Table S5 lane traces (scripts/gbz/s5-run.sh) to results/paper/gbz.csv:
# per window and route, the median requests, megabytes and seconds to settle,
# the display's final phase, and the build and plugin the runs used.
#
#   Rscript scripts/paperfigs/gbz-data.R results/graph-track/s5-<date>.jsonl

suppressPackageStartupMessages(library(jsonlite))

src <- commandArgs(trailingOnly = TRUE)[1]
runs <- stream_in(file(src), verbose = FALSE)
ROUTE <- c(hprc_v2_1_gbz_lanes = "GBZ-base", hprc_v2_1_pif_lanes = "PIF",
           hprc_v2_1_walk_lanes = "walks")
span <- function(loc) {
  p <- as.numeric(strsplit(sub(".*:", "", loc), "-")[[1]])
  p[2] - p[1] + 1
}
runs$route <- ROUTE[runs$trackId]
runs$bp <- vapply(runs$loc, span, numeric(1))
runs$limit <- runs$phase == "error" & grepl("^Zoom in", runs$message %||% "")
keys <- unique(runs[c("route", "loc", "bp")])
out <- do.call(rbind, lapply(seq_len(nrow(keys)), function(i) {
  k <- keys[i, ]
  r <- runs[runs$route == k$route & runs$loc == k$loc, ]
  ok <- r$phase == "ready" | r$limit
  stopifnot(all(ok))
  data.frame(route = k$route, loc = k$loc, bp = k$bp, runs = nrow(r),
             requests = median(r$requests), MB = median(r$MB),
             seconds = median(r$settledMs) / 1000, limit = all(r$limit),
             build = paste(unique(r$version), collapse = ","),
             plugin = paste(unique(r$plugin), collapse = ","),
             date = substr(min(r$date), 1, 10))
}))
out <- out[order(out$route, out$bp), ]
write.csv(out, "results/paper/gbz.csv", row.names = FALSE)
cat("wrote results/paper/gbz.csv,", nrow(out), "rows, from", src, "\n")

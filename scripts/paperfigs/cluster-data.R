#!/usr/bin/env Rscript
# Extract the clustering distance-build measurement into results/paper/cluster.csv,
# from the measurement record jbrowse-components keeps for it.
#
# Split from cluster.R for the same reason perf-data.R is split from its
# figures: nothing measured is typed by hand, and cluster.csv is committed, so
# the figure redraws from it. This is the only script here that needs a
# jbrowse-components checkout.
#
#   Rscript scripts/paperfigs/cluster-data.R [path-to-jbrowse-components]

suppressPackageStartupMessages(library(jsonlite))

jb2 <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(jb2)) {
  jb2 <- Sys.getenv("JB2", file.path(Sys.getenv("HOME"), "src/jbrowse-components"))
}
record <- file.path(jb2, "agent-docs/measurements/cluster-distance-gpu.json")
if (!file.exists(record)) {
  stop("no ", record, "; pass the jbrowse-components path as an argument")
}

m <- fromJSON(record, simplifyVector = FALSE)

series <- c(js = "greenelab/hclust (JS)",
            hclust500 = "hclust 5.0.0 (wasm)",
            hclustNew = "hclust 5.1.0 (wasm)",
            gpu = "WebGPU kernel")

rows <- list()
for (r in m$rows) {
  v <- r$values
  for (key in names(series)) {
    rows[[length(rows) + 1]] <- data.frame(
      case = v$window, n = v$n, v = v$v,
      series = series[[key]], s = v[[key]],
      stringsAsFactors = FALSE
    )
  }
}
d <- do.call(rbind, rows)
d$measured <- m$measured

dir.create("generated", showWarnings = FALSE)
write.csv(d, "results/paper/cluster.csv", row.names = FALSE)
cat("wrote results/paper/cluster.csv (measured ", m$measured, ")\n", sep = "")

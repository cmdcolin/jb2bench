#!/usr/bin/env Rscript
# Extract the clustering distance-build measurement into results/paper/cluster.csv:
# the wasm and WebGPU columns from the measurement record jbrowse-components
# keeps, and both JavaScript columns from this repo's own sweep.
#
# Split from cluster.R for the same reason perf-data.R is split from its
# figures: nothing measured is typed by hand, and cluster.csv is committed, so
# the figure redraws from it. This is the only script here that needs a
# jbrowse-components checkout.
#
# THE JS COLUMNS COME FROM results/cluster-distance-sweep.json, not from the
# record. The record's own `js` column was measured on a different machine
# (node 24, Linux) against synthetic data, and it says so: it "establishes the
# pre-wasm baseline's order of magnitude, not a fifth arm of the idle-machine
# sitting above". That was tolerable while JS was one curve among four whose
# job was to sit at the top. It is not tolerable now that the figure draws an
# optimized JS curve beside it, because the gap between the two IS the
# algorithm claim, and half of it would be the two machines. distance-sweep.mjs
# re-measures both arms here, on the real dosage matrices, on the same 2019
# MacBook Pro the record's wasm and WebGPU columns were taken on.
#
#   Rscript scripts/paperfigs/cluster-data.R [path-to-jbrowse-components] [path-to-jb2bench]

suppressPackageStartupMessages(library(jsonlite))

a <- commandArgs(trailingOnly = TRUE)
jb2 <- if (is.na(a[1])) Sys.getenv("JB2", file.path(Sys.getenv("HOME"), "src/jbrowse-components")) else a[1]
bench <- if (is.na(a[2])) Sys.getenv("JB2BENCH", ".") else a[2]

record <- file.path(jb2, "agent-docs/measurements/cluster-distance-gpu.json")
if (!file.exists(record)) {
  stop("no ", record, "; pass the jbrowse-components path as an argument")
}
sweepFile <- file.path(bench, "results/cluster-distance-sweep.json")
if (!file.exists(sweepFile)) {
  stop("no ", sweepFile, "; run node scripts/cluster/distance-sweep.mjs")
}

m <- fromJSON(record, simplifyVector = FALSE)
sweep <- fromJSON(sweepFile, simplifyVector = FALSE)

series <- c(hclust500 = "hclust 5.0.0 (wasm)",
            hclustNew = "hclust 5.1.0 (wasm)",
            gpu = "WebGPU kernel")
jsSeries <- c(naive = "greenelab/hclust (JS)", opt = "optimized JS")

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
  # Joined on the window label, and every window must carry both arms: a
  # missing one would drop out of the figure silently as a shorter curve,
  # which reads as a measurement rather than as an absent file.
  for (key in names(jsSeries)) {
    js <- Filter(function(x) x$window == v$window && x$impl == key, sweep$results)
    if (!length(js)) stop("no ", key, " sweep row for window ", v$window)
    rows[[length(rows) + 1]] <- data.frame(
      case = v$window, n = v$n, v = v$v,
      series = jsSeries[[key]], s = js[[1]]$s,
      stringsAsFactors = FALSE
    )
  }
}
d <- do.call(rbind, rows)
# Per row, not one date for the file: the wasm and WebGPU columns are the
# record's idle-machine sitting and the two JS columns are this repo's sweep,
# taken on the same machine on a different day. One `measured` value would have
# to be a lie about half the rows.
d$measured <- ifelse(d$series %in% jsSeries, sweep$measured, m$measured)

dir.create("generated", showWarnings = FALSE)
write.csv(d, "results/paper/cluster.csv", row.names = FALSE)
cat("wrote results/paper/cluster.csv (measured ", m$measured, ")\n", sep = "")

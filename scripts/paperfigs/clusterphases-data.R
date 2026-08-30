#!/usr/bin/env Rscript
# Extract the end-to-end clustering phase split into results/paper/clusterphases.csv,
# one set of rows per matrix measured.
#
#   Rscript scripts/paperfigs/clusterphases-data.R [path-to-jb2bench] [path-to-jbrowse-components]

suppressPackageStartupMessages(library(jsonlite))
a <- commandArgs(trailingOnly = TRUE)
bench <- if (is.na(a[1])) Sys.getenv("JB2BENCH", ".") else a[1]
jb2 <- if (is.na(a[2])) Sys.getenv("JB2", file.path(Sys.getenv("HOME"), "src/jbrowse-components")) else a[2]

res <- file.path(bench, "results")
gpu <- fromJSON(file.path(jb2, "agent-docs/measurements/cluster-distance-gpu.json"),
                simplifyVector = FALSE)

jsFiles <- list.files(res, "^cluster-js-phases-.*\\.json$", full.names = TRUE)
if (!length(jsFiles)) stop("no cluster-js-phases-*.json in ", res)

rows <- list()
for (f in jsFiles) {
  js <- fromJSON(f, simplifyVector = FALSE)
  slug <- sub("^cluster-js-phases-", "", sub("\\.json$", "", basename(f)))
  wf <- file.path(res, paste0("cluster-wasm-phases-", slug, ".json"))
  if (!file.exists(wf)) { message("skip ", slug, ": no wasm run"); next }
  wasm <- fromJSON(wf, simplifyVector = FALSE)

  jsFull <- Filter(function(r) r$n == wasm$n, js$results)
  if (!length(jsFull)) { message("skip ", slug, ": no JS row at N=", wasm$n); next }
  jsFull <- jsFull[[1]]

  # The GPU distance figure comes from a different harness (a WebGPU probe) on
  # the matrix of the same window. Matched on shape and carried with its own
  # provenance rather than folded in silently.
  g <- Filter(function(r) r$values$n == wasm$n && abs(r$values$v - wasm$v) <= 2, gpu$rows)
  if (!length(g)) { message("skip ", slug, ": no GPU row at N=", wasm$n, " V~", wasm$v); next }
  gpuS <- g[[1]]$values$gpu

  # Matrix shape is the label, not the window's MAF threshold: a filter setting
  # is not what the time scales with, and "MAF" reads as an allele frequency
  # rather than as a size.
  shape <- sprintf("%s × %s", format(wasm$n, big.mark = ","), format(wasm$v, big.mark = ","))
  for (r in list(
    list(config = "JS", phase = "distance", s = jsFull$distanceMs / 1000),
    list(config = "JS", phase = "merge", s = jsFull$clusterMs / 1000),
    list(config = "wasm", phase = "distance", s = wasm$distanceMs / 1000),
    list(config = "wasm", phase = "merge", s = wasm$clusterMs / 1000),
    list(config = "WebGPU + wasm", phase = "distance", s = gpuS),
    list(config = "WebGPU + wasm", phase = "merge", s = wasm$clusterMs / 1000)
  )) {
    rows[[length(rows) + 1]] <- data.frame(
      matrix = shape, n = wasm$n, v = wasm$v,
      config = r$config, phase = r$phase, s = r$s, stringsAsFactors = FALSE)
  }
}
d <- do.call(rbind, rows)
# rbind of nothing is NULL, and `NULL$v` then fails as "argument 1 is not a
# vector" several lines later, which says nothing about the cause. Every skip
# above is already reported; this says the run produced no complete case at all
# and, like perf-data.R, refuses rather than overwriting a good committed CSV
# with an empty one.
if (is.null(d)) {
  stop("no case had a complete JS + wasm + GPU triple, so ",
       "results/paper/clusterphases.csv was NOT written. Each ",
       "cluster-js-phases-<slug>.json needs a cluster-wasm-phases-<slug>.json ",
       "beside it in results/ and a GPU probe row of the same shape; the skips ",
       "listed above say which was missing.")
}
d <- d[order(d$v, d$config), ]

dir.create("generated", showWarnings = FALSE)
write.csv(d, "results/paper/clusterphases.csv", row.names = FALSE)
cat("wrote results/paper/clusterphases.csv (", length(unique(d$matrix)), " matrices )\n", sep = "")

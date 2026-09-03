#!/usr/bin/env Rscript
# Extract the end-to-end clustering phase split into results/paper/clusterphases.csv,
# one set of rows per matrix measured.
#
# Reads results/cluster-compare-<slug>-n<N>.json, which carries all three
# CPU configurations from one run of scripts/cluster/compare.mjs. It used to
# read the JS and wasm phase sweeps separately, and that quietly mixed two
# kinds of number: the JS sweep runs every N in one process, so the last N
# meets a heap full of the earlier sizes' garbage and reports about 1.5x its
# cold time, while the wasm side was always measured cold in a fresh process.
# The difference was being read as wasm's margin. compare.mjs forks per
# implementation so all three are the same kind of number, and taking the
# triple from a single file is what keeps them that way.
#
#   Rscript scripts/paperfigs/clusterphases-data.R [path-to-jb2bench] [path-to-jbrowse-components]

suppressPackageStartupMessages(library(jsonlite))
a <- commandArgs(trailingOnly = TRUE)
bench <- if (is.na(a[1])) Sys.getenv("JB2BENCH", ".") else a[1]
jb2 <- if (is.na(a[2])) Sys.getenv("JB2", file.path(Sys.getenv("HOME"), "src/jbrowse-components")) else a[2]

res <- file.path(bench, "results")
# CLUSTER_RECORD, as in cluster-data.R: a run that re-measures every arm on one
# machine points both scripts at its own record, so the GPU row here comes off
# the same box as the CPU rows beside it rather than out of the 2019 MacBook Pro
# the jbrowse-components store holds.
gpuRecord <- Sys.getenv("CLUSTER_RECORD",
                        file.path(jb2, "agent-docs/measurements/cluster-distance-gpu.json"))
gpu <- fromJSON(gpuRecord, simplifyVector = FALSE)

files <- list.files(res, "^cluster-compare-.*\\.json$", full.names = TRUE)
if (!length(files)) stop("no cluster-compare-*.json in ", res,
                         "; run scripts/cluster/compare.mjs")

# The three CPU rows are named for what a reader is choosing between, not for
# compare.mjs's internal keys. "JS" alone would have to cover both JavaScript
# implementations, and the whole point of the middle row is that they are not
# the same thing.
config <- c(naive = "JS reference", opt = "JS optimized", wasm = "wasm")

rows <- list()
for (f in files) {
  cmp <- fromJSON(f, simplifyVector = FALSE)
  byImpl <- setNames(cmp$results, vapply(cmp$results, function(r) r$impl, ""))
  if (!all(names(config) %in% names(byImpl))) {
    message("skip ", basename(f), ": needs all of ", paste(names(config), collapse = ", "))
    next
  }

  # The GPU distance figure comes from a different harness (a WebGPU probe) on
  # the matrix of the same window. Matched on shape and carried with its own
  # provenance rather than folded in silently.
  g <- Filter(function(r) r$values$n == cmp$n && abs(r$values$v - cmp$v) <= 2, gpu$rows)
  if (!length(g)) { message("skip ", basename(f), ": no GPU row at N=", cmp$n, " V~", cmp$v); next }
  gpuS <- g[[1]]$values$gpu

  # Matrix shape is the label, not the window's MAF threshold: a filter setting
  # is not what the time scales with, and "MAF" reads as an allele frequency
  # rather than as a size.
  shape <- sprintf("%s × %s", format(cmp$n, big.mark = ","), format(cmp$v, big.mark = ","))

  # hclust reports the distance/merge boundary through its progress callback,
  # and the C side throttles those to one per 100 ms with the timer reset as the
  # merge begins. A merge that finishes inside that interval is therefore never
  # reported, and compare.mjs records the split as null rather than guessing --
  # which is the wasm arm at N = 2504 on some sittings and not others. Left
  # alone, `null / 1000` is numeric(0), data.frame() drops the row, and the
  # config disappears from a CSV that still looks complete. The figure sums the
  # phases, so an unresolved split costs it nothing as long as the TOTAL
  # survives: emit one row carrying the whole call instead of two that vanish.
  SPLIT_FLOOR <- 0.1
  phasesFor <- function(cfg, r) {
    if (is.null(r$distanceMs) || is.null(r$clusterMs)) {
      list(list(config = cfg, phase = "total (split unresolved)",
                s = r$totalMs / 1000))
    } else {
      list(list(config = cfg, phase = "distance", s = r$distanceMs / 1000),
           list(config = cfg, phase = "merge", s = r$clusterMs / 1000))
    }
  }

  measured <- list()
  for (impl in names(config)) {
    measured <- c(measured, phasesFor(config[[impl]], byImpl[[impl]]))
  }
  # The compute shader replaces only the distance build, so its merge is the
  # wasm merge, carried across rather than re-measured. When that merge was
  # never resolved, carry the interval that hid it: the true value is somewhere
  # under it, so the WebGPU point comes out slow rather than flattering, which
  # is the direction an unmeasured quantity should err in a figure whose last
  # step is the one it buys.
  wasmMerge <- byImpl$wasm$clusterMs
  measured[[length(measured) + 1]] <-
    list(config = "WebGPU + wasm", phase = "distance", s = gpuS)
  measured[[length(measured) + 1]] <-
    list(config = "WebGPU + wasm",
         phase = if (is.null(wasmMerge)) "merge (upper bound)" else "merge",
         s = if (is.null(wasmMerge)) SPLIT_FLOOR else wasmMerge / 1000)

  for (r in measured) {
    rows[[length(rows) + 1]] <- data.frame(
      matrix = shape, n = cmp$n, v = cmp$v,
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
  stop("no case had a complete naive + opt + wasm + GPU set, so ",
       "results/paper/clusterphases.csv was NOT written. Each ",
       "cluster-compare-<slug>-n<N>.json needs a GPU probe row of the same ",
       "shape; the skips listed above say which was missing.")
}
d <- d[order(d$v, d$config), ]

dir.create("generated", showWarnings = FALSE)
write.csv(d, "results/paper/clusterphases.csv", row.names = FALSE)
cat("wrote results/paper/clusterphases.csv (", length(unique(d$matrix)), " matrices )\n", sep = "")

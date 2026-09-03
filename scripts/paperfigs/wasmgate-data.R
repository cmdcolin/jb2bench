#!/usr/bin/env Rscript
# Extract the wasm gate measurement into results/paper/wasmgate.csv.
#
# Split from wasmgate.R for the same reason parser-data.R is split from its
# figure: nothing measured is typed by hand, and the CSV is committed, so the
# figure redraws from it without re-running a benchmark.
#
#   Rscript scripts/paperfigs/wasmgate-data.R [path-to-jb2bench]

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}
src <- file.path(bench, "results", "wasmgate.json")
if (!file.exists(src)) {
  stop("no ", src, "; run 'make wasmgate'")
}

m <- fromJSON(src, simplifyVector = FALSE)

# Both statistics travel to the CSV. The figure draws the MINIMUM -- contention
# only ever adds time, so the fastest repetition is the least contaminated one --
# and the median rides alongside so a cell that spent most of its run waiting is
# visible as a gap between the two rather than invisible.
rows <- do.call(rbind, lapply(m$rows, function(r) data.frame(
  file = r$file, layer = r$layer, candidate = r$candidate,
  # Where JBrowse runs the routine. Carried into the CSV rather than left in the
  # JSON because it is the reason the row is on the figure at all.
  call_site = r$callSite,
  units = r$units, in_bytes = r$inBytes, out_bytes = r$outBytes,
  js_ms = r$js$min, js_median_ms = r$js$median,
  # A candidate with no shipped wasm implementation carries NA rather than a
  # zero, so the figure draws no point for it instead of one on the floor.
  wasm_ms = if (is.null(r$wasm)) NA_real_ else r$wasm$min,
  wasm_median_ms = if (is.null(r$wasm)) NA_real_ else r$wasm$median,
  floor_ms = r$floor$min, floor_median_ms = r$floor$median,
  load = r$load,
  stringsAsFactors = FALSE
)))
rows$marshalled <- rows$in_bytes + rows$out_bytes
rows$measured <- m$measured

dir.create(file.path(bench, "results/paper"), showWarnings = FALSE, recursive = TRUE)
write.csv(rows, file.path(bench, "results/paper/wasmgate.csv"), row.names = FALSE)
cat("wrote results/paper/wasmgate.csv (measured ", m$measured, ", ",
    nrow(rows), " rows)\n", sep = "")

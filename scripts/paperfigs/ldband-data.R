#!/usr/bin/env Rscript
# Extract the banded-LD measurements the band figure plots, from jb2bench's
# recorded results into results/paper/ldband.csv.
#
# Split from ldband.R for the same reason perf-data.R is split from its figures:
# nothing measured is typed by hand, and ldband.csv is committed, so the figure
# redraws from it without touching results/.
#
#   Rscript scripts/paperfigs/ldband-data.R [path-to-jb2bench]

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}
src <- file.path(bench, "results", "ld-band.json")
if (!file.exists(src)) {
  stop("no ", src, "; run scripts/ld/ldband.ts in ", bench)
}

d <- fromJSON(src, simplifyVector = FALSE)

rows <- do.call(rbind, lapply(d$rows, function(r) data.frame(
  # Which estimator ran. The benchmark sweeps both against ONE cohort packed two
  # ways, so this is the phased/unphased axis and not two datasets: `units` is
  # what each cell reduces over, 2n haplotypes against n genotypes.
  method = r$method,
  units = r$units,
  unit_name = r$unitName,
  window = r$window,
  band = r$band,
  cells = r$cells,
  output_mib = r$outputMiB,
  # A declined dispatch has no time: the app falls back to the CPU column, so
  # NA is the honest value and the figure marks it rather than plotting a zero.
  gpu_ms = if (isTRUE(r$declined)) NA_real_ else as.numeric(r$gpuMs),
  declined = isTRUE(r$declined),
  cpu_ms = as.numeric(r$cpuMs),
  # Whether the CPU number was run or extrapolated from a measured per-cell
  # rate. Carried through so the figure can distinguish them; a paper that
  # plots an estimate as a measurement has stopped being a measurement.
  cpu_measured = isTRUE(r$cpuMeasured),
  max_abs_diff = if (is.null(r$maxAbsDiff)) NA_real_ else as.numeric(r$maxAbsDiff),
  # Measured per method, since the two do different work per cell; it is what a
  # row too big for the CPU budget would have been extrapolated from.
  cpu_ns_per_cell = as.numeric(d$calibration$perMethod[[r$method]]$nsPerCell),
  stringsAsFactors = FALSE
)))

# Provenance travels with the numbers: the device limit decides which rows can
# dispatch at all, and it is a DEVICE limit rather than the adapter's (a bare
# requestDevice() would report 128 MiB on this same 2 GiB adapter).
rows$num_snps <- d$numSnps
rows$num_samples <- d$numSamples
rows$adapter <- trimws(paste(d$adapter$vendor, d$adapter$architecture))
rows$max_storage_binding <- d$limits$maxStorageBufferBindingSize

dir.create("generated", showWarnings = FALSE)
write.csv(rows, "results/paper/ldband.csv", row.names = FALSE)
cat("wrote results/paper/ldband.csv\n")

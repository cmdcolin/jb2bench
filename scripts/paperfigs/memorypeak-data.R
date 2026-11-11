#!/usr/bin/env Rscript
# Extract the peak-memory pass and the no-GPU panel into results/paper/memory-peak.csv
# and results/paper/nogpu.csv, for perf-memory.R to tabulate.
#
# The memory number is the cgroup peak of non-file memory over the whole Chrome
# process tree (scripts/crosstool/cgroupmemory.ts), not the end-of-load snapshot
# perf-data.R writes to memory.csv. A run whose JS heap is under a quarter of its
# cell's largest is a page that settled before the reads loaded and is dropped;
# the threshold is against the largest heap, not the median, because at 1000x
# long-read BAM two of three v5.0.0 runs settled early.
#
#   Rscript scripts/paperfigs/memorypeak-data.R [memory-peak dir] [no-GPU panel dir]

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = TRUE)
memdir <- if (length(args) >= 1) args[1] else "results/ec2/2026-11-11-1057/memory-peak"
panel_dir <- if (length(args) >= 2) args[2] else "results/ec2mac/g4dn-nogpu-20261111-1551"

xt <- fromJSON(file.path(memdir, "crosstool.json"), simplifyVector = FALSE)
SERIES <- c("jbrowse-release-2.4.0" = "Release 2.4.0",
            "jbrowse" = "This work",
            "igv" = paste("igv.js", xt$igvVersion),
            "igv-tall" = paste0("igv.js ", xt$igvVersion, ", every row"),
            "genomespy" = paste("GenomeSpy", xt$gsVersion))

case_of <- function(key) {
  p <- strsplit(sub("@.*", "", key), "-")[[1]]
  c(case = paste(p[1], sub("read$", " read", p[2])), format = toupper(p[3]),
    window = sub(".*@", "", key))
}

rows <- list()
for (key in names(xt$rows)) {
  for (tool in names(SERIES)) {
    arm <- xt$rows[[key]][[tool]]
    if (is.null(arm)) next
    mem <- Filter(function(m) !is.null(m$cgroup), arm$memory %||% list())
    heap <- vapply(mem, function(m) m$jsHeap$usedMB, numeric(1))
    peak <- vapply(mem, function(m) m$cgroup$peakNonFileMB, numeric(1))
    kept <- heap >= max(c(heap, 0)) / 4
    rows[[length(rows) + 1]] <- data.frame(
      t(case_of(key)), series = SERIES[[tool]],
      peak_mb = if (any(kept)) median(peak[kept]) else NA_real_,
      n = sum(kept), early = sum(!kept), stringsAsFactors = FALSE)
  }
}
blank <- stream_in(file(file.path(memdir, "blank.jsonl")), verbose = FALSE)
rows[[length(rows) + 1]] <- data.frame(
  case = "blank page", format = NA, window = NA, series = NA,
  peak_mb = median(blank$peakNonFileMB), n = nrow(blank), early = 0)
out <- do.call(rbind, rows)
write.csv(out, "results/paper/memory-peak.csv", row.names = FALSE)
cat("wrote results/paper/memory-peak.csv,", nrow(out), "rows, from", memdir, "\n")

panel <- fromJSON(file.path(panel_dir, "panel.json"), simplifyVector = FALSE)
cells <- do.call(rbind, lapply(names(panel$summary), function(k) {
  s <- panel$summary[[k]]
  p <- strsplit(k, "/")[[1]]
  data.frame(cell = p[1], backend = p[2], ms = s$median, n = s$n,
             host = panel$host$label, stringsAsFactors = FALSE)
}))
write.csv(cells, "results/paper/nogpu.csv", row.names = FALSE)
cat("wrote results/paper/nogpu.csv,", nrow(cells), "rows, from", panel_dir, "\n")

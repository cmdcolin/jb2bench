#!/usr/bin/env Rscript
# results/paper/webgpu-lite.csv from every laptop's `make webgpu-lite` run under
# results/webgpu-lite-100kb/<hostname>/: the cold load over the paper's 100 kb
# window in Firefox Nightly with WebGPU, WebGL 2 and Canvas 2D, one row per
# laptop, case and backend. `excluded` marks a cell the table prints as a dash:
# the Dell's 200x long-read cell splits into fast and slow runs in Firefox on
# every run (results/webgpu-lite-100kb/cdiesh-Precision-7540/NOTES.md).
#
#   Rscript scripts/paperfigs/webgpu-lite-data.R [results/webgpu-lite-100kb]

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = TRUE)
root <- if (length(args) >= 1) args[1] else "results/webgpu-lite-100kb"
EXCLUDED <- c("cdiesh-Precision-7540/200x-longread")
RUNG <- c(default = "WebGPU", webgl = "WebGL2", canvas2d = "Canvas2D")

machine_field <- function(lines, key) {
  hit <- grep(paste0("^", key, ": "), lines, value = TRUE)
  if (length(hit)) sub(paste0("^", key, ": "), "", hit[1]) else NA_character_
}

rows <- list()
for (dir in list.dirs(root, recursive = FALSE)) {
  file <- file.path(dir, "backends-firefox-100kb.json")
  if (!file.exists(file)) next
  machine <- readLines(file.path(dir, "machine.txt"))
  run <- fromJSON(file, simplifyVector = FALSE)
  for (case in names(run$results)) {
    for (backend in names(RUNG)) {
      cell <- run$results[[case]][[backend]]
      stopifnot(identical(cell$rung, RUNG[[backend]]))
      runs <- unlist(cell$runs)
      rows[[length(rows) + 1]] <- data.frame(
        host = basename(dir), cpu = machine_field(machine, "cpu"),
        os = machine_field(machine, "os"), firefox = machine_field(machine, "firefox"),
        build = run$build, date = run$stamp, case = case, backend = cell$rung,
        median_ms = cell$median, min_ms = min(runs), max_ms = max(runs),
        n = length(runs), load_max = max(unlist(cell$load)),
        excluded = paste0(basename(dir), "/", case) %in% EXCLUDED,
        stringsAsFactors = FALSE)
    }
  }
}
out <- do.call(rbind, rows)
write.csv(out, "results/paper/webgpu-lite.csv", row.names = FALSE)
cat("wrote results/paper/webgpu-lite.csv,", nrow(out), "rows from",
    length(unique(out$host)), "laptops\n")

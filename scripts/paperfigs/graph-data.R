#!/usr/bin/env Rscript
# Reduce the graph-view traces to the CSVs graph-macros.R reads:
#   results/paper/graph-windows.csv  hosted HPRC rGFA windows (scripts/gbz/hosted-windows.sh)
#   results/paper/pggb-windows.csv   pggb chrY windows (scripts/pggb/trace.sh, reference-steps.mjs)
#   results/paper/pggb-index.csv     the pggb chrY index build (scripts/pggb/index.sh)
# Each window gets the median of its runs to loaded (cutMs) and to drawn (drawnMs).
#
#   Rscript scripts/paperfigs/graph-data.R <hosted.jsonl> <pggb-windows.jsonl> \
#     <reference-steps.jsonl> <index.json>

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = TRUE)
hosted <- stream_in(file(args[1]), verbose = FALSE)
pggb <- stream_in(file(args[2]), verbose = FALSE)
steps <- stream_in(file(args[3]), verbose = FALSE)
index <- fromJSON(args[4])

reduce <- function(runs, keys) {
  groups <- unique(runs[keys])
  do.call(rbind, lapply(seq_len(nrow(groups)), function(i) {
    r <- merge(runs, groups[i, , drop = FALSE], by = keys)
    stopifnot(length(unique(r$nodes)) == 1)
    refused <- grepl("too large", r$error %||% rep("", nrow(r)))
    cbind(groups[i, , drop = FALSE],
          data.frame(runs = nrow(r), nodes = r$nodes[1], links = r$links[1],
                     requests = median(r$requests), MB = median(r$MB),
                     loadedS = median(r$cutMs) / 1000,
                     drawnS = if (any(refused)) NA else median(r$drawnMs) / 1000,
                     refused = any(refused),
                     build = paste(unique(r$appVersion), collapse = ","),
                     plugin = paste(unique(r$plugin), collapse = ","),
                     date = substr(min(r$date), 1, 10)))
  }))
}

dir.create("results/paper", showWarnings = FALSE)
g <- reduce(hosted, c("refName", "start", "end"))
write.csv(g[order(g$refName, g$start), ], "results/paper/graph-windows.csv", row.names = FALSE)
p <- reduce(pggb, c("start", "end"))
p <- merge(p, steps[c("start", "steps", "stepsDrawn", "laterPassSteps")], by = "start", all.x = TRUE)
write.csv(p[order(p$start), ], "results/paper/pggb-windows.csv", row.names = FALSE)
write.csv(data.frame(tool = index$tool, command = index$command, gfaBytes = index$gfaBytes,
                     nodes = index$nodes, links = index$links, seconds = index$seconds,
                     peakGB = index$peakGB, load = index$load, date = substr(index$date, 1, 10)),
          "results/paper/pggb-index.csv", row.names = FALSE)
cat("wrote results/paper/{graph-windows,pggb-windows,pggb-index}.csv:",
    nrow(g), "hosted and", nrow(p), "pggb windows\n")

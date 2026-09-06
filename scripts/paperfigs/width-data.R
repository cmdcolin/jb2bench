#!/usr/bin/env Rscript
# Extract the 1 Mb cold-load numbers into results/paper/width.csv.
#
# Split from the figure for the same reason perf-data.R is: redrawing a figure
# and re-reading a benchmark are separate acts, and the CSV is committed so a
# redraw never has to touch results/.
#
# This reads results/alignments-1mb.json, which is its own file rather than more
# rows in alignments.json — the wide arm shares no assembly, no window and no
# coverage ladder with the deep one. That is also why this reader exists at all:
# perf-data.R's READ_CASES is the deep arm's 20x/200x/1000x ladder, and a wide
# case fed through it labels as NA.
#
#   Rscript scripts/paperfigs/width-data.R [path-to-jb2bench]

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}
if (!dir.exists(file.path(bench, "results"))) {
  stop("no results/ under ", bench, "; pass the jb2bench path as an argument")
}

READ_CASES <- c("1mb-20x-shortread", "1mb-100x-shortread",
                "1mb-20x-longread", "1mb-100x-longread")
labels <- c("20x short read", "100x short read",
            "20x long read", "100x long read")

# Two arms, which is what the run measures. Release 4.3.0 sits between them and
# is not run at this window: it answers "what did that release change", and the
# question here is how a 1 Mb view scales at all.
BUILDS <- c("current" = "This work", "release-2.4.0" = "Release 2.4.0")
FORMATS <- c("bam" = "BAM", "cram" = "CRAM")

# The same gate jb2bench applies to its own tables and perf-data.R to the
# manuscript's: foreign cores, judged per ROW, since contention on one arm
# invalidates the pair rather than the point.
FOREIGN_MAX <- 0.5
contention_ok <- function(cell) {
  f <- cell$load$foreignCores
  is.null(f) || f <= FOREIGN_MAX
}

# Range of the replicate runs, not an SD: six runs of one cell say what was
# seen, and dressing them as a distribution claims more than that.
spread <- function(runs) {
  v <- unlist(runs)
  v <- v[!is.na(v)]
  if (length(v) < 2) c(lo = NA_real_, hi = NA_real_) else c(lo = min(v), hi = max(v))
}

results <- fromJSON(file.path(bench, "results", "alignments-1mb.json"),
                    simplifyVector = FALSE)$results

rows <- list()
dropped <- character()
for (i in seq_along(READ_CASES)) {
  for (fmt in names(FORMATS)) {
    key <- paste0(READ_CASES[i], "-", fmt)
    cell <- results[[key]]
    if (is.null(cell)) {
      stop("alignments-1mb.json has no cell for ", key,
           "; cases present: ", paste(names(results), collapse = ", "))
    }
    present <- names(BUILDS)[names(BUILDS) %in% names(cell)]
    ok <- all(vapply(present, function(b) contention_ok(cell[[b]]), logical(1)))
    if (!ok) dropped <- c(dropped, key)
    for (b in present) {
      s <- spread(cell[[b]]$runs)
      rows[[length(rows) + 1]] <- data.frame(
        case = labels[i], series = BUILDS[[b]], format = FORMATS[[fmt]],
        window = "1mb", ms = cell[[b]]$median, usable = ok, censored = FALSE,
        lo = unname(s["lo"]), hi = unname(s["hi"]),
        stringsAsFactors = FALSE)
    }
  }
}

if (length(dropped)) {
  cat("cells over the ", FOREIGN_MAX, " foreign-core ceiling, marked unusable: ",
      paste(dropped, collapse = ", "), "\n", sep = "")
}

out <- do.call(rbind, rows)
out$case <- factor(out$case, levels = labels)
dir.create(file.path("results", "paper"), showWarnings = FALSE, recursive = TRUE)
write.csv(out, "results/paper/width.csv", row.names = FALSE)
cat("wrote results/paper/width.csv,", nrow(out), "rows, from", bench, "\n")

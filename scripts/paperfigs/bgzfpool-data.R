#!/usr/bin/env Rscript
# Extract what the BGZF worker pool is worth into results/paper/bgzfpool.csv,
# from the two runs that measure it: the query on its own and the same query
# inside jbrowse.
#
# Split from the figure script for the same reason perf-data.R is: redrawing a
# figure and re-reading a benchmark stay separate acts, and the csv is committed
# so the figure redraws without touching results/.
#
#   Rscript scripts/paperfigs/bgzfpool-data.R [path-to-jb2bench]
#
# CHECK THE BLOB-WORKER COLUMN BEFORE TRUSTING A RUN. A pooled arm that spawned
# no `blob:` workers fell back to inflating in process, and the row then
# compares a thing with itself and reports ~1.00x. That failure is silent in
# every other column, so it is a gate here rather than a note.

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}

# The end-to-end arm needs a jbrowse-web built with the useBgzfWorkerPool config
# slot staged under builds/. Without that build there is no such run, and the
# standalone arm is still worth drawing on its own -- it is the ceiling the
# end-to-end number would be read against, and a one-series figure says so
# honestly where a missing figure says nothing.
e2e_path <- file.path(bench, "results/bgzfpool.json")
e2e <- if (file.exists(e2e_path)) {
  fromJSON(e2e_path, simplifyVector = FALSE)
} else {
  cat("no results/bgzfpool.json; drawing the standalone arm only\n")
  list(results = list())
}
alone <- fromJSON(file.path(bench, "results/bgzfpool-standalone.json"), simplifyVector = FALSE)

# Above this many foreign cores a timing is not comparable to one taken on a
# quiet box; the same ceiling scripts/render/loadavg.ts applies.
FOREIGN_CORE_CEILING <- 0.5

# Coverage is the axis for BAM and sample count is the axis for VCF, because
# those are the two things that grow the chunk a query resolves to. They are
# different units, so they are different panels rather than one axis with a
# label that would have to mean both.
describe <- function(track) {
  bam <- regmatches(track, regexec("^([0-9]+)x\\.(shortread|longread)\\.bam$", track))[[1]]
  vcf <- regmatches(track, regexec("^variants\\.pool\\.([0-9]+)\\.(wide|gtonly)\\.vcf\\.gz$", track))[[1]]
  if (length(bam)) {
    list(panel = if (bam[3] == "shortread") "BAM, short read" else "BAM, long read",
         x = as.numeric(bam[2]),
         xlab = paste0(bam[2], "×"))
  } else if (length(vcf)) {
    list(panel = if (vcf[3] == "wide") "Tabix VCF, full genotypes" else "Tabix VCF, genotypes only",
         x = as.numeric(vcf[2]),
         xlab = format(as.numeric(vcf[2]), big.mark = ","))
  } else {
    NULL
  }
}

rows <- list()
add <- function(track, series, speedup, lo, hi, n, usable, note, rounds = NA_integer_) {
  d <- describe(track)
  if (is.null(d)) {
    cat("skipping unrecognised track ", track, "\n", sep = "")
  } else {
    rows[[length(rows) + 1]] <<- data.frame(
      panel = d$panel, x = d$x, xlab = d$xlab, track = track, series = series,
      speedup = speedup, lo = lo, hi = hi, n = n, rounds = rounds,
      usable = usable, note = note, stringsAsFactors = FALSE)
  }
}

dropped <- character()
for (track in names(e2e$results)) {
  r <- e2e$results[[track]]
  foreign <- if (is.null(r$load$foreignCores)) NA_real_ else r$load$foreignCores
  # Two independent ways this row can be worthless, and neither shows up in the
  # ratio: the box was busy, or the pool never engaged.
  contended <- is.na(foreign) || foreign > FOREIGN_CORE_CEILING
  engaged <- r$blobWorkers$pooled > 0 && r$blobWorkers$plain == 0
  usable <- !contended && engaged
  note <- if (!engaged) "pool did not engage" else if (contended) "measured under external load" else ""
  if (!usable) {
    dropped <- c(dropped, paste0(track, " (", note, ")"))
  }
  add(track, "in jbrowse, end to end", r$median, r$p25, r$p75,
      length(r$ratios), usable, note)
}

for (track in names(alone$results)) {
  r <- alone$results[[track]]
  # A cell the renderer heap could not hold. It is recorded rather than absent,
  # so it is reported rather than quietly leaving a shorter line.
  if (!is.null(r$failed)) {
    dropped <- c(dropped, paste0(track, " (did not fit in the renderer heap)"))
    add(track, "query alone", NA_real_, NA_real_, NA_real_, 0, FALSE,
        "did not fit in the renderer heap")
    next
  }
  ratios <- unlist(r$ratios)
  # No contention gate here: this arm interleaves within one page and takes a
  # min over rounds, so drift shows as a wider spread rather than as a biased
  # ratio. The record-count check is the gate instead.
  usable <- !isTRUE(r$mismatched)
  if (!usable) {
    dropped <- c(dropped, paste0(track, " (arms returned different record counts)"))
  }
  # Rounds is per track, not per run: the heaviest cell does not survive as many
  # of them as the rest, so a cell taken over fewer has to say so rather than
  # sit in the table looking equally well sampled.
  add(track, "query alone", median(ratios), min(ratios), max(ratios),
      length(ratios), usable, if (usable) "" else "record count mismatch",
      rounds = length(r$rounds))
}

out <- do.call(rbind, rows)
dir.create("results/paper", showWarnings = FALSE, recursive = TRUE)
write.csv(out, "results/paper/bgzfpool.csv", row.names = FALSE)
cat("wrote results/paper/bgzfpool.csv (", nrow(out), " rows)\n", sep = "")
if (length(dropped)) {
  cat("marked unusable: ", paste(dropped, collapse = ", "), "\n", sep = "")
}
cat("libraries measured standalone: ",
    paste(names(alone$versions), unlist(alone$versions), sep = "@", collapse = " "), "\n", sep = "")

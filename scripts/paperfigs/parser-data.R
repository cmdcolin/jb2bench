#!/usr/bin/env Rscript
# Extract the parser timings the ecosystem figure plots, from jb2bench's
# recorded results into results/paper/parser.csv.
#
# Split from parser.R for the same reason perf-data.R is split from its figures:
# nothing measured is typed by hand, and parser.csv is committed, so the figure
# redraws from it without touching results/.
#
# Same run as results/paper/parser-speedup.tex, which report.ts writes from this
# same results/bench.json: the table is the ratio of the two arms, this is the
# two arms themselves.
#
#   Rscript scripts/paperfigs/parser-data.R [path-to-jb2bench]

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}
src <- file.path(bench, "ecosystem", "results", "bench.json")
if (!file.exists(src)) {
  stop("no ", src, "; run 'make bench' in ", file.path(bench, "ecosystem"))
}

d <- fromJSON(src, simplifyVector = FALSE)

# Group names carry the case: "bam 200x longread", "bgzf browser path 20x
# shortread". The prefix before the coverage token is the arm of the benchmark
# suite, which is not always the package name -- bbi's groups say "bigwig".
packages <- c(
  "bam" = "@gmod/bam",
  "cram" = "@gmod/cram",
  "bgzf browser path" = "@gmod/bgzf-filehandle",
  "bgzf node path" = "@gmod/bgzf-filehandle (node zlib)",
  "bigwig" = "@gmod/bbi"
)

# Groups whose prefix is not in `packages` are other arms of the same suite --
# jb2bench added a VCF sweep in 2026-08, keyed by sample count rather than by
# coverage, so it does not fit this figure's axes at all. They are skipped and
# NAMED, not silently dropped: `packages[[prefix]]` used to subscript-error on
# the first one, which at least failed loudly, and quietly ignoring them instead
# would hide a genuinely new measurement.
rows <- list()
skipped <- character()
for (f in d$files) {
  for (g in f$groups) {
    case <- sub(".*> ", "", g$fullName)
    prefix <- sub(" [0-9]+x .*", "", case)
    if (!prefix %in% names(packages)) {
      skipped <- unique(c(skipped, prefix))
      next
    }
    for (b in g$benchmarks) {
      rows[[length(rows) + 1]] <- data.frame(
        package = packages[[prefix]],
        coverage = as.numeric(sub(".*[^0-9]([0-9]+)x .*", "\\1", case)),
        reads = if (grepl("longread", case)) "long read" else "short read",
        # The suite names each arm with its version and which side it is, and
        # bgzf adds the codec it runs -- "v1.4.3 native zlib (2023)". The
        # version is what the facet strip prints; the side is what the colour
        # is, and it has to be read off the name rather than off the rank,
        # because rank is fastest-first and the point of a couple of the
        # bigwig rows is that the current release is the slower one.
        version = sub("^(v[0-9.]+).*", "\\1", b$name),
        arm = if (grepl("\\(2023\\)", b$name)) "2023" else "current",
        ms = as.numeric(b$mean),
        stringsAsFactors = FALSE
      )
    }
  }
}

out <- do.call(rbind, rows)
out <- out[order(out$package, out$reads, out$coverage, out$arm), ]
dir.create("generated", showWarnings = FALSE)
write.csv(out, "results/paper/parser.csv", row.names = FALSE)
cat("wrote results/paper/parser.csv,", nrow(out), "rows, from", src, "\n")
if (length(skipped)) {
  cat("suite arms this figure does not plot, skipped: ",
      paste(sort(skipped), collapse = ", "), "\n", sep = "")
}

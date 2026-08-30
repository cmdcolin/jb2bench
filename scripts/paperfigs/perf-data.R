#!/usr/bin/env Rscript
# Extract the measured numbers the performance figure plots, from jb2bench's
# recorded results into results/paper/perf.csv.
#
# Split from the figure scripts so that redrawing a figure and re-reading a
# benchmark stay separate acts: nothing measured is typed by hand, and perf.csv
# is committed, so a figure redraws from it without touching results/. This is
# the half that reads the JSON, and the only half a fresh run invalidates.
#
#   Rscript scripts/paperfigs/perf-data.R [path-to-jb2bench]
#
# CHECK THE LOAD BEFORE TRUSTING A RUN. Every cold-load cell in alignments.json
# records the machine's load average either side of it, and the paper already
# discards one row on that basis. The 2026-08-13 re-run of the cold-load sweep
# records loads of 7 to 27 in every cell and its values move by up to 54% against
# the run the manuscript's tables were built from, in the direction contention
# would move them, so it is not a refresh — it is the box. A run worth
# committing wants those numbers low and roughly equal across builds.

suppressPackageStartupMessages(library(jsonlite))

bench <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(bench)) {
  bench <- Sys.getenv("JB2BENCH", ".")
}
if (!dir.exists(file.path(bench, "results"))) {
  stop("no results/ under ", bench, "; pass the jb2bench path as an argument")
}

read_results <- function(f) fromJSON(file.path(bench, "results", f),
                                    simplifyVector = FALSE)

# Case order is coverage within read length, which is the order every table in
# the paper uses.
# Case ids are written out in full, format suffix included. jb2bench keys every
# result by `<coverage>-<readtype>-<format>`, and these panels plot BAM.
#
# They used to be spelled without the suffix and resolved through a fallback
# that tried the bare name and then `-bam`. That is the wrong kind of clever:
# which format the figure showed depended on what happened to be in the JSON,
# so the same script could silently plot BAM for one panel and a bare-keyed
# legacy row for another. Naming the format makes a missing key an error
# instead of a quiet substitution.
#
# CRAM is measured for every one of these cases too. The alignments and
# interaction readers stay BAM-only -- adding a format axis to either changes
# what those panels mean -- but the cold-load reader carries both, since
# `sync-benchmarks` covers a format capability, not a single file type.
FORMAT <- "bam"
READ_CASES <- c(
  "20x-shortread", "200x-shortread", "1000x-shortread",
  "20x-longread", "200x-longread", "1000x-longread"
)
cases <- paste(READ_CASES, FORMAT, sep = "-")
labels <- c(
  "20x short read", "200x short read", "1000x short read",
  "20x long read", "200x long read", "1000x long read"
)

rows <- list()
# `session` records which benchmark run a number came from, and it is what the
# cold-load figure selects on. Cold load is measured twice, in two harnesses on
# two dates: the version sweep interleaves four JBrowse builds, and the
# cross-tool run interleaves three of them with igv.js. The same build differs
# between the two by up to 40%, so a number from one and a number from the other
# are not a fair pair, and a figure drawing both has to say which is which. The
# cold-load figure draws the cross-tool session alone instead.
add <- function(panel, case, series, ms, usable = TRUE, session = NA, format = "BAM",
                window = NA, censored = FALSE) {
  # Format-agnostic: `case` carries whichever suffix its own JSON key does
  # (alignments/interaction are always "-bam"; cold load's cross-tool loop
  # passes both), and only READ_CASES -- stripped of the format suffix and of
  # the `@window` the cross-tool keys carry since 2026-08-29 -- is the label key.
  base <- sub("-(bam|cram)$", "", sub("@.*$", "", case))
  rows[[length(rows) + 1]] <<- data.frame(
    panel = panel, case = labels[match(base, READ_CASES)],
    series = series, ms = ms, usable = usable, session = session, format = format,
    window = window, censored = censored,
    stringsAsFactors = FALSE
  )
}

# Shared by all three readers. Cold load gained the format suffix on
# 2026-08-16 and zoom/pan on 2026-08-23, and when only the cold-load reader
# knew about it, refreshing this file died on the interaction keys.
cell_for <- function(results, case, what) {
  cell <- results[[case]]
  if (is.null(cell)) {
    stop(what, " has no cell for ", case,
         "; cases present: ", paste(names(results), collapse = ", "))
  }
  cell
}

# Contention is judged by FOREIGN CPU, matching jb2bench's own verdict, and no
# longer by the load average. The load average counts the benchmark's own
# threads, so a heavy cell inflates it by working: 1000x-shortread-bam on
# v2.4.0 drove the 1-min average from 2.1 to 10.3 by itself on an idle box.
# Under the old 4.0 ceiling this script dropped clean rows -- including the
# largest speedup in the table -- as "too loaded to quote".
#
# Rows recorded before 2026-08-23 carry no foreignCores and fall back to the
# load rule, which errs toward calling a clean row dirty. That is the safe
# direction for a figure to be wrong in.
FOREIGN_MAX <- 0.5
LOAD_MAX <- 4.0
contention_ok <- function(cell) {
  f <- cell$load$foreignCores
  if (!is.null(f)) return(f <= FOREIGN_MAX)
  l <- unlist(cell$load)
  is.null(l) || max(l, na.rm = TRUE) <= LOAD_MAX
}

# The zoom and pan cells are held to the same gate as the cold-load ones.
#
# They were not, until 2026-08-25: `add()` defaults `usable = TRUE` and this
# loop never passed anything else, so every interaction point entered the figure
# marked clean no matter what the box had been doing. interaction.json is the
# one file in jb2bench that most needs the gate -- five of its cells sit above
# the ceiling, and the contention is ASYMMETRIC between the two arms of a row.
# `1000x-shortread-bam / pan` is the case: 0.79 foreign cores on this work
# against 1.91 on release 4.3.0, of which 1.46 was a tsc running during the
# measurement. A ratio taken across that pair flatters this work, which is the
# direction a figure must never be quietly wrong in.
#
# `published` is release-2.4.0, read the same way cold load reads it: not every
# interaction.json carries it (the region-keyed marker detector it needs is
# newer than the file format), so it is left absent rather than guessed at.
interaction <- read_results("interaction.json")$results
contended <- character()
sides <- c(new = "This work", baseline = "Release 4.3.0", published = "Release 2.4.0")
for (c in cases) {
  for (mode in c("in", "pan")) {
    panel <- if (mode == "in") "Zoom in, within loaded data" else "Pan, both refetch"
    cell <- cell_for(interaction, c, "interaction.json")
    present <- names(sides)[vapply(names(sides), function(s) !is.null(cell[[mode]][[s]]), logical(1))]
    # Per ROW, not per point: a point is only comparable to the one beside it,
    # so one dirty arm marks both. This mirrors the cold-load gate above, which
    # holds the published pair together for the same reason.
    ok <- all(vapply(present, function(s) contention_ok(cell[[mode]][[s]]), logical(1)))
    if (!ok) contended <- c(contended, paste0(c, "/", mode))
    for (side in present) {
      add(panel, c, sides[[side]], cell[[mode]][[side]]$zoomTimeToContentMs,
          usable = ok, session = "interaction")
    }
  }
}
if (length(contended)) {
  cat("interaction cells over the ", FOREIGN_MAX, " foreign-core ceiling, ",
      "marked unusable: ", paste(contended, collapse = ", "), "\n", sep = "")
}

alignments <- read_results("alignments.json")$results
# All four builds, not two. The sweep measures current against 4.3.0, 4.1.15 and
# 2.4.0 interleaved in one session, and taking only the first two threw away half
# of what was measured -- and with it the question a reader actually has, which
# is how far back the comparison holds.
builds <- c("current" = "This work",
            "release-4.3.0" = "Release 4.3.0",
            "release-4.1.15" = "Release 4.1.15",
            "release-2.4.0" = "Release 2.4.0")
# Nothing is excluded by name any more. `1000x-longread` was hardcoded here
# because it had never been measured on a quiet box; it now is, and it carries
# the largest speedup in the table, so a hand-maintained exclusion list was
# about to drop the best result on the strength of a stale comment.
unusable_cold <- character()  # ids here must carry the format suffix too
loaded <- character()
for (c in cases) {
  cell <- cell_for(alignments, c, "alignments.json")
  # The row gate stays on the pair the published ratio is built from, so adding
  # the two older builds cannot flip a row the table already calls usable. Each
  # build is then held to its own cell on top of that.
  ok <- !(c %in% unusable_cold) &&
    all(vapply(c("current", "release-4.3.0"),
               function(s) contention_ok(cell[[s]]), logical(1)))
  if (!ok && !(c %in% unusable_cold)) loaded <- c(loaded, c)
  for (build in names(builds)) {
    # release-2.4.0 does not have every case. An absent run is left absent
    # rather than carried as a zero or a guess.
    if (!is.null(cell[[build]])) {
      add("Cold load", c, builds[[build]], cell[[build]]$median,
          usable = ok && contention_ok(cell[[build]]),
          session = "version sweep")
    }
  }
}
if (length(loaded)) {
  cat("cold load over the ", LOAD_MAX, " load gate, marked unusable: ",
      paste(loaded, collapse = ", "), "\n", sep = "")
}

# The cross-tool run measures three JBrowse builds and igv.js interleaved in one
# session, so every arm of a row is comparable with every other arm of it. That
# is why the cold-load figure is drawn from this file alone rather than from both
# runs at once: the version sweep above uses a different instrument on a
# different day, the same build differs between the two by up to 40%, and a
# figure that drew both had to distinguish them by linetype and ask the reader
# to keep the distinction in mind while reading everything else off it.
#
# The sweep's rows are still written -- the manuscript's initial-render table is
# built from them, and they carry release 4.1.15, which no other run does.
crosstool <- read_results("crosstool.json")$rows
# GenomeSpy and Gosling join igv.js as comparators in the run of 2026-08-29.
# They are the more informative pair for a render claim and the harder one:
# GenomeSpy decodes BAM through the same `@gmod/bam` this work does, so a
# GenomeSpy column largely isolates the render path rather than the parser.
xt_builds <- c("jbrowse" = "This work",
               "jbrowse-release-4.3.0" = "Release 4.3.0",
               "jbrowse-release-2.4.0" = "Release 2.4.0",
               "igv" = "igv.js 3.8.5",
               "genomespy" = "GenomeSpy 0.85.0",
               "gosling" = "Gosling 1.0.7")
# Both formats: the version sweep above is BAM-only because that reader has
# always meant BAM, but cross-tool's own JSON keys every case by format
# already, so the only change here is not throwing CRAM's half away.
FORMATS <- c("bam" = "BAM", "cram" = "CRAM")
# Every cross-tool key names its window as well as its format, since the run
# that added GenomeSpy and Gosling added a second window with them. Both are
# extracted and the figure chooses; reading only the narrow one here would
# throw away half of what the run measured.
WINDOWS <- c("19kb", "100kb")
for (base in READ_CASES) {
  for (fmt in names(FORMATS)) {
    for (win in WINDOWS) {
      key <- sprintf("%s-%s@%s", base, fmt, win)
      ct <- cell_for(crosstool, key, "crosstool.json")
      # This harness records one load reading per row, shared by every arm, so a
      # row's gate and its cells' gates are the same test.
      for (b in names(xt_builds)) {
        arm <- ct[[b]]
        if (is.null(arm)) next
        # A capability limit is not a timing. Neither GenomeSpy nor Gosling
        # reads CRAM, and Gosling's BAM fetcher declines a tile wider than
        # 20 kb, so those cells carry `unsupported` and no median. They leave
        # no point behind: a page that draws nothing settles immediately, and
        # timing it would make the tool that cannot render the window the
        # fastest thing in the panel.
        if (!is.null(arm$unsupported)) next
        # An arm that never settled records the ceiling it was abandoned at
        # rather than a median. That is a lower bound, not a measurement, so it
        # travels with a flag and the figure draws it as one.
        censored <- is.null(arm$median)
        ms <- if (censored) arm$unsettled else arm$median
        if (is.null(ms)) next
        add("Cold load", key, xt_builds[[b]], ms,
            usable = contention_ok(arm), session = "cross-tool",
            format = FORMATS[[fmt]], window = win, censored = censored)
      }
    }
  }
}

out <- do.call(rbind, rows)
out$case <- factor(out$case, levels = labels)
dir.create("generated", showWarnings = FALSE)
write.csv(out, "results/paper/perf.csv", row.names = FALSE)
cat("wrote results/paper/perf.csv,", nrow(out), "rows, from", bench, "\n")

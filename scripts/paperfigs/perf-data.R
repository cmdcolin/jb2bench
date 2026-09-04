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

# The spread behind a plotted median, as the RANGE of the replicate runs.
#
# Range and not a standard deviation or an interval, because every one of these
# cells is three runs. An SD over n=3 is a number with no useful precision and a
# 95% interval over n=3 is worse -- both would dress three measurements as a
# distribution. The range says exactly what was seen and claims nothing else,
# and the figures label it as what it is.
#
# What is NOT a replicate here: the five steps inside one run. A zoom step
# halves the width again each time, so those five are five different workloads
# and their spread is the sweep, not the error. Only the run-to-run values are
# repeats of the same thing, which is why these read `runs` and never `steps`.
spread <- function(runs) {
  v <- unlist(runs)
  v <- v[!is.null(v) & !is.na(v)]
  if (length(v) < 2) c(lo = NA_real_, hi = NA_real_)
  else c(lo = min(v), hi = max(v))
}

# `session` records which benchmark run a number came from, and it is what the
# cold-load figure selects on. Cold load is measured twice, in two harnesses on
# two dates: the version sweep interleaves four JBrowse builds, and the
# cross-tool run interleaves three of them with igv.js. The same build differs
# between the two by up to 40%, so a number from one and a number from the other
# are not a fair pair, and a figure drawing both has to say which is which. The
# cold-load figure draws the cross-tool session alone instead.
#
# `runs` is the replicate values behind `ms`, and the caller passes whichever
# array the median it is adding was taken over. Absent for a cell with no
# repeats, which is the honest answer for the interaction session: it is one run
# of five steps, so it has a sweep and no error.
add <- function(panel, case, series, ms, usable = TRUE, session = NA, format = "BAM",
                window = NA, censored = FALSE, metric = NA, runs = NULL) {
  # Format-agnostic: `case` carries whichever suffix its own JSON key does
  # (alignments/interaction are always "-bam"; cold load's cross-tool loop
  # passes both), and only READ_CASES -- stripped of the format suffix and of
  # the `@window` the cross-tool keys carry since 2026-08-29 -- is the label key.
  base <- sub("-(bam|cram)$", "", sub("@.*$", "", case))
  s <- spread(runs)
  rows[[length(rows) + 1]] <<- data.frame(
    panel = panel, case = labels[match(base, READ_CASES)],
    series = series, ms = ms, usable = usable, session = session, format = format,
    window = window, censored = censored, metric = metric,
    lo = unname(s["lo"]), hi = unname(s["hi"]),
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
          session = "version sweep", runs = cell[[build]]$runs)
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
            format = FORMATS[[fmt]], window = win, censored = censored,
            runs = if (censored) NULL else arm$runs)
      }
    }
  }
}

# The cross-tool motion runs, zoom and pan: the same harness and the same arms
# as the cold load above, against an application that is already up.
#
# Kept apart from interaction.json rather than merged into its panels. That file
# reads 0 ms for this work on a zoom where this one reads 507, for the same
# build and the same motion: its marker fires before the 500 ms
# `LGVCoarseDynamicBlocks` debounce and the draw-and-network detector here waits
# the debounce out. Two instruments measuring two quantities, so a panel holding
# both would be comparing neither -- the same reason the cold-load figure draws
# one session and not two.
#
# TWO METRICS PER CELL, because a wait is not a render time even when it is
# short. Until 2026-09-04 a JBrowse zoom step came back at a flat ~505 ms at
# every coverage -- the LGVCoarseDynamicBlocks throttle and not work -- around
# well under a millisecond of drawing; taking the discrete navigation path left
# 7-30 ms of wait around 1-2 ms of drawing. The ratio collapsed but the two are
# still different numbers, and publishing either alone as a render time is a
# mistake this repo made once and retracted. So both travel, and the figures
# draw them side by side.
#
# Pan's waiting figure is `fetchedMedian` -- the steps on which the tool went to
# the network -- rather than the median over all five steps. This work serves
# three of five from data it already holds and igv.js serves none, so a median
# over every step prices residency twice: once by being fast on a step, and
# again by not fetching on it. Zoom needs no such choice, since no arm issued a
# single request on any zoom step.
MOTIONS <- c("crosstool-zoom.json" = "Zoom in, both hold the data",
             "crosstool-pan.json" = "Pan, both refetch")
MOTION_WAIT <- c("crosstool-zoom.json" = "median",
                 "crosstool-pan.json" = "fetchedMedian")
# The per-run values behind each of those, so an error bar is the spread of the
# statistic actually plotted. `fetchedRuns` and `drawRuns` were added to
# panrunner.ts on 2026-09-03 and are absent from runs recorded before it; those
# cells get no bar rather than a bar borrowed from a different statistic.
MOTION_RUNS <- c("crosstool-zoom.json" = "runs",
                 "crosstool-pan.json" = "fetchedRuns")
# A motion recorded before the benchmark took the discrete navigation path is
# not comparable with one recorded after it. Driven through the bare per-frame
# chokepoint, a JBrowse step timed the 500ms LGVCoarseDynamicBlocks throttle
# coalescing a gesture that never arrived -- a flat ~507ms at every coverage,
# against 7-8ms once the step ends with settleCoarseBlocks the way a UI control
# does. Mixing the two in one CSV puts a timer and a redraw in the same column.
#
# Detected from the data rather than from a date: panrunner.ts began recording
# `settlesCoarseBlocks` in the same commit that fixed the drive, so a motion
# whose arms all lack the field predates the fix.
predates_discrete_drive <- function(rows) {
  for (cell in rows) {
    for (arm in cell) {
      if (is.list(arm) && !is.null(arm$settlesCoarseBlocks)) return(FALSE)
    }
  }
  TRUE
}

for (f in names(MOTIONS)) {
  motion <- read_results(f)$rows
  if (predates_discrete_drive(motion)) {
    cat("skipping ", f, ": recorded before the discrete-drive fix, so its ",
        "JBrowse arms time a throttle rather than a redraw. Re-run it to ",
        "put it back in the figures.\n", sep = "")
    next
  }
  for (base in READ_CASES) {
    key <- paste0(base, "-", FORMAT)
    cell <- cell_for(motion, key, f)
    present <- names(xt_builds)[names(xt_builds) %in% names(cell)]
    # Per row, as everywhere else here: a contended arm invalidates the pair it
    # is compared against and not only itself. These runs predate foreignCores,
    # so contention_ok falls back to the load rule, which errs toward calling a
    # clean row dirty.
    ok <- all(vapply(present, function(b) contention_ok(cell[[b]]), logical(1)))
    for (b in present) {
      arm <- cell[[b]]
      wait <- arm[[MOTION_WAIT[[f]]]]
      if (!is.null(wait)) {
        add(MOTIONS[[f]], key, xt_builds[[b]], wait, usable = ok,
            session = "cross-tool motion", metric = "what the user waits",
            runs = arm[[MOTION_RUNS[[f]]]])
      }
      if (!is.null(arm$drawMedian)) {
        add(MOTIONS[[f]], key, xt_builds[[b]], arm$drawMedian, usable = ok,
            session = "cross-tool motion", metric = "what the renderer did",
            runs = arm$drawRuns)
      }
    }
  }
}

out <- do.call(rbind, rows)
out$case <- factor(out$case, levels = labels)
dir.create("generated", showWarnings = FALSE)
write.csv(out, "results/paper/perf.csv", row.names = FALSE)
cat("wrote results/paper/perf.csv,", nrow(out), "rows, from", bench, "\n")

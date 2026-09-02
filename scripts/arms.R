# The arms every figure in this repo draws, named and coloured in one place.
#
# Sourced by scripts/paperfigs/common.R. It used to be two lists that drifted:
# the render figures ran v2.4.0/v4.1.15/v4.3.0/current with no igv column at all,
# and the cross-tool figures ran current-against-igv with no older JBrowse. A
# reader comparing two figures from the same run was comparing two different sets
# of programs.
#
# Its two consumers -- scripts/render/charts.R and scripts/crosstool/panchart.R --
# were deleted on 2026-09-02, so the arm naming and colouring below (ARM_BUILD,
# ARM_COL, arm_label, arm_levels, arm_colours) and paper_fig() have no caller
# left. They are kept because the runs' JSON still records the tool ids they
# decode, and a figure drawn from that JSON again would need them; what the
# paperfigs scripts use is the formatting half further down -- fmt_time,
# fmt_ratio, fmt_slower, endpoint_labels and the type sizes.
#
# Five arms, and the reason for each:
#
#   v2.4.0        what the 2023 Genome Biology paper benchmarked as "jb2 parallel",
#                 and therefore the version a reader has already seen numbers for.
#   v4.3.0        the last release, so "has it regressed since the last thing I
#                 installed" has an answer.
#   5.0.0 (main)  the build under test. jbrowse-components main at the time of
#                 measurement, which reports package version 4.3.0 and is the tree
#                 v5.0.0 is cut from -- there is no v5.0.0 tag yet, and the label
#                 says (main) so nobody quotes it as a shipped release.
#   igv.js        the other tool. One outside comparison is worth more than three
#                 more of our own versions.
#   GenomeSpy     the other other tool, and the one whose BAM path is closest to
#                 comparable: it decodes through @gmod/bam like this repo, where
#                 igv.js does not. Cold load only -- it is not in the zoom/pan
#                 JSON panchart.R reads, so it cannot appear in those figures.
#
# v4.1.15 was an arm until 2026-08-24 and is not any more. It sat between two
# releases and moved no conclusion; the column it occupied is igv's now.
#
# Gosling is deliberately not an arm. Its BAM fetcher declines a tile wider than
# 20kb, so the 100kb window has no stock cell at all, and the "patched" arm that
# raises the cap reads a whole tile rather than the requested window -- an upper
# bound, not a result comparable to the other four. results/crosstool.md keeps
# both columns; a chart with fixed arms is the wrong place for a comparator that
# needs its own caveat on every cell.

# Build directory -> arm label. The key is the directory under builds/, which is
# what resolveBuild() records, so a figure cannot be labelled with a version that
# is not the one that was served.
ARM_BUILD <- c(
  "release-2.4.0"  = "v2.4.0 (2023 paper)",
  "release-4.3.0"  = "v4.3.0",
  "current"        = "5.0.0 (main)"
)

# Not a build directory -- GenomeSpy is measured once, not staged per version --
# so it gets its own constant rather than a slot in ARM_BUILD. The version is
# written here rather than read from the run because crosstool.json does not
# record one for it the way it does igvVersion; scripts/crosstool/runner.ts and
# scripts/paperfigs/common.R's PERF_SERIES both hardcode "0.85.0" for the same
# reason.
GENOMESPY_LABEL <- "GenomeSpy 0.85.0"

# Oldest to newest, so a legend reads as a timeline and the other tools sit at
# the end rather than in the middle of our own history.
ARM_LEVELS <- c(unname(ARM_BUILD), "igv.js", GENOMESPY_LABEL)

ARM_COL <- c(
  "v2.4.0 (2023 paper)" = "#c1462f",
  "v4.3.0"              = "#6a7fa8",
  "5.0.0 (main)"        = "#12796e",
  "igv.js"              = "#7a5ea8",
  "GenomeSpy 0.85.0"    = "#d4a017"
)

#' Label a recorded tool id.
#'
#' JBrowse arms are `jbrowse` (the build under test) or `jbrowse-<build>`; the
#' igv arms are `igv` and `igv-deep`. `under_test` is the build directory port
#' 8000 served, which is the only way to know what the bare `jbrowse` id meant.
#' `genomespy` is cold-load only -- panchart.R's zoom/pan JSON has no such key,
#' so this branch is simply never reached there. `gosling` falls through to
#' NA_character_ on purpose; see the header comment for why it stays out.
arm_label <- function(tool_id, under_test, igv_version = NULL) {
  igv_name <- if (is.null(igv_version)) "igv.js" else paste("igv.js", igv_version)
  vapply(tool_id, function(id) {
    if (id == "igv") return(igv_name)
    if (id == "genomespy") return(GENOMESPY_LABEL)
    if (id == "jbrowse") return(unname(ARM_BUILD[under_test]) %||% NA_character_)
    if (startsWith(id, "jbrowse-")) {
      return(unname(ARM_BUILD[sub("^jbrowse-", "", id)]) %||% NA_character_)
    }
    NA_character_
  }, character(1), USE.NAMES = FALSE)
}

# Levels carrying the measured igv version, so the legend says 3.8.5 rather than
# leaving a reader to find it in the prose. GenomeSpy has no equivalent
# per-run version to splice in -- see GENOMESPY_LABEL.
arm_levels <- function(igv_version = NULL) {
  c(unname(ARM_BUILD), if (is.null(igv_version)) "igv.js" else paste("igv.js", igv_version),
    GENOMESPY_LABEL)
}

arm_colours <- function(igv_version = NULL) {
  v <- ARM_COL
  if (!is.null(igv_version)) {
    names(v)[names(v) == "igv.js"] <- paste("igv.js", igv_version)
  }
  v
}

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a)) b else a

# Type and stroke sizes every figure draws its data with. geom_text sizes are
# in mm, so points are converted through ggplot2's .pt.
POINT_LABEL <- 10 / .pt
ENDPOINT_LABEL <- 12 / .pt
LINE_W <- 0.9
POINT_S <- 2.3

# Durations in the unit a person would say out loud -- 10 ms, 1 s, 1 min --
# rather than a bare number a reader has to convert.
fmt_time <- function(s) {
  n <- function(x) trimws(formatC(x, format = "fg", digits = 2, drop0trailing = TRUE))
  ifelse(is.na(s), "",
  ifelse(s < 0.9995, paste0(round(s * 1000), " ms"),
  ifelse(s < 9.95,   paste0(n(round(s, 1)), " s"),
  ifelse(s < 59.5,   paste0(round(s), " s"),
  ifelse(s < 3540,   paste0(n(round(s / 60, 1)), " min"),
                     paste0(n(round(s / 3600, 1)), " h"))))))
}

fmt_ratio <- function(r) ifelse(r < 9.95, sprintf("%.1f×", r),
                                sprintf("%s×", trimws(format(round(r), big.mark = ","))))

# The endpoint label every comparator carries: its time divided by the build
# under test at the same cell. A comparator that came in under the reference
# says so rather than printing "0.8× slower".
fmt_slower <- function(r) ifelse(r >= 1, paste(fmt_ratio(r), "slower"),
                                 paste(fmt_ratio(1 / r), "faster"))

# The same thing for a panel that cannot spare the word. "9.5x slower" is three
# times the width of "9.5x", and in a cell where four series end within a decade
# of each other that width is the difference between four labels the repel
# solver can separate and four it cannot -- it settles them on top of one
# another and the numbers are unreadable, which is worse than terse. The
# direction moves to the figure's caption, which says it once for every cell.
# "faster" stays spelled out: it is the exception, and a bare ratio in the
# unexpected direction reads as the expected one.
fmt_slower_terse <- function(r) ifelse(r >= 1, fmt_ratio(r),
                                       paste(fmt_ratio(1 / r), "faster"))

#' The last measured point of every series in a cell, with its ratio to the
#' reference series at that same point.
#'
#' `cell` names the columns that identify a panel, `x` the sweep, `y` the
#' measurement and `series` the arm. Rows for the reference arm get its time as
#' their label; every other arm gets fmt_slower. A series whose endpoint has no
#' reference measurement at the same x gets no label at all, since a ratio
#' against a cell nobody measured is not a ratio.
endpoint_labels <- function(df, cell, x, y, series, reference,
                            ratio = fmt_slower) {
  key <- function(d) do.call(paste, c(d[c(cell, x)], sep = "|"))
  ref <- df[df[[series]] == reference, ]
  ord <- df[order(-df[[x]]), ]
  ends <- ord[!duplicated(ord[c(cell, series)]), ]
  ends$ref_y <- ref[[y]][match(key(ends), key(ref))]
  ends$label <- ifelse(ends[[series]] == reference, fmt_time(ends[[y]]),
                       paste0(fmt_time(ends[[y]]), "\n", ratio(ends[[y]] / ends$ref_y)))
  ends[!is.na(ends$ref_y) & is.finite(ends[[y]]), ]
}

is_endpoint <- function(df, ends, cell, x, series) {
  key <- function(d) do.call(paste, c(d[c(cell, x, series)], sep = "|"))
  key(df) %in% key(ends)
}

#' Save a figure for a paper: no title, no subtitle, no caption.
#'
#' Every figure here used to carry its provenance inside the image -- what was
#' measured, when, on what, and which caveats travel with it. That was right
#' while the figures were the deliverable and a slide might quote one out of
#' context. It is wrong once the figures go into a paper, which gives each one a
#' real caption and where a title baked into the raster competes with it.
#'
#' So the prose is not deleted, it is moved: this writes it to a `.txt` beside
#' the `.png`, which is the text to draw a caption from. A figure whose caveats
#' exist nowhere is how "not quotable at 2.32 foreign cores" becomes a number in
#' a table with no asterisk.
paper_fig <- function(p, path, width, height, dpi = 200) {
  lab <- tryCatch(p@labels, error = function(e) p$labels)
  side <- sub("\\.png$", ".txt", path)
  writeLines(
    c(
      paste0("# ", basename(path)),
      "",
      "Text that used to be drawn inside the figure. Written here so a paper",
      "caption can be built from it and so the caveats survive the image.",
      "",
      if (!is.null(lab$title)) c("## title", "", lab$title, "") else NULL,
      if (!is.null(lab$subtitle)) c("## subtitle", "", lab$subtitle, "") else NULL,
      if (!is.null(lab$caption)) c("## caveats", "", lab$caption, "") else NULL
    ),
    side
  )
  ggsave(path, p + labs(title = NULL, subtitle = NULL, caption = NULL),
         width = width, height = height, dpi = dpi)
}

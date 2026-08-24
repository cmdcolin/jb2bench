# The arms every figure in this repo draws, named and coloured in one place.
#
# Sourced by scripts/render/charts.R and scripts/crosstool/panchart.R. It used to
# be two lists that drifted: the render figures ran v2.4.0/v4.1.15/v4.3.0/current
# with no igv column at all, and the cross-tool figures ran current-against-igv
# with no older JBrowse. A reader comparing two figures from the same run was
# comparing two different sets of programs.
#
# Four arms, and the reason for each:
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
#
# v4.1.15 was an arm until 2026-08-24 and is not any more. It sat between two
# releases and moved no conclusion; the column it occupied is igv's now.

# Build directory -> arm label. The key is the directory under builds/, which is
# what resolveBuild() records, so a figure cannot be labelled with a version that
# is not the one that was served.
ARM_BUILD <- c(
  "release-2.4.0"  = "v2.4.0 (2023 paper)",
  "release-4.3.0"  = "v4.3.0",
  "current"        = "5.0.0 (main)"
)

# Oldest to newest, so a legend reads as a timeline and the other tool sits at
# the end rather than in the middle of our own history.
ARM_LEVELS <- c(unname(ARM_BUILD), "igv.js")

ARM_COL <- c(
  "v2.4.0 (2023 paper)" = "#c1462f",
  "v4.3.0"              = "#6a7fa8",
  "5.0.0 (main)"        = "#12796e",
  "igv.js"              = "#7a5ea8"
)

#' Label a recorded tool id.
#'
#' JBrowse arms are `jbrowse` (the build under test) or `jbrowse-<build>`; the
#' igv arms are `igv` and `igv-deep`. `under_test` is the build directory port
#' 8000 served, which is the only way to know what the bare `jbrowse` id meant.
arm_label <- function(tool_id, under_test, igv_version = NULL) {
  igv_name <- if (is.null(igv_version)) "igv.js" else paste("igv.js", igv_version)
  vapply(tool_id, function(id) {
    if (id == "igv") return(igv_name)
    if (id == "jbrowse") return(unname(ARM_BUILD[under_test]) %||% NA_character_)
    if (startsWith(id, "jbrowse-")) {
      return(unname(ARM_BUILD[sub("^jbrowse-", "", id)]) %||% NA_character_)
    }
    NA_character_
  }, character(1), USE.NAMES = FALSE)
}

# Levels carrying the measured igv version, so the legend says 3.8.5 rather than
# leaving a reader to find it in the prose.
arm_levels <- function(igv_version = NULL) {
  c(unname(ARM_BUILD), if (is.null(igv_version)) "igv.js" else paste("igv.js", igv_version))
}

arm_colours <- function(igv_version = NULL) {
  v <- ARM_COL
  if (!is.null(igv_version)) {
    names(v)[names(v) == "igv.js"] <- paste("igv.js", igv_version)
  }
  v
}

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a)) b else a

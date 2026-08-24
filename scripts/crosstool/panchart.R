#!/usr/bin/env Rscript
# The interaction figure: what a zoom and a pan cost, across four arms.
#
# Drawn from results/crosstool-pan.json and results/crosstool-zoom.json so a
# slide cannot quote a number no run produced -- the rule scripts/render/charts.R
# and ecosystem/report.ts both follow.
#
#   results/figures/interaction.png       time to content, zoom and pan
#   results/figures/zoom-redraw.png       the zoom with the waiting taken out
#
# Two things this file used to draw and does not any more, both removed on
# 2026-08-24:
#
#   Canvas draw calls per step. It was the sturdiest measurement here -- it
#   repeats to within 1% because it depends on the data and the code rather than
#   the machine -- and it was still a bad figure. A batched renderer issues a
#   fixed handful of GPU draws whatever the depth, so the JBrowse series was a
#   flat line at 50 by construction, against igv at a quarter of a million. That
#   is a description of which drawing API each tool calls, not a result either
#   earned, and a log axis spanning four decades made it look like the headline.
#   The counts are still recorded, still in results/crosstool-pan.md, and still
#   doing the two jobs that need them: separating a cache hit from an abandoned
#   step, and controlling for downsampling.
#
#   "did not complete" crosses at the end of a series. Where a cell has no
#   number the series simply stops, and results/crosstool-pan.md says in prose
#   what was diagnosed -- igv.js at 1000x long read reaches 2.3 GB of renderer
#   heap. A cross drawn at a neighbouring cell's height invited the reader to
#   read a position off it, which was never a measurement.
suppressPackageStartupMessages({
  library(jsonlite)
  library(ggplot2)
  library(dplyr)
  library(tidyr)
  library(scales)
})

source("scripts/arms.R")
dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)

# A cell the run could not measure has null for its medians, and `as.numeric` of
# NULL is a zero-length vector rather than NA -- which makes data.frame() fail
# with "arguments imply differing number of rows" instead of carrying a gap.
num1 <- function(x) if (is.null(x) || length(x) == 0) NA_real_ else as.numeric(x)

read_motion <- function(path, motion) {
  if (!file.exists(path)) return(NULL)
  d <- fromJSON(path, simplifyVector = FALSE)
  under_test <- d$jbrowseBuilds$jbrowse %||% d$jbrowseBuild
  igv_v <- d$igvVersion
  rows <- list()
  for (case_id in names(d$rows)) {
    parts <- strsplit(case_id, "-", fixed = TRUE)[[1]]
    for (tool_id in names(d$rows[[case_id]])) {
      lab <- arm_label(tool_id, under_test, igv_v)
      # igv-deep and the height controls are controls, not arms. They belong in
      # the table that discusses them, not in a figure with four series.
      if (is.na(lab)) next
      cell <- d$rows[[case_id]][[tool_id]]
      fetched <- cell$fetchedMedian
      rows[[length(rows) + 1]] <- data.frame(
        motion = motion,
        case = case_id,
        coverage = as.numeric(sub("x$", "", parts[1])),
        read = if (parts[2] == "shortread") "short reads" else "long reads",
        format = if (length(parts) >= 3 && parts[3] == "cram") "CRAM" else "BAM",
        arm = lab,
        # On a pan the comparable number is the median over steps that fetched:
        # JBrowse reads in 256 KiB blocks, so some of its pan steps are served
        # from what it already holds, and averaging a cache hit into a fetch is
        # how a benchmark ends up calling the difference "rendering". On a zoom
        # nothing is supposed to fetch, so every step counts.
        ms = if (motion == "Zoom in" || is.null(fetched)) num1(cell$median) else num1(fetched),
        cached_only = motion == "Pan" && is.null(fetched),
        draw_ms = num1(cell$drawMedian),
        # Median main-thread draws per step. A handful of calls means the arm
        # rasterized somewhere this instrument cannot see -- see main_thread below.
        draws = {
          dd <- unlist(cell$drawsPerStep)
          if (length(dd)) stats::median(dd) else NA_real_
        },
        refetched = num1(cell$requests) > 0,
        igv_version = igv_v %||% NA_character_,
        stringsAsFactors = FALSE
      )
    }
  }
  bind_rows(rows)
}

pan <- read_motion("results/crosstool-pan.json", "Pan")
zoom <- read_motion("results/crosstool-zoom.json", "Zoom in")
d2 <- bind_rows(zoom, pan)
if (!nrow(d2)) stop("no recorded cross-tool interaction rows")

igv_v <- unique(na.omit(d2$igv_version))[1]
d2 <- d2 |>
  mutate(
    arm = factor(arm, levels = arm_levels(igv_v)),
    read = factor(read, levels = c("short reads", "long reads")),
    # Zoom first: it is the interaction that isolates drawing, and the pan is the
    # one that adds the fetch back.
    motion = factor(motion, levels = c("Zoom in", "Pan"))
  ) |>
  filter(!is.na(arm))

ARMS <- arm_colours(igv_v)

pan_theme <- function(base = 12) {
  theme_minimal(base_size = base) +
    theme(
      plot.title    = element_text(face = "bold", size = rel(1.05)),
      plot.subtitle = element_text(colour = "grey25", size = rel(0.82),
                                   margin = margin(b = 8)),
      plot.caption  = element_text(colour = "grey35", size = rel(0.72),
                                   hjust = 0, margin = margin(t = 10)),
      strip.text    = element_text(face = "bold", size = rel(0.9)),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(colour = "grey92"),
      legend.position = "top",
      legend.title = element_blank()
    )
}

cov_scale <- scale_x_log10(breaks = c(20, 200, 1000),
                           labels = c("20x", "200x", "1000x"))

# Per row, not a single peak. Rows are measured on different days and loads, and
# quoting the worst minute over the whole figure would condemn cells taken at
# load 1.2 because a later partial run happened at 10.
load_note <- function(path) {
  if (!file.exists(path)) return("")
  d <- fromJSON(path, simplifyVector = FALSE)
  row_peak <- sapply(d$rows, function(r)
    suppressWarnings(max(unlist(lapply(r, function(cc) unlist(cc$load))))))
  hot <- names(row_peak)[is.finite(row_peak) & row_peak > 4]
  if (length(hot)) {
    sprintf("%d of %d rows ran above the 4.0 load ceiling and their absolutes are not a run of record: %s.",
            length(hot), length(row_peak),
            paste(hot, collapse = ", "))
  } else {
    "Every row below the 4.0 load ceiling."
  }
}

dates <- function(path) {
  if (!file.exists(path)) return(NA_character_)
  d <- fromJSON(path, simplifyVector = FALSE)
  paste(sort(unique(unlist(d$dates))), collapse = ", ")
}

# ---- time to content, both motions ---------------------------------------
timed <- d2 |> filter(is.finite(ms))

p_time <- ggplot(timed, aes(coverage, ms, colour = arm, group = arm)) +
  geom_line(linewidth = 0.75) +
  # Hollow for a pan step that fetched nothing. Kept because it is a real
  # finding -- at 20x long read JBrowse served all five steps from one 256 KiB
  # block -- but the legend now says what it means rather than saying "cache".
  geom_point(aes(shape = cached_only), size = 2.5) +
  facet_grid(motion + format ~ read, scales = "free_y") +
  scale_shape_manual(
    values = c(`FALSE` = 16, `TRUE` = 1),
    labels = c(`FALSE` = "went to the network for this region",
               `TRUE`  = "already had the region in memory"),
    name = NULL
  ) +
  scale_colour_manual(values = ARMS, drop = FALSE) +
  cov_scale +
  scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                expand = expansion(mult = c(0.08, 0.2))) +
  labs(
    title = "What an interaction costs you",
    subtitle = paste(
      "Time to content: from the interaction to the last canvas draw before the page stops drawing and stops fetching.",
      "\nZoom in — the region is already in memory, so this is redraw. Pan — one full viewport at constant scale, so this is fetch and redraw."
    ),
    x = "coverage", y = "ms (log scale)",
    caption = paste(
      sprintf("Zoom measured %s; pan measured %s.", dates("results/crosstool-zoom.json"), dates("results/crosstool-pan.json")),
      paste("Pan:", load_note("results/crosstool-pan.json")),
      "Instrument: the last canvas draw before draws and network both go still. Neither tool's own loading state is consulted --",
      "igv hides its spinner before it draws, and JBrowse's indicator wording moves between releases.",
      "A series that stops has a cell with no measurement; results/crosstool-pan.md says which and why.",
      "IMPORTANT: JBrowse's zoom row is flat at ~505 ms at every depth because 500 ms of it is a navigation debounce, not drawing.",
      "results/figures/zoom-redraw.png separates the two.",
      sep = "\n"
    )
  ) +
  pan_theme()

paper_fig(p_time, "results/figures/interaction.png", width = 13, height = 7.4)

# ---- the zoom, with the waiting taken out --------------------------------
# Its own figure rather than a panel, because it answers a different question
# from every other panel here: not "how long did the user wait" but "how much of
# that wait was work". Publishing the first without the second is what got the
# earlier zoom benchmark retracted.
# Only the arms that rasterize where the instrument can see it.
#
# The old block renderer paints in a worker and the main thread blits the
# finished tiles, so drawclock -- which patches the page's canvas prototypes and
# cannot reach a worker's global scope -- times a composite rather than a render.
# Plotting release-2.4.0's 0.1 ms beside the current renderer's 0.6 ms would say
# the 2023 release redraws six times faster than the GPU path.
#
# Decided from the renderer, not from the draw count, and the counts are why: at
# 20x short read the current build issues 20 draws a step, release-4.3.0 issues
# 12 to 18, release-2.4.0 issues 6 to 12. Twenty WebGL draw calls and a dozen
# drawImage blits, indistinguishable by number. An earlier version of this script
# thresholded on the count and dropped cells at random.
redraw <- d2 |>
  filter(motion == "Zoom in", is.finite(draw_ms), !arm %in% ARM_BUILD[c("release-2.4.0", "release-4.3.0")])
offthread <- d2 |>
  filter(motion == "Zoom in", arm %in% ARM_BUILD[c("release-2.4.0", "release-4.3.0")]) |>
  distinct(arm) |>
  pull(arm) |>
  as.character()

if (nrow(redraw)) {
  p_draw <- ggplot(redraw, aes(coverage, draw_ms, colour = arm, group = arm)) +
    geom_line(linewidth = 0.75) +
    geom_point(size = 2.5) +
    facet_grid(format ~ read, scales = "free_y") +
    scale_colour_manual(values = ARMS, drop = FALSE) +
    cov_scale +
    scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                  expand = expansion(mult = c(0.08, 0.2))) +
    labs(
      title = "The zoom redraw itself, with the waiting removed",
      subtitle = "The final draw burst of each step: its last canvas draw minus its first. Nothing here is a time a user experiences.",
      x = "coverage", y = "ms of drawing (log scale)",
      caption = paste(
        "Read this against the zoom panels of interaction.png, never instead of them. There, JBrowse waits a flat ~505 ms at every",
        "depth -- the 500 ms LGVCoarseDynamicBlocks debounce -- and igv waits nothing at all. Here is what each did with the time.",
        "The gap between the two figures is JBrowse's to close: the drawing is already sub-millisecond, and the wait is a constant.",
        if (length(offthread)) paste0(
          "Absent on purpose: ", paste(offthread, collapse = ", "),
          ". The block renderer rasterizes in a worker and blits the result, so the main thread shows a drawImage -- 0.1 ms under a 9.7 s wait.",
          "\nThat is a composite being timed, not a render, and this instrument cannot reach a worker's canvas. Their waits are in interaction.png, which is the number that matters for them."
        ) else "",
        sep = "\n"
      )
    ) +
    pan_theme()

  paper_fig(p_draw, "results/figures/zoom-redraw.png", width = 13, height = 4.2)
}

# The draws figure this file used to write. Removed rather than left stale: a
# figure nothing regenerates is a figure that gets quoted after the run it came
# from stopped being true.
unlink(c("results/figures/crosstool-pan-draws.png",
         "results/figures/crosstool-pan-time.png"))

cat("wrote results/figures/interaction.png and zoom-redraw.png\n")

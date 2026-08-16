#!/usr/bin/env Rscript
# Figures for the cross-tool pan, drawn from results/crosstool-pan.json so a
# slide cannot quote a number no run produced -- the rule scripts/render/charts.R
# and ecosystem/report.ts both follow.
#
# Two panels, because the run says two different things and reading them as one
# would be wrong:
#
#   (a) time to content against coverage. The headline, and the thing that
#       crosses: igv is faster at 20x short read and JBrowse is an order of
#       magnitude faster at 1000x.
#   (b) canvas draw calls per pan step. The mechanism, and the sturdier
#       measurement -- it repeats to within ~1% across runs because it depends
#       on the data and the code rather than on the machine.
#
# Both axes are log10. Time spans 537 ms to 27 s and draws span 42 to 1.6
# million; on a linear axis every point but the largest collapses onto the floor.
#
# Palette is the house one from the paper's figures/perf.R, not a new one:
# #2a78d6 for this work and #1baf7a for igv, validated as a pair (worst CVD dE
# 23.1 protan / 9.6 tritan, normal-vision 24.0). The green sits below 3:1 on
# white, so every series carries a direct label as well as a legend entry and the
# numbers also exist as a table in results/crosstool-pan.md.
#
#   Rscript scripts/crosstool/panchart.R    # -> results/figures/crosstool-pan-*.png
suppressPackageStartupMessages({
  library(jsonlite)
  library(ggplot2)
  library(dplyr)
  library(scales)
})

dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)

d <- fromJSON("results/crosstool-pan.json", simplifyVector = FALSE)

TOOL <- c(jbrowse = "JBrowse (this work)", igv = "igv.js 3.8.5")
TOOL_COL <- c("JBrowse (this work)" = "#2a78d6", "igv.js 3.8.5" = "#1baf7a")

# A cell the run could not measure has null for both medians, and `as.numeric`
# of NULL is a zero-length vector rather than NA — which makes data.frame() fail
# with "arguments imply differing number of rows" instead of carrying a gap.
num1 <- function(x) if (is.null(x) || length(x) == 0) NA_real_ else as.numeric(x)

rows <- list()
for (case_id in names(d$rows)) {
  # `20x-shortread` or `20x-shortread-cram`; BAM ids stay bare so results
  # recorded before CRAM was added are not orphaned.
  parts <- strsplit(case_id, "-", fixed = TRUE)[[1]]
  fmt <- if (length(parts) >= 3 && parts[3] == "cram") "CRAM" else "BAM"
  for (tool_id in names(d$rows[[case_id]])) {
    if (!tool_id %in% names(TOOL)) next
    cell <- d$rows[[case_id]][[tool_id]]
    draws <- unlist(cell$drawsPerStep)
    fetched <- cell$fetchedMedian
    rows[[length(rows) + 1]] <- data.frame(
      case = case_id,
      coverage = as.numeric(sub("x$", "", parts[1])),
      read = if (parts[2] == "shortread") "short reads" else "long reads",
      format = fmt,
      tool = unname(TOOL[tool_id]),
      # A cell where the tool fetched on no step has no comparable median. Keep
      # it, flagged, rather than dropping it: at 20x/200x long read JBrowse
      # rendered fully every step while fetching nothing, and a gap in the line
      # would read as a failed measurement instead of a finding.
      ms = if (is.null(fetched)) num1(cell$median) else num1(fetched),
      cached_only = is.null(fetched),
      draws = if (length(draws)) stats::median(draws) else NA_real_,
      stringsAsFactors = FALSE
    )
  }
}
# Deliberately NOT filtered to measured rows. A cell that produced neither a
# time nor a draw count is the one worth seeing — igv at 1000x-longread reaches
# 2.3 GB of renderer heap and does not reliably finish — and dropping it here
# leaves a line that simply stops, which reads as "not run".
d2 <- bind_rows(rows)
d2$tool <- factor(d2$tool, levels = unname(TOOL))
d2$read <- factor(d2$read, levels = c("short reads", "long reads"))

# Cells the run could not measure at all. Drawn as an annotation rather than
# omitted, because "this tool did not finish" is the result in the heaviest row.
missing <- d2 |> filter(!is.finite(ms))

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

# Per row, not a single peak. Rows here were measured on different days and
# loads -- the CRAM ones were added after the BAM ones -- and quoting the worst
# minute over the whole figure would condemn cells taken at load 1.2 because a
# later partial run happened at 10.
row_peak <- sapply(d$rows, function(r)
  suppressWarnings(max(unlist(lapply(r, function(cc) unlist(cc$load))))))
hot <- names(row_peak)[is.finite(row_peak) & row_peak > 4]
load_note <- if (length(hot)) sprintf(
  "Measured %s. %d of %d rows ran above the 4.0 load ceiling and their absolutes are\nnot a run of record: %s.\nThe rest were measured below it.",
  d$dates[[1]], length(hot), length(row_peak),
  paste(strwrap(paste(hot, collapse = ", "), width = 80), collapse = "\n")
) else sprintf("Measured %s. Every row below the 4.0 load ceiling.", d$dates[[1]])

# ---- panel (a): time to content ------------------------------------------
timed <- d2 |> filter(is.finite(ms))
p_time <- ggplot(timed, aes(coverage, ms, colour = tool, group = tool)) +
  geom_line(linewidth = 0.8) +
  geom_point(aes(shape = cached_only), size = 2.6) +
  # Direct labels on the heaviest point of each series, so identity never rests
  # on colour alone -- the green is below 3:1 on this surface.
  geom_text(
    data = timed |> group_by(tool, read, format) |> slice_max(coverage, n = 1),
    aes(label = ifelse(ms >= 1000, sprintf("%.1f s", ms / 1000), sprintf("%.0f ms", ms))),
    hjust = -0.15, vjust = -0.5, size = 3, show.legend = FALSE
  ) +
  scale_shape_manual(values = c(`FALSE` = 16, `TRUE` = 1),
                     labels = c(`FALSE` = "fetched", `TRUE` = "served from cache"),
                     name = NULL) +
  scale_colour_manual(values = TOOL_COL) +
  cov_scale +
  # Headroom for the direct labels, which otherwise collide with the facet strip.
  scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                expand = expansion(mult = c(0.06, 0.22))) +
  facet_grid(format ~ read) +
  labs(
    title = "Time to content after a pan, one viewport at constant scale",
    subtitle = "Median over the steps where that tool actually fetched. Hollow points fetched on no step.",
    x = "coverage", y = "ms (log scale)",
    caption = paste(load_note,
      "Instrument: the last canvas draw before draws and network both go still.",
      "Neither tool's own loading state is consulted -- igv hides its spinner",
      "before it draws, and JBrowse's indicator wording moves between releases.",
      sep = "\n")
  ) +
  pan_theme() +
  expand_limits(x = 2200)

if (nrow(missing)) {
  # Marked at the tool's own last measured level so the eye continues the line
  # into the gap, with a cross rather than a filled point so it cannot be read
  # as a datum.
  anchor <- timed |>
    group_by(tool, read, format) |>
    summarise(y = max(ms), .groups = "drop")
  missing2 <- missing |> select(-ms) |> inner_join(anchor, by = c("tool", "read", "format"))
  p_time <- p_time +
    geom_point(data = missing2, aes(x = coverage, y = y), shape = 4, size = 3.2,
               stroke = 1.1, show.legend = FALSE) +
    geom_text(data = missing2, aes(x = coverage, y = y),
              label = "did not\ncomplete", size = 2.6, vjust = -0.35, hjust = 0.5,
              lineheight = 0.9, colour = "grey25", show.legend = FALSE)
}

ggsave("results/figures/crosstool-pan-time.png", p_time,
       width = 8.2, height = 5.6, dpi = 200)

# ---- panel (b): draw calls -----------------------------------------------
drawn <- d2 |> filter(is.finite(draws))
p_draws <- ggplot(drawn, aes(coverage, draws, colour = tool, group = tool)) +
  geom_line(linewidth = 0.8) +
  geom_point(size = 2.6) +
  geom_text(
    data = drawn |> group_by(tool, read, format) |> slice_max(coverage, n = 1),
    aes(label = label_number(scale_cut = cut_short_scale())(draws)),
    hjust = -0.15, vjust = -0.5, size = 3, show.legend = FALSE
  ) +
  scale_colour_manual(values = TOOL_COL) +
  cov_scale +
  # Headroom for the direct labels, which otherwise collide with the facet strip.
  scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                expand = expansion(mult = c(0.06, 0.22))) +
  facet_grid(format ~ read) +
  labs(
    title = "Canvas draw calls per pan step",
    subtitle = "The architecture in one measurement: per-read 2D drawing against a batched GPU pass.",
    x = "coverage", y = "draw calls (log scale)",
    caption = paste(
      "Repeats to within ~1% across runs: it depends on the data and the code, not",
      "the machine, so it survives a contaminated run. igv's count saturates near",
      "250k above 200x, and NOT because of downsampling -- at samplingDepth 10000,",
      "which clips nothing on this corpus, draws and time are both unchanged.",
      sep = "\n")
  ) +
  pan_theme() +
  expand_limits(x = 2200)

ggsave("results/figures/crosstool-pan-draws.png", p_draws,
       width = 8.2, height = 5.6, dpi = 200)

cat("wrote results/figures/crosstool-pan-time.png and crosstool-pan-draws.png\n")

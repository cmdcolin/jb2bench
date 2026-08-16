#!/usr/bin/env Rscript
# Figures for the parser version sweep, drawn from results/sweep.json so a slide
# cannot quote a number no run produced -- the rule report.ts already follows.
#
# Two panels, and the split is the point rather than a layout choice:
#
#   (a) requests per query against version. Counted, not timed, so it is exact,
#       identical on every machine and unaffected by whatever else the box was
#       doing. It is also the quantity that transfers to the network, where a
#       read is a range request and a round trip.
#   (b) time against version. A timing on a shared workstation, and it carries
#       the load the run was taken under.
#
# Read (a) whatever the machine was doing and (b) only if the load line says the
# box was quiet. Drawing them in one figure with one shared axis would invite
# exactly the reading that is wrong.
#
# x is the major version, not the release date: what a reader wants from this is
# "which upgrade do I need", and majors are what they choose between.
#
# Palette is the house trio from the paper's figures/perf.R, re-validated here
# (worst CVD dE 9.2 deutan / 32.7 tritan, normal-vision 27.6). The green sits
# below 3:1 on white, so every series is direct-labelled as well as in the legend.
#
#   Rscript ecosystem/sweepchart.R    # -> results/figures/sweep-*.png
suppressPackageStartupMessages({
  library(jsonlite)
  library(ggplot2)
  library(dplyr)
  library(scales)
})

setwd(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])))
dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)

d <- fromJSON("results/sweep.json", simplifyVector = FALSE)

CASE_COL <- c(
  "20x shortread"  = "#2a78d6",
  "200x shortread" = "#eb6834",
  "200x longread"  = "#1baf7a"
)

rows <- list()
for (r in d$results) {
  for (p in r$points) {
    counts <- p$counts
    rows[[length(rows) + 1]] <- data.frame(
      package = r$package,
      case = r$case,
      tag = p$tag,
      major = as.numeric(p$major),
      ms = if (is.null(p$ms)) NA_real_ else as.numeric(p$ms),
      # `countable` is false for libraries handed lines or a buffer rather than a
      # file -- @gmod/vcf and bgzf-filehandle have no request shape to report,
      # which is different from reporting zero. Absent in JSON written before
      # that flag existed, where a numeric `reads` means the same thing, so
      # treat missing as "count it" rather than dropping every older run.
      reads = if (is.null(counts) || is.null(counts$reads) ||
                  identical(counts$countable, FALSE)) NA_real_
              else as.numeric(counts$reads),
      records = if (is.null(p$records)) NA_real_ else as.numeric(p$records),
      stringsAsFactors = FALSE
    )
  }
}
d2 <- bind_rows(rows)
d2$case <- factor(d2$case, levels = names(CASE_COL))

sweep_theme <- function(base = 12) {
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

lastpt <- function(x) x |> group_by(package, case) |> slice_max(major, n = 1)

# Where several cases land on the same value -- every @gmod/bbi case is 6 reads
# at v10 -- one label per value, not one per series. Three copies of "6" stacked
# on each other is less readable than one, and colour still carries identity.
distinct_labels <- function(x, col) {
  lastpt(x) |> ungroup() |> distinct(package, .data[[col]], .keep_all = TRUE)
}

# ---- panel (a): request shape --------------------------------------------
counted <- d2 |> filter(is.finite(reads))
if (nrow(counted)) {
  # Cases coincide exactly on some libraries -- every @gmod/bbi case is 5 reads
  # below v7 -- so without a dodge two of the three series are simply invisible
  # under the third. A small horizontal offset is honest here in a way jitter
  # would not be: it separates identical values without misstating any of them.
  dodge <- position_dodge(width = 0.30)
  p_reads <- ggplot(counted, aes(major, reads, colour = case, group = case)) +
    geom_line(linewidth = 0.8, position = dodge) +
    geom_point(size = 2.4, position = dodge) +
    geom_text(data = distinct_labels(counted, "reads"), aes(label = comma(reads)),
              hjust = -0.35, size = 3, show.legend = FALSE, position = dodge) +
    scale_colour_manual(values = CASE_COL) +
    scale_x_continuous(breaks = pretty_breaks(),
                       expand = expansion(mult = c(0.06, 0.16))) +
    scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                  expand = expansion(mult = c(0.10, 0.22))) +
    facet_wrap(~package, scales = "free", ncol = 3) +
    labs(
      title = "Reads per query, by major version",
      subtitle = "Counted through a wrapper around each build's own LocalFile. Exact, and the same on every machine.",
      x = "major version", y = "read() + readFile() calls (log scale)",
      caption = paste(
        "Needs no idle box: these are counts, not timings, so they neither decay nor",
        "depend on load. Over HTTP each one is a range request and a round trip.",
        sep = "\n")
    ) +
    sweep_theme()
  ggsave("results/figures/sweep-reads.png", p_reads, width = 10, height = 4.2, dpi = 200)
}

# ---- panel (b): time ------------------------------------------------------
timed <- d2 |> filter(is.finite(ms))
if (nrow(timed)) {
  load_note <- if (!is.null(d$loadPeak)) sprintf(
    "Peak 1-minute load %.1f, against the 4.0 this repo treats as the ceiling for a\nquotable absolute.",
    as.numeric(d$loadPeak)) else ""
  p_time <- ggplot(timed, aes(major, ms, colour = case, group = case)) +
    geom_line(linewidth = 0.8) +
    geom_point(size = 2.4) +
    geom_text(data = lastpt(timed) |> ungroup(),
              aes(label = ifelse(ms >= 1000, sprintf("%.1f s", ms / 1000), sprintf("%.0f ms", ms))),
              hjust = -0.35, size = 3, show.legend = FALSE) +
    scale_colour_manual(values = CASE_COL) +
    scale_x_continuous(breaks = pretty_breaks(),
                       expand = expansion(mult = c(0.06, 0.16))) +
    scale_y_log10(labels = label_number(scale_cut = cut_short_scale()),
                  expand = expansion(mult = c(0.10, 0.22))) +
    facet_wrap(~package, scales = "free", ncol = 3) +
    labs(
      title = "Time per query, by major version",
      subtitle = "One process per version, version order rotated each round, best-of-N per arm.",
      x = "major version", y = "ms (log scale)",
      caption = paste(load_note,
        "A curve, not a ratio: a reader on an intermediate version cannot use a",
        "2023-to-current number, because most of it may be behind them already.",
        sep = "\n")
    ) +
    sweep_theme()
  ggsave("results/figures/sweep-time.png", p_time, width = 10, height = 4.2, dpi = 200)
}

cat(sprintf("wrote %d figure(s) to ecosystem/results/figures/\n",
            sum(nrow(counted) > 0, nrow(timed) > 0)))

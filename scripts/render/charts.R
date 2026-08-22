#!/usr/bin/env Rscript
# Figures for the render benchmarks, drawn from the JSON the runners wrote so a
# slide cannot quote a number no run produced -- the same rule report.ts follows.
#
# Deliberately laid out like Fig 8 and Fig 10 of the 2023 Genome Biology paper:
# time against coverage, one colour per program, faceted by read type, so a
# reader who knows those figures can put these beside them. Two departures from
# the paper, both to make three coverages legible where it had five:
#   - x is log10 with breaks at the coverages actually measured, since 20x and
#     200x collide against a linear axis running to 1000
#   - the run's load average is carried in the subtitle rather than dropped
#
#   Rscript scripts/render/charts.R      # -> results/figures/*.png
suppressPackageStartupMessages({
  library(jsonlite)
  library(ggplot2)
  library(dplyr)
  library(tidyr)
  library(scales)
})

dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)

# Programs are ordered oldest to newest so the legend reads as a timeline, and
# named the way a reader of the paper would name them: v2.4.0 is the version it
# benchmarked as "jb2 parallel".
PROG <- c(
  "release-2.4.0"  = "v2.4.0 (2023 paper)",
  "release-4.1.15" = "v4.1.15",
  "release-4.3.0"  = "v4.3.0",
  "current"        = "current (HEAD)"
)
PROG_COL <- c(
  "v2.4.0 (2023 paper)" = "#c1462f",
  "v4.1.15"             = "#b08a3e",
  "v4.3.0"              = "#6a7fa8",
  "current (HEAD)"      = "#12796e"
)

paper_theme <- function(base = 13) {
  theme_grey(base_size = base) +
    theme(
      plot.title    = element_text(face = "bold", size = rel(1.05)),
      plot.subtitle = element_text(colour = "grey25", size = rel(0.82),
                                   margin = margin(b = 8)),
      plot.caption  = element_text(colour = "grey35", size = rel(0.72),
                                   hjust = 0, margin = margin(t = 10)),
      strip.text    = element_text(face = "bold", size = rel(0.9)),
      legend.key.height = unit(1.1, "lines")
    )
}

split_case <- function(id) {
  # "200x-longread-cram" -> coverage 200, read longread, format CRAM.
  # Rows recorded before the runner enumerated formats are two-part and BAM.
  data.frame(case = id) |>
    mutate(
      cov      = sub("-.*$", "", case),
      read     = sub("^[^-]+-([a-z]+read).*$", "\\1", case),
      fmt      = ifelse(grepl("-(bam|cram)$", case), sub("^.*-", "", case), "bam"),
      coverage = as.numeric(sub("x$", "", cov))
    )
}

# The paper's Fig 8 layout: one panel per (format, read type), time against
# coverage, one colour per program. Rows are CRAM over BAM as they are there, so
# the two figures can be read side by side.
fmt_levels  <- c("cram", "bam")
fmt_labels  <- c("CRAM", "BAM")
read_levels <- c("shortread", "longread")
read_labels <- c("short read", "long read")

as_matrix_facets <- function(df) {
  df |>
    filter(fmt %in% fmt_levels, read %in% read_levels) |>
    mutate(
      fmt  = factor(fmt, levels = fmt_levels, labels = fmt_labels),
      read = factor(read, levels = read_levels, labels = read_labels)
    )
}

cov_axis <- scale_x_log10(breaks = c(20, 200, 1000),
                          labels = c("20x", "200x", "1000x"))

# facet_wrap rather than facet_grid, for the reason the paper drew four separate
# plots: facet_grid shares a y scale down each row, which puts every short-read
# panel on the floor of its row's long-read axis and hides the shape the figure
# exists to show. facet_wrap gives each panel its own.
matrix_facets <- facet_wrap(vars(fmt, read), nrow = 2, scales = "free_y",
                            labeller = label_wrap_gen(multi_line = FALSE))

# ---------------------------------------------------------------- cold load
cold <- fromJSON("results/alignments.json", simplifyVector = FALSE)

cold_rows <- do.call(rbind, lapply(names(cold$results), function(case) {
  per <- cold$results[[case]]
  do.call(rbind, lapply(names(per), function(b) {
    cell <- per[[b]]
    if (is.null(cell$median) || !is.finite(cell$median)) return(NULL)
    ld <- if (is.null(cell$load)) NA_real_ else max(cell$load$before, cell$load$after)
    data.frame(
      case = case, build = b,
      median = cell$median / 1000, sd = cell$stddev / 1000,
      load = ld, measured = cold$measuredAt[[case]] %||% NA_character_
    )
  }))
}))

`%||%` <- function(a, b) if (is.null(a)) b else a

cold_df <- cold_rows |>
  left_join(split_case(unique(cold_rows$case)), by = "case") |>
  mutate(program = factor(PROG[build], levels = unname(PROG))) |>
  filter(!is.na(program)) |>
  as_matrix_facets()

# Only cases where all four builds were measured. 1000x-longread has no v2.4.0
# cell and its baselines are the 2026-08-05 pair taken at load 35 -- 36 s and
# 56 s for the same work -- so plotting it would put the run's least trustworthy
# numbers where they dominate the longread panel and flatter HEAD most.
complete <- cold_df |>
  count(case) |>
  filter(n == length(PROG)) |>
  pull(case)
dropped <- setdiff(unique(cold_df$case), complete)
cold_df <- cold_df |> filter(case %in% complete)

peak_load <- max(cold_df$load, na.rm = TRUE)
dates <- paste(sort(unique(na.omit(cold_df$measured))), collapse = ", ")

# A format with no rows yet is named in the caption rather than drawn as an
# empty band: the CRAM cases only became measurable on 2026-08-16, and a blank
# facet reads as "CRAM rendered nothing" instead of "nobody has run it".
missing_fmt <- setdiff(fmt_labels, as.character(unique(cold_df$fmt)))

p_cold <- ggplot(cold_df, aes(coverage, median, colour = program, group = program)) +
  geom_line(linewidth = 0.7) +
  geom_point(size = 2.1) +
  geom_errorbar(aes(ymin = pmax(median - sd, 0), ymax = median + sd),
                width = 0.06, linewidth = 0.45, show.legend = FALSE) +
  matrix_facets +
  cov_axis +
  scale_y_continuous(limits = c(0, NA), labels = label_number(accuracy = 1)) +
  scale_colour_manual(values = PROG_COL, name = "program") +
  labs(
    title = "Cold load to rendered reads — single track, 19 kb region",
    subtitle = sprintf(
      "In-page navigation→render-complete, median of %d runs after a warmup. Lower is better.",
      cold$runs
    ),
    x = "coverage", y = "time (s)",
    caption = paste0(
      "Measured ", dates, " on one workstation, peak 1-min load ",
      sprintf("%.1f", peak_load),
      " — far above the 4.0 this repo treats as usable, so the absolute seconds are not quotable.\n",
      "Builds are measured back to back within each case, so a load spike lands on all four at once and the ratios between them survive it better than the values do.\n",
      if (length(missing_fmt)) {
        paste0("No ", paste(missing_fmt, collapse = " or "),
               " row: those cases have not been run since the runner started enumerating formats.\n")
      } else "",
      if (length(dropped)) {
        paste0("Excluded: ", paste(dropped, collapse = ", "),
               " — no v2.4.0 cell, and its baselines are the pair that read 36 s and 56 s for identical work.")
      } else ""
    )
  ) +
  paper_theme()

ggsave("results/figures/cold-load.png", p_cold,
       width = 11, height = if (length(missing_fmt)) 5.2 else 7.6, dpi = 150)

# Speedup against the published version, which is the question the paper's
# readers are actually asking. Drawn as bars because a ratio has a meaningful
# zero and a meaningful 1.0, neither of which a line chart shows.
sp <- cold_df |>
  select(case, fmt, read, coverage, build, median) |>
  pivot_wider(names_from = build, values_from = median) |>
  filter(!is.na(`release-2.4.0`), !is.na(current)) |>
  mutate(speedup = `release-2.4.0` / current)

p_sp <- ggplot(sp, aes(factor(coverage, labels = c("20x", "200x", "1000x")), speedup)) +
  geom_col(fill = "#12796e", width = 0.62) +
  geom_hline(yintercept = 1, linetype = "dashed", colour = "grey30") +
  geom_text(aes(label = sprintf("%.2f×", speedup)),
            vjust = -0.45, size = 3.5, colour = "grey15") +
  facet_grid(fmt ~ read) +
  scale_y_continuous(limits = c(0, max(sp$speedup) * 1.18), expand = c(0, 0)) +
  labs(
    title = "How much faster than the version the 2023 paper benchmarked",
    subtitle = "Cold-load median of v2.4.0 ÷ median of current HEAD. Dashed line is parity.",
    x = "coverage", y = "speedup vs v2.4.0",
    caption = paste0(
      "Cumulative, not isolated: three years separate v2.4.0 from HEAD and almost none of it is the renderer.\n",
      "Same corpus and same simulation commands as the paper's methods; 19 kb window against its 10 kb.\n",
      # Same cold_df the panel above plots, so the same load caveat applies. A
      # ratio survives a loaded machine better than a duration does, since both
      # builds are measured back to back, but it does not survive it untouched.
      if (peak_load > 4) {
        sprintf(paste("Measured at peak 1-min load %.1f, over the 4.0 gate:",
                      "both builds took the spike together, so read these as",
                      "approximate."), peak_load)
      } else ""
    )
  ) +
  paper_theme()

ggsave("results/figures/speedup-vs-published.png", p_sp, width = 9.5, height = 4.6, dpi = 150)

# -------------------------------------------------------------- interaction
inter <- fromJSON("results/interaction.json", simplifyVector = FALSE)
roles <- unlist(inter$builds)

inter_rows <- do.call(rbind, lapply(names(inter$results), function(case) {
  do.call(rbind, lapply(c("in", "pan"), function(mode) {
    per <- inter$results[[case]][[mode]]
    if (is.null(per)) return(NULL)
    do.call(rbind, lapply(names(per), function(role) {
      r <- per[[role]]
      if (is.null(r$zoomTimeToContentMs) || isTRUE(r$allBailed)) return(NULL)
      v <- r$zoomTimeToContentMs
      if (!is.finite(v)) return(NULL)
      data.frame(case = case, mode = mode, build = roles[[role]],
                 secs = v / 1000, censored = isTRUE(r$censored))
    }))
  }))
}))

inter_df <- inter_rows |>
  left_join(split_case(unique(inter_rows$case)), by = "case") |>
  mutate(
    program = factor(PROG[build], levels = unname(PROG)),
    read = factor(read,
                  levels = c("shortread", "longread"),
                  labels = c("BAM shortread", "BAM longread")),
    mode = factor(mode, levels = c("in", "pan"),
                  labels = c("Zoom in", "Pan"))
  ) |>
  filter(!is.na(program))

# current is 0 on every zoom-in cell: it shows no loading state at all. A zero
# bar is invisible, so it gets its own label rather than being left to look like
# missing data.
zero_lab <- inter_df |> filter(secs == 0)

p_int <- ggplot(inter_df,
                aes(factor(coverage, labels = c("20x", "200x", "1000x")),
                    secs, fill = program)) +
  geom_col(position = position_dodge(width = 0.78), width = 0.7) +
  geom_text(data = zero_lab, aes(label = "none"),
            position = position_dodge(width = 0.78),
            vjust = -0.35, size = 2.9, colour = "#12796e", fontface = "bold") +
  facet_grid(mode ~ read) +
  scale_fill_manual(values = PROG_COL, name = "program") +
  scale_y_continuous(limits = c(0, NA), expand = expansion(mult = c(0, 0.13))) +
  labs(
    title = "What an interaction costs you",
    subtitle = paste(
      "Time-to-content: seconds a loading indicator sits on the track after the interaction before correct content is back.",
      "\nZoom in — only the old renderer refetches.  Pan — the region is new to both, so both pay the fetch."
    ),
    x = "coverage", y = "time-to-content (s)",
    caption = paste0(
      "Measured ", inter$measuredAt$`in`, " (zoom) and ", inter$measuredAt$pan, " (pan). ",
      "Zoom-in is the current renderer's best case and pan its worst: on a pan the region is new to both,\n",
      "so both pay the fetch and what is left is render cost rather than avoided network. ",
      "v2.4.0 is absent here — see the note in results/interaction.md."
    )
  ) +
  paper_theme()

ggsave("results/figures/interaction.png", p_int, width = 11, height = 6.4, dpi = 150)

# ----------------------------------------------------------------- parsers
# The layer under the browser, and the other half of the "since the paper"
# question: same corpus, 2023 release against current, decode only.
eco_path <- "ecosystem/results/bench.json"
if (file.exists(eco_path)) {
  eco <- fromJSON(eco_path, simplifyVector = FALSE)
  rows <- do.call(rbind, lapply(eco$files, function(f) {
    do.call(rbind, lapply(f$groups, function(g) {
      nm <- sub("^.*> ", "", g$fullName)
      bs <- g$benchmarks
      old <- Filter(function(b) grepl("2023", b$name), bs)
      new <- Filter(function(b) !grepl("2023", b$name), bs)
      if (!length(old) || !length(new)) return(NULL)
      data.frame(case = nm, old = old[[1]]$mean, new = new[[1]]$mean)
    }))
  }))
  eco_df <- rows |>
    mutate(
      lib = sub(" .*$", "", case),
      speedup = old / new
    ) |>
    filter(lib %in% c("bam", "cram", "bigwig")) |>
    mutate(lib = factor(lib, levels = c("bam", "cram", "bigwig"),
                        labels = c("@gmod/bam", "@gmod/cram", "@gmod/bbi (BigWig)")),
           # fixed order across facets: reorder() sorts on the global speedup,
           # which leaves each panel looking unsorted
           label = factor(sub("^[a-z]+ ", "", case),
                          levels = rev(c("20x shortread", "200x shortread", "1000x shortread",
                                         "20x longread", "200x longread", "1000x longread"))))

  p_eco <- ggplot(eco_df, aes(label, speedup, fill = lib)) +
    geom_col(width = 0.66, show.legend = FALSE) +
    geom_hline(yintercept = 1, linetype = "dashed", colour = "grey30") +
    geom_text(aes(label = sprintf("%.1f×", speedup)),
              hjust = -0.15, size = 3.1, colour = "grey15") +
    facet_wrap(~lib, scales = "free_x", nrow = 1) +
    coord_flip() +
    scale_y_continuous(expand = expansion(mult = c(0, 0.22))) +
    scale_fill_manual(values = c("#12796e", "#7a5ea8", "#b08a3e")) +
    labs(
      title = "The parser layer underneath, 2023 release vs current",
      subtitle = "Decode only — no browser, no GPU. Same corpus and window as the render benchmarks.",
      x = NULL, y = "speedup (2023 mean ÷ current mean)",
      caption = paste0(
        "Both sides built from source from a pinned tag with the same toolchain, so the difference is library code.\n",
        "An equivalence gate runs first: a timing comparison between two libraries returning different records is not a comparison."
      )
    ) +
    paper_theme()

  ggsave("results/figures/parsers.png", p_eco, width = 12, height = 4.4, dpi = 150)

  # The same data in the paper's Fig 8 layout — time against coverage, one line
  # per version, faceted format x read type. The bar chart above answers "how
  # much faster"; this answers the question a ratio destroys, which is how each
  # format's cost grows with depth. CRAM's long-read column is the one to look
  # at: the 2023 parser bends upward where the current one does not.
  #
  # BigWig is deliberately absent. It is not an alignment format, its cases are
  # summary reads of 1-3 ms, and a fifth panel of flat lines at the bottom of a
  # log axis would be four fifths of the figure saying nothing.
  matrix_rows <- rows |>
    filter(grepl("^(bam|cram) [0-9]+x (short|long)read$", case)) |>
    mutate(
      fmt  = sub(" .*$", "", case),
      read = sub("^.* ", "", case),
      coverage = as.numeric(sub("^[a-z]+ ([0-9]+)x .*$", "\\1", case))
    ) |>
    pivot_longer(c(old, new), names_to = "side", values_to = "ms") |>
    mutate(
      secs = ms / 1000,
      version = factor(side, levels = c("old", "new"),
                       labels = c("2023 release", "current release"))
    ) |>
    as_matrix_facets()

  p_mat <- ggplot(matrix_rows,
                  aes(coverage, secs, colour = version, group = version)) +
    geom_line(linewidth = 0.7) +
    geom_point(size = 2.1) +
    matrix_facets +
    cov_axis +
    scale_y_continuous(limits = c(0, NA), labels = label_number(accuracy = 0.1)) +
    scale_colour_manual(values = c("2023 release" = "#c1462f",
                                   "current release" = "#12796e"),
                        name = "library") +
    labs(
      title = "Parser cost by format, read type and coverage",
      subtitle = "One query over the 19 kb window, decode only — no browser, no GPU. Lower is better.",
      x = "coverage", y = "time (s)",
      caption = paste0(
        "Mean of the vitest bench iterations, both sides built from source at pinned tags with the same toolchain.\n",
        "Panels carry their own y scale: a shared one would put every BAM cell on the floor of the CRAM long-read axis."
      )
    ) +
    paper_theme()

  ggsave("results/figures/parser-matrix.png", p_mat, width = 11, height = 7.2, dpi = 150)
}

cat("wrote:\n")
cat(paste0("  ", list.files("results/figures", full.names = TRUE), "\n"), sep = "")

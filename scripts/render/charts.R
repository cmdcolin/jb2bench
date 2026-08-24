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
    fg <- if (is.null(cell$load$foreignCores)) NA_real_ else cell$load$foreignCores
    data.frame(
      case = case, build = b,
      median = cell$median / 1000, sd = cell$stddev / 1000,
      load = ld, foreign = fg,
      measured = cold$measuredAt[[case]] %||% NA_character_
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
# Contention is foreign CPU, not the load average. The load average counts this
# benchmark's own threads, so a heavy cell inflates it by working -- and this
# caption used to declare the figure unquotable whenever it passed 4.0, which on
# 2026-08-24 meant condemning a run whose worst cell saw 0.36 foreign cores. The
# offender was 200x-shortread-cram at load 4.2 and foreign 0.18: the benchmark
# reading its own six renders back.
FOREIGN_MAX <- 0.5
peak_foreign <- suppressWarnings(max(cold_df$foreign, na.rm = TRUE))
has_foreign <- is.finite(peak_foreign)
quotable <- has_foreign && peak_foreign <= FOREIGN_MAX
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
    # A one-run spike has no spread to report, so it says so rather than
    # printing "median of 1 runs" and implying a median of anything.
    subtitle = if (cold$runs == 1) {
      "In-page navigation→render-complete, one run per cell after a warmup. Lower is better."
    } else {
      sprintf(
        "In-page navigation→render-complete, median of %d runs after a warmup. Lower is better.",
        cold$runs
      )
    },
    x = "coverage", y = "time (s)",
    caption = paste0(
      "Measured ", dates, " on one workstation. ",
      if (!has_foreign) {
        sprintf(paste0("Peak 1-min load %.1f, against the 4.0 this repo treated as usable before it measured contention directly; ",
                       "these rows predate that, so the absolute seconds are not quotable.\n"), peak_load)
      } else if (quotable) {
        sprintf(paste0("Worst cell saw %.2f cores of foreign CPU — work by processes outside this benchmark — against a %.1f ceiling, ",
                       "so the absolute seconds stand. Peak 1-min load was %.1f, which counts this benchmark's own six renders and is context, not a verdict.\n"),
                peak_foreign, FOREIGN_MAX, peak_load)
      } else {
        sprintf(paste0("Worst cell saw %.2f cores of foreign CPU against a %.1f ceiling, so the absolute seconds are not quotable.\n"),
                peak_foreign, FOREIGN_MAX)
      },
      "Builds are measured back to back within each case, so contention lands on all four at once and the ratios between them survive it better than the values do.\n",
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
      data.frame(case = nm, old = old[[1]]$mean, new = new[[1]]$mean,
                 old_rme = old[[1]]$rme %||% NA_real_,
                 new_rme = new[[1]]$rme %||% NA_real_)
    }))
  }))
  eco_df <- rows |>
    mutate(
      lib = sub(" .*$", "", case),
      speedup = old / new,
      # Both sides carry a relative margin of error, so the ratio carries their
      # sum in quadrature. Without it this figure invites exactly the question
      # it cannot answer -- why CRAM dips at 200x and rebounds at 1000x -- when
      # those two cells are the noisiest in the set.
      rel = sqrt(old_rme^2 + new_rme^2) / 100,
      lo = speedup * (1 - rel),
      hi = speedup * (1 + rel)
    ) |>
    # BigWig is deliberately absent, and its absence is the honest reading.
    # Coverage is not an axis for it: a BigWig holds binned signal, so the 19 kb
    # window returns about the same intervals whatever the read depth behind it
    # -- 13168, 17676, 18495 across 20x/200x/1000x, against BAM's 3079, 31126,
    # 153652 over the same steps. Six sub-2 ms numbers that barely move were
    # being drawn as a coverage trend, and there is no trend to draw.
    #
    # The cost @gmod/bbi actually carries is PER FILE, paid once per sample and
    # invisible when measured once. `make cohort` is where it becomes legible --
    # 100 files, one window -- and results/figures/cohort-bw.png plots it.
    filter(lib %in% c("bam", "cram")) |>
    mutate(
      lib = factor(lib, levels = c("bam", "cram"),
                   labels = c("@gmod/bam", "@gmod/cram")),
      read = factor(sub("^.* ", "", case), levels = c("shortread", "longread"),
                    labels = c("short read", "long read")),
      coverage = factor(sub("^[a-z]+ ([0-9]+x) .*$", "\\1", case),
                        levels = rev(c("20x", "200x", "1000x")))
    )

  # A lollipop from the 1x line rather than a bar from zero, on ONE shared log
  # axis. Bars with a free x scale per library were actively misleading: BigWig
  # is a REGRESSION at 0.8-1.0x and its bar ran the full width of its panel,
  # reading as an achievement next to CRAM's 12x. On a shared log scale a
  # regression points left of the dashed line and cannot be mistaken for one.
  # Log also lets 0.8x and 12.2x share an axis without flattening the middle,
  # which a shared linear scale would.
  p_eco <- ggplot(eco_df, aes(coverage, speedup, colour = lib)) +
    geom_hline(yintercept = 1, linetype = "dashed", colour = "grey30") +
    geom_linerange(aes(ymin = pmin(speedup, 1), ymax = pmax(speedup, 1)),
                   linewidth = 1.6, alpha = 0.65) +
    geom_pointrange(aes(ymin = lo, ymax = hi), size = 0.42, linewidth = 0.5) +
    geom_text(aes(y = hi, label = sprintf("%.1f×", speedup)),
              hjust = -0.25, size = 2.9, colour = "grey15") +
    facet_grid(read ~ lib) +
    coord_flip() +
    scale_y_log10(breaks = c(0.5, 1, 2, 5, 10, 20),
                  labels = c("0.5×", "1×", "2×", "5×", "10×", "20×"),
                  expand = expansion(mult = c(0.08, 0.26))) +
    scale_colour_manual(values = c("#12796e", "#7a5ea8"), guide = "none") +
    labs(
      title = "The parser layer underneath, 2023 release vs current",
      subtitle = "Decode only — no browser, no GPU. Same corpus and window as the render benchmarks.",
      x = "coverage", y = "speedup (2023 mean ÷ current mean, log scale)",
      caption = paste0(
        "Both sides built from source from a pinned tag with the same toolchain, so the difference is library code.\n",
        "@gmod/bbi is not here: coverage is not an axis for BigWig, whose binned signal returns the same intervals at any read depth.\n",
        "Its cost is per file — see the cohort panel, where 100 samples pay it 100 times.\n",
        "An equivalence gate runs first: a timing comparison between two libraries returning different records is not a comparison."
      )
    ) +
    paper_theme()

  ggsave("results/figures/parsers.png", p_eco, width = 11.5, height = 5.6, dpi = 150)

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

# ------------------------------------------------------- cohort BigWig panel
# Where @gmod/bbi's cost is actually legible.
#
# The single-file BigWig comparison reads 1-2 ms and flat, which looks like "the
# library did not improve" and is really "a per-file cost measured once is
# invisible". Coverage is not an axis for it either: binned signal returns about
# the same intervals at any read depth. The axis that matters is HOW MANY FILES,
# because answering one BigWig query means reading the header, walking the
# chromosome B+ tree and descending the R-tree before a byte of data is touched,
# and a hundred-sample panel pays all of that a hundred times.
#
# Counts, not milliseconds. Each read is a range request and a round trip on the
# network, and a count is exact on any machine -- which is why this figure is
# worth drawing on a box too busy to time anything.
cohort_path <- "ecosystem/results/cohort-bw.json"
if (file.exists(cohort_path)) {
  co <- fromJSON(cohort_path, simplifyVector = FALSE)
  co_df <- do.call(rbind, lapply(co$rows, function(r) {
    data.frame(build = r$build, n = r$n, reads = r$reads,
               per_file = r$reads / r$n)
  }))
  builds <- unique(co_df$build)
  co_df$build <- factor(co_df$build, levels = builds)
  co_col <- setNames(c("#c2452d", "#12796e")[seq_along(builds)], builds)

  p_n <- ggplot(co_df, aes(n, reads, colour = build, group = build)) +
    geom_line(linewidth = 0.8) +
    geom_point(size = 2.2) +
    geom_text(aes(label = reads), hjust = -0.35, vjust = 0.3, size = 3, show.legend = FALSE) +
    scale_x_log10(breaks = unlist(co$sizes), labels = unlist(co$sizes),
                  expand = expansion(mult = c(0.12, 0.18))) +
    scale_y_log10(expand = expansion(mult = c(0.10, 0.16))) +
    scale_colour_manual(values = co_col, name = NULL) +
    labs(title = "Range requests grow with the panel, not with the window",
         x = "BigWig files in the panel", y = "read() calls (log)") +
    paper_theme() +
    theme(legend.position = "top")

  # The per-file read sequence, which is where the extra request comes from:
  # one 56-byte header read in v3.0.0 is two reads of 32 and 22 in v11.2.2.
  # Equal-width boxes rather than widths proportional to bytes, because the
  # point is the COUNT of round trips; the 8 kB data read is not eight times
  # more expensive than the 48-byte one over a network.
  pat_df <- do.call(rbind, lapply(co$rows, function(r) {
    if (r$n != max(unlist(co$sizes))) return(NULL)
    data.frame(build = r$build, i = seq_along(r$pattern),
               bytes = unlist(r$pattern))
  }))
  pat_df$build <- factor(pat_df$build, levels = builds)

  p_pat <- ggplot(pat_df, aes(i, build, fill = build)) +
    geom_tile(width = 0.92, height = 0.62, alpha = 0.85, show.legend = FALSE) +
    geom_text(aes(label = ifelse(bytes >= 1000,
                                 sprintf("%.1fk", bytes / 1000),
                                 as.character(bytes))),
              size = 2.9, colour = "white", fontface = "bold") +
    scale_x_continuous(breaks = seq_len(max(pat_df$i)),
                       expand = expansion(mult = c(0.03, 0.03))) +
    scale_fill_manual(values = co_col) +
    labs(title = "What one file costs, read by read",
         subtitle = "Every sample repeats this exact sequence",
         x = "read number within a single file", y = NULL) +
    paper_theme()

  p_co <- patchwork::wrap_plots(p_n, p_pat, ncol = 1, heights = c(1.35, 1)) +
    patchwork::plot_annotation(
      title = "Opening a cohort of BigWigs: the cost is per file and does not amortize",
      subtitle = sprintf(
        "Window %s. Counts of read() calls, exact on any machine — each one is a range request and a round trip.",
        co$window),
      caption = paste0(
        "Measured ", co$measured, ". Reads per file is flat across N: the hundredth sample costs what the first did.\n",
        "The current release issues one MORE request per file than the 2023 one for identical bytes — a 56-byte header read split into 32 and 22.\n",
        "Timings are omitted deliberately: a browser opens tracks concurrently, and concurrency hides exactly the per-file cost this measures."
      ),
      theme = paper_theme()
    )

  ggsave("results/figures/cohort-bw.png", p_co, width = 10, height = 7.2, dpi = 150)
  cat("  results/figures/cohort-bw.png\n")
}

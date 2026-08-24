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

source("scripts/arms.R")
dir.create("results/figures", showWarnings = FALSE, recursive = TRUE)

# ggplot does not wrap a caption, it clips it. Every caption here is several
# sentences of provenance, so they are wrapped at a width that fits the widest
# figure rather than trusted to fit.
wrap_caption <- function(...) {
  paste(strwrap(paste(..., collapse = " "), width = 150), collapse = "\n")
}

paper_theme <- function(base = 13) {
  theme_grey(base_size = base) +
    theme(
      plot.title    = element_text(face = "bold", size = rel(1.05)),
      plot.subtitle = element_text(colour = "grey25", size = rel(0.82),
                                   margin = margin(b = 8)),
      plot.caption  = element_text(colour = "grey35", size = rel(0.72),
                                   hjust = 0, margin = margin(t = 10)),
      strip.text    = element_text(face = "bold", size = rel(0.9)),
      legend.key.height = unit(1.1, "lines"),
      # The default is 5.5pt, which is not enough room for two adjacent panels
      # whose outermost x labels are "1000x" and "20x": they touch, and a reader
      # cannot tell which axis either belongs to.
      panel.spacing.x = unit(1.1, "lines"),
      panel.spacing.y = unit(0.7, "lines")
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

# One row of four, so the panels sit side by side and a reader compares them by
# moving along a line rather than across a grid. The 2023 paper drew its four as
# separate plots for the same reason.
#
# facet_wrap rather than facet_grid, and this is the part that matters: facet_grid
# shares a y scale down each column, which would put every short-read panel on the
# floor of the long-read axis and flatten the shape the figure exists to show.
# facet_wrap with free_y gives each panel its own.
matrix_facets <- facet_wrap(vars(fmt, read), nrow = 1, scales = "free_y",
                            labeller = label_wrap_gen(multi_line = FALSE))

# ---------------------------------------------------------------- cold load
#
# From results/crosstool.json, not results/alignments.json, since 2026-08-24.
#
# The two matrices measure the same interaction with different instruments, and
# only one of them can carry igv.js. alignments.json watches for JBrowse's own
# render-complete testid -- finer, but a signal no other tool emits -- while
# crosstool.json polls the pixels, which is the same question asked of any page.
# A figure that wants four arms including another tool has to be drawn from the
# instrument all four share. The cost is a few hundred ms of settle folded into
# every cell, and it is folded into all of them equally.
#
# results/alignments.md keeps the JBrowse-only matrix and its finer instrument.
# It is the better place to read small differences between our own builds; it
# just cannot be a cross-tool figure.
cold <- fromJSON("results/crosstool.json", simplifyVector = FALSE)
cold_under_test <- cold$jbrowseBuilds$jbrowse %||% cold$jbrowseBuild
cold_igv <- cold$igvVersion

cold_rows <- do.call(rbind, lapply(names(cold$rows), function(case) {
  per <- cold$rows[[case]]
  do.call(rbind, lapply(names(per), function(tool) {
    cell <- per[[tool]]
    lab <- arm_label(tool, cold_under_test, cold_igv)
    if (is.na(lab)) return(NULL)
    if (is.null(cell$median) || !is.finite(cell$median)) return(NULL)
    ld <- if (is.null(cell$load)) NA_real_ else max(cell$load$before, cell$load$after)
    fg <- if (is.null(cell$load$foreignCores)) NA_real_ else cell$load$foreignCores
    data.frame(
      case = case, build = tool, arm = lab,
      median = cell$median / 1000, sd = cell$stddev / 1000,
      load = ld, foreign = fg,
      measured = cold$dates[[case]] %||% NA_character_
    )
  }))
}))

ARMS <- arm_colours(cold_igv)

cold_df <- cold_rows |>
  left_join(split_case(unique(cold_rows$case)), by = "case") |>
  mutate(program = factor(arm, levels = arm_levels(cold_igv))) |>
  filter(!is.na(program)) |>
  as_matrix_facets()

# Only cases where every arm was measured. A case missing one arm draws a line
# that stops, which reads as "this tool got slower and then failed" rather than
# "nobody ran it"; the caption names what was dropped instead.
n_arms <- length(arm_levels(cold_igv))
complete <- cold_df |>
  count(case) |>
  filter(n == n_arms) |>
  pull(case)
dropped <- setdiff(unique(cold_df$case), complete)
cold_df <- cold_df |> filter(case %in% complete)

# A clear refusal rather than a ggplot faceting error twelve frames deep. The
# usual cause is a matrix measured with only one JBrowse arm served: run
# `make crosstool-cold` with JBROWSE_PORTS set, or `make serve` first.
if (!nrow(cold_df)) {
  stop(sprintf(
    "no case in results/crosstool.json has all %d arms (%s); recorded arms: %s",
    n_arms, paste(arm_levels(cold_igv), collapse = ", "),
    paste(sort(unique(cold_rows$arm)), collapse = ", ")
  ))
}

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
  scale_colour_manual(values = ARMS, name = NULL, drop = FALSE) +
  labs(
    title = "Cold load to rendered reads — single track, 19 kb region",
    subtitle = paste(
      "Navigation to the last frame in which the pixels change, median of the run's replicates after a warmup. Lower is better.",
      "\nThe instrument belongs to neither tool: igv.js hides its spinner before it draws, so its own loading state would credit it with a render it has not done."
    ),
    x = "coverage", y = "time (s)",
    caption = wrap_caption(
      paste0("Measured ", dates, " on one workstation. "),
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
      "Arms are measured back to back within each case, so contention lands on all of them at once and the ratios between them survive it better than the values do.\n",
      "igv.js parses alignments on the main thread where JBrowse decodes in a worker, and JBrowse boots an application shell where igv mounts a widget. Both are inside these numbers, and a cold load is where they weigh most — results/figures/interaction.png is the same four arms with startup out of the number.\n",
      if (length(missing_fmt)) {
        paste0("No ", paste(missing_fmt, collapse = " or "),
               " row: those cases have not been run since the runner started enumerating formats.\n")
      } else "",
      if (length(dropped)) {
        paste0("Excluded, because not every arm has a cell there: ",
               paste(dropped, collapse = ", "),
               ". igv.js at 1000x long read reaches 2.3 GB of renderer heap and does not reliably finish — see results/crosstool.md.")
      } else ""
    )
  ) +
  paper_theme()

paper_fig(p_cold, "results/figures/cold-load.png", width = 13, height = 4.2, dpi = 200)

# Speedup against the published version, which is the question the paper's
# readers are actually asking. Drawn as bars because a ratio has a meaningful
# zero and a meaningful 1.0, neither of which a line chart shows.
# Keyed by arm label rather than by build directory, so the pivot cannot silently
# produce an empty frame the day a build is re-staged under a different name.
PAPER_ARM <- unname(ARM_BUILD["release-2.4.0"])
HEAD_ARM <- unname(ARM_BUILD["current"])
sp <- cold_df |>
  select(case, fmt, read, coverage, program, median) |>
  mutate(program = as.character(program)) |>
  filter(program %in% c(PAPER_ARM, HEAD_ARM)) |>
  pivot_wider(names_from = program, values_from = median) |>
  filter(!is.na(.data[[PAPER_ARM]]), !is.na(.data[[HEAD_ARM]])) |>
  mutate(speedup = .data[[PAPER_ARM]] / .data[[HEAD_ARM]])

p_sp <- ggplot(sp, aes(factor(coverage, labels = c("20x", "200x", "1000x")), speedup)) +
  geom_col(fill = unname(ARM_COL["5.0.0 (main)"]), width = 0.62) +
  geom_hline(yintercept = 1, linetype = "dashed", colour = "grey30") +
  geom_text(aes(label = sprintf("%.2f×", speedup)),
            vjust = -0.45, size = 3.5, colour = "grey15") +
  facet_grid(fmt ~ read) +
  scale_y_continuous(limits = c(0, max(sp$speedup) * 1.18), expand = c(0, 0)) +
  labs(
    title = "How much faster than the version the 2023 paper benchmarked",
    subtitle = sprintf("Cold-load median of %s ÷ median of %s. Dashed line is parity.", PAPER_ARM, HEAD_ARM),
    x = "coverage", y = "speedup vs v2.4.0",
    caption = wrap_caption(
      "Cumulative, not isolated: three years separate v2.4.0 from this tree and almost none of it is the renderer.",
      "Same corpus and same simulation commands as the paper's methods; 19 kb window against its 10 kb.",
      # Judged by foreign CPU, not by the load average, for the reason the panel
      # above spells out: load counts this benchmark's own renders, and the 1000x
      # cells drive it into the tens on an idle box. This caption used to call
      # itself approximate whenever load passed 4.0, which condemned a run whose
      # worst cell saw a third of a core of outside work. A ratio also survives
      # contention better than a duration, since both arms take the spike
      # together -- but it does not survive it untouched, so a contended run is
      # still named.
      if (quotable) {
        sprintf("Worst cell saw %.2f cores of foreign CPU against a %.1f ceiling, so these ratios stand.",
                peak_foreign, FOREIGN_MAX)
      } else if (has_foreign) {
        sprintf(paste("Worst cell saw %.2f cores of foreign CPU against a %.1f ceiling.",
                      "Both arms of a ratio are measured back to back and took the contention together, so read these as approximate rather than as a run of record."),
                peak_foreign, FOREIGN_MAX)
      } else ""
    )
  ) +
  paper_theme()

paper_fig(p_sp, "results/figures/speedup-vs-published.png", width = 9.5, height = 4.2, dpi = 200)

# -------------------------------------------------------------- interaction
#
# Not drawn here any more, and the reason is the figure it used to draw.
#
# It plotted results/interaction.json -- JBrowse against older JBrowse, zoom and
# pan, timed by watching for a loading indicator to clear. On every zoom-in cell
# the build under test showed no loading indicator at all, so the bar was zero,
# so the figure labelled it "none". That label was the instrument's, not the
# renderer's: "no loading state was observed" is not a duration, and printing it
# beside real seconds invited the reader to treat it as an unbeatable one.
#
# scripts/crosstool/panchart.R draws the replacement from the draws-and-network
# clock, which measures the same two interactions without asking either tool
# whether it thinks it is finished. What the zero cells actually cost is 505 ms
# of navigation debounce and 0.8 ms of drawing -- two real numbers where there
# used to be a word -- and it carries igv.js and the two older releases as well.

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
    # Deliberately one neutral colour and no legend. In the composite below, the
    # other panel colours by VERSION -- red for 2023, teal for current -- and a
    # figure where teal means "current release" in one panel and "@gmod/bam" in
    # the other is a figure that cannot be read. The facet strips already name
    # the library, and a speedup is a ratio of the two versions rather than
    # either one, so it gets a colour that means nothing.
    scale_colour_manual(values = c("#4a5568", "#4a5568"), guide = "none") +
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

  # p_eco is panel A of the composite written below, not a figure of its own.

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

  # One shared log y across all four panels, not a free linear one per panel.
  #
  # Free scales answered "how does each format's cost grow with depth" and hid the
  # question next to it: how the two formats compare at all. The panels span 8.4 ms
  # (BAM 20x short read, current) to 28.2 s (CRAM 1000x long read, 2023) -- a
  # factor of 3350 -- so a shared LINEAR axis is not the alternative: it would put
  # every BAM cell on the floor of the CRAM long-read axis, which is the reason
  # the scales were freed in the first place.
  #
  # Log fixes both. A ratio is a constant vertical distance whatever the depth, so
  # CRAM's decode penalty is legible as the gap between panels -- 11x over BAM at
  # 20x short read, and 1.05x at 1000x long read, which is the finding free scales
  # made invisible. Growth with depth still reads as slope.
  p_mat <- ggplot(matrix_rows,
                  aes(coverage, secs, colour = version, group = version)) +
    geom_line(linewidth = 0.7) +
    geom_point(size = 2.1) +
    # 2x2, unlike the cold-load matrix's single row. That figure has one panel per
    # (format, read type) and nothing else, so a row of four reads as one
    # sequence; this one sits beside a 2x2 speedup panel in the composite below,
    # and two grids of the same shape line up where a row and a grid do not.
    facet_wrap(vars(fmt, read), nrow = 2,
               labeller = label_wrap_gen(multi_line = FALSE)) +
    cov_axis +
    scale_y_log10(labels = label_number(accuracy = 0.01, drop0trailing = TRUE),
                  breaks = c(0.01, 0.1, 1, 10, 30)) +
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

  # One figure, two panels, because they answer halves of one question and a
  # reader who sees only the speedups cannot tell whether a 12x is 12x of
  # something that mattered. A is the ratio; B is the cost the ratio is of.
  p_parsers <- patchwork::wrap_plots(
    p_eco + labs(title = NULL, subtitle = NULL, caption = NULL),
    p_mat + labs(title = NULL, subtitle = NULL, caption = NULL),
    ncol = 2, widths = c(1, 1.05)
  ) +
    patchwork::plot_annotation(tag_levels = "A") &
    theme(plot.tag = element_text(face = "bold", size = 13))

  writeLines(c(
    "# parsers.png",
    "",
    "Two panels. Text for a paper caption; nothing below is drawn in the image.",
    "",
    "## title",
    "",
    "The parser layer underneath JBrowse, 2023 release against current",
    "",
    "## subtitle",
    "",
    "(A) Speedup, 2023 mean divided by current mean, log scale; the dashed line is parity and a point left of it is a regression.",
    "(B) The times that ratio is of, on one shared log axis. Decode only -- no browser, no GPU -- over the same 19 kb window as the render benchmarks.",
    "",
    "## caveats",
    "",
    "Both sides built from source from a pinned tag with the same toolchain, so the difference is library code and not a change of transpiler target or module format.",
    "An equivalence gate runs first: a timing comparison between two libraries returning different records is not a comparison.",
    "@gmod/bbi is absent on purpose. Coverage is not an axis for BigWig, whose binned signal returns about the same intervals at any read depth -- 13168, 17676 and 18495 intervals across 20x/200x/1000x, against BAM's 3079, 31126 and 153652. Its cost is per FILE; see cohort-bw.png, where 100 samples pay it 100 times.",
    "Panel B shares one log axis rather than giving each panel its own. The cells span 8.4 ms to 28.2 s, a factor of 3350, so a shared linear axis would put every BAM cell on the floor of the CRAM long-read panel. On log, the BAM-to-CRAM gap is a readable vertical distance: CRAM costs 11x BAM at 20x short read and 1.05x at 1000x long read, so its decode penalty all but vanishes at depth.",
    "Panel A uses one neutral colour on purpose. Panel B colours by version, and teal cannot mean 'current release' in one panel and '@gmod/bam' in the other.",
    "In panel A, error bars are the two sides' relative margins of error added in quadrature; the CRAM 200x and 1000x cells are the noisiest in the set.",
    "Mean of the vitest bench iterations."
  ), "results/figures/parsers.txt")

  ggsave("results/figures/parsers.png", p_parsers, width = 15, height = 5.6, dpi = 200)
  unlink("results/figures/parser-matrix.png")
  unlink("results/figures/parser-matrix.txt")
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

  # patchwork's annotations are not the plot's own labels, so paper_fig cannot
  # reach them. Both panels and the wrapper are built bare and the prose is
  # written to the sidecar by hand.
  p_co <- patchwork::wrap_plots(
    p_n + labs(title = NULL, subtitle = NULL),
    p_pat + labs(title = NULL, subtitle = NULL),
    ncol = 2, widths = c(1.1, 1)
  )

  writeLines(c(
    "# cohort-bw.png",
    "",
    "## title",
    "",
    "Opening a cohort of BigWigs: the cost is per file and does not amortize",
    "",
    "## subtitle",
    "",
    sprintf("Window %s. Left: read() calls against panel size. Right: what one file costs, read by read -- every sample repeats this exact sequence. Counts, exact on any machine; each one is a range request and a round trip.", co$window),
    "",
    "## caveats",
    "",
    paste0("Measured ", co$measured, ". Reads per file is flat across N: the hundredth sample costs what the first did."),
    "The current release issues one MORE request per file than the 2023 one for identical bytes -- a 56-byte header read split into 32 and 22.",
    "Timings are omitted deliberately: a browser opens tracks concurrently, and concurrency hides exactly the per-file cost this measures."
  ), "results/figures/cohort-bw.txt")

  ggsave("results/figures/cohort-bw.png", p_co, width = 13, height = 4.2, dpi = 200)
  cat("  results/figures/cohort-bw.png\n")
}

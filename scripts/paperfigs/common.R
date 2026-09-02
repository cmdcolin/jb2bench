# Shared time axis for the measured-time figures. Sourced, not a package.
#
# Every one of these figures spans two to four orders of magnitude, so the axis
# has to be logarithmic. What is spelled out here rather than left to
# scale_*_log10 is the LABELLING: the stock log scale prints 1e-01 and 1e+03,
# which the reader has to convert before either one means anything, and a
# figure whose whole subject is "how long does this take" should not make the
# duration the hardest thing on it to read. So the labelled breaks are round
# durations in the unit a person would say out loud — 10 ms, 1 s, 1 min — and
# the unlabelled 2/5 gridlines between them keep the decade visible, which is
# what tells the eye the axis is logarithmic at all.

# Every figure here writes a PDF into results/figures/paper/pdf/ and a PNG twin
# into results/figures/paper/png/. ggsave will not create a directory that does
# not exist, so they are made here rather than in each script, which keeps a
# figure script runnable on its own.
dir.create("results/figures/paper/pdf", showWarnings = FALSE, recursive = TRUE)
dir.create("results/figures/paper/png", showWarnings = FALSE, recursive = TRUE)

# These lived in scripts/arms.R while the repo drew a second figure set that
# shared them. That set and its two scripts went on 2026-09-02, and what was
# left of arms.R was the arm naming and colouring they alone used; the half
# below is everything that had a caller, so it moves here rather than leaving a
# file named for arms that no longer names any.

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
# under test at the same cell.
#
# The bare ratio, not "9.5x slower". The word is three times the width of the
# number, and in a cell where four series end within a decade of each other that
# width is the difference between four labels the repel solver can separate and
# four it cannot -- it settles them on top of one another and the numbers are
# unreadable, which is worse than terse. Every figure's caption says the
# direction once, for every cell on it. "faster" stays spelled out: it is the
# exception, and a bare ratio in the unexpected direction reads as the expected
# one.
fmt_slower <- function(r) ifelse(r >= 1, fmt_ratio(r),
                                 paste(fmt_ratio(1 / r), "faster"))

#' The last measured point of every series in a cell, with its ratio to the
#' reference series at that same point.
#'
#' `cell` names the columns that identify a panel, `x` the sweep, `y` the
#' measurement and `series` the arm. Rows for the reference arm get its time as
#' their label; every other arm gets fmt_slower. A series whose endpoint has no
#' reference measurement at the same x gets no label at all, since a ratio
#' against a cell nobody measured is not a ratio.
endpoint_labels <- function(df, cell, x, y, series, reference) {
  key <- function(d) do.call(paste, c(d[c(cell, x)], sep = "|"))
  ref <- df[df[[series]] == reference, ]
  ord <- df[order(-df[[x]]), ]
  ends <- ord[!duplicated(ord[c(cell, series)]), ]
  ends$ref_y <- ref[[y]][match(key(ends), key(ref))]
  ends$label <- ifelse(ends[[series]] == reference, fmt_time(ends[[y]]),
                       paste0(fmt_time(ends[[y]]), "\n", fmt_slower(ends[[y]] / ends$ref_y)))
  ends[!is.na(ends$ref_y) & is.finite(ends[[y]]), ]
}

is_endpoint <- function(df, ends, cell, x, series) {
  key <- function(d) do.call(paste, c(d[c(cell, x, series)], sep = "|"))
  key(df) %in% key(ends)
}

TIME_BREAKS <- c(0.001, 0.01, 0.1, 1, 10, 60, 600, 3600)
TIME_MINOR <- c(outer(c(2, 5), 10^(-4:3)))

# `breaks` is a parameter because a narrow faceted panel cannot carry all eight
# without the labels touching; the minor gridlines are what keep the decade
# readable when a figure thins them.
time_scale_y <- function(name = "time", breaks = TIME_BREAKS, ...) {
  scale_y_log10(name = name, breaks = breaks, labels = fmt_time,
                minor_breaks = TIME_MINOR, ...)
}

time_scale_x <- function(name = "time", breaks = TIME_BREAKS, ...) {
  scale_x_log10(name = name, breaks = breaks, labels = fmt_time,
                minor_breaks = TIME_MINOR, ...)
}

# One series order for every measured-time figure, so a series keeps its colour
# across all of them: pair this with `scale_colour_discrete(drop = FALSE)` and
# limit the legend with `breaks` rather than by dropping levels. Ordered oldest
# release to newest and then the other tools, which is the order a reader walks
# them in. Shared because the cold-load and interaction figures are separate
# scripts that both draw "This work" and must agree on its colour.
PERF_SERIES <- c("Release 2.4.0", "Release 4.1.15", "Release 4.3.0",
                 "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")

# One type scale for every manuscript figure. The stock 11 pt base at 180 mm
# printed labels at 6 pt, which is legible on paper and not on a screen or a
# slide, where these figures are actually read.
PAPER_BASE <- 15
paper_theme <- function(base = PAPER_BASE) {
  theme_grey(base_size = base) +
    theme(legend.position = "top",
          legend.text = element_text(size = rel(0.95)),
          legend.key.size = unit(5.5, "mm"),
          strip.text = element_text(size = rel(0.95)),
          panel.spacing = unit(1, "lines"))
}

# Seeded, because the repel solver starts from a random jitter: without it a
# rebuild reshuffles every label and the figure is a different picture each time
# it is drawn.
REPEL_SEED <- 7
# In log10 coverage units: how far right of its point an endpoint label starts.
# Small on purpose. A nudge large enough to clear the curve entirely needs a
# right margin as wide as a third of the panel, and that margin is empty on
# every cell -- the figure then spends a third of its width on nothing. The
# labels sit over the panel instead and the repel solver moves them off the
# lines, which is what it is for.
ENDPOINT_NUDGE <- 0.16
# Plain times go the other way, so they and the bold verdicts do not both want
# the strip immediately right of the last point.
PLAIN_NUDGE <- -0.07
# In log10 seconds: how far below its point a reference-curve label starts. The
# reference is the bottom curve in every cell these figures draw, so the band
# under it is empty and nothing else wants it.
REFERENCE_DROP <- -0.12

#' One row per drawn label, carrying the columns the facets key on.
#'
#' `cell` names those columns, so the same helper serves a figure faceted on
#' (reads, format) and one faceted on (reads, format, window).
label_rows <- function(df, cell, label, face) {
  data.frame(df[c("coverage", "s", cell, "series")], label = label, face = face,
             stringsAsFactors = FALSE)
}

# ggrepel pushes a label off other LABELS and off the POINTS of its own layer,
# and knows nothing about the lines joining them -- so left alone it settles
# bold ratios neatly into the gaps between points and straight through the
# curves, which is the one place a number must not sit. Sampling each segment
# into empty-labelled rows puts the curve into the layer as a row of obstacles
# it does understand. An empty string has no box, so these push labels away
# without drawing anything themselves.
curve_obstacles <- function(df, cell) {
  seg <- split(df, df[c("series", cell)], drop = TRUE)
  do.call(rbind, lapply(seg, function(g) {
    if (nrow(g) < 2) return(NULL)
    g <- g[order(g$coverage), ]
    i <- seq_len(nrow(g))
    at <- seq(1, nrow(g), length.out = 40)
    label_rows(data.frame(coverage = 10^approx(i, log10(g$coverage), xout = at)$y,
                          s = 10^approx(i, log10(g$s), xout = at)$y,
                          g[rep(1, length(at)), c(cell, "series"), drop = FALSE],
                          row.names = NULL),
               cell, "", "plain")
  }))
}

#' Every point's label for a cold-load figure: plain times on the inner points,
#' the comparator's bold verdict on its last one, and the curves as obstacles.
#'
#' `d` is every usable row including the ones abandoned at the paint ceiling,
#' which get a ">" and no ratio; `meas` is the measured subset the curves are
#' drawn from. Both figures that call this used to carry their own copy, and the
#' copies had already diverged -- the combined one dropped the censored rows
#' before labelling, so an abandoned run appeared as a curve that simply stopped.
coldload_labels <- function(d, meas, cell, reference) {
  ends <- endpoint_labels(meas, cell = cell, x = "coverage", y = "s",
                          series = "series", reference = reference)
  ends <- ends[ends$series != reference, ]
  inner <- d[!is_endpoint(d, ends, cell, "coverage", "series"), ]

  labels <- rbind(
    label_rows(inner, cell,
               ifelse(inner$censored, paste0(">", fmt_time(inner$s)),
                      fmt_time(inner$s)), "plain"),
    label_rows(ends, cell, ends$label, "bold"),
    curve_obstacles(meas, cell)
  )
  labels$nudge <- ifelse(labels$face == "bold", ENDPOINT_NUDGE,
                         ifelse(labels$label == "", 0, PLAIN_NUDGE))
  labels$nudge_y <- ifelse(labels$series == reference & labels$label != "",
                           REFERENCE_DROP, 0)
  labels
}

# The layer coldload_labels feeds, and the size scale that gives `face` its two
# sizes. Returned as a list so a figure adds both with one `+`.
endpoint_repel <- function(labels) {
  list(
    ggrepel::geom_text_repel(
      data = labels, aes(label = label, fontface = face, size = face),
      nudge_x = labels$nudge, nudge_y = labels$nudge_y, lineheight = 0.9,
      seed = REPEL_SEED, show.legend = FALSE,
      box.padding = 0.38, point.padding = 0.2,
      force = 3, force_pull = 0.4,
      min.segment.length = 0.25, segment.size = 0.25,
      segment.alpha = 0.5, max.overlaps = Inf,
      max.time = 5, max.iter = 60000),
    scale_size_manual(values = c(plain = POINT_LABEL, bold = ENDPOINT_LABEL),
                      guide = "none")
  )
}

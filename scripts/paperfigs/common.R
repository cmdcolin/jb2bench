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

# fmt_time, fmt_ratio, fmt_slower, endpoint_labels and the label/line sizes live
# in scripts/arms.R, shared with the repo's own figures so both sets label a
# point the same way.
source("scripts/arms.R")

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
coldload_labels <- function(d, meas, cell, reference,
                            ratio = fmt_slower_terse) {
  ends <- endpoint_labels(meas, cell = cell, x = "coverage", y = "s",
                          series = "series", reference = reference,
                          ratio = ratio)
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

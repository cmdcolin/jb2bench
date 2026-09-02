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

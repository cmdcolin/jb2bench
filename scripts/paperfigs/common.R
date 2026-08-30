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

TIME_BREAKS <- c(0.001, 0.01, 0.1, 1, 10, 60, 600, 3600)
TIME_MINOR <- c(outer(c(2, 5), 10^(-4:3)))

fmt_time <- function(s) {
  n <- function(x) trimws(formatC(x, format = "fg", digits = 2, drop0trailing = TRUE))
  ifelse(is.na(s), "",
  ifelse(s < 0.9995, paste0(round(s * 1000), " ms"),
  ifelse(s < 9.95,   paste0(n(round(s, 1)), " s"),
  ifelse(s < 59.5,   paste0(round(s), " s"),
  ifelse(s < 3540,   paste0(n(round(s / 60, 1)), " min"),
                     paste0(n(round(s / 3600, 1)), " h"))))))
}

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

# "Faster by" for a label: 3 significant-ish digits below 10x, none above,
# because "1.8x" and "3,400x" both need to be read at a glance and neither
# wants the other's precision.
fmt_ratio <- function(r) ifelse(r < 9.95, sprintf("%.1f×", r),
                                sprintf("%s×", trimws(format(round(r), big.mark = ","))))

# One series order for every measured-time figure, so a series keeps its colour
# across all of them: pair this with `scale_colour_discrete(drop = FALSE)` and
# limit the legend with `breaks` rather than by dropping levels. Ordered oldest
# release to newest and then the other tools, which is the order a reader walks
# them in. Shared because the cold-load and interaction figures are separate
# scripts that both draw "This work" and must agree on its colour.
PERF_SERIES <- c("Release 2.4.0", "Release 4.1.15", "Release 4.3.0",
                 "This work", "igv.js 3.8.5", "GenomeSpy 0.85.0")

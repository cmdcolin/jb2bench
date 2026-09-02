#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-interaction.pdf, from results/paper/perf.csv.
#
# Time-to-content after a two-fold zoom in and after a one-viewport pan, this
# release against the one it replaces. The numbers behind the manuscript's
# zoom and pan time-to-content tables, and behind results/interaction.md.
#
# Half of what used to be perf-summary.pdf, which carried this and the cold load
# in one two-panel figure. They are separate figures as of 2026-08-25 because
# they answer separate questions and share nothing: different harness, different
# instrument, different comparators, different y unit. Stacking them meant one
# caption for two experiments and two legends the reader had to keep apart.
#
# Release 2.4.0 joined this figure on 2026-08-25, once the detector did: the
# harness used to ask the loading indicator whether content was back, and
# 2.4.0 never shows one it recognizes in seven of the twelve cells, which came
# back as 0 ms with `loadingEverSeen` false -- indistinguishable from "This
# work"'s real zeros on the zoom panel, where no refetch happens at all. A
# region-keyed marker per finished block (jb2bench's contentready.ts) replaced
# that instrument; against the same twelve cells it reads a duration in all of
# them.
#
#   Rscript scripts/paperfigs/perf-interaction.R
#
# Stock discrete colour scale; type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ggrepel)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
d <- subset(d, session == "interaction")
d$s <- d$ms / 1000

# Coverage is the sweep, so it goes on an axis rather than into a row label, and
# the read length is the other factor rather than half of a compound category
# name: "1000x long read" is two variables spelled as one.
d$coverage <- as.numeric(sub("x .*", "", d$case))
d$reads <- factor(sub("^[0-9]+x ", "", d$case), levels = c("short read", "long read"))
d$series <- factor(d$series, levels = PERF_SERIES)

PANELS <- c("Zoom in, within loaded data", "Pan, both refetch")
d$panel <- factor(d$panel, levels = PANELS)

# A dropped point truncates its series rather than interpolating across the gap,
# which is what jb2bench's own interaction figure does for the same reason: a
# line drawn through a cell nobody measured is a claim nobody made. The gate is
# per row, since contention on one arm invalidates the pair and not just the
# point -- 1000x short read pan is the case, where a tsc took 1.46 cores during
# the 4.3.0 arm and none during ours.
plotted <- subset(d, usable)
dropped <- unique(subset(d, !usable)[, c("panel", "reads")])
drop_note <- if (nrow(dropped)) {
  geom_text(data = dropped, label = "gap: cell measured under external load",
            x = Inf, y = Inf, hjust = 1.04, vjust = 1.6, size = POINT_LABEL,
            inherit.aes = FALSE)
}

# Each release's last point carries its ratio to this work, stacked to the
# right of the curve ends. The pan row can divide by a reference time; the zoom
# row cannot, because a zoom in this work is a redraw with no refetch and reads
# 0 s, and a ratio against zero is not a ratio. So the zoom row labels the same
# endpoints with the duration alone, and names this work's zero for what it is
# rather than leaving an unlabelled flat line on the axis.
LABEL_COLS <- c("panel", "reads", "coverage", "s", "series", "label")

pan_ends <- endpoint_labels(subset(plotted, panel == "Pan, both refetch"),
                            cell = c("panel", "reads"), x = "coverage", y = "s",
                            series = "series", reference = "This work")
pan_ends$label <- sub("\n", " · ", pan_ends$label, fixed = TRUE)

zoom <- subset(plotted, panel == "Zoom in, within loaded data")
zoom <- zoom[order(-zoom$coverage), ]
zoom_ends <- zoom[!duplicated(zoom[c("panel", "reads", "series")]), ]
zoom_ends$label <- ifelse(zoom_ends$series == "This work", "0 s · no refetch",
                          fmt_time(zoom_ends$s))

ends <- rbind(pan_ends[LABEL_COLS], zoom_ends[LABEL_COLS])

# Read length used to be a linetype within each panel rather than its own facet,
# which put short and long read on one shared y scale -- and they are not close
# enough for that to work: the zoom panel alone ranges 1.5 s at short read to
# 12 s at long read, an 8x spread that left the short-read curve pinned near
# zero. Faceting on both panel and read length gives all four cells their own
# scale, which is what free_y is for -- none of the four is being compared with
# another on this axis, each is being compared with its own predecessor.
# facet_grid cannot do this: its "free_y" frees a scale per ROW, so whichever
# variable is not the row still shares a y-axis across its two levels.
fig <- ggplot(plotted, aes(x = coverage, y = s, colour = series)) +
  geom_line(linewidth = LINE_W) +
  geom_point(size = POINT_S) +
  geom_text_repel(data = ends, aes(label = label), direction = "y",
                  nudge_x = 0.08, hjust = 0, size = ENDPOINT_LABEL,
                  fontface = "bold", seed = 7, show.legend = FALSE,
                  min.segment.length = 0.3, segment.size = 0.25,
                  segment.alpha = 0.5, box.padding = 0.25) +
  drop_note +
  facet_wrap(~panel + reads, nrow = 2, scales = "free_y") +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.08, 0.85))) +
  scale_y_continuous(expand = expansion(mult = c(0.05, 0.12))) +
  # drop = FALSE keeps "This work" the colour it is in the cold-load figure;
  # `breaks` keeps the legend to the three builds this run measured, which is
  # otherwise five keys wide and runs off the page.
  scale_colour_discrete(drop = FALSE,
                        breaks = c("Release 2.4.0", "Release 4.3.0", "This work")) +
  # Below the panels rather than above them: as a subtitle this note sat
  # between the reader and the legend, and three lines of small italic there
  # read as the figure's title. The manuscript caption says the same thing; this
  # is what keeps the image quotable on its own.
  labs(x = "coverage", y = "seconds", colour = NULL,
       caption = paste("time-to-content after a 2× zoom in and after a one-viewport pan,",
                       "median of five steps; zero is a redraw with no refetch.",
                       "Bold: that release's time divided by this work's at the same point",
                       sep = "\n")) +
  paper_theme() +
  theme(plot.caption = element_text(size = rel(0.8), hjust = 0, face = "italic",
                                    lineheight = 1.25, margin = margin(t = 8)))

ggsave("results/figures/paper/pdf/perf-interaction.pdf", fig,
       width = 220, height = 170, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-interaction.pdf\n")

ggsave("results/figures/paper/png/perf-interaction.png", fig,
       width = 220, height = 170, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-interaction.png\n")

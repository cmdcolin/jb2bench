#!/usr/bin/env Rscript
# results/figures/paper/pdf/perf-motion.pdf, from results/paper/perf.csv.
#
# Zoom and pan against igv.js 3.8.5 on an application that is already up, over
# the same corpus, machine and browser build. perf-interaction.R draws the same
# two motions across JBrowse releases only; this is the cross-tool half, and
# they are separate figures because they are separate instruments -- the marker
# one there reports 0 ms for a zoom this one reports at 507 ms, and neither
# number is wrong for what it measures.
#
# BOTH COLUMNS OR NEITHER. A JBrowse zoom step is a flat ~505 ms at every
# coverage and every read type: that is the 500 ms `LGVCoarseDynamicBlocks`
# debounce, and the drawing inside it takes well under a millisecond. So the
# left column says igv.js finishes a zoom fourteen times sooner and the right
# column says it spends fifty times longer drawing one, and both are true.
# results/crosstool-zoom.md sets the rule this figure follows: an earlier
# version of the benchmark could not see inside the debounce and published it as
# a render time, and the README had to retract it. Faceting the two side by side
# makes quoting one alone take deliberate effort.
#
# THE DRAW COLUMN CARRIES TWO ARMS, NOT FOUR, and the reason is the instrument
# rather than the result. drawclock.ts patches the canvas prototypes of the
# PAGE, so, in its own words, "work in a worker is invisible here unless it
# lands on a main-thread canvas". Releases 2.4.0 and 4.3.0 rasterize in a worker
# and blit the finished image, so what the clock times for them is the blit and
# not the drawing: their spans collapse to a single clock tick at exactly the
# depths where the work grows, which drew release 2.4.0 as out-drawing this work
# by a factor of ten. This work submits WebGL draws on the main thread and
# igv.js draws canvas2d on the main thread, so both are wholly visible and
# comparable with each other. The release arms keep the left column, where the
# quantity is what the user waits and nothing is hidden.
#
# BAM only, like perf-interaction.R and for the same reason: these panels mean
# "what does a motion cost", and a format axis makes them mean something else.
# The CRAM cells are measured and sit in results/crosstool-{zoom,pan}.md.
#
#   Rscript scripts/paperfigs/perf-motion.R
#
# Stock ggplot2 throughout: default theme, default discrete colour scale.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})
source("scripts/paperfigs/common.R")

VISIBLE_DRAWS <- c("This work", "igv.js 3.8.5")

d <- read.csv("results/paper/perf.csv", stringsAsFactors = FALSE)
d <- subset(d, session == "cross-tool motion" & usable)
d <- subset(d, metric == "what the user waits" | series %in% VISIBLE_DRAWS)

d$coverage <- as.numeric(sub("x .*", "", d$case))
d$reads <- sub("^[0-9]+x ", "", d$case)
# One strip per motion and read length, spelled so the row reads as a phrase
# rather than as two factor levels the reader has to recombine.
d$row <- factor(paste0(sub(",.*", "", d$panel), " · ", d$reads),
                levels = c("Zoom in · short read", "Zoom in · long read",
                           "Pan · short read", "Pan · long read"))
d$series <- factor(d$series, levels = PERF_SERIES)
d$metric <- factor(d$metric, levels = c("what the user waits", "what the renderer did"))
d$s <- d$ms / 1000

# Both absences in the long-read pan row are results, and a panel that does not
# say so reads as a run that failed. `fetchedMedian` is the median over the
# steps on which a tool went to the network, and on long reads no JBrowse
# release went to the network on any pan step at any depth -- all five came from
# data already held, where igv.js refetched every one. At 1000x igv.js has no
# cell at all: the page stopped responding and all three rounds ended in a CDP
# timeout, which is a statement about the tool at that depth rather than a gap
# in the run.
notes <- data.frame(
  row = factor("Pan · long read", levels = levels(d$row)),
  metric = factor(c("what the user waits", "what the renderer did"),
                  levels = levels(d$metric)),
  label = c("no JBrowse release fetched on any step here",
            "igv.js: no 1000× cell, the page stopped responding"))

fig <- ggplot(d, aes(x = coverage, y = s, colour = series)) +
  geom_line() +
  geom_point(size = 1.5) +
  geom_text(data = notes, aes(label = label), inherit.aes = FALSE,
            x = Inf, y = -Inf, hjust = 1.03, vjust = -0.7, size = 2.1) +
  facet_grid(row ~ metric) +
  scale_x_log10(breaks = c(20, 200, 1000), labels = c("20×", "200×", "1000×"),
                expand = expansion(mult = c(0.12, 0.12))) +
  time_scale_y("time per step (log scale)",
               breaks = c(0.001, 0.01, 0.1, 1),
               expand = expansion(mult = c(0.16, 0.12))) +
  scale_colour_discrete(drop = FALSE,
                        breaks = intersect(PERF_SERIES, unique(as.character(d$series)))) +
  guides(colour = guide_legend(nrow = 1)) +
  labs(x = "coverage", colour = NULL,
       subtitle = paste(
         "Median step of five, median of three interleaved rounds, against an application already up.",
         "Left: navigation to the last draw before the page stops drawing and stops fetching; for a pan,",
         "over the steps on which the tool fetched. Right: the drawing inside that, timed at the canvas API.",
         "A JBrowse zoom waits out a 500 ms debounce it does not spend drawing, so read the pair, not a column.",
         "The releases rasterize in a worker, where the draw clock cannot see them, so the right column omits them.",
         sep = "\n")) +
  theme(legend.position = "top",
        legend.text = element_text(size = 8.5),
        plot.subtitle = element_text(size = 7.6, lineheight = 1.3))

ggsave("results/figures/paper/pdf/perf-motion.pdf", fig,
       width = 180, height = 215, units = "mm", device = cairo_pdf)
cat("wrote results/figures/paper/pdf/perf-motion.pdf\n")

ggsave("results/figures/paper/png/perf-motion.png", fig,
       width = 180, height = 215, units = "mm", dpi = 300, device = ragg::agg_png)
cat("wrote results/figures/paper/png/perf-motion.png\n")

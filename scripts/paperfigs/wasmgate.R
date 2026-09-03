#!/usr/bin/env Rscript
# results/figures/paper/pdf/wasmgate.pdf, from results/paper/wasmgate.csv.
#
# Two dots per routine: what the work costs, and what merely moving its bytes
# across the wasm boundary costs.
#
# That is the whole figure. A worker boundary is free to cross -- postMessage
# transfers an ArrayBuffer's ownership and copies nothing -- but wasm addresses
# only its own linear memory, so every call copies its input in and its result
# back out. A port can only win where the work is bigger than that copy, and both
# are times, so both are dots on one axis and the question is which one is
# further right.
#
# Where the work dot is right of the copy dot there is room for a port; where it
# is left, there is none, and no implementation however fast can create any. One
# routine here is ported, and its third dot is where the port landed.
#
# Two earlier versions of this figure are worth not repeating. The first drew
# time against payload size as a plane, which made every verdict a GAP between
# two curves a decade apart on a log axis and left the reader to measure it. The
# second divided that plane by the floor, which turned the verdict into a height
# but bought it with an abstraction -- a "ceiling", a ratio to a quantity the
# reader had to be told about first, on an axis of speedups nobody had measured.
# Both were answering the question correctly and neither was answering it
# legibly. Two dots and a gap need no explaining, and the floor stops being a
# denominator and becomes a duration, which is what it always was.
#
# The sweep over payload size is gone with them. It showed the same verdict at
# every size, which is a fact for the prose (results/wasmgate.md) rather than a
# reason to draw six curves; these dots are the whole file, which is the payload
# a real query resolves to.
#
# Every row is a routine JBrowse's alignments render path actually runs, and
# `call_site` in the CSV names where. That is an admission rule and not a note:
# two rows used to be `BamRecord.CIGAR` and `BamRecord.seq`, the accessors that
# build a CIGAR string and a base string, and the renderer calls neither -- it
# reads NUMERIC_CIGAR and walks the packed SEQ on purpose. They measured work
# the program does not do, and flattered it, most of their cost being JS string
# building that no port could remove.
#
#   Rscript scripts/paperfigs/wasmgate.R
#
# Type sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/wasmgate.csv", stringsAsFactors = FALSE)

# Panels are named for what they hold rather than for the fixture, since read
# length is the thing that changes the answer: a 100 kb ONT read carries far more
# CIGAR to walk than a 150 bp one, and 53,596 short records carry far more
# per-record overhead than 757 long ones.
panel_of <- c("shortreads_300x.bam" = "short reads (Illumina, 300×)",
              "chr22_nanopore_subset.bam" = "long reads (ONT, chr22)")
named <- ifelse(is.na(panel_of[d$file]), d$file, panel_of[d$file])
d$panel <- factor(named, levels = unique(named[order(match(d$file, names(panel_of)))]))

# The whole file: the largest payload of the sweep, and the only one every
# routine is measured at the same number of bytes on.
rows <- do.call(rbind, lapply(split(d, list(d$panel, d$candidate), drop = TRUE), function(g) {
  g[order(-g$marshalled), ][1, ]
}))
rows$work <- rows$js_ms / 1000
rows$copy <- rows$floor_ms / 1000
rows$ported <- rows$wasm_ms / 1000

# Ordered by how far the work exceeds the copy, averaged over both read types so
# a routine keeps its row in both facets. Geometric, because these are ratios.
margin <- tapply(log(rows$work / rows$copy), rows$candidate, mean)
rows$candidate <- factor(rows$candidate, levels = names(sort(margin)))

rows$room <- rows$work > rows$copy
# The bare ratio. "41x the copy" spelled out is three times the width, and at
# twelve rows that width is the difference between a label that fits beside its
# pair and one that runs off the panel; the subtitle says what the number is,
# once, for all of them.
rows$label <- ifelse(rows$room, fmt_ratio(rows$work / rows$copy),
                     sprintf("%.2f×", rows$work / rows$copy))
# Outside the pair, on whichever side the work dot ended up.
rows$label_at <- pmax(rows$work, rows$copy)

ported <- rows[is.finite(rows$ported), ]
ported$label <- sprintf("%s faster", fmt_ratio(ported$work / ported$ported))

# The grey dot is the crux, and naming it badly is what made an earlier draft
# unreadable: it is not a third measurement of the same kind, it is a BOUND. A
# wasm port's time is copy + compute, so it can never come in under its own
# copying, and that copying is measurable without writing the port. Five of the
# six routines here have no wasm implementation and never needed one -- their
# verdict is that the bound alone already loses. The legend has to say so, or the
# reader is left asking, correctly, where the wasm numbers for those rows are.
# Plain words for the grey dot, because the abstract ones did not survive
# contact with a reader: "the port with its compute taken to zero" is exact and
# means nothing to anyone who has not already followed the argument. What it IS
# is a measurement of copying bytes into wasm and back with nothing computed in
# between, so that is what it says.
SERIES <- c("just the copying, with nothing computed",
            "the whole job today, in JavaScript",
            "the one real wasm port, measured")
dots <- rbind(
  data.frame(rows[c("panel", "candidate")], s = rows$copy, series = SERIES[1]),
  data.frame(rows[c("panel", "candidate")], s = rows$work, series = SERIES[2]),
  data.frame(ported[c("panel", "candidate")], s = ported$ported, series = SERIES[3])
)
dots$series <- factor(dots$series, levels = SERIES)

fig <- ggplot(rows, aes(y = candidate)) +
  # The pair, joined, so the gap reads as one object rather than two marks that
  # happen to share a row.
  geom_segment(aes(x = copy, xend = work, yend = candidate),
               linewidth = 1.5, colour = "grey72") +
  geom_point(data = dots, aes(x = s, colour = series, shape = series),
             size = POINT_S * 1.7) +
  # nudge_x, not hjust: hjust offsets by a multiple of the label's own width, so
  # a short label ends up closer to its dot than a long one and the shortest sit
  # on top of theirs. On a log axis the nudge is in decades, so every label
  # clears its dot by the same distance.
  geom_text(aes(x = label_at, label = label), hjust = 0, nudge_x = 0.22,
            size = POINT_LABEL, fontface = "bold", colour = "grey20") +
  geom_text(data = ported, aes(x = ported, label = label), vjust = 2.3,
            size = POINT_LABEL, fontface = "italic") +
  facet_wrap(~panel) +
  time_scale_x("time for the whole file (log scale)",
               breaks = c(1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1),
               expand = expansion(mult = c(0.08, 0.36))) +
  scale_colour_manual(values = setNames(c("grey35", "#3573b9", "black"), SERIES)) +
  scale_shape_manual(values = setNames(c(1, 19, 17), SERIES)) +
  labs(y = NULL, colour = NULL, shape = NULL,
       title = "Could a wasm port of this routine win?",
       # Hand-wrapped. The panel is 250 mm and this text is not wrapped for it by
       # ggplot, so a long line is silently cut off at the device edge.
       # Hand-wrapped. The panel is 250 mm and ggplot does not wrap this text for
       # it, so a long line is silently cut off at the device edge.
       # Hand-wrapped at about 100 characters. ggplot does not wrap this text, and
       # a longer line is silently cut off at the device edge rather than flowing.
       subtitle = paste(
         "A wasm port has to copy its input into wasm memory and its result back out.",
         "\nGrey is that copying alone, nothing computed. Every real port pays it on top of its own work,",
         "\nso none can land left of grey. Where grey is right of blue, no port can beat today's JavaScript.",
         "\nOnly BGZF inflate has a real port; the triangle is it. The number is blue ÷ grey.")) +
  paper_theme() +
  theme(plot.title = element_text(face = "bold", size = rel(1.1), hjust = 0),
        plot.subtitle = element_text(size = rel(0.85), hjust = 0, colour = "grey25",
                                     lineheight = 1.2, margin = margin(b = 8)),
        legend.position = "top",
        legend.direction = "vertical",
        legend.justification = "left",
        panel.grid.major.y = element_blank())

ggsave("results/figures/paper/pdf/wasmgate.pdf", fig,
       width = 250, height = 150, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/wasmgate.pdf\n")

ggsave("results/figures/paper/png/wasmgate.png", fig,
       width = 250, height = 150, units = "mm", dpi = 200, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/wasmgate.png\n")

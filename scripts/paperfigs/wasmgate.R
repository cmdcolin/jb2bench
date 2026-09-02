#!/usr/bin/env Rscript
# results/figures/paper/pdf/wasmgate.pdf, from results/paper/wasmgate.csv.
#
# The admission test a routine has to pass before compiling it to WebAssembly is
# worth doing, drawn as a plane.
#
# A worker boundary is free to cross -- postMessage transfers an ArrayBuffer's
# ownership and copies nothing. wasm has no equivalent: it addresses only its own
# linear memory, so a call copies its input in and its result back out whether or
# not the code inside is any faster. The x axis is therefore the bytes a routine
# would have to marshal, and the black curve is what moving them costs. Every
# other curve is that routine's cost in JavaScript.
#
# The vertical gap to the floor is the whole content of the figure. Above it, a
# port has that much room and no more -- so the gap is a CEILING on the speedup,
# not a promise of one, which is why both arms of the one routine that is
# actually ported are drawn: the dashed curve is where the port landed inside the
# room the floor said it had. Below the floor there is no room at all, and no
# implementation, however fast, can win: the copy alone already costs more than
# doing the whole job in JavaScript.
#
# The floor is drawn from every candidate's own floor measurement rather than one
# series measured apart, so its points come from a dozen different input and
# output sizes. That they fall on one curve is the evidence that it is a memcpy
# pair -- a property of the machine, not of the module measured through.
#
# Minima, not medians, and the reason is in the CSV: the run of record was taken
# on a box under load, where contention only ever adds time and the fastest
# repetition is the least contaminated one. Every arm of a cell is measured back
# to back, so what contention does survive lands on all of them together and the
# ratios this figure is made of hold.
#
# Only one legend, for the routines. The wasm arm is labelled on the curve
# instead: exactly one routine here has a shipped port, so a second legend would
# spend a row of the figure distinguishing a case from itself.
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
d$js_s <- d$js_ms / 1000
d$wasm_s <- d$wasm_ms / 1000
d$floor_s <- d$floor_ms / 1000

# Panels are named for what they hold rather than for the fixture, since read
# length is the thing that changes the answer: a 100 kb ONT read carries a CIGAR
# worth decoding and a 150 bp read does not.
panel_of <- c("shortreads_300x.bam" = "short reads (Illumina, 300×)",
              "chr22_nanopore_subset.bam" = "long reads (ONT, chr22)")
named <- ifelse(is.na(panel_of[d$file]), d$file, panel_of[d$file])
d$panel <- factor(named, levels = unique(named[order(match(d$file, names(panel_of)))]))

FLOOR <- "marshalling floor"
CANDIDATES <- c("BGZF inflate", "BAM sequence decode", "BAM CIGAR decode",
                "BAM field decode", "BAM record walk", "BGZF block scan")
# The floor leads the legend because every other entry is read against it.
SERIES <- c(FLOOR, CANDIDATES)
COLOURS <- setNames(c("black", scales::hue_pal()(length(CANDIDATES))), SERIES)

# One floor series per panel, from every candidate's own measurement.
floor_pts <- data.frame(panel = d$panel, marshalled = d$marshalled,
                        s = d$floor_s, series = FLOOR)
floor_pts <- floor_pts[order(floor_pts$panel, floor_pts$marshalled), ]

js <- data.frame(panel = d$panel, marshalled = d$marshalled, s = d$js_s,
                 series = d$candidate)
wasm <- data.frame(panel = d$panel, marshalled = d$marshalled, s = d$wasm_s,
                   series = d$candidate)
wasm <- wasm[is.finite(wasm$s), ]

for (f in list(floor_pts, js, wasm)) {
  stopifnot(all(f$series %in% SERIES))
}
floor_pts$series <- factor(floor_pts$series, levels = SERIES)
js$series <- factor(js$series, levels = SERIES)
wasm$series <- factor(wasm$series, levels = SERIES)

# The dead zone: a routine drawn inside it already costs less in JavaScript than
# moving its own bytes across the boundary.
dead <- floor_pts
BOTTOM <- min(c(d$js_s, d$wasm_s, d$floor_s), na.rm = TRUE) / 2.5
dead$ymin <- BOTTOM

# Each curve ends with what the floor leaves it: a ceiling, or the absence of
# one. The ported routine gets what it actually collected instead, since for it
# the question is settled rather than open.
ends <- do.call(rbind, lapply(split(d, list(d$panel, d$candidate), drop = TRUE), function(g) {
  g <- g[order(-g$marshalled), ][1, ]
  ceiling <- g$js_ms / g$floor_ms
  data.frame(panel = g$panel, series = g$candidate, marshalled = g$marshalled,
             s = g$js_s,
             label = if (is.na(g$wasm_ms)) {
               if (ceiling < 1) sprintf("no room (%.2f×)", ceiling) else sprintf("≤%s", fmt_ratio(ceiling))
             } else {
               sprintf("%s of ≤%s", fmt_ratio(g$js_ms / g$wasm_ms), fmt_ratio(ceiling))
             })
}))
ends$series <- factor(ends$series, levels = SERIES)

# The wasm curve names itself, partway along where there is room under it,
# rather than through a second legend.
wasm_end <- do.call(rbind, lapply(split(wasm, wasm$panel, drop = TRUE), function(g) {
  g[order(g$marshalled), ][1, ]
}))
wasm_end$label <- "shipped wasm port"

fig <- ggplot(mapping = aes(x = marshalled, y = s)) +
  geom_ribbon(data = dead, aes(ymin = ymin, ymax = s), fill = "grey88",
              inherit.aes = TRUE) +
  geom_line(data = floor_pts, aes(colour = series), linewidth = LINE_W * 1.2) +
  geom_point(data = floor_pts, aes(colour = series), size = POINT_S * 0.6) +
  geom_line(data = js, aes(colour = series), linewidth = LINE_W) +
  geom_point(data = js, aes(colour = series), size = POINT_S) +
  geom_line(data = wasm, aes(colour = series), linewidth = LINE_W, linetype = "22") +
  geom_point(data = wasm, aes(colour = series), size = POINT_S, shape = 17) +
  ggrepel::geom_text_repel(data = ends, aes(label = label, colour = series),
                           size = ENDPOINT_LABEL, fontface = "bold", seed = REPEL_SEED,
                           show.legend = FALSE, box.padding = 0.45, point.padding = 0.3,
                           nudge_x = ENDPOINT_NUDGE, force = 5, force_pull = 0.3,
                           min.segment.length = 0.25, segment.size = 0.25,
                           segment.alpha = 0.5, max.overlaps = Inf,
                           max.time = 5, max.iter = 60000) +
  geom_text(data = wasm_end, aes(label = label, colour = series),
            size = POINT_LABEL, fontface = "italic", hjust = -0.12, vjust = 1.6,
            show.legend = FALSE) +
  geom_text(data = data.frame(panel = factor(levels(d$panel), levels(d$panel)),
                              marshalled = 10^7.6, s = BOTTOM * 1.7),
            aes(label = "no wasm port can win in here"),
            size = POINT_LABEL, fontface = "italic", colour = "grey30",
            hjust = 1) +
  facet_wrap(~panel) +
  scale_x_log10(name = "bytes crossing the wasm boundary (input + result)",
                breaks = 10^(4:8),
                labels = c("10 kB", "100 kB", "1 MB", "10 MB", "100 MB"),
                minor_breaks = c(outer(c(2, 5), 10^(3:8))),
                expand = expansion(mult = 0.13)) +
  time_scale_y("time (log scale)",
               breaks = c(1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1),
               expand = expansion(mult = 0.09)) +
  scale_colour_manual(values = COLOURS, breaks = SERIES, drop = FALSE) +
  labs(colour = NULL) +
  guides(colour = guide_legend(nrow = 2, byrow = TRUE,
                               override.aes = list(linewidth = LINE_W * 1.2, size = POINT_S))) +
  paper_theme()

ggsave("results/figures/paper/pdf/wasmgate.pdf", fig,
       width = 250, height = 160, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/wasmgate.pdf\n")

ggsave("results/figures/paper/png/wasmgate.png", fig,
       width = 250, height = 160, units = "mm", dpi = 300, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/wasmgate.png\n")

#!/usr/bin/env Rscript
# results/figures/paper/pdf/wasmgate.pdf, from results/paper/wasmgate.csv.
#
# The admission test a routine has to pass before compiling it to WebAssembly is
# worth doing.
#
# A worker boundary is free to cross -- postMessage transfers an ArrayBuffer's
# ownership and copies nothing. wasm has no equivalent: it addresses only its own
# linear memory, so a call copies its input in and its result back out whether or
# not the code inside is any faster. Both halves of "is the work bigger than the
# copy" are therefore measurable, and the figure is those two halves in the two
# forms they need to be read in.
#
#   (a) the plane. x is the bytes a routine would have to marshal, the black
#       curve is what moving them costs, and every other curve is that routine's
#       cost in JavaScript. This panel exists to establish the floor: that its
#       points come from a dozen different input and output sizes and still fall
#       on one line is what says it is a memcpy pair and a property of the
#       machine, not of the module it was measured through.
#
#   (b) the same data divided by that floor, which is the number the decision
#       actually turns on: how many times faster a PERFECT port could be. The
#       black line is the floor again, now at 1x, and everything under it is a
#       routine that would come out slower in wasm however fast the wasm was.
#
# The division is not cosmetic. In (a) every curve rises with payload size, so a
# routine's verdict is a GAP between two lines a decade apart on the page and the
# eye has to measure it; in (b) the size dependence divides out and the verdict is
# a height. Neither panel is redundant: (b) alone would be a ratio to a quantity
# the reader has never seen.
#
# One routine is ported, so it is drawn twice in both panels -- solid for the
# JavaScript, dashed for the shipped wasm. In (b) those two curves are directly
# comparable, because a ceiling and a realised speedup are the same kind of
# number: the gap between them is what the port left on the table, and the fact
# that the dashed curve sits inside the room the floor predicted is the check
# that the floor means what this figure says it means.
#
# Minima, not medians. The run of record was taken on a box under load, where
# contention only ever adds time and the fastest repetition is the least
# contaminated one. Every arm of a cell is measured back to back, so what
# contention survives lands on all of them together and the ratios this figure is
# made of hold. See results/wasmgate.md.
#
#   Rscript scripts/paperfigs/wasmgate.R
#
# cowplot stitches the two panels and lifts one shared legend out of them; type
# sizes come from common.R's paper_theme.

suppressPackageStartupMessages({
  library(ggplot2)
  library(ragg)
  library(cowplot)
})
source("scripts/paperfigs/common.R")

d <- read.csv("results/paper/wasmgate.csv", stringsAsFactors = FALSE)
d$js_s <- d$js_ms / 1000
d$wasm_s <- d$wasm_ms / 1000
d$floor_s <- d$floor_ms / 1000
# The ceiling: the floor is a lower bound on what a port must pay, so the JS time
# over it is an upper bound on what any port could return. `realised` is what the
# one shipped port actually returns, in the same units.
d$ceiling <- d$js_ms / d$floor_ms
d$realised <- d$js_ms / d$wasm_ms

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
stopifnot(all(d$candidate %in% CANDIDATES))

# In-panel notes are drawn once, in the left facet: they describe the shaded
# region, which means the same thing in both, and in the right one the (b) note
# landed under the long-read record-walk label.
FIRST_PANEL <- factor(levels(d$panel)[1], levels(d$panel))

as_series <- function(df, y, series) {
  out <- data.frame(panel = df$panel, marshalled = df$marshalled, s = y,
                    series = factor(series, levels = SERIES))
  out[is.finite(out$s), ]
}

# One floor series per panel, from every candidate's own measurement rather than
# one series measured apart.
floor_pts <- as_series(d, d$floor_s, FLOOR)
floor_pts <- floor_pts[order(floor_pts$panel, floor_pts$marshalled), ]
js <- as_series(d, d$js_s, d$candidate)
wasm <- as_series(d, d$wasm_s, d$candidate)
ceiling <- as_series(d, d$ceiling, d$candidate)
realised <- as_series(d, d$realised, d$candidate)

x_scale <- scale_x_log10(
  name = "bytes crossing the wasm boundary (input + result)",
  breaks = 10^(4:8), labels = c("10 kB", "100 kB", "1 MB", "10 MB", "100 MB"),
  minor_breaks = c(outer(c(2, 5), 10^(3:8))),
  # Asymmetric: every curve ends at the right-hand edge and every endpoint label
  # wants the strip past it, so the margin goes where the labels are.
  expand = expansion(mult = c(0.06, 0.2)))

colour_scale <- scale_colour_manual(values = COLOURS, breaks = SERIES, drop = FALSE)

# (b) draws a rectangle over its whole dead zone, which would otherwise widen the
# axis it is drawn on; see the annotate() call there.
x_scale_bounded <- scale_x_log10(
  name = x_scale$name, breaks = x_scale$breaks, labels = x_scale$labels,
  minor_breaks = x_scale$minor_breaks, expand = x_scale$expand,
  limits = range(d$marshalled), oob = scales::squish)

# The last point of each curve, labelled. Placed by ggrepel because six curves
# converge at the right-hand edge of every panel and a fixed nudge stacks them.
last_of <- function(df) {
  do.call(rbind, lapply(split(df, list(df$panel, df$series), drop = TRUE),
                        function(g) g[order(-g$marshalled), ][1, ]))
}
#' Every endpoint label in ONE layer.
#'
#' ggrepel only pushes a label off the labels in its own layer, so drawing the
#' ceilings and the realised speedups as two calls settled "3.1x collected"
#' directly on top of "1.3x" -- each layer solved a problem the other could not
#' see. `face` and `size` therefore come through aes, which is what lets the
#' two kinds of label stay visually distinct inside a single solver.
repel_ends <- function(df) {
  list(
    ggrepel::geom_text_repel(
      data = df, aes(label = label, colour = series, fontface = face, size = face),
      nudge_y = df$nudge_y, seed = REPEL_SEED, show.legend = FALSE,
      box.padding = 0.45, point.padding = 0.3, force = 6, force_pull = 0.3,
      min.segment.length = 0.2, segment.size = 0.25, segment.alpha = 0.5,
      max.overlaps = Inf, max.time = 5, max.iter = 60000),
    scale_size_manual(values = c(bold = ENDPOINT_LABEL, bold.italic = POINT_LABEL),
                      guide = "none")
  )
}

# ---------------------------------------------------------------- (a) the plane

# The dead zone: a routine drawn inside it already costs less in JavaScript than
# moving its own bytes across the boundary.
BOTTOM <- min(c(js$s, wasm$s, floor_pts$s)) / 2
dead <- transform(floor_pts, ymin = BOTTOM)

# (a) carries no ratios at all -- (b) is made of them, and repeating them here
# only crowded the one panel whose job is to show what the floor IS. Its curves
# are named by the legend and the wasm arm by a note on itself.
wasm_note <- do.call(rbind, lapply(split(wasm, wasm$panel, drop = TRUE),
                                   function(g) g[order(g$marshalled), ][1, ]))
wasm_note$label <- "shipped wasm port"

plane <- ggplot(mapping = aes(x = marshalled, y = s)) +
  geom_ribbon(data = dead, aes(ymin = ymin, ymax = s), fill = "grey88") +
  geom_line(data = js, aes(colour = series), linewidth = LINE_W) +
  geom_point(data = js, aes(colour = series), size = POINT_S) +
  geom_line(data = wasm, aes(colour = series), linewidth = LINE_W, linetype = "22") +
  geom_point(data = wasm, aes(colour = series), size = POINT_S, shape = 17) +
  geom_line(data = floor_pts, aes(colour = series), linewidth = LINE_W * 1.4) +
  geom_point(data = floor_pts, aes(colour = series), size = POINT_S * 0.6) +
  geom_text(data = wasm_note, aes(label = label, colour = series),
            size = POINT_LABEL, fontface = "italic", hjust = -0.12, vjust = 2.2,
            show.legend = FALSE) +
  geom_text(data = data.frame(panel = FIRST_PANEL, marshalled = 10^3.75,
                              s = BOTTOM * 1.4),
            aes(label = "the copy alone costs more than the work"),
            size = POINT_LABEL, fontface = "italic", colour = "grey30", hjust = 0) +
  facet_wrap(~panel) +
  x_scale +
  time_scale_y("time (log scale)", breaks = c(1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1),
               expand = expansion(mult = 0.07)) +
  colour_scale +
  labs(colour = NULL, title = "a  What a routine costs, and what moving its bytes costs") +
  paper_theme() +
  theme(plot.title = element_text(face = "bold", size = rel(0.95), hjust = 0))

# ------------------------------------------------------------- (b) the headroom

B_XLIM <- range(c(ceiling$marshalled, realised$marshalled))
B_YLIM <- range(c(ceiling$s, realised$s))

ceiling_ends <- last_of(ceiling)
ceiling_ends$label <- ifelse(ceiling_ends$s < 1,
                             sprintf("%.2f×", ceiling_ends$s),
                             fmt_ratio(ceiling_ends$s))
ceiling_ends$face <- "bold"
ceiling_ends$nudge_y <- 0

realised_ends <- last_of(realised)
realised_ends$label <- sprintf("%s collected", fmt_ratio(realised_ends$s))
realised_ends$face <- "bold.italic"
# Downward, so the collected value and the ceiling it is collected out of do not
# both want the strip immediately right of the last point.
realised_ends$nudge_y <- -0.5

ends <- rbind(ceiling_ends, realised_ends)

headroom <- ggplot(mapping = aes(x = marshalled, y = s)) +
  # Full-bleed to the panel edge, and finite. Both axes here are log and ggplot
  # transforms an annotation's coordinates before it resolves infinities, so
  # +/-Inf reaches log10() and warns on every build -- but a rectangle drawn past
  # the data instead TRAINS the scales, which the first attempt at this did: it
  # stretched both axes by two decades and squashed every curve into the middle.
  # Fixed limits plus `squish` gets both: the corners are clamped to the panel
  # rather than expanding it or being dropped.
  annotate("rect", fill = "grey88",
           xmin = B_XLIM[1] / 2, xmax = B_XLIM[2] * 2,
           ymin = B_YLIM[1] / 2, ymax = 1) +
  geom_line(data = ceiling, aes(colour = series), linewidth = LINE_W) +
  geom_point(data = ceiling, aes(colour = series), size = POINT_S) +
  geom_line(data = realised, aes(colour = series), linewidth = LINE_W, linetype = "22") +
  geom_point(data = realised, aes(colour = series), size = POINT_S, shape = 17) +
  geom_hline(yintercept = 1, linewidth = LINE_W * 1.4) +
  repel_ends(ends) +
  geom_text(data = data.frame(panel = FIRST_PANEL, marshalled = 10^3.75,
                              s = B_YLIM[1]),
            aes(label = "a port here comes out slower, however fast the wasm"),
            size = POINT_LABEL, fontface = "italic", colour = "grey30", hjust = 0) +
  facet_wrap(~panel) +
  x_scale_bounded +
  # Both curves in this panel are speedups over the same baseline, which is what
  # makes them comparable on one axis: the ceiling is what the routine would gain
  # if the wasm compute were free, the realised is what it gained.
  scale_y_log10(name = "speedup over JavaScript",
                breaks = 10^(-3:2),
                labels = c("0.001×", "0.01×", "0.1×", "1× (break even)", "10×", "100×"),
                minor_breaks = c(outer(c(2, 5), 10^(-4:2))),
                limits = B_YLIM, oob = scales::squish,
                expand = expansion(mult = 0.07)) +
  colour_scale +
  labs(colour = NULL,
       title = "b  The same, divided by the floor: the room a port has, and what one collected") +
  paper_theme() +
  theme(plot.title = element_text(face = "bold", size = rel(0.95), hjust = 0))

# --------------------------------------------------------------------- assembly

# Two rows, not one: seven entries on one row runs off the page and cowplot
# clips it silently -- the floor and the block scan simply vanished.
legend <- cowplot::get_plot_component(plane +
  guides(colour = guide_legend(nrow = 2, byrow = TRUE, override.aes =
                                 list(linewidth = LINE_W * 1.4, size = POINT_S))),
  "guide-box-top", return_all = TRUE)

strip <- function(p) p + theme(legend.position = "none",
                               axis.title.x = element_blank())

# The two panels share one x axis and sit one above the other, so only the lower
# one carries its ticks.
plane <- plane + theme(axis.text.x = element_blank(),
                       axis.ticks.x = element_blank())

caption <- cowplot::ggdraw() +
  cowplot::draw_label(
    paste("(a) solid: the routine in JavaScript;  dashed: the one shipped wasm port —",
          "@gmod/bgzf-filehandle's Rust/libdeflate inflate against its pako path.",
          "\n(b) the same two divided by that floor, so solid is the ceiling it allows and dashed is what the port collected.",
          "\nMinima over 21 repetitions on a loaded box — read the ratios, not the milliseconds."),
    size = 11, fontface = "italic", lineheight = 1.15)

x_title <- cowplot::ggdraw() +
  cowplot::draw_label("bytes crossing the wasm boundary (input + result)",
                      size = PAPER_BASE)

fig <- cowplot::plot_grid(
  legend,
  cowplot::plot_grid(strip(plane), strip(headroom), ncol = 1, align = "v", axis = "lr"),
  x_title, caption,
  ncol = 1, rel_heights = c(0.13, 1, 0.05, 0.13))

ggsave("results/figures/paper/pdf/wasmgate.pdf", fig,
       width = 250, height = 250, units = "mm", device = cairo_pdf, bg = "white")
cat("wrote results/figures/paper/pdf/wasmgate.pdf\n")

ggsave("results/figures/paper/png/wasmgate.png", fig,
       width = 250, height = 250, units = "mm", dpi = 200, device = ragg::agg_png,
       bg = "white")
cat("wrote results/figures/paper/png/wasmgate.png\n")

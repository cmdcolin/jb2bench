# What the table generator cannot fix

`scripts/render/papertables.ts` regenerates the four render tables, so their
numbers cannot drift again. Three things in `paper.tex` are still wrong and none
of them is a number.

## 1. The zoom section states a mechanism the run contradicts

> The prior architecture **refetches** and re-renders on every zoom, so it shows
> a download indicator for one to fifteen seconds

Release 4.3.0 does not refetch on a zoom-in. Measured 2026-08-24 with per-step
network accounting taken from CDP rather than from either application, across 60
cells — three JBrowse arms and two igv.js arms over twelve cases — **every arm
issued zero data requests and moved zero bytes on every zoom step**, and every
step was served from data already held.

What the old renderer does is re-rasterize: the block renderer repaints tiles in
a worker, and that is what costs one to fifteen seconds. The table's numbers are
sound and the conclusion holds. The causal claim is wrong, and a reviewer can
falsify it in an afternoon with devtools open.

Suggested: "The prior architecture re-rasterizes the whole viewport on every
zoom, so it shows an indicator for one to fifteen seconds, and the wait grows
with read depth." The download indicator is real; what it indicates is not a
download.

## 2. "Time-to-content is zero by construction" is the indicator's zero

The caption is careful — "this work's zero follows from the absence of a refetch
and is not an independent measurement" — and then the body escalates it:

> so time-to-content is zero by construction in every case

Zero is what the loading-indicator instrument reports when no indicator is ever
displayed. It is not what a user waits. Measured on the draws-and-network clock,
which consults neither application, this work takes **504--532 ms** on a zoom at
every coverage, read type and container. 500 ms of that is the
`LGVCoarseDynamicBlocks` navigation debounce and 0.2--0.6 ms is the redraw.

That is still far better than 1--15 s, and it is a better story than the zero:
the drawing is essentially free and a configured constant is what stands between
users and it. `results/crosstool-zoom.md` has the measurement.

## 3. Two prose ranges and the initial-render caption

- Pan: "the margin is 1.9 to 4.3 times" is now **1.90 to 7.33 times**.
- Initial render: "the five usable cases improve by 1.29 to 2.19 times" is now
  **six cases, 1.36 to 4.18 times** — no row is excluded any more.
- The initial-render caption still explains why the 1000x long read row is
  unusable. It is not. It was re-measured on a quiet box on 2026-08-24 at 0.19
  cores of foreign CPU, it passes the gate, and at **4.18x** it is the largest
  margin in the table. The generated caption already says this; the old one has
  to come out of `paper.tex`.

## One shape change to approve or reject

`tab-initial-render.tex` carries **four** build columns — this work, 4.3.0,
4.1.15 and 2.4.0 — where `paper.tex` prints three. The run measured all four and
2.4.0 is the version the 2023 paper benchmarked, so dropping it silently seemed
worse than adding a column somebody has to accept.

Note also that **4.1.15 was retired as a jb2bench arm on 2026-08-24**: it sat
within about 1% of 4.3.0 in every one of the twelve cells (4700/4646, 2794/2786,
2613/2622), so it moved no conclusion and cost a quarter of the longest matrix.
This run still carries it. The next one will not, and the generator drops a
column that has no data rather than printing dashes.

# The 0.8 s zoom settle: half a second of debounce, and half of instrument

`results/crosstool-zoom.md` reports that after a 2x zoom-in the rendered image
keeps changing for ~0.8 s in JBrowse, at 20x and at 1000x coverage alike. This is
what it turned out to be, and it is neither drawing nor a bug.

> **This file replaces an earlier version that was wrong.** It reported an
> at-rest re-render loop, on evidence from a diagnostic whose own clipped
> screenshots were causing what it measured. The retraction is at the bottom,
> kept because the way it went wrong is the reusable part.

## What it is

**A deliberate 500 ms delayed autorun, plus instrument overhead.**

With no screenshots taken at all — draw calls and DOM mutations recorded from
inside the page — a 2x zoom-in produces:

| | |
| --- | --- |
| first draw | **1 ms** |
| last draw | **505 ms** (505, 505, 506 across three runs) |
| draws in between | 18 |
| DOM mutations | stop in the same 500 ms bucket |

That reproduces to the millisecond, which is the signature of a timer rather than
of work. It is `setupCoarseDynamicBlocksAutorun` in
`plugins/linear-genome-view/src/LinearGenomeView/afterAttach.ts`:

```ts
autorun(function coarseDynamicBlocksAutorun() {
  if (self.initialized) {
    self.setCoarseDynamicBlocks(self.dynamicBlocks, self.bpPerPx)
  }
}, { delay: 500, name: 'LGVCoarseDynamicBlocks' })
```

The zoom redraws the track at the first frame; half a second later the coarse
blocks are written and whatever reads them repaints. `FetchVisibleRegions` runs
on a 600 ms debounce and is the other timer in this neighbourhood, but the tail
ends at 505 ms, so it is the 500 ms one.

The gap between 505 ms and the reported ~800 ms is `zoomprofile.ts` itself: it
wants three consecutive unchanged polls and subtracts a nominal 3 × 100 ms, but
each poll also takes a screenshot, so the real interval between polls is nearer
150–180 ms and the subtraction under-corrects by roughly what is missing.

**The track's own pixels are correct at the first frame.** Nothing here
contradicts `results/interaction.md`: time-to-content on zoom is 0 because no
refetch happens, and the redraw fits in a frame.

## At rest, the page is idle

`scripts/crosstool/restprofile.ts` settles the initial render and then profiles
pure idle. Over a 6 s window: **95.7% idle, 4.3% `(program)`, about 1 ms of
JavaScript.** No draws, no mutations, no timers firing. There is no loop.

## The retraction, and why it matters for anything else measured here

The first version of this file claimed an at-rest re-render loop: display phase
flipping `loading -> ready` several times a second, the canvas remounted ~3×/s,
54–99 draws in 2.5 s of "idle". Those numbers were real. Their cause was
`zoomdiag.ts` polling `page.screenshot({ clip })`.

A **clipped** capture is not a passive read. Measured directly:

| what the harness did, 10 times | draws | phase writes |
| --- | ---: | ---: |
| `page.screenshot()` (full viewport) | 0 | 0 |
| `page.setViewport()` 1280↔1281 (a real resize) | 90 | 0 |

A clipped capture behaves like the resize, not like the full-viewport shot —
which is exactly what it should do, since a resize legitimately re-lays-out and
redraws. Set `NO_SHOTS=1` and the churn is gone, 3 runs out of 3.

So:

- **`zoomprofile.ts` and `paintprofile.ts` are not affected.** Both take
  full-viewport screenshots, and those measured zero induced draws.
- **`zoomdiag.ts`'s clip was.** It now carries `NO_SHOTS=1`, and any finding from
  it should be confirmed with that set before it is believed.
- The four controls in the first version — no zoom, release-4.3.0, no track, no
  timers — were all consistent with the wrong conclusion because every one of
  them removes the *canvas*, and no canvas means nothing for the clip to
  perturb. Controls that vary the subject cannot catch an instrument that is
  perturbing the subject. The control that did catch it varies the *instrument*.

## Reproduce

```bash
NO_SHOTS=1 node scripts/crosstool/zoomdiag.ts "<url>"      # the app's real activity
NO_SHOTS=1 NO_ZOOM=1 node scripts/crosstool/zoomdiag.ts "<url>"   # at rest: silent
node scripts/crosstool/restprofile.ts "<url>" rest 6000    # idle CPU profile
node scripts/flamegraph/cpuprofile2collapsed.ts flame/rest.main.cpuprofile > flame/rest.folded
node scripts/flamegraph/hotfns.ts flame/rest.folded
```

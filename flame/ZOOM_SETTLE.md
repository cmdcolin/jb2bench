# The 0.8 s zoom settle is not the zoom

`results/crosstool-zoom.md` reports that after a 2x zoom-in the rendered image
keeps changing for ~0.8 s in JBrowse, and reports the same figure at 20x and at
1000x coverage. This is what that turned out to be. Reproduce with
`scripts/crosstool/zoomdiag.ts`, which records three channels against one clock:
GPU draw calls, DOM mutations, and a screenshot clipped to the track canvas.

## What it is

**An ambient re-render loop, present with no interaction at all.** The display
re-enters its loading phase and the track canvas is torn down and rebuilt several
times a second, on an untouched view.

Measured on `builds/current` at `chr22_mask:124000-143000`, 20x shortread,
`?renderer=webgl`, with `NO_ZOOM=1` — no zoom, no pan, no input of any kind:

| channel | at rest, 2.4–4 s window |
| --- | --- |
| `data-display-phase` | `loading -> ready` **16 times** |
| canvas element | recreated ~3 times a second |
| canvas sizing | each new canvas set to **564 px**, then corrected to **1266 px** one frame later |
| GPU draws | 54–81, spread across the whole window |
| `setInterval` handlers firing | **none** |

The 564 → 1266 pair is the signature of a remount rather than a resize: a fresh
canvas takes the container's pre-layout width and is corrected after measurement,
so every cycle draws twice, once at the wrong width.

## The controls, which are what make it a finding

- **No zoom.** Identical churn. So the 0.8 s is not a cost of zooming.
- **Release 4.3.0, same harness, same locus, at rest.** Zero DOM mutations, zero
  draw calls, zero canvas writes. Completely quiet. So it is new.
- **No track loaded, same build.** Zero mutations, zero draws. So it is the
  display, not the view chrome around it.
- **Timers.** `setInterval` traced from before page scripts run (`TRACE_TIMERS=1`,
  installed via `evaluateOnNewDocument` so startup registrations are visible):
  nothing fires. It is not a poller.
- **The instrument itself.** The pixel churn was first seen by `zoomprofile.ts`,
  which installs no observer, so it is not an artifact of the diagnostic.

Not tested: whether other display types do it. The wiggle attempt failed because
`builds/current` has no `.bw` track wired up — `shell/load_alignments.sh` loads
BAM and CRAM only.

## Why the measured number looked like a zoom cost

`zoomprofile.ts` waits for three consecutive 100 ms polls with an unchanged
screenshot. A remount blanks the canvas for a frame, so the stability counter
resets whenever a poll lands inside one. The reported figure is therefore the
expected wait to catch a quiet ~300 ms gap in a loop running at 3–7 Hz — which is
why it is ~0.8 s, and why it does not move when the data volume changes by 50x.

The track's own pixels settle at the **first** poll after the zoom (1 ms). The
drawing was never the cost.

## What is not affected

- **Time-to-content** (`results/interaction.md`) reads JBrowse's loading
  indicator, not pixels, and its zoom result stands.
- **Redraw cost** is the longest rAF gap spanning the redraw, also unaffected.
- The **cold-load** numbers use a quiescence detector that wants five stable
  polls of the done-marker count. Since that marker is one of the attributes
  flipping, an interaction is possible in principle; the recorded stddevs are
  small (±38 ms on 20x shortread) and reproduce across runs, so it does not look
  like it bites, but nothing here proves that.

## Open

Which observable flips. The loading term is
`!loadingSuppressed && (isLoadingOrCanceled || (rendersCanvas && !canvasDrawn) || !viewportCurrent())`
in `packages/render-core/src/displayPhase.ts`. The `rendersCanvas && !canvasDrawn`
clause is self-referential across a remount — a rebuilt canvas has not drawn yet,
so the term that unmounts it can be re-armed by the unmount — which makes it the
first place to look, but nothing here has confirmed the entry point into the
cycle. That wants MobX-level tracing inside the app (`?gpu-perf=1`, or a `spy` on
the reaction) rather than more black-box probing from out here.

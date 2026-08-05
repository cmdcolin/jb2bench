# Interaction CPU profile — zoom, per-frame React/MobX cost

Measures the per-frame main-thread cost of a sustained interaction (not
time-to-content). Driven by `scripts/flamegraph/interaction-profile.ts`: after initial
render it arms the V8 CPU profiler and drives an rAF-paced interaction that stays
WITHIN loaded data (no refetch), so the profile is pure re-render/recompute.
`THROTTLE=n` applies CDP CPU throttling to emulate a slower machine.

Case: `chr22_mask:130000-131000` (1kb, labels on), `1000x.shortread.bam`,
`renderer=webgl`, **Jun-13 build** (stale — see caveats). ~240 frames.

## Zoom, frame gaps vs CPU throttle

Jun-13 build (`builds/webgl-poc`):

| CPU | median frame | p90 | p99 | max | dropped (>20ms) |
|---|---:|---:|---:|---:|---:|
| **1×** (fast desktop) | 16.7ms | 16.8ms | 17.2ms | 21ms | **0%** — smooth 60fps |
| **4×** (mid laptop) | 32.7ms | 42.8ms | 54.6ms | 84ms | **100%** — ~30fps |
| **6×** (unplugged/old) | 45.9ms | 62ms | 87ms | 114ms | **100%** — ~20fps |

Fresh build of current `webgl-poc` (`builds/webgl-poc-current`, 2026-07-10) —
somewhat better at 4× but still throttle-bound:

| CPU | median frame | p90 | p99 | dropped |
|---|---:|---:|---:|---:|
| **1×** | 16.7ms | 16.8ms | 17.2ms | **0%** |
| **4×** | 21.5ms | 26.5ms | 35.5ms | **81%** |
| **6×** | 44.5ms | 95.6ms | 171ms | **99%** |

Frame time scales ~linearly with the CPU factor (16.7 → 32.7 → 45.9). **That is
the signature of a main-thread-JS-bound frame, not a GPU-bound one** — if the GPU
draw were the limit, throttling the CPU wouldn't move it. Pan behaves the same
(16.7ms median at 1×), so the finding is general to interaction, not zoom-only.

## Where the per-frame JS goes — CURRENT build (4× zoom, resolved)

After `(program)` 55%, top self-time (fresh build, authoritative for current
source): **Emotion CSS-in-JS** (`@emotion/styled` 65+41ms, `@emotion/hash` 44ms,
`@emotion/serialize [serializeStyles/handleInterpolation]` 36+19ms ≈ 205ms),
**MUI render machinery** (`@mui/material/Tooltip` 26+17ms — re-renders every zoom
frame even with nothing hovered; `@mui/system/createStyled [processStyleVariants]`
19ms; `@mui/material/utils/useSlot` 17ms), **React reconcile** (`renderWithHooks`,
`updateForwardRef`, `createElement`), **DOM churn** (`removeChild`,
`setAttribute`). **MobX not in the top 22. `drawArrays` absent.** Same shape as
June below, now pinned to MUI+Emotion styled-component re-render as the concrete
cost.

## Where the per-frame JS goes (Jun-13 build, 4× zoom, resolved via sourcemaps)

Top self-time after `(program)` 54% (browser style/layout/paint/composite —
itself inflated by the DOM churn below) and idle:

- **React reconcile + commit** — `setValueForStyle(s)`, `completeWork`,
  `updateFromMap`, `renderWithHooks`, `updateForwardRef`, `detachDeletedInstance`
  (react-dom).
- **CSS-in-JS runtime** — `@emotion/serialize [serializeStyles]`,
  `@emotion/hash`, `@emotion/styled`, and tss-react `fixClassName`
  (`packages/core/src/util/tss-react/cssAndCx.ts:143`). Styled/`makeStyles`
  components re-generate CSS on each render.
- **DOM churn** — `removeChild` / `appendChild` / `createElement` /
  `setAttribute`, whose direct callers are all react-dom commit internals
  (`pu`/`ju`/`_u`) — i.e. React committing updates from **many** small
  components, not one hot component.
- **MobX** (`1397.chunk`, mobx) self-time is minor — it does **not** dominate.
- **GPU** — `drawArrays` appears once; the pileup canvas redraw is negligible.

## Tooltip-clear-on-zoom fix — MEASURED perf-neutral

Hover+zoom (`HOVER=1`, cursor parked over a read so a tooltip is active), 4×:

| build | 1× | 4× |
|---|---|---|
| baseline (pre-fix) | 16.7ms / 0% | 21.4ms / 74% |
| fixed (`ce1e168b71`) | 16.7ms / 0% | 21.1ms / 74% |

Within noise. Activating a hover on the *baseline* also zoomed the same as
no-hover (21.4 vs 21.5ms), because the alignments tooltip is an `observer` with
stable deps — during a stationary-cursor (wheel) zoom it does **not** re-render.
So the fix is a correct **UX** change (no stale, wrong-bp tooltip during zoom),
not a speed win. The `@mui/material/Tooltip` self-time seen in the profiles is
**chrome** (e.g. `TrackHeightIndicator`'s `CascadingMenuButton`, LGV header
controls), not the hover tooltip.

## Conclusion

The felt slowness is the classic **React re-render + CSS-in-JS per-frame tax**,
spread across the overlay/chrome React tree that re-renders every interaction
frame — invisible at desktop speed (~50% idle headroom) but it drops frames
under any CPU throttle (laptop / unplugged). MobX reactivity and WebGL draw are
NOT the bottleneck. "Reduce MobX" would be misdirected; the lever is **fewer
React renders per frame** and **less CSS-in-JS work per render**.

### Directions (measured, not guessed)

1. Keep the React overlays (sashimi/bezier/labels/axes/handles) from
   re-rendering every interaction frame — reposition via a cheap CSS transform
   during the gesture and re-render on settle (coarse blocks), the same way the
   GPU pileup canvas already repositions via a uniform instead of a React render.
2. Cut CSS-in-JS from the per-frame path: hoist static styles out of render,
   avoid dynamic `styled`/`makeStyles` props on per-frame components, prefer
   plain style objects / stable class names so Emotion doesn't re-serialize.

## Caveats

- **Jun-13 build.** Numbers are real but the resolved *component* attribution is
  against June source; a fresh `webgl-poc` build would refine which overlays
  churn. The class of finding (React + CSS-in-JS per-frame) is architectural and
  stable.
- One light locus (1kb, plain pileup). Heavier loci that mount more overlays
  (sashimi, linked-read beziers, grouped sections, coverage ticks) churn more
  React/DOM per frame — expect the throttled gap to widen.
- `scripts/flamegraph/interaction-profile.ts <url> <label> [pan|scroll|zoom|both]`,
  `THROTTLE=n` for CPU emulation. Profiles saved under `flame/`.

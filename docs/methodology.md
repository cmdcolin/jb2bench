# Methodology and caveats

## How the measurement is kept fair

This repo replaces `~/src/dont_care/jb2profile`, whose puppeteer scripts were
overfit to the old block-based DOM: they waited for an exact
`BLOCKS_PER_TRACK * n` count of `pileup-overlay-normal` / `wiggle-rendering-test`
blocks. The new branch paints a single canvas per display, so block counting no
longer applies. The first three points below follow from that; the rest are
lessons from measurements that turned out to be measuring the wrong thing.

- **Render-complete detection spans two disjoint contracts, and it says which
  one it used.** `scripts/render/profile.ts` waits for *quiescence*, but what
  counts as a render-complete marker depends on the build's vintage. Verified
  against `builds/` on 2026-08-12:

  | build          | signal                                             |
  | -------------- | -------------------------------------------------- |
  | release-4.3.0  | 4 × `[data-testid$="-done"]`, no phase attributes   |
  | current main   | `[data-display-phase]` + `[data-display-drawn]`     |

  There is **no overlap**, so the old marker-only detector this file used to
  describe finds nothing on a build from current main and every such row times
  out at 120 s. The detector now picks the contract inside the poll — sampling
  it beforehand does not work, since at that moment no display has mounted — and
  prints `render-complete contract: phase|legacy` on stderr so a row measured
  under a different contract from its neighbours is visible rather than silently
  incomparable.

  Guessing wrong does not error, which is why this matters: the unmatched
  selector makes the wait return immediately, and the build reports a render
  time near zero. On a baseline column that quietly shrinks every speedup in the
  table.

- **The loading indicator is no longer read as text, because that cannot be made
  to work.** `scripts/render/interaction.ts` decides that content is back when
  nothing is outstanding, and until 2026-08-25 it asked that by matching
  `document.body.innerText`. Both patterns it could use are wrong:
  `/Downloading|Loading alignments|Rendering/` misses release-2.4.0, which labels
  a refetching block plain **`Loading`** and its worker step **`Serializing
  results`**; adding `/\bLoading\b/` matches release-4.3.0 *permanently*, since
  4.3.0 fully rendered and idle still carries four `Loading` strings, so every
  step runs to `MAX_WAIT`. The per-build fallback between them needs the page to
  be genuinely at rest when it samples, and on 2.4.0 the render-complete detector
  says "at rest" with one block of six painted — so the fallback chose the narrow
  pattern for 2.4.0 in **seven of twelve cells**, and those cells recorded 0 ms
  with `loadingEverSeen: false` for zooms that take seconds.

  The direction of the error is what makes it dangerous: an unrecognized
  indicator can only ever make a build look *faster*, and it lands hardest on the
  oldest build in the matrix, whose wording is least likely to match.

  `scripts/render/contentready.ts` replaces it with a structural question, per
  build generation. Builds from the DisplayChrome work publish
  `data-display-phase` and `data-display-drawn`; older builds (4.3.0 and 2.4.0
  alike) mark each finished block with a **region-keyed** marker,
  `prerendered_canvas_{hg19mod}chr22_mask:119891..131879-0_done`. Content is back
  once the finished regions **cover the region on screen** — which is exact,
  needs no word list, and is checkable the instant an interaction is applied.
  `DETECTOR=text` still runs the old way for comparison.

  Two wrong versions of this are recorded in that file's header so nobody rebuilds
  them. Waiting for the DOM to *stop changing* declares content back in the gap
  between two blocks, which under load ended a warmup step early and left 2.4.0's
  track blank for the rest of the run. Counting *finished blocks* instead of
  measuring coverage called a view ready with half the screen unrendered, and
  then called a pan ready because the one stale block still overlapped the new
  view.

  Measured 2026-08-25 on 200x-longread-bam, zoom in: `builds/current` reads 0 ms
  on every step with **nothing** outstanding at any sample — its zero now rests on
  a positive structural fact rather than on a regex missing — while 2.4.0 reads
  1.8–5.1 s where the text detector recorded 0. **`results/interaction.json`
  predates this and was measured with the text detector; the matrix needs
  re-running on an idle box before those numbers are quoted.**

- **A positive gate runs before any of it.** Every signal above is negative — no
  overlay, no unpainted display, no unstable count — so all of them pass on a
  page whose JavaScript never ran. `profile.ts` first waits for
  `window.JBrowseSession` to exist with its views initialized, so a 404ed config
  fails loudly instead of reporting a very fast render of an empty browser. A
  timeout with no display mounted at all now says so, because that is nearly
  always a trackId this build's `config.json` does not define.

  That gate is a stand-in for `@jbrowse/capture`'s `waitForSession`, which is the
  maintained implementation of this problem and has more stages (view phases,
  quiescence, a paint contract, and a check that the requested trackIds are
  actually open). It is not imported because that package's `exports` resolves to
  `./src/index.ts` while its `files` ships only `esm/`: the bare specifier lands
  on TypeScript inside `node_modules`, which node refuses to strip, and the built
  output is unreachable through the exports map. If that gets fixed — sibling
  `@jbrowse/img` has it right — drop the hand-rolled gate and take its stages.
- **Headless but still hardware-accelerated.** Plain headless Chrome on Linux
  falls back to the SwiftShader software rasterizer, which would unfairly slow
  the branch's GPU path. `--use-angle=gl` makes headless render WebGL2 through
  ANGLE on the Mesa Intel UHD 630 instead — verify with `scripts/gpucheck.ts`,
  which reports the `UNMASKED_RENDERER_WEBGL` string. Set `HEADLESS=0` to watch
  it run on the X display.
- **The metric is in-page navigation→render-complete time**, not whole-process
  wall-clock, so the ~3 s constant browser-launch overhead does not wash out the
  render difference.
- **Contamination is recorded per cell, not per run.** Competing load does not
  corrupt a run uniformly — it lands on whichever cells overlap the other job, so
  a run whose median load looks fine can still contain one ruined row. Both
  runners now read `/proc/loadavg` either side of every cell, store it with the
  measurement, and print a warning naming any cell measured at more than twice
  the run's median load (`scripts/render/loadavg.ts`). `results/alignments.md`
  carries the date and peak load of every row.
- **The build under test is identified, not assumed.** See "Builds compared".
- **The browser is pinned.** `puppeteer` is held at an exact version rather than
  a caret range, because the Chrome it bundles *is* the measurement instrument —
  a routine `pnpm update` would otherwise swap it and shift every number without
  anything looking wrong. The recorded results were produced with puppeteer
  24.43.1 → **Chrome for Testing 148.0.7778.97**.


## Caveats worth attaching to any external claim

- **WebGPU is not what is being measured.** The headline numbers are WebGL2;
  WebGPU is pinned off because of Dawn validation errors on this box (above).
- **Part of the long-read initial-render win is not the renderer.** Some of it
  comes from the branch's intentional SNP downsampling, which changes what is
  drawn, not just how fast it is drawn.
- **`flame/FINDINGS.md` is still against a Jun-13 build.** It resolves frames
  against June source. The class of finding is stable; the specific attribution
  needs a re-profile against a fresh build.
  `flame/WORKER_FINDINGS.md` **was** in this position and no longer is — it was
  re-profiled on 2026-08-11 against a current build, which confirmed the
  `_computeTags` fix had landed (586 ms → gone), kept two of its three verdicts
  with measurements behind them, and corrected a third claim that had been
  reasoned forward from the stale trace. Its "bgzf pool not captured" caveat is
  closed too — `flameprofile.ts` attached to the page's own workers and stopped,
  missing the pool the RPC worker spawns; it now recurses, and the pool is
  measured. A thread that is not attached looks exactly like a thread that is
  cheap, which is worth remembering before trusting any per-thread number here.
- **One machine, one locus.** Everything is a single workstation at
  `chr22_mask:124000-143000`, and the per-frame numbers come from a light 1 kb
  locus. Heavier loci that mount more overlays churn more per frame.
- **The machine is shared, and the heaviest row is currently unmeasurable.** The
  2026-08-05 numbers were taken at load 4–12, against 1.45–2.90 for a clean run,
  with spikes past 35 from a dozen other agent processes. The light rows
  reproduced June within 1%, which is the reason to trust them;
  `1000x-longread` did not, in either of two attempts, and
  `results/alignments.md` marks it `unusable` rather than reporting a speedup.
  Check the load column before quoting any row.
- **The pan comparison is one run, not a median of runs.** Each cell is the
  median of five pan steps, but the cell itself was measured once. Between the
  rightward and leftward pan runs, `200x-shortread` on release-4.3.0 moved
  1818 → 1310 ms with no corpus reason (short-read depth is flat), so
  run-to-run spread on this metric is real and not yet quantified. The ratios
  are robust — both builds are measured minutes apart under the same conditions
  — but a single absolute pan figure should not be quoted to three digits.

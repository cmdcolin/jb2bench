Complete, and the result is unambiguous and consistent across every case:

Zoom interaction benchmark — time-to-content (loading shown per zoom-in)

┌─────────────────┬───────────┬───────────────┬────────────────────────┐ │ case
│ webgl-poc │ release-4.3.0 │ webgl-poc redraw frame │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
20x-shortread │ 0ms │ 1074ms │ 17ms │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
200x-shortread │ 0ms │ 1106ms │ 17ms │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
1000x-shortread │ 0ms │ 1760ms │ 17ms │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
20x-longread │ 0ms │ 1150ms │ 17ms │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
200x-longread │ 0ms │ 2786ms │ 17ms │
├─────────────────┼───────────┼───────────────┼────────────────────────┤ │
1000x-longread │ 0ms │ 15008ms │ 117ms │
└─────────────────┴───────────┴───────────────┴────────────────────────┘

webgl-poc shows correct content instantly on every zoom (no loading state ever
appears); the old build makes the user wait 1–15 seconds of "Downloading
alignments…" on each zoom, scaling with data weight. This is the architectural
win the initial-render numbers couldn't capture.

Now let me clean up the editor diagnostics across the toolkit (benchmarks are
done, so installing won't perturb timings):

Ran 1 shell command

Done — and the diagnostics are now clean (added @types/node + tsconfig.json;
verified scripts still run and headless still gets the hardware GPU).

Bottom line: yes, we proved it — on the axis that matters

Your instinct was exactly right. Initial render is fetch-dominated and
undersells the rewrite. The interaction benchmark is where the GPU
architecture's advantage is undeniable:

Initial render (cold start, fetch-bound): webgl-poc is 1.1–1.5× faster on 5/6
cases, with one regression (1000x-shortread, traced to placeRect running on the
main thread — flame/FINDINGS.md).

Zoom (the real story): every zoom on the old build refetches + re-renders → 1–15
s of "Downloading alignments…", scaling with data weight. webgl-poc re-projects
already-loaded reads with 0 ms loading on every zoom — content is never lost;
the only cost is a single ~17–117 ms redraw frame. That's the architectural
payoff: render is decoupled from the data fetch and from bpPerPx.

What's in ~/src/jb2bench

- Two benchmarks: results/alignments.md (initial render) and
  results/interaction.md (zoom time-to-content)
- Flamegraph toolkit: flame/\*.svg + flame/FINDINGS.md (the 1000x-shortread root
  cause)ts / cpuprofile2collapsed.ts / resolve.ts / hotfns.ts
- Fair-measurement infrastructure: renderer-agnostic render-complete detection
  (no block-count overfit), headless-but-hardware-GPU (gpucheck.ts proves Mesa
  Intel, not SwiftShader), in-page timing
- README.md documents all of it

Two honest caveats I'd keep attached to any external claim: the headline zoom
numbers ws Dawn validation errors on this Intel box), and part of the longread
initial-renderwin comes from the intentional SNP downsampling, not purely the
renderer.

If you want, next steps could be: prototype offloading the heavy placeRect
layout to the worker to kill the 1000x-shortread regression, or add a
pan/zoom-out benchmark (where both refetch, to show the redraw cost in
isolation).

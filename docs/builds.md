# Builds compared

`builds/` is untracked — each entry is a deployed `jbrowse-web` build plus
symlinks into `data/`, staged by hand and wired up with
`shell/load_alignments.sh`.

| build | what it is |
| --- | --- |
| `current` | `jbrowse-components` main, copied from `products/jbrowse-web/build`. The first build in `runner.ts`. Restaged 2026-08-18 from `7fbb075ee5`; the commit it came from is in `builds/current/BUILD_INFO.txt`, because "HEAD" names a different build every week and the recorded numbers say only `current`. |
| `webgl-poc` | the original branch build (Jun 13) the June numbers and all the flame profiles come from |
| `webgl-poc-current` | a fresh build of the same branch (2026-07-10), used for `results/interaction-cpu.md` |
| `webgl-poc-fixed` | the branch plus the tooltip-clear-on-zoom fix `ce1e168b71`, measured perf-neutral |
| `release-4.3.0` | last release, old block renderer — the baseline every speedup is against |
| `release-4.1.15` | retired as an arm on 2026-08-24 — it sat between two releases and moved no conclusion. Still staged; nothing serves it. |
| `release-2.4.0` | **the version the 2023 Genome Biology paper describes** — see below |

## `release-2.4.0`, the published baseline

Added 2026-08-11. Every other baseline here is a recent predecessor, which
answers "what did this release change" and not "what has changed since the
version people have read about". The 2023 paper archived its own source as
JBrowse v2.4.0 (Zenodo `10.5281/zenodo.7710472`) and benchmarked "jb2 parallel
(v2.4.0)", so v2.4.0 is the version in the literature and the right thing to
measure against.

No build from source is needed, which is worth knowing before anyone tries:
the release still ships a prebuilt web bundle.

```bash
curl -L -o /tmp/jb-web-2.4.0.zip \
  https://github.com/GMOD/jbrowse-components/releases/download/v2.4.0/jbrowse-web-v2.4.0.zip
mkdir -p builds/release-2.4.0 && unzip -q -o /tmp/jb-web-2.4.0.zip -d builds/release-2.4.0
./shell/load_alignments.sh        # wires the assembly + 12 alignment tracks
```

**A 2026 `jbrowse` CLI config does load in the 2023 build** — this was the risk
and it was checked rather than assumed. Serving `builds/release-2.4.0` and
opening `?loc=chr22_mask:124000-143000&assembly=hg19mod&tracks=20x.shortread.bam`
in headless Chrome renders the ruler and the track with six canvases and zero
console or page errors. The build stamps `main.05f7e6e1.js`, unique against
every other `builds/*`, so `servedbuild.ts` resolves its name correctly and no
runner change was required.

**The corpus already matches the 2023 paper's**, which is why this comparison is
worth anything: that paper generated reads over `chr22:25,000,000-25,250,000` on
hg19 with `pbsim --depth 1000 --hmm_model data/R103.model --length-mean 50000`
and `wgsim -1 150 -2 150 -N 1000000`, and `shell/generate_alignments.sh` uses the
same 250 kb slice and the same two invocations. `runner.ts`'s 19 kb window
carries a comment saying it matches the historical `jb2profile`.

**First measured 2026-08-13, and every row of it is over the load ceiling.** The
run was made to a deadline on a box sitting at load 7–28 from unrelated work, so
`results/alignments.md` marks all four re-measured rows `unusable` and none of
the absolute milliseconds should be quoted. What survives is the *ratio*: the
four builds are measured back to back inside each case, so a load spike lands on
all of them at once rather than on one column. Read against v2.4.0 those ratios
were 2.0× (1000x-shortread), 2.4× (20x-shortread) and 3.6× (200x-longread).

The cold-load measurement on an idle box is still owed, and it is the one worth
having, since a contaminated row can only be re-run and not repaired.

**It is wired into every runner** on port 8004 — `runner.ts` (JBrowse-only cold
load), `runner-interaction.ts` (JBrowse-only zoom, zoom-out, pan) and the
cross-tool pair, `crosstool/runner.ts` and `crosstool/panrunner.ts`, which take
one arm per port through `JBROWSE_PORTS` and are what `make crosstool` drives.

Since 2026-08-24 it is not an optional extra arm anywhere it matters: every
figure in `results/figures` draws v2.4.0 beside v4.3.0, the build under test and
igv.js, so a run that omits 8004 cannot produce the figure set. That is the 2023
paper's own Fig 8 comparison re-run on a corpus built to the paper's recipe, with
an instrument belonging to neither tool.

In the interaction runner the role is **optional**: if nothing is served on
8004 it logs `published: port 8004 not served, skipping (optional)` and emits
the old two-column tables. The other roles stay required, because a missing
baseline is a broken run rather than a smaller one. Both paths were checked with
`MODES=none`, which rebuilds the report from recorded JSON without measuring;
with 8004 up, unmeasured cells print `—` rather than an empty column.

Zoom is where this column is most worth having. Cold load is fetch-dominated
and compresses three years into a small ratio, whereas zoom-in is the case the
architecture actually changed.

**Read that column as cumulative, not as a second isolation.** Three years of
change separate 2.4.0 from HEAD, and almost none of it is the renderer. 4.3.0 is
the column that isolates this release; 2.4.0 is the column that tells a reader of
the 2023 paper what the intervening period bought them. The two answer different
questions and the report should not present them as one gradient.

Expect cells to fail rather than to be slow. `profile.ts` caps a run at 120 s, so
a 2023 build that cannot finish 1000x longread will error that cell — which is
itself a result, and should be printed the way igv.js's censored rows are rather
than quietly dropped.

**Port 8000 means "whichever new build you are testing."** The runners no longer
guess which one that is: each fetches the served `index.html`, matches its
content-hashed bundle against `builds/*/index.html`, and labels the column with
the build directory it actually found (`scripts/render/servedbuild.ts`). A port
serving something that is not in `builds/` aborts the run rather than producing a
table whose headers are a guess.

That check exists because the guess was wrong. Both runners used to hardcode a
name for port 8000 — and disagree about it, `current` vs `webgl-poc`. On
2026-08-05 port 8000 was serving `builds/current`, so `results/interaction.md`
attributed a correct measurement to `webgl-poc`, a different build. `current`
does ship the WebGL2 renderer, so the comparison itself stood; only the name was
wrong. The tables now name `current`.

> WebGPU note: the branch's default ladder is WebGPU → WebGL2 → Canvas2D.
> WebGPU initializes on this Intel UHD 630 / Vulkan / Dawn stack but emits
> texture-allocation validation errors, so the benchmark pins WebGL2 via
> `?renderer=webgl` — the stable path, and the realistic fallback most users hit
> today. Releases ignore the parameter.


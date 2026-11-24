# Dell Precision 7540, paper 100 kb cells, 2026-11-24

- Top level: the second full Firefox Nightly run (the reshoot).
- `run1/`: the first full run; `run1/rerun-200x-longread/` repeats that cell.
- `chrome-200x-longread/`: the 200x long-read cell in headless Chrome on the
  same machine, 8 runs, WebGL 2 and Canvas 2D.

Firefox splits the 200x long-read cell into runs of about 3.0 s and about
4.7-5.1 s on every backend, in all three Firefox runs; one run of the first
stalled at "Downloading alignments 0%" and was closed by hand (FAIL). Headless
Chrome on the same machine does not split (WebGL 2 2.63-2.83 s, Canvas 2D
3.01-3.24 s), nor does Chrome on the T4 (results/ec2/2026-11-24-t4-100kb).
Treat the Firefox 200x long-read medians as unreliable.

Both full runs agree elsewhere: at 1000x short reads WebGPU is about 18%
faster than WebGL 2 (7.8-7.9 s against 9.6-9.7 s), and at 1000x long reads the
three backends take about 14.7 s.

# The paper's 100 kb cells on the T4: WebGPU, and headless against headed WebGL 2

g4dn.4xlarge (Tesla T4), Chrome 148.0.7778.97 from puppeteer 24.43.1,
v5.0.0-beta.21, `scripts/render/backends.ts` at `SCALE=100kb`
(chr22_mask:75000-175000, the cross-tool 100 kb window), BAM, one warm-up and
five runs per cell, 2026-11-24. A is headless with the paper's flags
(`--use-angle=gl-egl --use-gl=angle`); B is headed under Xvfb with
`--use-angle=vulkan --use-vulkan=native`. Setup notes are in
`../2026-11-24-t4-headed/README.md`.

## Times (median ms)

| cell | A WebGL 2 | B WebGL 2 | B WebGPU | A Canvas 2D | B Canvas 2D |
|---|---|---|---|---|---|
| 20x short | 1036 | 981 | 969 | 963 | 972 |
| 200x short | 2568 | 2454 | 2353 | 2534 | 2551 |
| 1000x short | 8252 | 8266 | 8071 | 7928 | 8069 |
| 20x long | 1309 | 1266 | 1162 | 1559 | 1575 |
| 200x long | 4465 | 4467 | 4284 | 4826 | 4989 |
| 1000x long | 16405 | 16854 | 16374 | 16417 | 16492 |

- Headed WebGL 2 is within −5% to +3% of the headless setup every paper
  benchmark used, including +0.2% and +3% at 1000x.
- WebGPU is 1–8% faster than WebGL 2 in every cell, both headed.
- Every cell's five runs agree within a few percent. The 200x long-read cell
  does not split into fast and slow runs here, as it does in Firefox on the
  Dell (`results/webgpu-lite-100kb/`).
- `ink` reads 4.2% in five cells; the screenshots show a full pileup, so the
  ink measure missed the canvas, not the render.

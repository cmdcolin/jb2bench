# WebGPU on the T4, and headless against headed WebGL 2

g4dn.4xlarge (Tesla T4, NVIDIA driver AMI), Chrome 148.0.7778.97 from
puppeteer 24.43.1, v5.0.0-beta.21, `scripts/render/backends.ts` at
`SCALE=100kb-wide`, BAM, one warm-up and five runs per cell, 2026-11-24.

## Which Chrome setups reach the T4 (`probe.mjs`)

- Headless, any flags: WebGPU is SwiftShader. WebGL 2 reaches the T4 with
  `--use-angle=gl-egl` (OpenGL ES) or `--use-angle=vulkan --use-vulkan=native`.
- Headed under Xvfb with `--use-angle=vulkan --use-vulkan=native
  --enable-unsafe-webgpu --enable-features=Vulkan`: WebGPU is the NVIDIA Turing
  adapter and renders, and WebGL 2 is ANGLE on the T4's Vulkan driver.
- Headed under Xvfb with `--use-angle=gl-egl`: WebGL 2 falls to llvmpipe. Never
  run the paper's gl-egl flags headed.

## Times (median ms)

| cell | A headless gl-egl WebGL 2 | B headed Vulkan WebGL 2 | B WebGPU | A Canvas 2D | B Canvas 2D |
|---|---|---|---|---|---|
| 20x short | 955 | 948 | 865 | 847 | 949 |
| 100x short | 1538 | 1454 | 1347 | 1546 | 1554 |
| 20x long | 1241 | 1156 | 1067 | 1349 | 1457 |
| 100x long | 2525 | 2439 | 2454 | 2845 | 2952 |

- Headed Vulkan WebGL 2 is 1–7% faster than the headless gl-egl setup every
  paper benchmark used, so the paper's WebGL 2 numbers are not handicapped by
  more than that.
- WebGPU against WebGL 2, both headed: −9%, −7%, −8%, +0.6%.
- `ink` reads 4.2% in two cells (A 20x short WebGL 2, B 20x long WebGPU); their
  screenshots show the full pileup, so the ink measure missed the canvas, not
  the render.

`run.log` has every run; `remote-run.sh` is the command sequence.

# Samsung 940Z5L (i7-6700HQ, HD 530 + GTX 950M, 7.6 GB RAM, 4 GB swap), 2026-11-24

The first attempt (04:07 UTC) ran out of memory in the 1000x short-read WebGPU
cell, after three runs, while a normal Firefox session held about 3 GB: the
kernel killed Firefox's page process (anon RSS 2.5 GB, total VM 9.8 GB) at
23:13 EST and the laptop was rebooted. Those results were never written.

This run (04:57 UTC) had nothing else open. All 18 cells finished with five
runs each. `memory-free.log` samples `free -m` every 10 s: available memory
fell to 283 MB and swap use peaked at 1.8 GB during the 1000x long-read cells.
Run over ssh from the Dell, Firefox on the laptop's own Wayland session.

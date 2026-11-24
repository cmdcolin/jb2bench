# Samsung 940Z5L, 2026-11-24

## The machine

- Model: Samsung Notebook 9 Pro 15" (NP940Z5L-X01US), a 2016-era laptop; BIOS
  dated 12/15/2017.
- CPU: Intel Core i7-6700HQ (Skylake, launched 2015), 4 cores / 8 threads,
  2.6 GHz base, 3.5 GHz max.
- GPU: Intel HD Graphics 530 (integrated) and NVIDIA GeForce GTX 950M (2015,
  Maxwell, switchable). Firefox hides its WebGPU adapter, so which GPU drew is
  not recorded; Optimus laptops default to the integrated GPU.
- Memory: 8 GB (7.3 GiB usable), with a 4 GB swap file.
- OS: Ubuntu 26.04.1 LTS, kernel 7.0.0-44; Firefox Nightly 163.0a1.
- On A/C power for every run.

## The runs

The first attempt (04:07 UTC) ran out of memory in the 1000x short-read WebGPU
cell, after three runs, while a normal Firefox session held about 3 GB: the
kernel killed Firefox's page process (anon RSS 2.5 GB, total VM 9.8 GB) at
23:13 EST and the laptop was rebooted. Those results were never written.

This run (04:57 UTC) had nothing else open. All 18 cells finished with five
runs each. `memory-free.log` samples `free -m` every 10 s: available memory
fell to 283 MB and swap use peaked at 1.8 GB during the 1000x long-read cells.
Run over ssh from the Dell, Firefox on the laptop's own Wayland session.

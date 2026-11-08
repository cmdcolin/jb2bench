# Hardware panel: EC2 Mac hosts and a Linux CPU sweep

Reviewers asked how JBrowse's performance varies across hardware, including a
typical laptop with integrated graphics and no discrete GPU. This directory
runs one small panel of cells on two Mac machines and, separately, on the
g4dn with Chrome confined to fewer CPUs. It is kept apart from `ec2/` so a run
driven from there is never touched.

## What the panel measures

One build, `builds/release-5.0.0-beta.20`, in headless Chrome for Testing (the
version puppeteer 24.43.1 pins), pinned to each backend with
`?renderer=webgpu`, `webgl` and `canvas2d`. A pinned `webgpu` does not fall
back: the build shows an error instead.

| cell | track | window | instrument |
|---|---|---|---|
| `cold-20x` | `20x.shortread.bam` | 100 kb, `chr22_mask:75000-175000` | `scripts/crosstool/paintprofile.ts`, navigation to the last changed frame, 10 min ceiling |
| `cold-1000x` | `1000x.shortread.bam` | the same 100 kb | the same |
| `zoom-200x` | `200x.shortread.bam` | 19 kb, `chr22_mask:124000-143000` | `scripts/crosstool/panprofile.ts` `MOTION=zoom INSTRUMENT=frames`, the median of 5 halvings per run, each timed to the compositor swap of its last changed frame (59398a1) |

Each cell has one warm-up and 5 runs per backend. The backends are interleaved
within each run. `panel.json` keeps every run plus n, median, mean, SD, min
and max. `panel.md` is the table.

Every run also records what the page ran on (`scripts/crosstool/gpuinfo.ts`,
read after the clock stops). That covers the WebGL2 renderer string, the
WebGPU adapter, the context type of the page's own canvases (the rung it
reached) and `navigator.hardwareConcurrency`. A run is not counted when:
- it reached a different rung than the one pinned, or
- a `webgpu` or `webgl` run landed on a software adapter (SwiftShader,
  llvmpipe, or a WebGPU fallback adapter).

The reason is printed beside the run. Before the panel starts,
`ec2mac/gpuprobe.ts` tries several flag sets, and `drive.sh` stops if the
configured one gives a software WebGL2.

Memory is sampled after each cold load, once the clock has stopped:
- **JS heap**: `Runtime.getHeapUsage` over the page and every worker, through
  CDP, on both platforms.
- **Chrome processes on Linux**: PSS from `/proc`, grouped by Chrome process
  type. Shared pages are divided among the processes that map them, so the sum
  is the browser's footprint.
- **Chrome processes on macOS**: RSS from `ps -ww -axo pid=,ppid=,rss=,command=`
  over the launched Chrome's process tree, grouped the same way. RSS counts a
  shared page once in every process that maps it, so the macOS total is an
  upper bound and is not comparable with the Linux PSS total. Compare the macOS
  totals with each other only. M1 has unified memory, so GPU allocations show
  up in the GPU process's RSS. No separate device counter is recorded on
  either Mac. `nvidia-smi` gives one on the g4dn only.

## Machines

| `HOST=` | type | CPU | GPU | memory | on-demand |
|---|---|---|---|---|---|
| `mac1` | mac1.metal (2018 Mac mini) | Intel i7-8700B, 6 cores / 12 threads | Intel UHD 630, integrated | 32 GiB | $1.083/h |
| `mac2` | mac2.metal (2020 Mac mini) | Apple M1, 8 cores | M1, 8 GPU cores | 16 GiB | $0.65/h |

Both hosts are in us-east-1, in us-east-1a by default (`EC2MAC_AZ=us-east-1d`
also works). The quotas are 3 and 5 hosts. Both default to the newest
**macOS 15** AMI, found with `describe-images`: on 2026-11-03 that was
`amzn-ec2-macos-15.8-20260918` for each architecture. The newest arm64 AMI is
macOS 27, which the Intel mac1 cannot run, and one OS on both machines keeps
the OS out of the comparison. Set `EC2MAC_MACOS=` to empty to take the newest
AMI of any version, or `EC2MAC_AMI=ami-...` to name one. Log in as
`ec2-user`.

mac1's UHD 630 is the integrated GPU this repo's laptop also has. That laptop
reaches it through Mesa (`ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 ...)`),
while mac1 reaches it through Apple's Metal driver.

## The 24-hour rule and what it costs

From the AWS documentation
([Mac instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html),
[stop or terminate](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/mac-instance-stop.html),
read 2026-11-03):

- The Dedicated Host is the unit of billing, and Mac instances run only on
  Dedicated Hosts, "with a minimum allocation period of 24 hours before you can
  release the Dedicated Host". The instance on the host costs nothing extra.
- Terminating the instance does not release the host. AWS then scrubs the host
  (up to 50 min on x86, up to 3 h with a firmware update, and up to 4.5 h on
  Apple silicon) and does not bill during the scrub. The host returns to
  `available` and bills again until it is released.
- "You cannot release the host until the allocation period exceeds the 24-hour
  minimum."
- A launch takes about 6 to 20 minutes before ssh answers.

So each host costs at least 24 hours of its rate however short the run:

| | minimum | panel run itself |
|---|---|---|
| mac1 | 24 h × $1.083 = **$25.99** | |
| mac2 | 24 h × $0.65 = **$15.60** | |
| 2 × 150 GB gp3 root volumes, ~1 day | ~$0.80 | |
| **both Macs** | **~$42.40** | about 2 to 2.5 h per host from `mac-up` to the end of the panel, and both can run at once |
| CPU sweep on g4dn.2xlarge ($0.752/h) | | about 1 h of panel, ~$1, plus provisioning if the instance has to be relaunched |

The time estimate is about 15 min to launch, 15 to 20 min to provision and
about 1 h for 54 panel runs: 3 cells × 3 backends × 6. If the 1000x
`canvas2d` cold load is slow on the Intel host, the run takes longer. A host
left unreleased after 24 hours bills its rate until someone releases it.
`mac-down` prints a reminder with the earliest release time every time it
cannot release.

## Commands

Every target that can reach AWS refuses without `CONFIRM=1`. `DRY_RUN=1`
prints the allocate, launch, terminate and release calls without making them.

```sh
make mac-test                                   # shellcheck, tsrs, the ps parser fixture; no AWS
make mac-up HOST=mac1 DRY_RUN=1                 # what would be allocated and launched

make stage-release TAG=v5.0.0-beta.20           # once, if builds/release-5.0.0-beta.20 is missing
make mac-up        HOST=mac1 CONFIRM=1          # allocate host + launch; 24 h billing starts here
make mac-provision HOST=mac1 CONFIRM=1          # node@24, rsync, Chrome for Testing, code, build, 3 BAMs
make mac-run-panel HOST=mac1 CONFIRM=1          # detached on the Mac; results sync to results/ec2mac/mac1-<stamp>/
make mac-down      HOST=mac1 CONFIRM=1          # terminates now; releases the host only once 24 h have passed
# ... 24 h after mac-up:
make mac-down      HOST=mac1 CONFIRM=1          # releases the host; billing stops

# the same sequence with HOST=mac2, in a second shell if both run at once
```

`mac-run-panel` reattaches if the connection drops: rerun it and it picks up
the running driver and keeps syncing. `BACKENDS=`, `CELLS=`, `RUNS=` and
`WARMUP=` pass through. `EC2MAC_CHROME_ANGLE` overrides the Chrome flags, whose
default is `--use-angle=metal --enable-unsafe-webgpu`. The instance powers
itself off after `EC2MAC_MAX_MINUTES` (default 360), which terminates the
instance but not the host.

The Linux CPU sweep runs the same three cells on the g4dn with WebGL2 only,
once each under `taskset -c 0-1`, `0-3` and `0-7`. Chrome inherits the
affinity, and the probe records the `navigator.hardwareConcurrency` the page
saw. On this laptop, under `taskset -c 0-1`, it read 2, so JBrowse's worker
pool shrinks with the cores. The http-server is not confined.

```sh
make ec2-up && EC2_BUILD=release-5.0.0-beta.20 make ec2-provision   # only when no ec2/ run is going
make cpu-sweep DRY_RUN=1
make cpu-sweep CONFIRM=1                        # refuses while ec2/phases.sh runs there
make ec2-down
```

To check the wiring on any box with the build served locally:

```sh
npx http-server builds/release-5.0.0-beta.20 -p 8027 -s --cors &
PORT=8027 CELLS=cold-20x CHROME_ANGLE='--use-angle=gl --use-gl=angle --enable-unsafe-webgpu' make mac-panel-local
```

## Checked on the laptop, and what is not checked yet

Checked on 2026-11-03 without spending anything:
- shellcheck passes.
- tsc passes.
- The ps parser passes against `fixtures/ps-darwin.txt` and against live `ps`
  output.
- Each make target refuses without `CONFIRM=1`.
- `DRY_RUN=1` prints the calls for `mac-up`, `mac-down` and `cpu-sweep`, and
  the AMI lookup returns real AMIs.
- The panel ran one run of `cold-20x` on each backend against beta.20. webgl
  and canvas2d were counted. The webgpu run was refused, correctly: Chrome's
  Dawn rejected the Vulkan surface on this laptop, the page showed the error
  and drew no track canvas, and the paint instrument would otherwise have
  scored that as a 1.2 s load.
- One run each of `zoom-200x` and of `CPUS=2` completed.

Not verified until a host runs:
- whether headless Chrome over ssh, with no logged-in GUI session, reaches
  Metal for WebGL2 and WebGPU on each Mac
- whether `--instance-initiated-shutdown-behavior terminate` and the user-data
  power-off take effect on a Mac instance
- whether Homebrew's `node@24` and the arm64 and x86 Chrome for Testing install
  cleanly on the macOS 15.8 AMIs
- the release-hosts error text before 24 hours, and whether a host in
  `pending` (scrubbing) can be released
- the run time per host

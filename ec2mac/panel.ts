// The hardware panel: cold load at 100 kb (20x and 1000x short-read BAM) and the
// pixel-settled zoom on the 19 kb 200x short-read BAM, one JBrowse build, each
// `?renderer=` pin. Timings come from the same instruments as the crosstool
// figures (paintprofile.ts, panprofile.ts INSTRUMENT=frames); this file only
// chooses the cells, interleaves the backends, and refuses runs that did not
// land on the rung and the hardware they were meant to.
//
//   RUNS=5 WARMUP=1 PORT=8000
//   BACKENDS=webgpu,webgl,canvas2d
//   CELLS=cold-20x,cold-1000x,zoom-200x
//   CPUS=2,4,8        Linux only: each pass under taskset -c 0-(n-1)
//   EXPECT_BUILD=release-5.0.0-beta.20   stop if port 8000 serves another
//   OUT=results/ec2mac/<label>-<stamp>   LABEL=<host label>
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import { launch } from 'puppeteer'

import type { GpuInfo } from '../scripts/crosstool/gpuinfo.ts'
import type { MemorySample } from '../scripts/crosstool/memory.ts'
import { resolveBuild } from '../scripts/render/servedbuild.ts'
import { ANGLE_ARGS } from '../scripts/angleargs.ts'

const env = process.env
const PORT = Number(env.PORT ?? 8000)
const RUNS = Number(env.RUNS ?? 5)
const WARMUP = Number(env.WARMUP ?? 1)
const LABEL = env.LABEL ?? os.hostname().split('.')[0]!
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const OUT = env.OUT ?? `results/ec2mac/${LABEL}-${STAMP}`

const BACKENDS = ['webgpu', 'webgl', 'canvas2d'] as const
type Backend = (typeof BACKENDS)[number]
const expectedRung: Record<Backend, string> = {
  webgpu: 'webgpu',
  webgl: 'webgl2',
  canvas2d: 'canvas2d',
}

interface CellDef {
  id: string
  kind: 'cold' | 'zoom'
  track: string
  loc: string
  ceilingMs: number
}
const CELLS: CellDef[] = [
  {
    id: 'cold-20x',
    kind: 'cold',
    track: '20x.shortread.bam',
    loc: 'chr22_mask:75000-175000',
    ceilingMs: 600000,
  },
  {
    id: 'cold-1000x',
    kind: 'cold',
    track: '1000x.shortread.bam',
    loc: 'chr22_mask:75000-175000',
    ceilingMs: 600000,
  },
  {
    id: 'zoom-200x',
    kind: 'zoom',
    track: '200x.shortread.bam',
    loc: 'chr22_mask:124000-143000',
    ceilingMs: 120000,
  },
]

const pick = <T extends string>(name: string, known: readonly T[], value: string | undefined) => {
  const want = value?.split(',').filter(Boolean)
  const got = want ? known.filter(k => want.includes(k)) : [...known]
  if (!got.length || (want && got.length !== want.length)) {
    throw new Error(`${name}=${value} names something unknown; known: ${known.join(',')}`)
  }
  return got
}
const backends = pick('BACKENDS', BACKENDS, env.BACKENDS)
const cellIds = pick(
  'CELLS',
  CELLS.map(c => c.id),
  env.CELLS,
)
const cells = CELLS.filter(c => cellIds.includes(c.id))
const cpuSets = env.CPUS ? env.CPUS.split(',').map(Number) : [0]
if (cpuSets.some(n => n > 0) && process.platform !== 'linux') {
  throw new Error('CPUS needs taskset, which is Linux only')
}

const urlFor = (c: CellDef, b: Backend) =>
  `http://localhost:${PORT}/?loc=${c.loc}&assembly=hg19mod&tracks=${c.track}&renderer=${b}`

interface Run {
  ms: number
  counted: boolean
  why?: string
  gpu: GpuInfo | { error: string } | null
  memory?: MemorySample
  steps?: number[]
  drawClockMs?: number | null
  load: [number, number]
}

const lineAfter = (lines: string[], prefix: string) => {
  const l = lines.find(x => x.startsWith(prefix))
  const parsed: unknown = l ? JSON.parse(l.slice(prefix.length)) : null
  return parsed
}

function runOnce(c: CellDef, b: Backend, cpus: number): Run {
  const script =
    c.kind === 'cold' ? 'scripts/crosstool/paintprofile.ts' : 'scripts/crosstool/panprofile.ts'
  const args = [
    '--experimental-strip-types',
    script,
    urlFor(c, b),
    ...(c.kind === 'zoom' ? ['jbrowse'] : []),
  ]
  const [cmd, argv] =
    cpus > 0
      ? ['taskset', ['-c', `0-${cpus - 1}`, process.execPath, ...args]]
      : [process.execPath, args]
  const before = os.loadavg()[0]!
  let out = ''
  try {
    out = execFileSync(cmd, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1 << 24,
      env: {
        ...env,
        GPU_PROBE: '1',
        MAX_WAIT: String(c.ceilingMs),
        CEILING: String(c.ceilingMs),
        MOTION: 'zoom',
        INSTRUMENT: 'frames',
      },
    })
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  }
  const load: [number, number] = [before, os.loadavg()[0]!]
  const lines = out.trim().split('\n')
  const gpu = lineAfter(lines, 'GPU ') as Run['gpu']
  const last = lines.at(-1) ?? ''
  const zoom =
    c.kind === 'zoom' && last.startsWith('{')
      ? (JSON.parse(last) as {
          medianMs: number | null
          medianDrawClockMs?: number | null
          steps: { ms: number; applied: boolean }[]
        })
      : null
  const ms = c.kind === 'cold' ? Number.parseFloat(last) : (zoom?.medianMs ?? Number.NaN)
  const rung = gpu && 'rung' in gpu ? gpu.rung : 'unprobed'
  const hardware = gpu && 'rung' in gpu ? gpu.hardware : null
  const why = !Number.isFinite(ms)
    ? 'failed'
    : rung !== expectedRung[b]
      ? `reached ${rung}, not ${expectedRung[b]}`
      : b !== 'canvas2d' && hardware !== true
        ? 'software adapter'
        : undefined
  return {
    ms,
    counted: why === undefined,
    why,
    gpu,
    memory:
      c.kind === 'cold'
        ? (lineAfter(lines, 'DETAIL ') as { memory: MemorySample } | null)?.memory
        : undefined,
    steps: zoom?.steps.filter(s => s.applied).map(s => s.ms),
    drawClockMs: zoom?.medianDrawClockMs,
    load,
  }
}

const median = (a: number[]) => {
  const s = [...a].toSorted((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const stddev = (a: number[]) => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)))
const round = (x: number) => Number(x.toFixed(1))

function memorySummary(runs: Run[]) {
  const got = runs.filter(r => r.counted && r.memory).map(r => r.memory!)
  const med = (f: (m: MemorySample) => number | undefined) => {
    const v = got.map(f).filter((x): x is number => typeof x === 'number')
    return v.length ? round(median(v)) : null
  }
  return got.length
    ? {
        source: got[0]!.process?.source ?? null,
        jsHeapUsedMB: med(m => m.jsHeap.usedMB),
        totalMB: med(m =>
          m.process?.source === 'proc' ? m.process.totalPssMB : m.process?.totalRssMB,
        ),
        rendererMB: med(m =>
          m.process?.source === 'proc'
            ? m.process.byType.renderer?.pssMB
            : m.process?.byType.renderer?.rssMB,
        ),
        gpuProcessMB: med(m =>
          m.process?.source === 'proc'
            ? m.process.byType['gpu-process']?.pssMB
            : m.process?.byType['gpu-process']?.rssMB,
        ),
        gpuDeviceDeltaMB: med(m => m.gpuDevice?.deltaMB),
      }
    : null
}

function summarize(runs: Run[]) {
  const ok = runs.filter(r => r.counted).map(r => r.ms)
  const probed = runs.map(r => r.gpu).find(g => g && 'rung' in g) as GpuInfo | undefined
  return {
    n: ok.length,
    median: ok.length ? round(median(ok)) : null,
    mean: ok.length ? round(mean(ok)) : null,
    sd: ok.length ? round(stddev(ok)) : null,
    min: ok.length ? Math.min(...ok) : null,
    max: ok.length ? Math.max(...ok) : null,
    rung: probed?.rung ?? null,
    glRenderer: probed?.glRenderer ?? null,
    webgpuAdapter: probed?.webgpuAdapter ?? null,
    hardwareConcurrency: probed?.hardwareConcurrency ?? null,
    refused: runs.filter(r => !r.counted).map(r => r.why),
    memory: memorySummary(runs),
  }
}

function sh(cmd: string, args: string[]) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

async function chromeVersion() {
  const browser = await launch({ headless: true, args: ['--no-sandbox', ...ANGLE_ARGS] })
  const v = await browser.version()
  await browser.close()
  return v
}

const build = await resolveBuild(PORT)
if (env.EXPECT_BUILD && build !== env.EXPECT_BUILD) {
  throw new Error(`port ${PORT} serves builds/${build}, not ${env.EXPECT_BUILD}`)
}
const host = {
  label: LABEL,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  macos: process.platform === 'darwin' ? sh('sw_vers', ['-productVersion']) : null,
  cpuModel: os.cpus()[0]?.model ?? null,
  logicalCpus: os.cpus().length,
  memGB: round(os.totalmem() / 2 ** 30),
  gpu:
    process.platform === 'darwin'
      ? (sh('system_profiler', ['SPDisplaysDataType'])?.match(/Chipset Model: (.*)/)?.[1] ?? null)
      : sh('nvidia-smi', ['-L']),
  chrome: await chromeVersion(),
  chromeAngle: ANGLE_ARGS.join(' '),
  node: process.version,
}
console.log(
  `builds/${build} on port ${PORT}; ${host.cpuModel} x${host.logicalCpus}, ${host.gpu}; ${host.chrome}`,
)
console.log(
  `cells ${cellIds.join(',')}; backends ${backends.join(',')}; ${WARMUP} warm-up + ${RUNS} runs${env.CPUS ? `; cpus ${env.CPUS}` : ''}`,
)

fs.mkdirSync(OUT, { recursive: true })
const key = (c: CellDef, b: Backend, cpus: number) =>
  `${c.id}/${b}${cpus > 0 ? `/cpus${cpus}` : ''}`
const raw: Record<string, Run[]> = {}
const write = () => {
  const summary = Object.fromEntries(Object.entries(raw).map(([k, runs]) => [k, summarize(runs)]))
  fs.writeFileSync(
    `${OUT}/panel.json`,
    JSON.stringify(
      { build, port: PORT, runs: RUNS, warmup: WARMUP, stamp: STAMP, host, summary, raw },
      null,
      2,
    ),
  )
  return summary
}

for (const cpus of cpuSets) {
  for (const c of cells) {
    for (const b of backends) {
      for (let i = 0; i < WARMUP; i++) {
        const w = runOnce(c, b, cpus)
        console.log(`${key(c, b, cpus)} warm-up ${w.ms.toFixed(0)} ms ${w.why ?? ''}`)
      }
      raw[key(c, b, cpus)] = []
    }
    for (let i = 0; i < RUNS; i++) {
      for (const b of backends) {
        const r = runOnce(c, b, cpus)
        raw[key(c, b, cpus)]!.push(r)
        const g =
          r.gpu && 'rung' in r.gpu
            ? `${r.gpu.rung} on ${r.gpu.rung === 'webgpu' ? r.gpu.webgpuAdapter : r.gpu.glRenderer}`
            : 'unprobed'
        console.log(
          `${key(c, b, cpus)} run ${i + 1}: ${r.ms.toFixed(0)} ms, ${g}${r.why ? ` -- NOT COUNTED: ${r.why}` : ''}`,
        )
        write()
      }
    }
  }
}

const summary = write()
const mb = (x: number | null | undefined) => (x === null || x === undefined ? '' : x.toFixed(0))
let md = `# Hardware panel: ${LABEL}\n\n`
md += `builds/${build}, ${host.cpuModel} (${host.logicalCpus} logical CPUs, ${host.memGB} GB), GPU ${host.gpu}, ${host.chrome}, ${host.platform} ${host.macos ?? host.osRelease}. `
md += `${WARMUP} warm-up and ${RUNS} runs per cell, backends interleaved within each run. Cold load is paintprofile.ts to the last changed frame; zoom is panprofile.ts INSTRUMENT=frames, the median of its steps per run. `
md += `A run counts only if the page reached the pinned rung and, for webgpu and webgl, a hardware adapter. Memory is the median over counted cold-load runs: JS heap over page and workers; ${host.platform === 'darwin' ? 'RSS summed over the Chrome processes (ps), which counts shared pages once per process' : 'PSS summed over the Chrome processes (/proc)'}.\n\n`
md += `| cell | backend | n | median ms | sd | min | max | rung | adapter | JS heap MB | Chrome MB |\n|---|---|---:|---:|---:|---:|---:|---|---|---:|---:|\n`
for (const [k, s] of Object.entries(summary)) {
  const [cell, backend, cpus] = k.split('/')
  md += `| ${cell}${cpus ? ` ${cpus}` : ''} | ${backend} | ${s.n} | ${mb(s.median)} | ${mb(s.sd)} | ${mb(s.min)} | ${mb(s.max)} | ${s.rung ?? '?'} | ${(s.rung === 'webgpu' ? s.webgpuAdapter : s.glRenderer) ?? ''} | ${mb(s.memory?.jsHeapUsedMB)} | ${mb(s.memory?.totalMB)} |\n`
}
const refused = Object.entries(summary).filter(([, s]) => s.refused.length)
if (refused.length) {
  md += `\nRuns not counted:\n\n${refused.map(([k, s]) => `- ${k}: ${s.refused.join('; ')}`).join('\n')}\n`
}
fs.writeFileSync(`${OUT}/panel.md`, md)
console.log(`\nwrote ${OUT}/panel.md and panel.json`)

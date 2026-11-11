// Where does a JBrowse cold load spend its time before the first read is drawn?
//
// One Chrome trace per cold load puts the network, the main thread, the RPC
// workers and the draw calls on one clock. The draw hook leaves a user-timing
// mark at most once per frame, so the trace itself says when pixels were
// produced, and the phases are cut at network milestones every JBrowse build
// passes through: the eager JS, config.json, the assembly's .fai, the alignment
// index, the first alignment bytes, the first draw after them, and the last draw.
//
// Each run launches a fresh browser with a fresh profile, so the V8 code cache
// and HTTP cache are both cold: a first visit. The HTTP cache stays enabled,
// because the worker's chunk loader fetches a chunk and then importScripts it as
// a cache read; disabling the cache, or serving no-store, makes it fetch twice.
//
// Usage: boottrace.ts <url> [runs]   → results/boot/<stamp>/{run-N.json,summary.md}
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import { SourceMapConsumer } from 'source-map'
import { ANGLE_ARGS } from '../angleargs.ts'

const urlArg = process.argv[2]
if (!urlArg) {
  throw new Error('usage: boottrace.ts <url> [runs]')
}
const url: string = urlArg
const RUNS = Number(process.argv[3] ?? 5)
const QUIET_MS = Number(process.env.QUIET_MS ?? 2000)
const CEILING_MS = Number(process.env.CEILING_MS ?? 60000)
const OUT =
  process.env.OUT ??
  path.join('results', 'boot', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))
fs.mkdirSync(OUT, { recursive: true })

const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
  'loading',
  'toplevel',
  'v8.execute',
  'disabled-by-default-v8.compile',
  'disabled-by-default-v8.cpu_profiler',
]

interface TraceEvent {
  name: string
  cat: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  args?: {
    name?: string
    data?: {
      url?: string
      requestId?: string
      frame?: string
      documentLoaderURL?: string
    }
  }
}

const isData = (u: string) => /\.(bam|cram|bai|crai|csi|fai|fa|2bit|gzi)(\?|$)/.test(u)

async function oneRun(i: number) {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== '0',
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-features=Vulkan',
      ...ANGLE_ARGS,
      '--window-size=1280,900',
      // a pinned SPKI makes Chrome treat the local h2 cert as valid; with
      // --ignore-certificate-errors instead, Chrome skips the HTTP cache for the
      // origin and the worker refetches every chunk it prefetched
      ...(process.env.CHROME_EXTRA_ARGS?.split(/\s+/).filter(Boolean) ?? []),
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  if (process.env.NET) {
    const [latency, mbps] = process.env.NET.split(',').map(Number)
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: latency!,
      downloadThroughput: (mbps! * 1e6) / 8,
      uploadThroughput: (mbps! * 1e6) / 8,
    })
  }

  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __draws: number[] }
    w.__draws = []
    let lastMark = -Infinity
    for (const ctor of [
      globalThis.WebGL2RenderingContext,
      globalThis.WebGLRenderingContext,
    ]) {
      const proto = ctor?.prototype as unknown as
        | Record<string, (...a: unknown[]) => unknown>
        | undefined
      for (const name of [
        'drawArraysInstanced',
        'drawElementsInstanced',
        'drawArrays',
        'drawElements',
      ]) {
        const orig = proto?.[name]
        if (proto && orig) {
          proto[name] = function (this: unknown, ...args: unknown[]) {
            const t = performance.now()
            w.__draws.push(t)
            if (t - lastMark > 16) {
              lastMark = t
              performance.mark('jb-draw')
            }
            return orig.apply(this, args)
          }
        }
      }
    }
    const rpc: { t: number; dir: string; method?: string; uid?: unknown; fn?: string }[] = []
    ;(window as unknown as { __rpc: typeof rpc }).__rpc = rpc
    const describe = (m: unknown) => {
      const o = m as { method?: string; uid?: unknown; data?: { args?: { sessionId?: string } } }
      return { method: o?.method, uid: o?.uid }
    }
    const origPost = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
      const d = describe(msg)
      if (d.method || d.uid !== undefined) {
        rpc.push({ t: performance.now(), dir: 'call', ...d })
      }
      return (origPost as (...a: unknown[]) => void).call(this, msg, ...rest)
    } as typeof Worker.prototype.postMessage
    const origAdd = Worker.prototype.addEventListener
    Worker.prototype.addEventListener = function (this: Worker, type: string, fn: unknown, ...rest: unknown[]) {
      if (type === 'message' && typeof fn === 'function') {
        const wrapped = (e: MessageEvent) => {
          const d = e.data as { uid?: unknown; method?: string } | undefined
          if (d && d.uid !== undefined) {
            rpc.push({ t: performance.now(), dir: 'reply', uid: d.uid, method: d.method })
          }
          return (fn as (e: MessageEvent) => unknown)(e)
        }
        return (origAdd as (...a: unknown[]) => void).call(this, type, wrapped, ...rest)
      }
      return (origAdd as (...a: unknown[]) => void).call(this, type, fn, ...rest)
    } as typeof Worker.prototype.addEventListener
    const gl = { calls: 0, ms: 0, first: -1, last: -1 }
    ;(window as unknown as { __gl: typeof gl }).__gl = gl
    for (const ctor of [
      globalThis.WebGL2RenderingContext,
      globalThis.WebGLRenderingContext,
    ]) {
      const proto = ctor?.prototype as unknown as
        | Record<string, (...a: unknown[]) => unknown>
        | undefined
      for (const name of [
        'compileShader',
        'linkProgram',
        'getProgramParameter',
        'getShaderParameter',
        'getUniformLocation',
        'getAttribLocation',
      ]) {
        const orig = proto?.[name]
        if (proto && orig) {
          proto[name] = function (this: unknown, ...args: unknown[]) {
            const t = performance.now()
            const r = orig.apply(this, args)
            const d = performance.now() - t
            gl.calls++
            gl.ms += d
            if (gl.first < 0) {
              gl.first = t
            }
            gl.last = t + d
            return r
          }
        }
      }
    }
    const enc = globalThis.GPURenderPassEncoder?.prototype as unknown as
      | Record<string, (...a: unknown[]) => unknown>
      | undefined
    for (const name of ['draw', 'drawIndexed']) {
      const orig = enc?.[name]
      if (enc && orig) {
        enc[name] = function (this: unknown, ...args: unknown[]) {
          const t = performance.now()
          w.__draws.push(t)
          if (t - lastMark > 16) {
            lastMark = t
            performance.mark('jb-draw')
          }
          return orig.apply(this, args)
        }
      }
    }
  })

  let inflight = 0
  let lastActivity = performance.now()
  page.on('request', r => {
    if (isData(r.url())) {
      inflight++
    }
    lastActivity = performance.now()
  })
  const done = (r: { url: () => string }) => {
    if (isData(r.url())) {
      inflight--
    }
    lastActivity = performance.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)

  const tracePath = path.join(OUT, `run-${i}.trace.json`)
  await page.tracing.start({ path: tracePath, categories: CATEGORIES })
  const t0 = performance.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  let lastDrawCount = 0
  for (;;) {
    await new Promise(r => setTimeout(r, 100))
    const n = await page.evaluate(
      () => (window as unknown as { __draws: number[] }).__draws.length,
    )
    if (n !== lastDrawCount) {
      lastDrawCount = n
      lastActivity = performance.now()
    }
    const now = performance.now()
    if (n > 0 && inflight === 0 && now - lastActivity > QUIET_MS) {
      break
    }
    if (now - t0 > CEILING_MS) {
      console.error(`run ${i}: hit the ${CEILING_MS} ms ceiling`)
      break
    }
  }
  const glStats = await page.evaluate(() => (window as unknown as { __gl: unknown }).__gl)
  const rpcLog = await page.evaluate(() => (window as unknown as { __rpc: unknown }).__rpc)
  await page.tracing.stop()
  await browser.close()
  return { tracePath, glStats, rpcLog }
}

interface Request {
  url: string
  start: number
  end?: number
  thread: string
}

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
interface ProfileNode {
  id: number
  callFrame: CallFrame
}
interface ProfileChunkData {
  cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }
  timeDeltas?: number[]
  startTime?: number
}
interface ProfileEvent {
  name: string
  ph: string
  id?: string
  pid: number
  tid: number
  ts: number
  args?: { data?: ProfileChunkData }
}

const JS_DIR = process.env.JS_DIR
const consumers = new Map<string, SourceMapConsumer | null>()
async function consumerFor(url: string) {
  const base = url.split('/').pop()?.split('?')[0] ?? ''
  if (!consumers.has(base)) {
    const mapPath = JS_DIR ? path.join(JS_DIR, base + '.map') : ''
    consumers.set(
      base,
      mapPath && fs.existsSync(mapPath)
        ? await new SourceMapConsumer(fs.readFileSync(mapPath, 'utf8'))
        : null,
    )
  }
  return consumers.get(base) ?? null
}

// The package a resolved source path belongs to: an npm package for anything
// under node_modules, the workspace package for our own code.
function packageOf(source: string) {
  const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(source)
  if (nm) {
    return nm[1]!
  }
  const ws = /(packages|plugins|products)\/([^/]+)/.exec(source)
  return ws ? `${ws[1]}/${ws[2]}` : source.replace(/^webpack:\/\//, '').split('/').slice(0, 2).join('/')
}

async function resolveFrame(cf: CallFrame) {
  if (!cf.url || cf.functionName.startsWith('(')) {
    return { pkg: cf.functionName || '(native)', where: cf.functionName || '(native)' }
  }
  const c = await consumerFor(cf.url)
  const pos = c?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber })
  if (pos?.source) {
    const src = pos.source.replace(/^webpack:\/\//, '')
    return {
      pkg: packageOf(src),
      where: `${src.replace(/^.*\/node_modules\//, '')}:${pos.line}${pos.name ? ` [${pos.name}]` : ''}`,
    }
  }
  return {
    pkg: cf.url.split('/').pop() ?? cf.url,
    where: `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`,
  }
}

function merge(intervals: [number, number][]) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [s, e] of sorted) {
    const last = out.at(-1)
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      out.push([s, e])
    }
  }
  return out
}

const overlap = (iv: [number, number][], from: number, to: number) =>
  iv.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, to) - Math.max(s, from)), 0)

async function analyse(tracePath: string) {
  const raw = JSON.parse(fs.readFileSync(tracePath, 'utf8')) as
    | { traceEvents: TraceEvent[] }
    | TraceEvent[]
  const events = Array.isArray(raw) ? raw : raw.traceEvents

  const nav = events.find(
    e => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.startsWith('http'),
  )
  if (!nav) {
    throw new Error(`${tracePath}: no navigationStart`)
  }
  const navStart = nav.ts
  const pagePid = nav.pid
  const ms = (ts: number) => (ts - navStart) / 1000

  const threadName = new Map<string, string>()
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name) {
      threadName.set(`${e.pid}:${e.tid}`, e.args.name)
    }
  }
  // Threads of the page's renderer get their own name, everything else is
  // labelled by process role, so two renderers' CrRendererMain do not sum.
  const workerIndex = new Map<string, number>()
  const label = (pid: number, tid: number) => {
    const name = threadName.get(`${pid}:${tid}`) ?? '?'
    if (pid !== pagePid) {
      return name === 'CrGpuMain' || name === 'VizCompositorThread' ? `gpu:${name}` : `other:${name}`
    }
    if (name === 'DedicatedWorker thread') {
      const key = `${pid}:${tid}`
      if (!workerIndex.has(key)) {
        workerIndex.set(key, workerIndex.size)
      }
      return `worker${workerIndex.get(key)}`
    }
    return name === 'CrRendererMain' ? 'main' : `page:${name}`
  }
  const nameOf = (e: { pid: number; tid: number }) => label(e.pid, e.tid)

  const requests = new Map<string, Request>()
  for (const e of events) {
    const id = e.args?.data?.requestId
    if (id && e.name === 'ResourceSendRequest' && e.args?.data?.url) {
      requests.set(id, { url: e.args.data.url, start: ms(e.ts), thread: nameOf(e) })
    }
    if (id && e.name === 'ResourceFinish') {
      const r = requests.get(id)
      if (r) {
        r.end = ms(e.ts)
      }
    }
  }
  const reqs = [...requests.values()].sort((a, b) => a.start - b.start)
  const file = (r: Request) => new URL(r.url).pathname.split('/').pop() ?? ''
  const first = (pred: (r: Request) => boolean) => reqs.find(pred)
  const lastEnd = (pred: (r: Request) => boolean, before = Infinity) =>
    Math.max(...reqs.filter(r => pred(r) && r.start < before).map(r => r.end ?? r.start), -Infinity)

  const isJs = (r: Request) => /\.js(\?|$)/.test(r.url)
  const isAlignIndex = (r: Request) => /\.(bai|crai|csi)(\?|$)/.test(r.url)
  const isAlign = (r: Request) => /\.(bam|cram)(\?|$)/.test(r.url)

  const draws = events
    .filter(e => e.name === 'jb-draw' && e.ph !== 'M' && e.pid === pagePid)
    .map(e => ms(e.ts))
    .sort((a, b) => a - b)

  const htmlReq = first(r => file(r) === '' || file(r) === 'index.html')
  const configReq = first(r => file(r) === 'config.json')
  const faiReq = first(r => /\.fai(\?|$)/.test(r.url))
  const indexReq = first(isAlignIndex)
  const alignReq = first(isAlign)
  const readsReq = indexReq?.end === undefined ? undefined : first(r => isAlign(r) && r.start >= indexReq.end!)
  const firstAlignEnd = readsReq?.end ?? alignReq?.end
  const lastAlignEnd = lastEnd(isAlign)
  const firstDataDraw =
    firstAlignEnd === undefined ? undefined : draws.find(t => t >= firstAlignEnd)
  const lastDraw = draws.at(-1)

  const milestones: Record<string, number | undefined> = {
    'HTML received': htmlReq?.end,
    'eager JS received (before config.json)': configReq ? lastEnd(isJs, configReq.start) : undefined,
    'config.json requested': configReq?.start,
    'config.json received': configReq?.end,
    '.fai requested': faiReq?.start,
    'alignment index requested': indexReq?.start,
    'alignment index received': indexReq?.end,
    'first alignment bytes requested': alignReq?.start,
    'reads requested (first range after the index)': readsReq?.start,
    'reads received': firstAlignEnd,
    'last alignment bytes received': Number.isFinite(lastAlignEnd) ? lastAlignEnd : undefined,
    'first draw (any)': draws[0],
    'first draw after reads': firstDataDraw,
    'last draw': lastDraw,
    'last JS chunk received': lastEnd(isJs),
  }

  const busy = new Map<string, [number, number][]>()
  for (const e of events) {
    if (e.ph === 'X' && e.name === 'RunTask') {
      const th = nameOf(e)
      const s = ms(e.ts)
      const list = busy.get(th) ?? []
      list.push([s, s + (e.dur ?? 0) / 1000])
      busy.set(th, list)
    }
  }
  const merged = new Map([...busy].map(([k, v]) => [k, merge(v)]))

  const cuts: [string, number | undefined][] = [
    ['nav → config.json requested', configReq?.start],
    ['→ .fai requested', faiReq?.start],
    ['→ alignment index requested', indexReq?.start],
    ['→ reads requested', readsReq?.start],
    ['→ reads received', firstAlignEnd],
    ['→ first draw after reads', firstDataDraw],
    ['→ last draw', lastDraw],
  ]
  const windows: { phase: string; from: number; to: number }[] = []
  let from = 0
  for (const [phase, to] of cuts) {
    if (to !== undefined) {
      windows.push({ phase, from, to })
      from = to
    }
  }

  // Sampled JS, per thread: every sample's leaf frame and timestamp.
  const profileThread = new Map<string, { pid: number; tid: number; t: number }>()
  const nodes = new Map<string, Map<number, CallFrame>>()
  const samples: { thread: string; t: number; key: string; node: number; dt: number }[] = []
  const lastSample = new Map<string, { t: number; dt: number }>()
  const cursor = new Map<string, number>()
  for (const e of events as unknown as ProfileEvent[]) {
    // a profile id is unique per process only: the about:blank renderer's
    // first profile is 0x1 too
    const pkey = `${e.pid}:${e.id}`
    if (e.name === 'Profile' && e.id) {
      profileThread.set(pkey, { pid: e.pid, tid: e.tid, t: e.args?.data?.startTime ?? e.ts })
    }
    if (e.name === 'ProfileChunk' && e.id) {
      const owner = profileThread.get(pkey) ?? { pid: e.pid, tid: e.tid, t: e.ts }
      const thread = label(owner.pid, owner.tid)
      const nodeMap = nodes.get(pkey) ?? new Map<number, CallFrame>()
      nodes.set(pkey, nodeMap)
      for (const n of e.args?.data?.cpuProfile?.nodes ?? []) {
        nodeMap.set(n.id, n.callFrame)
      }
      let t = cursor.get(pkey) ?? owner.t
      const ids = e.args?.data?.cpuProfile?.samples ?? []
      const deltas = e.args?.data?.timeDeltas ?? []
      for (let i = 0; i < ids.length; i++) {
        t += deltas[i] ?? 0
        const sample = { thread, t: ms(t), key: pkey, node: ids[i]!, dt: 0 }
        const prev = lastSample.get(pkey)
        if (prev) {
          prev.dt = Math.min(sample.t - prev.t, 5)
        }
        lastSample.set(pkey, sample)
        samples.push(sample)
      }
      cursor.set(pkey, t)
    }
  }

  const phases = []
  for (const w of windows) {
    const cpu: Record<string, number> = {}
    for (const [th, iv] of merged) {
      const v = overlap(iv, w.from, w.to)
      if (v > 2) {
        cpu[th] = Math.round(v)
      }
    }
    const byPkg: Record<string, Record<string, number>> = {}
    const byFrame: Record<string, Record<string, number>> = {}
    for (const s of samples) {
      if (s.t >= w.from && s.t < w.to) {
        const dt = s.dt
        const cf = nodes.get(s.key)?.get(s.node)
        if (cf && cf.functionName !== '(idle)' && dt > 0) {
          const r = await resolveFrame(cf)
          const pk = (byPkg[s.thread] ??= {})
          pk[r.pkg] = (pk[r.pkg] ?? 0) + dt
          const fr = (byFrame[s.thread] ??= {})
          fr[r.where] = (fr[r.where] ?? 0) + dt
        }
      }
    }
    const top = (m: Record<string, number>, n: number) =>
      Object.fromEntries(
        Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => [k, Math.round(v)]),
      )
    phases.push({
      phase: w.phase,
      from: Math.round(w.from),
      to: Math.round(w.to),
      cpu,
      packages: Object.fromEntries(Object.entries(byPkg).map(([th, m]) => [th, top(m, 12)])),
      frames: Object.fromEntries(Object.entries(byFrame).map(([th, m]) => [th, top(m, 15)])),
    })
  }

  return {
    milestones,
    phases,
    requests: reqs.map(r => ({
      file: file(r),
      thread: r.thread,
      start: Math.round(r.start),
      end: r.end === undefined ? undefined : Math.round(r.end),
    })),
  }
}

const results = []
for (let i = 0; i < RUNS; i++) {
  const { tracePath, glStats, rpcLog } = await oneRun(i)
  const a = { ...(await analyse(tracePath)), glStats, rpcLog }
  fs.writeFileSync(path.join(OUT, `run-${i}.json`), JSON.stringify(a, null, 2))
  if (process.env.KEEP_TRACES !== '1' && i > 0) {
    fs.rmSync(tracePath)
  }
  results.push(a)
  console.error(
    `run ${i}: first data draw ${a.milestones['first draw after reads']?.toFixed(0)} ms, last draw ${a.milestones['last draw']?.toFixed(0)} ms`,
  )
}

const median = (xs: number[]) => {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : undefined
}
const lines = [`# Cold-load phases`, '', `url: \`${url}\`  runs: ${RUNS}  net: ${process.env.NET ?? 'localhost'}`, '']
lines.push('| milestone | median ms | runs |', '| --- | ---: | --- |')
for (const k of Object.keys(results[0]!.milestones)) {
  const xs = results.map(r => r.milestones[k] ?? NaN)
  lines.push(`| ${k} | ${median(xs)?.toFixed(0) ?? '—'} | ${xs.map(x => x.toFixed(0)).join(', ')} |`)
}
lines.push('', '## CPU by phase, median ms per thread', '')
const threadSet = new Set(results.flatMap(r => r.phases.flatMap(p => Object.keys(p.cpu))))
const threadList = [...threadSet]
lines.push(`| phase | span | ${threadList.join(' | ')} |`, `| --- | ---: | ${threadList.map(() => '---:').join(' | ')} |`)
for (const p of results[0]!.phases.map(p => p.phase)) {
  const rows = results.map(r => r.phases.find(x => x.phase === p))
  const span = median(rows.map(r => (r ? r.to - r.from : NaN)))
  const cells = threadList.map(th => median(rows.map(r => r?.cpu[th] ?? 0))?.toFixed(0) ?? '—')
  lines.push(`| ${p} | ${span?.toFixed(0)} | ${cells.join(' | ')} |`)
}
lines.push('', `GL compile/link/introspection calls (run 0): ${JSON.stringify(results[0]!.glStats)}`)
lines.push('', '## Sampled JS by package, run 0, ms', '')
for (const p of results[0]!.phases) {
  lines.push(`### ${p.phase} (${p.from}–${p.to} ms)`, '')
  for (const [th, m] of Object.entries(p.packages)) {
    lines.push(`- **${th}**: ${Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  lines.push('')
}
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
console.log(`\n${OUT}`)

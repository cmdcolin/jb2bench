// Capture V8 CPU profiles (main thread + every web worker) for one render, so
// we can flamegraph where the 1000x-shortread regression spends time. Workers
// matter: jbrowse fetches/parses BAM in RPC workers, so the cost may be off the
// main thread. Auto-attach with waitForDebuggerOnStart pauses each worker until
// its profiler is armed, so nothing is missed.
//
// Same headless + hardware-GPU (--use-angle=gl) setup and quiescence-based
// render-complete detector as profile.ts.
//
// Usage: flameprofile.ts <url> <label>
// Writes flame/<label>.<target>.cpuprofile for each thread.
import puppeteer from 'puppeteer'
import type { CDPSession } from 'puppeteer'
import fs from 'fs'

const url = process.argv[2]
const label = process.argv[3] ?? 'profile'
if (!url) {
  throw new Error('usage: flameprofile.ts <url> <label>')
}

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-angle=gl',
    '--use-gl=angle',
    '--window-size=1280,900',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const client = await page.target().createCDPSession()
const connection = client.connection()!
const profilers: { id: string; session: CDPSession }[] = []

async function arm(session: CDPSession) {
  await session.send('Profiler.enable')
  await session.send('Profiler.setSamplingInterval', { interval: 200 }) // µs
  await session.send('Profiler.start')
}

await arm(client)
profilers.push({ id: 'main', session: client })

await client.send('Target.setAutoAttach', {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
})
client.on('Target.attachedToTarget', event => {
  const { sessionId, targetInfo } = event
  const session = connection.session(sessionId)
  void (async () => {
    if (
      session &&
      (targetInfo.type === 'worker' || targetInfo.type === 'shared_worker')
    ) {
      try {
        await arm(session)
        const tag = (targetInfo.url || 'worker').split('/').pop()
        profilers.push({ id: `worker${profilers.length}-${tag}`, session })
      } catch (e) {
        console.error('worker arm failed:', e instanceof Error ? e.message : e)
      }
    }
    await session?.send('Runtime.runIfWaitingForDebugger').catch(() => {})
  })()
})

const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(
  () => {
    const w = window as unknown as { __stable?: number; __last?: number }
    const done = document.querySelectorAll(
      '[data-testid$="-done"],[data-testid$="_done"]',
    ).length
    const loading =
      document.querySelectorAll('[data-testid="loading-overlay"]').length > 0
    const ready = done > 0 && !loading
    if (ready && done === w.__last) {
      w.__stable = (w.__stable ?? 0) + 1
    } else {
      w.__stable = 0
      w.__last = done
    }
    return ready && (w.__stable ?? 0) >= 5
  },
  { timeout: 120000, polling: 100 },
)
const elapsed = Date.now() - t0

fs.mkdirSync('flame', { recursive: true })
for (const p of profilers) {
  try {
    const { profile } = (await p.session.send('Profiler.stop')) as {
      profile: unknown
    }
    const samples = (profile as { samples?: unknown[] }).samples?.length ?? 0
    fs.writeFileSync(`flame/${label}.${p.id}.cpuprofile`, JSON.stringify(profile))
    console.log(`saved flame/${label}.${p.id}.cpuprofile  (${samples} samples)`)
  } catch (e) {
    console.error(`stop failed ${p.id}:`, e instanceof Error ? e.message : e)
  }
}
console.log(`render elapsed: ${elapsed}ms`)
await browser.close()

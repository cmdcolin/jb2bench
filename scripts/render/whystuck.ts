// Why did this cell never mount a display?
//
// profile.ts can only report that nothing appeared within 120 s. That message
// blames a missing trackId, which is one cause and not the only one — a track
// whose estimated byte count is over the build's limit renders a "force load"
// prompt instead of a display, and looks identical from outside.
//
// Usage: whystuck.ts <url>
import puppeteer from 'puppeteer'

const url = process.argv[2]
if (!url) {
  throw new Error('usage: whystuck.ts <url>')
}
const WAIT = Number(process.env.WAIT ?? 20000)

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=gl', '--use-gl=angle'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errors: string[] = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
page.on('requestfailed', r => errors.push(`failed: ${r.url()}`))
page.on('response', r => {
  if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`)
})
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`)
})
await page.goto(url, { waitUntil: 'load' })
await new Promise(r => setTimeout(r, WAIT))

const state = await page.evaluate(() => {
  const w = globalThis as Record<string, any>
  if (w.__igvState || w.__gsState) {
    return {
      toolState: w.__igvState ?? w.__gsState,
      canvases: [...document.querySelectorAll('canvas')].map(c => ({
        w: (c as HTMLCanvasElement).width,
        h: (c as HTMLCanvasElement).height,
      })),
      divs: document.getElementById('igv')?.children.length ?? document.getElementById('gs')?.children.length,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
    } as any
  }
  const session = w.JBrowseSession
  const track = session?.views?.[0]?.tracks?.[0]
  const display = track?.displays?.[0]
  const pick = (o: unknown, keys: string[]) =>
    Object.fromEntries(
      keys.map(k => {
        try {
          const v = (o as Record<string, unknown>)?.[k]
          return [k, typeof v === 'function' ? '<fn>' : v]
        } catch (e) {
          return [k, `throw: ${(e as Error).message.slice(0, 60)}`]
        }
      }),
    )
  return {
    trackId: track?.configuration?.trackId,
    displayType: display?.type,
    display: pick(display, [
      'error',
      'statusMessage',
      'byteEstimate',
      'forceLoadTrack',
      'canvasDrawn',
      'renderError',
      'currentRenderingBackend',
    ]),
    canvases: document.querySelectorAll('canvas').length,
    phases: [...document.querySelectorAll('[data-display-phase]')].map(n =>
      n.getAttribute('data-display-phase'),
    ),
    // What a person looking at the screen would see. A force-load prompt says
    // so in words, which is faster to read than any model field.
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
  }
})

console.log(JSON.stringify(state, null, 2))
if (errors.length) {
  console.log('\npage errors:')
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(' ', e)
}
await browser.close()

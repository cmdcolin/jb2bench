// Did a harness page actually draw the corpus, or only paint an empty frame?
//
// Shared by `toolcheck.ts` (does each harness still work?) and
// `formatsupport.ts` (which tool can open which format?), because those two ask
// the same question of a page and differ only in what they enumerate. They were
// one file until the second one wanted the answer as data rather than as a line
// of output.
//
// The check needs no per-tool knowledge, which is the point: a tool that drew
// has a canvas with content and has pulled bytes off the disk, and a tool that
// failed is missing one of those. Anything tool-specific would have to be
// written once per tool and would rot once per tool.
import type { Browser } from 'puppeteer'

/**
 * Data files, matched against the URL **path** and never the whole URL.
 *
 * A harness URL carries the track name in its query string and ends
 * `&track=200x.shortread.bam`, so a whole-URL match matches the *page* and
 * credits its few kB of HTML to the corpus. Every page then clears a
 * `bytes > 0` bar without fetching anything — which is precisely the
 * distinction this measurement exists to make, and it is how a GenomeSpy page
 * that issued zero data requests reported `ok` on 2026-08-23.
 */
const DATA = /\.(bam|bai|cram|crai|bw|vcf\.gz|tbi|gff3\.gz)$/

export const isData = (url: string) => {
  try {
    return DATA.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export interface Drew {
  /** canvases with marks on them */
  painted: number
  /** canvases found, including any the page left blank */
  canvases: number
  /** bytes pulled from files in the corpus */
  bytes: number
  /** whatever the page said went wrong, deduplicated */
  errors: string[]
  /** the tool's own error field, where the tool has one */
  declared: string | null
}

/** A page drew the corpus if there are marks on a canvas AND it read the data. */
export const drew = (d: Drew) => d.painted > 0 && d.bytes > 0

export async function drewCheck(
  browser: Browser,
  url: string,
  settleMs: number,
): Promise<Drew> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  let bytes = 0
  const errors: string[] = []
  page.on('response', r => {
    if (isData(r.url())) {
      bytes += Number(r.headers()['content-length'] ?? 0)
    }
  })
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]!.slice(0, 120)))
  // A tool that catches its own exception and logs it never raises pageerror.
  // GenomeSpy does exactly that — `embed()` resolves, its promise does not
  // reject, `__gsState.error` stays null, and the only trace of a page that
  // drew nothing is a console error. Four signals read clean on a dead page.
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text().split('\n')[0]!.slice(0, 120))
    }
  })
  try {
    await page.goto(url, { waitUntil: 'load' })
    await new Promise(r => setTimeout(r, settleMs))
    const counted = await page.evaluate(() => {
      // **Walk shadow roots, and this is not a detail.** igv 3.x calls
      // `parentDiv.attachShadow()` and appends its whole UI inside, so
      // `document.querySelectorAll('canvas')` returns ZERO for a page igv has
      // drawn twelve canvases onto. A probe that does not descend reports a
      // working igv as drawing nothing, which is what the first version did.
      const canvases: HTMLCanvasElement[] = []
      const walk = (root: Document | ShadowRoot) => {
        for (const el of root.querySelectorAll('*')) {
          if (el instanceof HTMLCanvasElement) {
            canvases.push(el)
          }
          if (el.shadowRoot) {
            walk(el.shadowRoot)
          }
        }
      }
      walk(document)
      let painted = 0
      for (const c of canvases) {
        try {
          // A blank canvas of any size encodes to a very short data URL;
          // anything with marks in it is an order of magnitude longer. A
          // presence test, not a measurement, so the margin is ample.
          if (c.toDataURL().length > 3000) {
            painted++
          }
        } catch {
          /* tainted or contextless — cannot tell, so do not claim it drew */
        }
      }
      return { canvases: canvases.length, painted }
    })
    const declared = await page.evaluate(() => {
      const w = window as Record<string, any>
      return w.__igvState?.error ?? w.__gsState?.error ?? null
    })
    return { ...counted, bytes, errors: [...new Set(errors)], declared }
  } catch (e) {
    return {
      painted: 0,
      canvases: 0,
      bytes,
      errors: [...new Set([...errors, String(e).split('\n')[0]!.slice(0, 120)])],
      declared: null,
    }
  } finally {
    await page.close()
  }
}

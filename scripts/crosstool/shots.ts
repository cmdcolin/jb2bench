// What does each cross-tool arm actually DRAW at the same window?
//
// The timings say how long each tool took. Nothing said whether the tools drew
// comparable pictures, and on 2026-08-29 they did not: GenomeSpy and Gosling
// were painting flat rectangles — no coverage track, no mismatches, not one
// coloured base — while JBrowse and igv.js drew a coverage track and per-base
// mismatches on top of the pileup. A renderer comparison over arms that draw
// different pictures is not a renderer comparison, and the GenomeSpy arm won
// the light cells partly by doing less.
//
// `drewcheck.ts` cannot catch that: it asks whether a page drew ANYTHING from
// corpus bytes, which all four pass. This asks what the picture looks like, and
// leaves the answer in screenshots/crosstool/ where a person can compare them
// side by side. Counting distinct saturated hues in the read band is the cheap
// proxy for "does this arm draw base-level detail at all" — a flat-fill arm
// scores 0-2, an arm drawing mismatches scores in the tens or hundreds.
//
// Usage:
//   make shots
//   TRACK=200x.shortread.bam LOC=chr22_mask:75000-175000 node ... shots.ts
import fs from 'node:fs'
import puppeteer from 'puppeteer'

const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const TRACK = process.env.TRACK ?? '20x.shortread.bam'
const OUT = process.env.OUT ?? 'screenshots/crosstool'
const SETTLE = Number(process.env.SETTLE ?? 25000)
const JBROWSE_PORT = Number(process.env.JBROWSE_PORT ?? 8000)
const CROSSTOOL_PORT = Number(process.env.CROSSTOOL_PORT ?? 8003)

const arms = [
  {
    id: 'jbrowse',
    url: `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${TRACK}&renderer=webgl`,
  },
  { id: 'igv', url: `http://localhost:${CROSSTOOL_PORT}/index.html?loc=${LOC}&track=${TRACK}` },
  { id: 'genomespy', url: `http://localhost:${CROSSTOOL_PORT}/genomespy.html?loc=${LOC}&track=${TRACK}` },
  { id: 'gosling', url: `http://localhost:${CROSSTOOL_PORT}/gosling.html?loc=${LOC}&track=${TRACK}` },
]

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl', '--use-gl=angle'],
})

const slug = TRACK.replace(/\./g, '_')
for (const arm of arms) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 700, deviceScaleFactor: 1 })
  const missing: string[] = []
  page.on('requestfailed', r => missing.push(r.url()))
  page.on('response', r => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`)
  })
  try {
    await page.goto(arm.url, { waitUntil: 'networkidle2', timeout: 60000 })
  } catch (e) {
    console.log(`${arm.id}: goto ${(e as Error).message}`)
  }
  await new Promise(r => setTimeout(r, SETTLE))
  const path = `${OUT}/${slug}-${arm.id}.png`
  await page.screenshot({ path })
  const state = await page
    .evaluate(() => {
      const w = window as any
      return {
        busy: typeof w.__harnessBusy === 'function' ? w.__harnessBusy() : null,
        gs: w.__gsState ?? null,
        gos: w.__goslingState ?? null,
      }
    })
    .catch(() => null)
  console.log(`${arm.id.padEnd(10)} -> ${path}`)
  if (state?.gs) console.log(`           gs ${JSON.stringify(state.gs)}`)
  if (state?.gos) console.log(`           gosling ${JSON.stringify(state.gos)}`)
  for (const m of [...new Set(missing)]) console.log(`           MISSING ${m}`)
  await page.close()
}
await browser.close()
console.log(`\nwrote ${arms.length} screenshots to ${OUT}/ at ${LOC}, ${TRACK}`)

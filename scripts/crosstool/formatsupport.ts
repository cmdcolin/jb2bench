// Which tool can open which format, from a plain static host — measured.
//
// The paper carries a hand-curated design-space table, and most of what is in
// it is judgement: what a tool is *for*, how it composes, what its plugin story
// is. None of that is checkable by a harness and this file does not try. One
// row of it is not judgement at all — whether a tool can open a given format
// off a static file server — and that is the row a reader is most likely to
// challenge, so it is the row worth generating from a run.
//
// **Scope, stated so the table is not read as more than it is.** A cell here
// means "pointed at this file on an ordinary HTTP server, marks appeared on a
// canvas and the bytes were fetched". It does not mean the rendering is
// correct, complete, fast, or that the feature is good. It is the floor, not
// the ceiling.
//
// Read `drew` as a property of the *pair*, never of the tool alone: a `no` can
// be the harness page's fault as easily as the tool's, which is why every cell
// carries the error the page reported. Two rows are that case today. The
// GenomeSpy and Gosling harness pages build a BAM pileup spec and nothing else,
// so their BigWig and VCF cells report a gap in this repo and not in the tool —
// both libraries read those formats. Their CRAM cells are the tool: neither has
// a CRAM reader.
//
// Usage: node --experimental-strip-types scripts/crosstool/formatsupport.ts
import fs from 'fs'
import puppeteer from 'puppeteer'
import { drew, drewCheck, type Drew } from './drewcheck.ts'

const JBROWSE_PORT = Number(process.env.JBROWSE_PORT ?? 8000)
const CROSSTOOL_PORT = Number(process.env.CROSSTOOL_PORT ?? 8003)
const LOC = process.env.LOC ?? 'chr22_mask:124000-143000'
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 20000)

interface Format {
  id: string
  /** the corpus file, relative to data/ */
  track: string
  /** why a tool might legitimately not have this, for the notes column */
  note?: string
}

// One file per format, deliberately small: this asks whether a tool can open
// the format at all, and a heavy file would be measuring something else and
// taking twenty minutes to do it. All four sit on the shared `chr22_mask`
// assembly, so every tool is pointed at the same coordinates.
//
// GFF3 is absent and that is a corpus gap, not a finding: `data/features.*.gff3`
// were generated for the @gmod/gff parser benchmark and sit on a contig called
// `gff_contig`, so no tool configured for `hg19mod` can open them. Regenerating
// them onto `chr22_mask` would add the row.
const FORMATS: Format[] = [
  { id: 'BAM', track: '20x.shortread.bam' },
  { id: 'CRAM', track: '20x.shortread.cram' },
  { id: 'BigWig', track: '20x.shortread.bw', note: 'self-indexing, no sidecar' },
  { id: 'VCF', track: 'variants.browser.vcf.gz', note: 'bgzip + tabix' },
]

interface Tool {
  id: string
  label: string
  url: (track: string) => string
}

const igvVersion = JSON.parse(
  fs.readFileSync('node_modules/igv/package.json', 'utf8'),
).version as string
const gsVersion = JSON.parse(
  fs.readFileSync('node_modules/@genome-spy/core/package.json', 'utf8'),
).version as string
const goslingVersion = JSON.parse(
  fs.readFileSync('node_modules/gosling.js/package.json', 'utf8'),
).version as string

const TOOLS: Tool[] = [
  {
    id: 'jbrowse',
    label: 'JBrowse (builds/current)',
    // The real application, not a harness page: its tracks come out of the
    // generated config, so a format missing here means the config pass never
    // added it rather than that JBrowse cannot read it.
    url: t =>
      `http://localhost:${JBROWSE_PORT}/?loc=${LOC}&assembly=hg19mod&tracks=${t}`,
  },
  {
    id: 'igv',
    label: `igv.js ${igvVersion}`,
    url: t => `http://localhost:${CROSSTOOL_PORT}/?loc=${LOC}&track=${t}`,
  },
  {
    id: 'genomespy',
    label: `GenomeSpy ${gsVersion}`,
    url: t =>
      `http://localhost:${CROSSTOOL_PORT}/genomespy.html?loc=${LOC}&track=${t}`,
  },
  {
    id: 'gosling',
    label: `Gosling ${goslingVersion}`,
    url: t =>
      `http://localhost:${CROSSTOOL_PORT}/gosling.html?loc=${LOC}&track=${t}`,
  },
]

const toolFilter = process.env.TOOLS?.split(',')
const tools = toolFilter ? TOOLS.filter(t => toolFilter.includes(t.id)) : TOOLS
const fmtFilter = process.env.FORMATS?.split(',')
const formats = fmtFilter ? FORMATS.filter(f => fmtFilter.includes(f.id)) : FORMATS

for (const f of formats) {
  if (!fs.existsSync(`data/${f.track}`)) {
    throw new Error(
      `data/${f.track} is missing — ${
        f.id === 'VCF' ? 'run shell/generate_indexed_vcf.sh' : 'regenerate the corpus'
      }`,
    )
  }
}

const browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== '0',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl', '--use-gl=angle'],
})

const results: Record<string, Record<string, Drew & { drew: boolean }>> = {}
for (const tool of tools) {
  results[tool.id] = {}
  for (const f of formats) {
    process.stdout.write(`${tool.id} / ${f.id}: `)
    const d = await drewCheck(browser, tool.url(f.track), SETTLE_MS)
    const ok = drew(d)
    results[tool.id]![f.id] = { ...d, drew: ok }
    console.log(
      `${ok ? 'drew' : 'no'} (${d.painted}/${d.canvases} canvases, ` +
        `${(d.bytes / 1e6).toFixed(1)} MB)${d.errors[0] ? ` — ${d.errors[0]}` : ''}`,
    )
  }
}
await browser.close()

const stamp = new Date().toISOString().slice(0, 10)
fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(
  'results/format-support.json',
  JSON.stringify({ loc: LOC, measuredAt: stamp, formats, tools, results }, null, 2),
)

let md = `# Format support, measured\n\n`
md += `Each cell is one page load against a plain \`http-server\`, at \`${LOC}\`, `
md += `settled for ${SETTLE_MS / 1000} s. **drew** means marks appeared on a canvas *and* the tool fetched the file; `
md += `either one alone is not enough, because a tool that paints an empty frame and a tool that fetches bytes it cannot draw both look like success from one side.\n\n`
md += `This is a floor, not a verdict on quality: it says the tool opened the file from a static host, not that it rendered it well. `
md += `A **no** belongs to the tool *and its harness page together* — the page can be at fault, and on ${stamp} one was. `
md += `Measured ${stamp}.\n\n`
md += `| format | ${tools.map(t => t.label).join(' | ')} | note |\n`
md += `|---|${tools.map(() => '---').join('|')}|---|\n`
for (const f of formats) {
  const cells = tools.map(t => {
    const r = results[t.id]![f.id]!
    return r.drew ? `drew, ${(r.bytes / 1e6).toFixed(1)} MB` : '**no**'
  })
  md += `| ${f.id} | ${cells.join(' | ')} | ${f.note ?? ''} |\n`
}

// Every failure gets its reason printed. A matrix of bare no's invites the
// reader to conclude the tool cannot do it, when the answer is often that this
// repo's harness for it does not.
const failures = tools.flatMap(t =>
  formats
    .filter(f => !results[t.id]![f.id]!.drew)
    .map(f => ({ tool: t, f, r: results[t.id]![f.id]! })),
)
if (failures.length) {
  md += `\n## Why each \`no\`\n\n`
  for (const { tool, f, r } of failures) {
    const why = r.declared ?? r.errors[0] ?? 'no error reported'
    md += `- **${tool.label} / ${f.id}** — ${r.painted}/${r.canvases} canvases painted, `
    md += `${(r.bytes / 1e6).toFixed(1)} MB fetched. ${why}\n`
  }
}

md += `\n## What this does not answer\n\n`
md += `Whether the rendering is correct or complete, how fast it is, and every part of the design-space comparison that is a judgement call. `
md += `GFF3 has no row: \`data/features.*.gff3\` sit on a contig named \`gff_contig\` because they were generated for the parser benchmark, so no tool configured for \`hg19mod\` can open them. That is a corpus gap, not a capability finding.\n`

fs.writeFileSync('results/format-support.md', md)
console.log('\n' + md)
console.log('Wrote results/format-support.json and results/format-support.md')

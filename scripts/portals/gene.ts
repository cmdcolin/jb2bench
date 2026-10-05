// Time the gene review portal on Tiberius predictions for human chr22, read against GENCODE v49, with and
// without the screenshots.
//
//   node --experimental-strip-types scripts/portals/gene.ts --app-dir <jbrowse-web build> [--runs 2] [--out results/portals-gene.json]
//
// --app-dir is required: the published jbrowse CLI's --with-app bundles v4.3.0, and every capture times out against it.
// GENE_PORTAL sets the gene-review-portal checkout (default ~/src/gene-review-portal). All data is fetched over the network.

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, homedir, hostname, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const opt = (n: string, d?: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const appDir = opt('--app-dir')
if (!appDir) {
  console.error('usage: gene.ts --app-dir <jbrowse-web build> [--runs N] [--out file]')
  process.exit(2)
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runs = Number(opt('--runs', '2'))
const out = resolve(root, opt('--out', 'results/portals-gene.json')!)
const portal = process.env.GENE_PORTAL ?? resolve(homedir(), 'src/gene-review-portal')
const work = resolve(tmpdir(), 'jb2bench-portals-gene')
const D = 'https://jbrowse.org/demos/tiberius_review'

const args = (outDir: string, extra: string[]) => [
  resolve(portal, 'bin/make-portal.mjs'),
  '--prediction', 'https://jbrowse.org/genomes/GRCh38/tiberius_grch38.gff.gz',
  '--hub', 'hg38', '--reference-track', 'hg38-gencodeComp',
  '--rnaseq', `${D}/HBR_brain_rnaseq_chr22.bam`, '--rnaseq-name', 'RNA-seq brain (HBR)',
  '--rnaseq', `${D}/UHR_reference_rnaseq_chr22.bam`, '--rnaseq-name', 'RNA-seq UHR',
  '--assembly', 'hg38', '--region', 'chr22', '--out', outDir, ...extra,
]

const results: Record<string, unknown>[] = []
for (const [mode, extra] of [['capture', ['--app-dir', resolve(appDir)]], ['no-capture', ['--no-capture']]] as const) {
  for (let i = 1; i <= (mode === 'capture' ? runs : Math.min(runs, 3)); i++) {
    const outDir = resolve(work, `${mode}${i}`)
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(work, { recursive: true })
    const t0 = performance.now()
    const r = spawnSync('node', args(outDir, [...extra]), { encoding: 'utf8', maxBuffer: 1 << 28 })
    const seconds = +((performance.now() - t0) / 1000).toFixed(1)
    const log = r.stdout + r.stderr
    const models = Number(/(\d+) models/.exec(log)?.[1] ?? 0)
    const flagged = Number(/(\d+) flagged/.exec(log)?.[1] ?? 0)
    const cards = Number(/(\d+) cards/.exec(log)?.[1] ?? 0)
    const captures = Number(/(\d+) captures/.exec(log)?.[1] ?? 0)
    const failed = (log.match(/^\s+(fail|FAIL|timeout)/gm) ?? []).length
    const row = { mode, run: i, seconds, models, flagged, cards, captures, failed, perScreenshot: captures ? +(seconds / captures).toFixed(2) : undefined }
    results.push(row)
    console.log(`${mode} run ${i}: ${seconds} s, ${models} models, ${flagged} flagged, ${cards} cards, ${captures} screenshots${row.perScreenshot ? `, ${row.perScreenshot} s each` : ''}`)
  }
}

const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: portal, encoding: 'utf8' }).stdout.trim()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  host: hostname(),
  cpu: cpus()[0].model,
  threads: cpus().length,
  source: 'remote',
  geneReviewPortal: rev,
  appDir: resolve(appDir),
  runs: results,
}, null, 2))
console.log(`→ ${out}`)

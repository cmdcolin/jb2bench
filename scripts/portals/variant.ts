// Time the structural variant review portal on the COLO829 somatic callset: one jb2export batch run drawing the tumor
// and the matched normal reads into each record's image, then variant-review-portal's make-portal.
//
//   node --experimental-strip-types scripts/portals/variant.ts <dir> [--runs 2] [--evict] [--out results/portals-variant.json]
//
// <dir> holds the files scripts/portals/fetch-colo829.sh downloads. With --evict, the first run starts with both
// read files dropped from the page cache (cold) and later runs are warm. Without <dir> files, pass --remote to read
// the demo config's URLs instead; that times the network.
// VARIANT_PORTAL sets the variant-review-portal checkout (default ~/src/variant-review-portal).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(n)
const opt = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const dir = argv.find(a => !a.startsWith('--') && a !== opt('--runs', '') && a !== opt('--out', ''))
if (!dir) {
  console.error('usage: variant.ts <dir> [--runs N] [--evict] [--remote] [--out file]')
  process.exit(2)
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const data = resolve(dir)
const runs = Number(opt('--runs', '2'))
const out = resolve(root, opt('--out', 'results/portals-variant.json'))
const portal = process.env.VARIANT_PORTAL ?? resolve(homedir(), 'src/variant-review-portal')
const IMG = '5.0.0-beta.13'
const remote = flag('--remote')

const sh = (cmd: string, args: string[], cwd = data) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })

const bin = resolve(data, 'tools/node_modules/.bin/jb2export')
const imgPackage = resolve(data, 'tools/node_modules/@jbrowse/img/package.json')
const installed = () => (existsSync(imgPackage) ? JSON.parse(readFileSync(imgPackage, 'utf8')).version : undefined)
if (installed() !== IMG) {
  mkdirSync(resolve(data, 'tools'), { recursive: true })
  sh('npm', ['install', '--prefix', resolve(data, 'tools'), `@jbrowse/img@${IMG}`])
}
const imgVersion = installed()
if (!remote && !existsSync(resolve(data, 'config.local.json'))) {
  sh('node', ['--experimental-strip-types', resolve(root, 'scripts/portals/localconfig.ts'), data])
}
const config = remote ? 'https://jbrowse.org/demos/cancer_sv/config.json' : resolve(data, 'config.local.json')
const vcf = resolve(data, 'COLO829.wf-somatic-sv.vcf.gz')

const tracks = {
  tumor: { id: 'COLO829_tumor_ont', file: 'COLO829_tumor.ht.cram' },
  normal: { id: 'COLO829BL_normal_ont', file: 'PAU59807.d052sup4305mCG_5hmCGvHg38.bam' },
}

const evict = (f: string) =>
  sh('python3', ['-c', 'import os,sys;fd=os.open(sys.argv[1],os.O_RDONLY);os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED)', resolve(data, f)])

const results: Record<string, unknown>[] = []
let lastDir = ''
for (let i = 1; i <= runs; i++) {
  const cold = flag('--evict') && i === 1
  if (cold) {
    for (const t of Object.values(tracks)) {
      evict(t.file)
    }
  }
  const outDir = resolve(data, `reads${i}`)
  rmSync(outDir, { recursive: true, force: true })
  const t0 = performance.now()
  const r = sh(bin, ['batch', '--vcf', vcf, '--config', config, '--assembly', 'hg38', ...Object.values(tracks).flatMap(t => ['--track', t.id, 'height:240']), '--outDir', outDir, '--flank', '600', '--width', '1100', '--manifest'])
  const seconds = (performance.now() - t0) / 1000
  const images = readdirSync(outDir).filter(f => f.endsWith('.png')).length
  const m = /wrote (\d+)\/(\d+) images/.exec(r.stdout + r.stderr)
  const total = m ? Number(m[2]) : images
  lastDir = outDir
  const row = { tracks: Object.keys(tracks).join('+'), run: i, cache: flag('--evict') ? (cold ? 'cold' : 'warm') : 'unspecified', seconds: +seconds.toFixed(1), images, total, perRecord: +(seconds / total).toFixed(3) }
  results.push(row)
  console.log(`run ${i} (${row.cache}): ${row.seconds} s, ${images}/${total} images, ${row.perRecord} s per record`)
}

const pageDir = resolve(data, 'portal')
rmSync(pageDir, { recursive: true, force: true })
const t0 = performance.now()
const p = sh('node', [resolve(portal, 'bin/make-portal.mjs'), '--vcf', vcf, '--images', `${Object.keys(tracks).join(',')}=${lastDir}`, '--out', pageDir])
const pageSeconds = +((performance.now() - t0) / 1000).toFixed(2)
const cards = Number(/wrote (\d+) cards/.exec(p.stdout + p.stderr)?.[1] ?? 0)
console.log(`make-portal: ${pageSeconds} s, ${cards} cards`)

const rev = sh('git', ['rev-parse', '--short', 'HEAD'], portal).stdout.trim()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  host: hostname(),
  cpu: cpus()[0].model,
  threads: cpus().length,
  source: remote ? 'remote' : 'local disk',
  jbrowseImg: imgVersion,
  variantReviewPortal: rev,
  runs: results,
  portalBuild: { seconds: pageSeconds, cards },
}, null, 2))
console.log(`→ ${out}`)

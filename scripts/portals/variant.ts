// Time the structural variant review portal on the COLO829 somatic callset: jb2export batch for the tumor and
// the matched normal reads, then variant-review-portal's make-portal.
//
//   node --experimental-strip-types scripts/portals/variant.ts <dir> [--runs 2] [--evict] [--out results/portals-variant.json]
//
// <dir> holds the files scripts/portals/fetch-colo829.sh downloads. With --evict, the first run of each track starts
// with that file dropped from the page cache (cold) and later runs are warm. Without <dir> files, pass --remote to read
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
const IMG = '5.0.0-beta.11'
const remote = flag('--remote')

const sh = (cmd: string, args: string[], cwd = data) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })

const bin = resolve(data, 'tools/node_modules/.bin/jb2export')
if (!existsSync(bin)) {
  mkdirSync(resolve(data, 'tools'), { recursive: true })
  sh('npm', ['install', '--prefix', resolve(data, 'tools'), `@jbrowse/img@${IMG}`])
}
const imgVersion = JSON.parse(readFileSync(resolve(data, 'tools/node_modules/@jbrowse/img/package.json'), 'utf8')).version
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
const lastDir: Record<string, string> = {}
for (const [name, t] of Object.entries(tracks)) {
  for (let i = 1; i <= runs; i++) {
    const cold = flag('--evict') && i === 1
    if (cold) {
      evict(t.file)
    }
    const outDir = resolve(data, `${name}${i}`)
    rmSync(outDir, { recursive: true, force: true })
    const t0 = performance.now()
    const r = sh(bin, ['batch', '--vcf', vcf, '--config', config, '--assembly', 'hg38', '--track', t.id, 'height:240', '--outDir', outDir, '--flank', '600', '--width', '1100', '--manifest'])
    const seconds = (performance.now() - t0) / 1000
    const images = readdirSync(outDir).filter(f => f.endsWith('.png')).length
    const m = /wrote (\d+)\/(\d+) images/.exec(r.stdout + r.stderr)
    const total = m ? Number(m[2]) : images
    lastDir[name] = outDir
    const row = { track: name, run: i, cache: flag('--evict') ? (cold ? 'cold' : 'warm') : 'unspecified', seconds: +seconds.toFixed(1), images, total, perRecord: +(seconds / total).toFixed(3) }
    results.push(row)
    console.log(`${name} run ${i} (${row.cache}): ${row.seconds} s, ${images}/${total} images, ${row.perRecord} s per record`)
  }
}

const pageDir = resolve(data, 'portal')
rmSync(pageDir, { recursive: true, force: true })
const t0 = performance.now()
const p = sh('node', [resolve(portal, 'bin/make-portal.mjs'), '--vcf', vcf, '--images', lastDir.tumor, '--images', lastDir.normal, '--out', pageDir])
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

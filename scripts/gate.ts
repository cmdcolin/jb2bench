// Preflight for a benchmark run: everything that decides whether the next hour
// of measurement is worth keeping, checked before it starts rather than
// discovered in the table afterwards.
//
// Each of these checks exists because its absence has already cost a run here:
//
//   load        2026-08-05: a run that began at load 3.15 finished at 35, and
//               release-4.1.15 returned 25187 ms and then 56452 ms for identical
//               work. Load is sampled again after every step by the runners; this
//               is only the door.
//   agents      the load average lags. `pgrep -c claude` sees six sessions about
//               to become load 30 while /proc/loadavg still reads 2.
//   builds      a port serving a build nobody staged produces a results table
//               whose column headers are a guess — see servedbuild.ts.
//   corpus      a missing CRAM makes one cell fail an hour into a matrix.
//   disk        the parser sweep writes 30-odd library builds; the paper corpus
//               is 16 GB.
//
//   node --experimental-strip-types scripts/gate.ts          # exits 1 on failure
//   node --experimental-strip-types scripts/gate.ts --warn   # reports, exits 0
//   LOAD_CEILING=8 node --experimental-strip-types scripts/gate.ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

import { loadavg } from './render/loadavg.ts'
import { resolveBuild } from './render/servedbuild.ts'

const CEILING = Number(process.env.LOAD_CEILING ?? 4.0)
const WARN_ONLY = process.argv.includes('--warn')

// Ports and the builds the README stages on them. Checked by content hash
// rather than by name, so a restaged port fails here instead of mislabelling a
// column.
const PORTS = [8000, 8001, 8004]

interface Check {
  name: string
  ok: boolean
  detail: string
  /** a failure that stops a timing run but not a counting one */
  timingOnly?: boolean
}

const checks: Check[] = []
const add = (c: Check) => checks.push(c)

// ------------------------------------------------------------------- load ---

const load = loadavg()
add({
  name: 'load average',
  ok: load <= CEILING,
  detail: `${load.toFixed(2)} (ceiling ${CEILING.toFixed(1)})`,
  timingOnly: true,
})

let agents = 0
try {
  agents = Number(
    execFileSync('pgrep', ['-c', 'claude'], { encoding: 'utf8' }).trim(),
  )
} catch {
  agents = 0
}
// The session driving the run is itself one of these, so the ceiling is 2 rather
// than 1 — a run started by hand from a session is normal, six sessions sharing
// the box is what produced every unusable table in results/.
const AGENT_CEILING = Number(process.env.AGENT_CEILING ?? 2)
add({
  name: 'agent sessions',
  ok: agents <= AGENT_CEILING,
  detail:
    agents <= AGENT_CEILING
      ? `${agents} (ceiling ${AGENT_CEILING})`
      : `${agents} claude processes; the load average has not caught up with them yet`,
  timingOnly: true,
})

// ------------------------------------------------------------------ disk ---

const free = (() => {
  const out = execFileSync('df', ['-BG', '--output=avail', '.'], {
    encoding: 'utf8',
  })
  return Number(out.split('\n')[1]!.replace(/\D/g, ''))
})()
add({
  name: 'free disk',
  ok: free >= 5,
  detail: `${free} GB`,
})

// ---------------------------------------------------------------- corpus ---

const COVERAGES = ['20x', '200x', '1000x']
const READS = ['shortread', 'longread']
const corpus = COVERAGES.flatMap(c =>
  READS.flatMap(r => [
    `${c}.${r}.bam`,
    `${c}.${r}.bam.bai`,
    `${c}.${r}.cram`,
    `${c}.${r}.cram.crai`,
  ]),
)
const missingCorpus = corpus.filter(f => !fs.existsSync(`data/${f}`))
add({
  name: 'alignment corpus',
  ok: missingCorpus.length === 0,
  detail:
    missingCorpus.length === 0
      ? `${corpus.length} files`
      : `missing ${missingCorpus.length}: ${missingCorpus.slice(0, 3).join(', ')}… — shell/generate_alignments.sh`,
})

// The ordinary-depth arms, on their own line rather than folded into the count
// above, because they are needed by one benchmark and not by the others.
//
// `shell/generate_alignments.sh` started emitting 10x and 30x on 2026-09-04 for
// the BGZF pool levers work -- 1000x is not a workload and 10-30x is, which is
// where that question is actually decided (results/bgzfpool-levers.md). A box
// whose corpus predates that commit can still take every render timing, so this
// must not block one; what it must do is be visible, which the count above
// cannot manage. That check passed at "24 files" on a machine with no 10x or
// 30x file on it at all, because 24 is what it expects and the new arms were
// never in its list.
const ORDINARY_DEPTHS = ['10x', '30x']
const ordinary = ORDINARY_DEPTHS.flatMap(c =>
  READS.flatMap(r => [
    `${c}.${r}.bam`,
    `${c}.${r}.bam.bai`,
    `${c}.${r}.cram`,
    `${c}.${r}.cram.crai`,
  ]),
)
const missingOrdinary = ordinary.filter(f => !fs.existsSync(`data/${f}`))
add({
  name: 'ordinary-depth arms',
  ok: missingOrdinary.length === 0,
  detail:
    missingOrdinary.length === 0
      ? `${ordinary.length} files (10x, 30x)`
      : `missing ${missingOrdinary.length} of ${ordinary.length} — only scripts/bgzfpool/levers.ts reads these; make corpus`,
})

const extras: [string, string, string][] = [
  ['variant corpus', 'data/variants.1000.wide.vcf', 'shell/generate_variants.sh'],
  ['GFF3 corpus', 'data/features.1000.rich.gff3', 'shell/generate_gff3.sh'],
  ['cohort BigWigs', 'data/cohort', 'shell/generate_cohort_bw.sh'],
  ['modBAM corpus', 'data/200x.longread.mod.bam', 'shell/generate_modbam.sh'],
  // The manifest rather than a CRAM: fetch_paper2019.sh writes it last, so its
  // presence means the downloads finished. A half-fetched 4.6 GB CRAM exists as
  // a file and fails as a corpus.
  ['paper-2019 corpus', 'data/paper2019/MANIFEST.txt', 'shell/fetch_paper2019.sh'],
]
for (const [name, path, how] of extras) {
  add({
    name,
    ok: fs.existsSync(path),
    detail: fs.existsSync(path) ? path : `absent — ${how}`,
  })
}

// ---------------------------------------------------------------- builds ---

for (const port of PORTS) {
  try {
    add({ name: `port ${port}`, ok: true, detail: await resolveBuild(port), timingOnly: true })
  } catch (e) {
    add({
      name: `port ${port}`,
      ok: false,
      detail: String((e as Error).message).split('\n')[0]!,
      timingOnly: true,
    })
  }
}

// -------------------------------------------------------------- libraries ---

const sweepBuilt = fs.existsSync('ecosystem/.libs/sweep-manifest.txt')
add({
  name: 'sweep builds',
  ok: sweepBuilt,
  detail: sweepBuilt ? 'ecosystem/.libs/*/sweep' : 'absent — ecosystem/setup-sweep.sh',
})

// ---------------------------------------------------------------- report ---

const pad = Math.max(...checks.map(c => c.name.length))
for (const c of checks) {
  console.log(`${c.ok ? ' ok ' : 'FAIL'}  ${c.name.padEnd(pad)}  ${c.detail}`)
}

const failed = checks.filter(c => !c.ok)
const blockingTimings = failed.filter(c => c.timingOnly)
console.log()
if (failed.length === 0) {
  console.log('all clear — a timing run taken now is worth keeping')
} else if (blockingTimings.length === 0) {
  console.log(
    `${failed.length} check(s) failed, none of which affect a timing: the counting\n` +
      'benchmarks (MODE=count sweep, cohort request counts) still produce results.',
  )
} else {
  console.log(
    `${blockingTimings.length} check(s) mean a timing taken now is not worth keeping.`,
  )
}
process.exit(failed.length === 0 || WARN_ONLY ? 0 : 1)

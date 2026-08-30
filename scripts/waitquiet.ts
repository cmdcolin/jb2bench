// Blocks until this machine is fit to measure on, then exits 0 so a caller can
// chain the run behind it: `node scripts/waitquiet.ts && make crosstool-cold`.
//
// `make gate` answers "is this box fit right now" and exits 1 when it is not,
// which is the right shape for a run started by hand and the wrong one for a
// run you want to start itself the moment the box frees up. This is the same
// question asked on a loop.
//
// TWO CONDITIONS, because neither catches the other's failure. The gate counts
// agent sessions and reads the load average, which lags; foreign CPU is what
// actually corrupts a cell and is what the cold runner marks a row unusable by.
// The run of 2026-08-30 passed no such wait: it began at 03:28 while another
// session was running jest, and four of its 19 kb rows came back above the
// 0.5-core ceiling and had to be thrown away.
//
// The ceiling here sits BELOW the runner's own, so a box that only just settles
// does not start a six-hour matrix that the first spike disqualifies.
//
//   QUIET_CEILING=0.35   foreign cores, against the runner's 0.5
//   QUIET_SAMPLES=3      consecutive clean windows before proceeding
//   QUIET_WINDOW_MS      length of each window; also the poll interval
//   QUIET_TIMEOUT_MS     give up and exit 1
import { spawnSync } from 'node:child_process'

import { foreignNow, loadavg } from './render/loadavg.ts'

const CEILING = Number(process.env.QUIET_CEILING ?? 0.35)
const NEEDED = Number(process.env.QUIET_SAMPLES ?? 3)
const WINDOW = Number(process.env.QUIET_WINDOW_MS ?? 30000)
const TIMEOUT = Number(process.env.QUIET_TIMEOUT_MS ?? 8 * 3600 * 1000)

// The gate's own failures are printed rather than counted, because "waiting"
// with no reason is indistinguishable from hung: a port that went down is a
// wait that will never end, and the log has to say so.
function gate() {
  const r = spawnSync('node', ['--experimental-strip-types', 'scripts/gate.ts'], {
    encoding: 'utf8',
  })
  return {
    ok: r.status === 0,
    fails: (r.stdout ?? '')
      .split('\n')
      .filter(l => l.startsWith('FAIL'))
      .map(l => l.replace(/\s+/g, ' ').trim()),
  }
}

console.log(
  `waiting for a quiet box: ${NEEDED} consecutive ${WINDOW / 1000}s windows ` +
    `under ${CEILING} foreign cores, with the gate passing`,
)

const t0 = Date.now()
let streak = 0
while (Date.now() - t0 < TIMEOUT) {
  const f = foreignNow(WINDOW)
  const g = gate()
  const ok = g.ok && f.cores <= CEILING
  streak = ok ? streak + 1 : 0
  console.log(
    [
      new Date().toTimeString().slice(0, 8),
      `foreign ${f.cores.toFixed(2)}`,
      `load ${loadavg().toFixed(2)}`,
      ok ? `clean ${streak}/${NEEDED}` : 'busy',
      f.top,
      g.fails.join('; '),
    ]
      .filter(Boolean)
      .join(' | '),
  )
  if (streak >= NEEDED) {
    console.log('box is quiet; starting the run')
    process.exit(0)
  }
}
console.log(`still not quiet after ${(TIMEOUT / 3600000).toFixed(1)}h; giving up`)
process.exit(1)

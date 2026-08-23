// Every number in results/ is a render timing on one shared workstation, so
// competing load corrupts it — and not uniformly: the corruption lands on
// whichever cells happen to overlap the other job. That makes a per-run load
// figure nearly useless for auditing, because a run whose *median* load looks
// fine can still contain one badly contaminated cell.
//
// The 2026-08-05 interaction run is the case in point. Load was 2.8–4.8 for most
// of it but spiked to 13.3 near the end, and the only cell that failed to
// reproduce (1000x-longread, +10%) was the one running at the time. That was
// recoverable only because a separate sampler happened to be running alongside.
//
// So attach the evidence to the measurement instead: each cell records the load
// average either side of itself, and the report flags any cell measured under
// load the rest of the run did not share.
//
// **The load average cannot do that job on its own, and treating it as if it
// could marks clean measurements as dirty.** It counts every runnable thread,
// including the benchmark's own: measured 2026-08-23 on a box with one agent
// session and nothing else running, `1000x-shortread-bam` on release-2.4.0 took
// 15.4 s a render and drove the 1-minute average from 2.1 to 10.3, and the next
// cell then *began* at 10.3 having inherited a trailing average of work this
// benchmark had done itself. Under a fixed ceiling of 4.0 both rows report
// `unusable` on an idle machine. The heavier the cell, the more certainly it
// disqualifies itself.
//
// So contention is measured as *foreign* CPU — time burned by processes outside
// this run's own tree — and the load average is kept beside it as context
// rather than as the verdict.
import fs from 'fs'

/** 1-minute load average */
export const loadavg = () =>
  Number.parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]!)

const CLOCK_TICK = 100 // CONFIG_HZ on every kernel this repo runs on

/**
 * The corpus http-servers, which are this benchmark's apparatus and not
 * contention.
 *
 * `make serve` starts them outside any runner, so ancestry alone puts them in
 * the foreign column — where they bias every verdict in the direction of
 * condemning a row, and bias it hardest on the heavy cases, since serving
 * 268 MB of BAM costs more than serving 3 MB. Measured 2026-08-23 they run at
 * 0.05 cores during a 1000x-longread cell, a tenth of the ceiling. Small, but
 * it is the benchmark's own work and the load average's mistake was exactly
 * this one.
 *
 * Matched on the command line of the `npm exec`/`sh -c` parents; the worker
 * process itself has a bare `http-server` cmdline with no arguments, so it is
 * picked up as their descendant rather than directly.
 */
const APPARATUS = /http-server\s+(builds|crosstool)/

function apparatusRoots(procs: Iterable<number>): number[] {
  const roots: number[] = []
  for (const pid of procs) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
      if (APPARATUS.test(cmd)) {
        roots.push(pid)
      }
    } catch {
      /* exited */
    }
  }
  return roots
}

/**
 * CPU seconds consumed so far, per process, by everything that is NOT part of
 * this run.
 *
 * "This run" is the process tree rooted at us — the runner, the per-cell
 * `profile.ts` children it spawns, and the Chrome those launch — plus the
 * corpus servers, which no runner is an ancestor of. Everything else — another
 * agent's build, a browser someone left open, a backup job — is foreign, and
 * foreign CPU is the thing that actually corrupts a timing.
 *
 * Keyed by pid rather than summed, because a sum cannot be differenced: a
 * foreign process that exits between two samples takes its accumulated total
 * out of the second one, and the difference of the sums goes NEGATIVE. That is
 * not a hypothetical — the first version of this reported "-0.03 cores".
 * `foreignCpuBetween` differences per pid instead.
 */
export function foreignCpuSnapshot(rootPid = process.pid): Map<number, number> {
  const ppid = new Map<number, number>()
  const own = new Map<number, number>()
  const pids: number[] = []
  for (const name of fs.readdirSync('/proc')) {
    const pid = Number(name)
    if (!Number.isInteger(pid)) {
      continue
    }
    let stat: string
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    } catch {
      continue // exited between readdir and read
    }
    // comm can contain spaces and parentheses, so fields are counted from the
    // last ')' rather than by splitting the whole line.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    ppid.set(pid, Number(rest[1]))
    // utime and stime are fields 14 and 15 of stat, which are indices 11 and 12
    // of `rest` (field 3 is at index 0).
    own.set(pid, (Number(rest[11]) + Number(rest[12])) / CLOCK_TICK)
    pids.push(pid)
  }
  const roots = new Set([rootPid, ...apparatusRoots(pids)])
  const isOurs = (pid: number) => {
    for (let p = pid, hops = 0; p > 1 && hops < 64; p = ppid.get(p) ?? 0, hops++) {
      if (roots.has(p)) {
        return true
      }
    }
    return false
  }
  const foreign = new Map<number, number>()
  for (const pid of pids) {
    if (pid !== rootPid && !isOurs(pid)) {
      foreign.set(pid, own.get(pid) ?? 0)
    }
  }
  return foreign
}

/**
 * Foreign CPU seconds spent between two snapshots.
 *
 * A pid in `now` that was not in `then` is counted from zero: it is a process
 * that started during the window, and all of its CPU was spent inside it. A pid
 * that has since exited contributes nothing, so a short-lived foreign job is
 * the one case this reads low on — an undercount, never a negative.
 */
export function foreignCpuBetween(
  then: Map<number, number>,
  now: Map<number, number>,
): number {
  let spent = 0
  for (const [pid, cpu] of now) {
    spent += Math.max(0, cpu - (then.get(pid) ?? 0))
  }
  return spent
}

export interface LoadWindow {
  before: number
  after: number
  /**
   * Foreign CPU over the cell, in "cores busy with other people's work":
   * foreign CPU seconds divided by wall seconds. 0.05 is a browser idling in
   * another workspace; 1.0 means something else had a core saturated for the
   * whole cell.
   *
   * Optional because every result recorded before 2026-08-23 has only the load
   * endpoints, and those cannot be converted — the benchmark's own contribution
   * is not recoverable from them.
   */
  foreignCores?: number
  /**
   * Who burned it: the largest few foreign consumers, as `comm cores`.
   *
   * A bare number cannot be acted on. The first two rows this metric condemned
   * reported 0.55 cores and nothing else, and answering "0.55 of what" meant
   * re-deriving it by hand against a live run — where it turned out to be the
   * operator's own shell commands, run against the box while the run was in
   * flight. That is a fixable mistake and the scalar hid it.
   */
  foreignTop?: string
}

/** the load figure to judge a cell by: the worse of its two endpoints */
export const peak = (l: LoadWindow) => Math.max(l.before, l.after)

/**
 * How many cores something else was using during this cell. Falls back to
 * NaN — not 0 — for a cell recorded before the measurement existed, so an
 * unknown cannot be mistaken for a clean one.
 */
export const foreign = (l: LoadWindow) => l.foreignCores ?? Number.NaN

/**
 * Above this many foreign cores, a timing is not comparable to one taken on a
 * quiet box. Deliberately low: contamination damages a measurement long before
 * it is obvious, and the whole point of attributing CPU is that this threshold
 * no longer has to leave room for the benchmark's own load.
 */
export const FOREIGN_CORE_CEILING = 0.5

const comm = (pid: number) => {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
  } catch {
    return 'exited'
  }
}

/**
 * The biggest foreign consumers over a window, as `comm cores`, largest first.
 *
 * Read the name and not only the number: `claude` or `node` at 0.2 cores is
 * someone working on the box and the run should be repeated, while `gnome-shell`
 * at 0.02 is the desktop and always there. This box idles at about 0.28 foreign
 * cores with nobody touching it — two other agent sessions, the terminal, and a
 * browser — so the ceiling is a budget over that floor, not over zero.
 */
function topForeign(
  then: Map<number, number>,
  now: Map<number, number>,
  wall: number,
  n = 3,
): string {
  return [...now]
    .map(([pid, cpu]) => [pid, (cpu - (then.get(pid) ?? cpu)) / wall] as const)
    .filter(([, cores]) => cores > 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pid, cores]) => `${comm(pid)} ${cores.toFixed(2)}`)
    .join(', ')
}

/** Samples foreign CPU across a cell. Call `done()` when the cell finishes. */
export function watchForeignCpu() {
  const t0 = Date.now()
  const c0 = foreignCpuSnapshot()
  return {
    done: () => {
      const wall = (Date.now() - t0) / 1000
      const c1 = foreignCpuSnapshot()
      return {
        cores: wall > 0 ? foreignCpuBetween(c0, c1) / wall : 0,
        top: wall > 0 ? topForeign(c0, c1, wall) : '',
      }
    },
  }
}

/**
 * Cells whose load stands out from the run as a whole. Compares each cell's
 * peak against the median cell's, so the threshold adapts to the machine rather
 * than being a constant that is wrong on a quieter or busier box.
 */
export function outliers<T>(
  cells: { key: string; load: LoadWindow; value: T }[],
  factor = 2,
) {
  const peaks = [...cells.map(c => peak(c.load))].sort((a, b) => a - b)
  const med = peaks[Math.floor(peaks.length / 2)] ?? Number.NaN
  return {
    medianLoad: med,
    suspect: cells.filter(c => peak(c.load) > med * factor),
  }
}

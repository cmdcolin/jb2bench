// The foreign-CPU sampler, on its own thread.
//
// It has to be off the main thread, and this is the whole reason the file
// exists. Both runners drive a cell with `execFileSync`, which blocks the event
// loop for the cell's entire duration — so a `setInterval` sampler on the main
// thread fires **zero** times while the thing it is supposed to be watching
// runs. Measured: an interval at 100 ms across a 3 s synchronous child fires 0
// times, not 30.
//
// That silently reduced the watcher to the before/after pair it was written to
// replace, which is how a pan cell came to report 14.54 foreign cores on an
// idle box with `chrome 9.57, chrome 4.82` named — the benchmark billing itself
// for its own browser, because an orphaned Chrome absent from the opening
// snapshot is charged its whole lifetime.
//
// A worker thread keeps sampling while the main thread is blocked, and shares
// the process id, so `cpuSnapshot`'s ancestry test means the same thing here as
// it does there.
import fs from 'fs'
import { parentPort } from 'worker_threads'
import { cpuSnapshot } from './loadavg.ts'

const INTERVAL_MS = Number(process.env.FOREIGN_SAMPLE_MS ?? 500)

/** pids ever seen inside this run's tree — once ours, always ours */
const ours = new Set<number>()
/** CPU seconds a foreign pid had when first sighted, and most recently */
const first = new Map<number, number>()
const last = new Map<number, number>()
const comm = new Map<number, string>()

// Read at FIRST sighting, not at report time: a process that ends mid-cell is
// exactly the kind worth naming, and by the end its /proc entry is gone. This
// used `require('fs')`, which is not defined in an ES module, so every read
// threw into the fallback and the whole attribution column read `exited`.
function readComm(pid: number) {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
  } catch {
    return 'exited'
  }
}

function sample() {
  const snap = cpuSnapshot()
  for (const pid of snap.ours) {
    ours.add(pid)
  }
  for (const [pid, cpu] of snap.foreign) {
    // A pid that was ever part of this run stays ours even after init adopts
    // it. Chrome outliving its parent is the case this exists for.
    if (ours.has(pid)) {
      continue
    }
    if (!first.has(pid)) {
      first.set(pid, cpu)
      comm.set(pid, readComm(pid))
    }
    last.set(pid, cpu)
  }
}

sample()
const timer = setInterval(sample, INTERVAL_MS)

parentPort!.on('message', (m: string) => {
  if (m !== 'report') {
    return
  }
  clearInterval(timer)
  sample()
  // Charged only from first sighting: counting a newly-appeared process from
  // zero bills this window for CPU burned before it began. Bounded to one
  // interval, and it can only ever undercount.
  const spent = [...last]
    .map(
      ([pid, cpu]) =>
        [pid, Math.max(0, cpu - (first.get(pid) ?? cpu)), comm.get(pid) ?? '?'] as const,
    )
    .filter(([, secs]) => secs > 0)
    .sort((a, b) => b[1] - a[1])
  parentPort!.postMessage(spent)
})

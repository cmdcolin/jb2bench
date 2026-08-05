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
import fs from 'fs'

/** 1-minute load average */
export const loadavg = () =>
  Number.parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]!)

export interface LoadWindow {
  before: number
  after: number
}

/** the load figure to judge a cell by: the worse of its two endpoints */
export const peak = (l: LoadWindow) => Math.max(l.before, l.after)

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

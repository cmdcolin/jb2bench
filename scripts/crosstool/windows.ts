// The window axis for the cross-tool benchmarks.
//
// Every cross-tool number before 2026-08-28 was measured at one window, a 19 kb
// slice named in each runner as a bare constant. One window cannot say which
// tool scales with the amount of data on screen, and it is the axis on which
// tools differ most sharply: at 100 kb, Gosling's BAM track declines to draw at
// all (see crosstool/gosling.html), GenomeSpy needs its lazy `windowSize`
// raised, igv.js keeps drawing, and JBrowse's byte gate gets a say.
//
// Windows live here rather than in scripts/render/cases.ts because that file's
// enumeration is shared with the JBrowse-only render and interaction matrices,
// and multiplying their twelve cases by a window axis nobody asked them for
// would double two already long runs.
import { migrateCaseKey } from '../render/cases.ts'

export interface Window {
  id: string
  loc: string
}

/**
 * `19kb` is the window every recorded cross-tool row was measured at, so it
 * stays first and keeps its name in the row keys after migration.
 *
 * `100kb` contains it — same reads, more of them — so the two rows differ in
 * how much is on screen and in nothing else.
 */
export const WINDOWS: readonly Window[] = [
  { id: '19kb', loc: 'chr22_mask:124000-143000' },
  { id: '100kb', loc: 'chr22_mask:75000-175000' },
]

export const DEFAULT_WINDOW = WINDOWS[0]!

export const span = (w: Window) => {
  const [start, end] = w.loc.split(':')[1]!.split('-').map(Number)
  return end! - start!
}

/** `WINDOWS=19kb` narrows to a subset, the way `CASES=` narrows the case axis. */
export function selectWindows(env = process.env): Window[] {
  const selected = env.WINDOWS?.split(',')
  const windows = selected ? WINDOWS.filter(w => selected.includes(w.id)) : [...WINDOWS]
  if (!windows.length) {
    throw new Error(`WINDOWS matched nothing; known: ${WINDOWS.map(w => w.id).join(',')}`)
  }
  return windows
}

/** How a measured cell is keyed in the recorded JSON: `20x-shortread-bam@19kb`. */
export const rowKey = (caseId: string, windowId: string) => `${caseId}@${windowId}`

/**
 * Bring recorded row keys up to `<case>@<window>`, whatever they were.
 *
 * Two relabels in one pass, and one function rather than two composed, because
 * composing them is not idempotent: `migrateCaseKeys` tests the *end* of the
 * key for a format suffix, so run over an already-windowed
 * `20x-shortread-bam@19kb` it appends another and yields
 * `20x-shortread-bam@19kb-bam`. Splitting the key first and migrating only the
 * case part is correct however many times it runs — which matters, because the
 * runner rewrites the file on every invocation including report-only ones.
 *
 * Rows with no window suffix were measured at the default window, since it was
 * the only one any runner served. Same contract as `migrateCaseKey`: it
 * relabels, never re-values.
 */
export function migrateRowKeys<T>(
  byKey: Record<string, T> | undefined,
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(byKey ?? {})) {
    const at = k.lastIndexOf('@')
    const caseId = at < 0 ? k : k.slice(0, at)
    const windowId = at < 0 ? DEFAULT_WINDOW.id : k.slice(at + 1)
    out[rowKey(migrateCaseKey(caseId), windowId)] = v
  }
  return out
}

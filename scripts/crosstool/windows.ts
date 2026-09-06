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
import fs from 'fs'
import { migrateCaseKey, SCALES, type Scale } from '../render/cases.ts'

export interface Window {
  id: string
  loc: string
  /**
   * The corpus this window is a window ON. 19 kb and 100 kb are two views of
   * the same 250 kb contig; 1 Mb cannot be, because that contig is 250 kb —
   * it brings its own assembly, its own tracks and its own coverage ladder.
   * See scripts/render/cases.ts.
   */
  scale: Scale
}

const byId = Object.fromEntries(SCALES.map(s => [s.id, s]))
const scale = (id: string) => {
  const s = byId[id]
  if (!s) {
    throw new Error(`no scale "${id}" in cases.ts`)
  }
  return s
}

/**
 * `19kb` is the window every recorded cross-tool row was measured at, so it
 * stays first and keeps its name in the row keys after migration.
 *
 * `100kb` contains it — same reads, more of them — so the two rows differ in
 * how much is on screen and in nothing else.
 */
export const WINDOWS: readonly Window[] = [
  { id: '19kb', loc: 'chr22_mask:124000-143000', scale: scale('19kb') },
  { id: '100kb', loc: 'chr22_mask:75000-175000', scale: scale('19kb') },
  { id: '1mb', loc: scale('1mb').loc, scale: scale('1mb') },
]

export const DEFAULT_WINDOW = WINDOWS[0]!

/**
 * What a run measures when `WINDOWS=` says nothing: the two that share a contig.
 *
 * 1 Mb is opt-in because it is a different corpus rather than a wider view of
 * this one — different assembly, different files, 20x and 100x where the others
 * sweep 20x to 1000x. Folding it into the default would silently change what a
 * bare `make crosstool` measures and half again what it costs.
 */
export const DEFAULT_WINDOWS = WINDOWS.filter(w => w.id !== '1mb')

/**
 * The size of the contig a window sits on, from the assembly's own `.fai`.
 *
 * The GenomeSpy harness needs it: a configured genome declares its contigs, and
 * a wrong size there is silent — the axis is drawn to the declared length and
 * the pileup lands wherever that puts it. Read rather than written down, so it
 * cannot drift from the FASTA the other arms are pointed at.
 */
export function contigSize(w: Window): number {
  const contig = w.loc.split(':')[0]!
  const path = `data/${w.scale.assembly}.fa.fai`
  const line = fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .find(l => l.split('\t')[0] === contig)
  if (!line) {
    throw new Error(`${path} has no contig ${contig}`)
  }
  return Number(line.split('\t')[1])
}

export const span = (w: Window) => {
  const [start, end] = w.loc.split(':')[1]!.split('-').map(Number)
  return end! - start!
}

/** `WINDOWS=19kb` narrows to a subset, the way `CASES=` narrows the case axis. */
export function selectWindows(env = process.env): Window[] {
  const selected = env.WINDOWS?.split(',')
  const windows = selected
    ? WINDOWS.filter(w => selected.includes(w.id))
    : [...DEFAULT_WINDOWS]
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

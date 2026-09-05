// The case axis, shared by the render matrix and the interaction matrix.
//
// Both enumerate the same corpus and both key their recorded JSON by case id, so
// the enumeration and the key migration live here rather than once per runner.
// They drifted before this file existed: `runner.ts` gained CRAM on 2026-08-16
// and `runner-interaction.ts` did not, so the format axis the 2023 paper's Fig 8
// is built on existed for cold load and not for zoom or pan.
export interface Case {
  id: string
  track: string
  /** the assembly the track is loaded under, since a scale brings its own */
  assembly: string
  /** the window this case is measured at */
  loc: string
}

export const READS = ['shortread', 'longread'] as const
export const FORMATS = ['bam', 'cram'] as const

/**
 * A scale is a reference, a window on it, and the coverages simulated over it.
 *
 * `19kb` is the corpus everything here was measured on until 2026-09-05: a
 * 250 kb contig, deep (20x/200x/1000x), viewed 19 kb at a time. It answers what
 * DEPTH costs. It cannot answer what WIDTH costs, because 250 kb is the widest
 * window it holds.
 *
 * `1mb` is the other axis: ordinary depth over a 2 Mb contig, viewed 1 Mb at a
 * time. 100x over 2 Mb is 200 Mb of aligned bases against the deep arm's 250 Mb
 * over 250 kb — about the same bytes, spread over 50x the screen. What differs
 * between the two arms is how much of the work is per-feature layout and paint
 * rather than fetch and decode.
 *
 * The contig is 2 Mb and the window 1 Mb because JBrowse clamps bpPerPx at the
 * contig width: a window that IS the assembly measures a view that cannot be
 * zoomed out of or panned, which is a different thing from a 1 Mb view of a
 * chromosome.
 */
export interface Scale {
  id: string
  label: string
  assembly: string
  loc: string
  coverages: readonly string[]
  /** filename prefix of this scale's tracks, so both arms can share a data dir */
  prefix: string
}

export const SCALES: readonly Scale[] = [
  {
    id: '19kb',
    label: '19 kb',
    assembly: 'hg19mod',
    loc: 'chr22_mask:124000-143000',
    coverages: ['20x', '200x', '1000x'],
    prefix: '',
  },
  {
    id: '1mb',
    label: '1 Mb',
    assembly: 'chr22_2mb',
    loc: 'chr22_2mb:500001-1500000',
    coverages: ['20x', '100x'],
    prefix: '2mb.',
  },
]

export const DEFAULT_SCALE = SCALES[0]!

/** `SCALE=1mb` picks the wide arm; the default is the deep one. */
export function selectScale(env = process.env): Scale {
  const id = env.SCALE ?? DEFAULT_SCALE.id
  const scale = SCALES.find(s => s.id === id)
  if (!scale) {
    throw new Error(`SCALE "${id}" is not one of ${SCALES.map(s => s.id).join('|')}`)
  }
  return scale
}

/**
 * A scale's results are its own files — `results/alignments-1mb.md` beside
 * `results/alignments.md` — rather than more rows in one table. The two arms
 * share no assembly, no window and no coverage ladder, so a single table would
 * have a column for every axis and a value for none of them. The deep arm keeps
 * the unsuffixed name it has always had.
 */
export const resultSuffix = (scale: Scale) =>
  scale.id === DEFAULT_SCALE.id ? '' : `-${scale.id}`

/**
 * Every (coverage x readtype x format) case of one scale, in the order the
 * reports print.
 *
 * `FORMATS=bam` in the environment restores the six-case BAM-only run, for when
 * the full twelve are unaffordable. It is read here rather than in each runner
 * so the two cannot disagree about what the variable means.
 */
export function enumerateCases(env = process.env): Case[] {
  const scale = selectScale(env)
  const formats = env.FORMATS?.split(',') ?? [...FORMATS]
  for (const f of formats) {
    if (!(FORMATS as readonly string[]).includes(f)) {
      throw new Error(`FORMATS entry "${f}" is not one of ${FORMATS.join('|')}`)
    }
  }
  const prefix = scale.id === DEFAULT_SCALE.id ? '' : `${scale.id}-`
  const cases: Case[] = []
  for (const read of READS) {
    for (const cov of scale.coverages) {
      for (const fmt of formats) {
        cases.push({
          id: `${prefix}${cov}-${read}-${fmt}`,
          track: `${scale.prefix}${cov}.${read}.${fmt}`,
          assembly: scale.assembly,
          loc: scale.loc,
        })
      }
    }
  }
  return cases
}

/**
 * Relabel one case id keyed `<cov>-<read>` as `<cov>-<read>-bam`.
 *
 * Every row recorded before a runner learned about formats was BAM, since BAM
 * was all it enumerated. Renaming keeps those measurements on the same axis as
 * the CRAM rows rather than stranding them under names nothing reads. It
 * relabels, never re-values.
 *
 * **It takes a case id and not a row key**, because a row key can carry more
 * than the case: the cross-tool matrix keys its rows `<case>@<window>`, and
 * appending `-bam` to one of those produces `20x-shortread-bam@19kb-bam` on the
 * second pass. Anything holding composite keys migrates the case part with this
 * — see `migrateRowKeys` in scripts/crosstool/windows.ts.
 */
export const migrateCaseKey = (id: string) =>
  /-(bam|cram)$/.test(id) ? id : `${id}-bam`

/** `migrateCaseKey` over a record keyed by bare case id. */
export function migrateCaseKeys<T>(
  byCase: Record<string, T> | undefined,
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(byCase ?? {})) {
    out[migrateCaseKey(k)] = v
  }
  return out
}

/** `CASES=` narrows to a subset; `CASES=none` measures nothing. */
export function selectCases(all: Case[], env = process.env): Case[] {
  if (env.CASES === 'none') {
    return []
  }
  const selected = env.CASES?.split(',')
  const cases = selected ? all.filter(c => selected.includes(c.id)) : all
  if (!cases.length) {
    throw new Error(`CASES matched nothing; known: ${all.map(c => c.id).join(',')}`)
  }
  return cases
}

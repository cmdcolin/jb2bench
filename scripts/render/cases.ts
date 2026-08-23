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
}

export const READS = ['shortread', 'longread'] as const
export const COVERAGES = ['20x', '200x', '1000x'] as const
export const FORMATS = ['bam', 'cram'] as const

/**
 * Every (coverage x readtype x format) case, in the order the reports print.
 *
 * `FORMATS=bam` in the environment restores the six-case BAM-only run, for when
 * the full twelve are unaffordable. It is read here rather than in each runner
 * so the two cannot disagree about what the variable means.
 */
export function enumerateCases(env = process.env): Case[] {
  const formats = env.FORMATS?.split(',') ?? [...FORMATS]
  for (const f of formats) {
    if (!(FORMATS as readonly string[]).includes(f)) {
      throw new Error(`FORMATS entry "${f}" is not one of ${FORMATS.join('|')}`)
    }
  }
  const cases: Case[] = []
  for (const read of READS) {
    for (const cov of COVERAGES) {
      for (const fmt of formats) {
        cases.push({ id: `${cov}-${read}-${fmt}`, track: `${cov}.${read}.${fmt}` })
      }
    }
  }
  return cases
}

/**
 * Relabel recorded rows keyed `<cov>-<read>` as `<cov>-<read>-bam`.
 *
 * Every row recorded before a runner learned about formats was BAM, since BAM
 * was all it enumerated. Renaming keeps those measurements on the same axis as
 * the CRAM rows rather than stranding them under names nothing reads. It
 * relabels, never re-values.
 */
export function migrateCaseKeys<T>(
  byCase: Record<string, T> | undefined,
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(byCase ?? {})) {
    out[/-(bam|cram)$/.test(k) ? k : `${k}-bam`] = v
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

import { writeFileSync } from 'node:fs'

import { firstValueFrom } from 'rxjs'
import { toArray } from 'rxjs/operators'

import Walk from './WalkTabixSyntenyAdapter.ts'
import walkSchema from './configSchema.ts'

import type { Feature } from '@jbrowse/core/util'
import type { SyntenyMate } from '@jbrowse/synteny-core'

const out = process.env.WALK_PAF_OUT ?? '/tmp/walk-cfhr.paf'
const haplotypes = [
  'HG00097#1',
  'HG00099#1',
  'HG00128#1',
  'HG00133#1',
  'HG01109#1',
  'HG01123#1',
  'HG01960#1',
  'HG02055#1',
]

test('export walk-file rows at the Figure 5 window as PAF', async () => {
  const walk = new Walk(
    walkSchema.create({
      walksUri: 'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38-f8.GRCh38',
      assemblyNames: ['hg38'],
      assemblyNameToPanSN: {
        hg38: 'GRCh38#0',
        ...Object.fromEntries(
          haplotypes.map(h => [h.replace('#', '.'), h]),
        ),
      },
    }),
  )
  const features: Feature[] = await firstValueFrom(
    walk
      .getFeatures(
        {
          refName: 'chr1',
          assemblyName: 'hg38',
          start: 196_640_000,
          end: 196_900_000,
        },
        { haplotypes } as never,
      )
      .pipe(toArray()),
  )
  const lines = features.map(f => {
    const mate = f.get('mate') as SyntenyMate & { name?: string }
    const cigar = (f.get('CIGAR') as string | undefined) ?? ''
    const columns = [...cigar.matchAll(/(\d+)([=XIDM])/g)].reduce(
      (s, [, n]) => s + +n!,
      0,
    )
    const matches = [...cigar.matchAll(/(\d+)=/g)].reduce(
      (s, [, n]) => s + +n!,
      0,
    )
    return [
      `${String(mate.assemblyName).replace('.', '#')}#${mate.refName}`,
      0,
      mate.start,
      mate.end,
      f.get('strand') === -1 ? '-' : '+',
      'GRCh38#0#chr1',
      248_956_422,
      f.get('start'),
      f.get('end'),
      matches,
      columns,
      60,
      `cg:Z:${cigar}`,
      `ty:Z:${String(f.get('type') ?? '')}`,
    ].join('\t')
  })
  writeFileSync(out, `${lines.join('\n')}\n`)
  expect(lines.length).toBeGreaterThan(0)
}, 120_000)

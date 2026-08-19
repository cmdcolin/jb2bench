import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

// v1.4.5 shipped two decompressors and picked between them at import time: in
// Node its `unzip` is a thin wrapper over zlib.gunzip (C++), while browsers got
// `pakoUnzip` (pure JS). v6.6.0 has one implementation, pako-esm2, everywhere.
//
// So comparing the two `unzip` exports in Node compares C++ against JS and says
// nothing about the library. Both paths are measured below and reported apart:
// the browser path is the one a genome browser actually runs, and the Node path
// is here so the regression is on the record rather than hidden.
import {
  pakoUnzip as oldBrowserUnzip,
  unzip as oldNodeUnzip,
} from './.libs/bgzf-filehandle/old/esm/unzip.js'
import { unzip as newUnzip } from './.libs/bgzf-filehandle/new/esm/unzip.js'
import { newArm, oldArm } from './lib/arms.ts'
import { DATA } from './lib/corpus.ts'

// 1000x is left out: BAM is BGZF end to end, so unzipping 1000x.longread.bam
// would materialize gigabytes per iteration and turn this into a GC benchmark.
const CASES = [
  { label: '20x shortread', file: `${DATA}20x.shortread.bam` },
  { label: '20x longread', file: `${DATA}20x.longread.bam` },
  { label: '200x shortread', file: `${DATA}200x.shortread.bam` },
  { label: '200x longread', file: `${DATA}200x.longread.bam` },
]

for (const { label, file } of CASES) {
  // Buffer, not a Uint8Array wrapper: 1.4.3 declares `unzip(input: Buffer)`
  // while 6.3.2 takes a Uint8Array, and Buffer satisfies both. Read once here,
  // outside the timed callbacks, so this is setup and not part of any result.
  const data = readFileSync(file)
  const opts = { iterations: 10, warmupIterations: 3 }

  describe(`bgzf browser path ${label}`, () => {
    bench(oldArm('bgzf-filehandle', ' pako'), async () => {
      await oldBrowserUnzip(data)
    }, opts)
    bench(newArm('bgzf-filehandle', ' pako-esm2'), async () => {
      await newUnzip(data)
    }, opts)
  })

  describe(`bgzf node path ${label}`, () => {
    bench(oldArm('bgzf-filehandle', ' native zlib'), async () => {
      await oldNodeUnzip(data)
    }, opts)
    bench(newArm('bgzf-filehandle', ' pako-esm2'), async () => {
      await newUnzip(data)
    }, opts)
  })
}

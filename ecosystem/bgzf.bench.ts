import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

// v1.4.3 shipped two decompressors and picked between them at import time: in
// Node its `unzip` is a thin wrapper over zlib.gunzip (C++), while browsers got
// `pakoUnzip` (pure JS). v6.3.2 has one implementation, pako-esm2, everywhere.
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
import { ROOT } from './lib/corpus.ts'

// 1000x is left out: BAM is BGZF end to end, so unzipping 1000x.longread.bam
// would materialize gigabytes per iteration and turn this into a GC benchmark.
const CASES = [
  { label: '20x shortread', file: `${ROOT}20x.shortread.bam` },
  { label: '20x longread', file: `${ROOT}20x.longread.bam` },
  { label: '200x shortread', file: `${ROOT}200x.shortread.bam` },
  { label: '200x longread', file: `${ROOT}200x.longread.bam` },
]

for (const { label, file } of CASES) {
  const data = new Uint8Array(readFileSync(file))
  const opts = { iterations: 10, warmupIterations: 3 }

  describe(`bgzf browser path ${label}`, () => {
    bench('v1.4.3 pako (2023)', async () => {
      await oldBrowserUnzip(data)
    }, opts)
    bench('v6.3.2 pako-esm2 (current)', async () => {
      await newUnzip(data)
    }, opts)
  })

  describe(`bgzf node path ${label}`, () => {
    bench('v1.4.3 native zlib (2023)', async () => {
      await oldNodeUnzip(data)
    }, opts)
    bench('v6.3.2 pako-esm2 (current)', async () => {
      await newUnzip(data)
    }, opts)
  })
}

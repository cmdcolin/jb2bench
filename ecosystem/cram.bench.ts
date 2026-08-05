import { bench, describe } from 'vitest'

import {
  CraiIndex as OldIndex,
  IndexedCramFile as OldFile,
} from './.libs/cram-js/old/esm/index.js'
import {
  CraiIndex as NewIndex,
  IndexedCramFile as NewFile,
} from './.libs/cram-js/new/esm/index.js'
import { CRAM_CASES, END, OLD_CRAM_OPTS, START, seqFetch } from './lib/corpus.ts'
import { iterations } from './lib/iterations.ts'

// checkSequenceMD5 is off because the simulated reference is a slice and its M5
// tags do not match the slice; leaving it on would make both sides throw rather
// than parse. seqId 0 is chr22_mask, the only contig in the corpus.
function run(File: any, Index: any, cramPath: string, extra: object = {}) {
  return async () => {
    const cram = new File({
      cramPath,
      index: new Index({ path: `${cramPath}.crai` }),
      seqFetch,
      checkSequenceMD5: false,
      ...extra,
    })
    await cram.getRecordsForRange(0, START, END)
  }
}

for (const { label, file } of CRAM_CASES) {
  describe(`cram ${label}`, () => {
    const opts = iterations(label)
    bench('v1.7.1 (2023)', run(OldFile, OldIndex, file, OLD_CRAM_OPTS), opts)
    bench('v10.4.0 (current)', run(NewFile, NewIndex, file), opts)
  })
}

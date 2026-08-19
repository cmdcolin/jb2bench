import { bench, describe } from 'vitest'

import { BamFile as Old } from './.libs/bam-js/old/esm/index.js'
import { BamFile as New } from './.libs/bam-js/new/esm/index.js'
import { newArm, oldArm } from './lib/arms.ts'
import { BAM_CASES, END, REF, START } from './lib/corpus.ts'
import { iterations } from './lib/iterations.ts'

// A fresh BamFile per iteration: the current release caches parsed chunks on the
// instance, so reusing one would measure the cache, not the parse. Both sides
// pay the same header read.
function run(Ctor: any, bamPath: string) {
  return async () => {
    const bam = new Ctor({ bamPath })
    await bam.getHeader()
    await bam.getRecordsForRange(REF, START, END)
  }
}

for (const { label, file } of BAM_CASES) {
  describe(`bam ${label}`, () => {
    const opts = iterations(label)
    bench(oldArm('bam-js'), run(Old, file), opts)
    bench(newArm('bam-js'), run(New, file), opts)
  })
}

import { bench, describe } from 'vitest'

import { BigWig as Old } from './.libs/bbi-js/old/esm/index.js'
import { BigWig as New } from './.libs/bbi-js/new/esm/index.js'
import { newArm, oldArm } from './lib/arms.ts'
import { BW_CASES, END, REF, START } from './lib/corpus.ts'
import { iterations } from './lib/iterations.ts'

// Base-resolution read of the same window the render benchmarks draw. getFeatures
// re-reads the header each time because the instance is new, which is what a
// freshly opened track does.
function run(Ctor: any, path: string) {
  return async () => {
    const bw = new Ctor({ path })
    await bw.getFeatures(REF, START, END)
  }
}

for (const { label, file } of BW_CASES) {
  describe(`bigwig ${label}`, () => {
    const opts = iterations(label)
    bench(oldArm('bbi-js'), run(Old, file), opts)
    bench(newArm('bbi-js'), run(New, file), opts)
  })
}

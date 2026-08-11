import { bench, describe } from 'vitest'

// The 2023-vs-current axis every other library here uses: v5.0.9, the version
// JBrowse 2 pinned at the paper, against v7.2.0.
//
// The single-release before/after that isolates the 7.2.0 genotype-scan rewrite
// (v7.1.1 against v7.2.0) lives in scan.ts, for the reason spelled out at the
// bottom of this file.
import OldVcf from './.libs/vcf-js/old/esm/index.js'
import NewVcf from './.libs/vcf-js/new/esm/index.js'
import { VCF_CASES, vcfParts } from './lib/corpus.ts'

// Fixed rather than time-budgeted, for the reason lib/iterations.ts gives: two
// runs on one machine stay comparable and a slow side cannot quietly take fewer
// samples than a fast one. Scaled by sample count, since a 3000-sample parse is
// 30x the work of a 100-sample one.
function opts(samples: number) {
  if (samples >= 3000) {
    return { iterations: 10, warmupIterations: 3 }
  }
  if (samples >= 1000) {
    return { iterations: 20, warmupIterations: 5 }
  }
  return { iterations: 40, warmupIterations: 10 }
}

// What JBrowse's variant displays actually need per record: every sample's GT,
// and nothing else. Each version is asked for it through the cheapest API that
// version offers, which is the comparison that describes what upgrading buys.
//
//   v5.0.9   `variant.SAMPLES` — a lazy property that parses EVERY FORMAT field
//            of every sample into an object of arrays. There was no way to ask
//            for GT alone.
//   v7.x     `variant.GENOTYPES()` — GT alone, as a Record.
//
// That the new call is cheaper *because the API grew* is the point rather than a
// confound, and the like-for-like SAMPLES comparison below prices the same work
// on both sides so the two readings are both on the record.
for (const { label, file, samples } of VCF_CASES) {
  const { header, lines } = vcfParts(file)
  const o = opts(samples)

  const oldParser = new (OldVcf as any)({ header })
  const newParser = new (NewVcf as any)({ header })

  describe(`vcf genotypes ${label}`, () => {
    bench(
      'v5.0.9 SAMPLES (2023)',
      () => {
        for (const line of lines) {
          const v = oldParser.parseLine(line)
          const s = v.SAMPLES
          for (const k in s) {
            s[k].GT
          }
        }
      },
      o,
    )
    bench(
      'v7.2.0 GENOTYPES (current)',
      () => {
        for (const line of lines) {
          newParser.parseLine(line).GENOTYPES()
        }
      },
      o,
    )
  })

  // Like-for-like: the same whole-record parse on both sides, so the API change
  // above is not doing the work. v5.0.9's SAMPLES is a property and v7.2.0's is
  // a method; that rename is the only difference in what is being asked for.
  describe(`vcf SAMPLES ${label}`, () => {
    bench(
      'v5.0.9 (2023)',
      () => {
        for (const line of lines) {
          oldParser.parseLine(line).SAMPLES
        }
      },
      o,
    )
    bench(
      'v7.2.0 (current)',
      () => {
        for (const line of lines) {
          newParser.parseLine(line).SAMPLES()
        }
      },
      o,
    )
  })

  // The v7.1.1-vs-v7.2.0 scan comparison is deliberately NOT here. It belongs to
  // `make scan` (scan.ts), which runs each side in its own process.
  //
  // The reason is measured, not theoretical. Every bench in this file loads both
  // library builds into one V8, so the megamorphic call sites they share are
  // slower for both than either would be alone. That is harmless at 6x-45x and
  // fatal at 1.1x: run in-process, the 3000-sample GT-only case reported the new
  // side 0.88x — a regression — while the same code, each side in its own
  // process, is 1.15x faster. Anything whose expected effect is a few percent
  // gets its own process.
}

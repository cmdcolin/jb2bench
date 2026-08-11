import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each case opens files up to 268 MB and the 1000x parses are seconds long.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One worker: two library builds racing for the same page cache and the same
    // cores would make the comparison a scheduling measurement.
    //
    // This was written as `poolOptions: { forks: { singleFork: true } }`, which
    // vitest 4 removed — it is not in the config type at all, so it was accepted
    // silently and did nothing. `fileParallelism: false` is the v4 spelling; it
    // runs one file at a time and pins maxWorkers to 1.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    benchmark: {
      // Only this directory's own benches. `.libs/` holds full clones of the
      // libraries under test, and several of them ship `*.bench.ts` of their
      // own — vcf-js has benchmark/parse.bench.ts and a
      // master-vs-current.bench.ts that imports build outputs (esm_branch1/,
      // esm_branch2/) which exist only in that repo's own two-branch workflow
      // and not in a tag clone. Collected by the default glob, those add 60+
      // groups of someone else's benchmark to results/bench.json and fail the
      // run outright. The default exclude covers node_modules and dist, neither
      // of which `.libs/` is.
      include: ['*.bench.ts'],
      outputJson: 'results/bench.json',
      reporters: ['default'],
    },
  },
})

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
      outputJson: 'results/bench.json',
      reporters: ['default'],
    },
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each case opens files up to 268 MB and the 1000x parses are seconds long.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One worker: two library builds racing for the same page cache and the same
    // cores would make the comparison a scheduling measurement.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    benchmark: {
      outputJson: 'results/bench.json',
      reporters: ['default'],
    },
  },
})

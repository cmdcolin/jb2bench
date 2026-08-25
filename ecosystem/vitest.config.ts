import { defineConfig } from 'vitest/config'

export default defineConfig({
  // NO BROWSER=1 RESOLUTION HERE, DELIBERATELY.
  //
  // A `resolve.conditions: ['browser']` block sat here on 2026-08-24 and did
  // nothing. Vite's conditions apply to package `exports` conditions; what these
  // 2023 tags carry is the legacy `browser` FIELD, an object map from
  // ./esm/unzip.js to ./esm/unzip-pako.js, and vitest resolves these benches
  // through its SSR pipeline besides. The run it produced was the node run under
  // a filename claiming otherwise -- a dead mechanism that looks like a live one,
  // which is the failure this directory exists to avoid.
  //
  // The redirect DOES work on the sweep path, where lib/legacy-resolve.mjs is
  // registered as a real loader hook: under BROWSER=1 it traces
  // `./esm/unzip.js -> ./esm/unzip-pako.js`, and the imported function changes
  // from zlibBufferSync (native C) to pako's inflateRaw. Verified 2026-08-25.
  //
  // For a bench, the technique that works is the one bgzf.bench.ts already uses:
  // import both decompressors explicitly by path and measure them as two arms,
  // rather than asking a resolver to substitute one behind your back.
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
      // A BROWSER=1 run is a different measurement, not a better version of the
      // same one: the 2023 arms inflate with pako there and with native zlib
      // here. Writing both to one path would mean whichever ran last silently
      // became "the" parser result, and the figures could not say which
      // resolution produced them.
      outputJson: 'results/bench.json',
      reporters: ['default'],
    },
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // BROWSER=1 makes vite resolve each package's `browser` field, which is the
  // difference between measuring these libraries as JBrowse runs them and
  // measuring them in the one runtime where the old arm gets a decompressor it
  // would never have.
  //
  // @gmod/bbi 3.0.0, @gmod/bgzf-filehandle 1.4.5 and @gmod/cram 1.7.3 all map
  // `./esm/unzip.js` to `./esm/unzip-pako.js` for browsers. Under plain node they
  // inflate with native zlib instead; their current versions inflate with wasm
  // unconditionally. So the default run pits native C against wasm -- which is
  // why the single-file BigWig comparison is a wash, and slightly negative -- and
  // a browser would pit pako against wasm, which is what the wasm was written
  // for. `scripts/render/charts.R` and ecosystem/README.md both have to say which
  // resolution produced a number, because the two answer different questions.
  resolve:
    process.env.BROWSER === '1'
      ? { conditions: ['browser'], mainFields: ['browser', 'module', 'main'] }
      : undefined,
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
      outputJson:
        process.env.BROWSER === '1'
          ? 'results/bench-browser.json'
          : 'results/bench.json',
      reporters: ['default'],
    },
  },
})

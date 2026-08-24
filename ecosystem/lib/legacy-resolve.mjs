// The two module-resolution hooks that let plain node import the older library
// builds. Both are fallbacks for things node's ESM implementation deliberately
// does not do and vitest's resolver quietly does, which is why bam.bench.ts
// never hit either of them and sweep.ts hits both immediately: sweep.ts runs one
// plain node process per version on purpose, so it cannot borrow vitest's
// resolver the way every other benchmark here does.
//
// Neither hook changes how a current build loads. The first runs only after the
// real resolver has already failed; the second produces a superset of the named
// exports node would have found by itself.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ---------------------------------------------------------------- browser ---
//
// BROWSER=1 resolves each package's `browser` field, and without it the BigWig
// comparison measures the opposite of what it claims to.
//
// @gmod/bbi 3.0.0 ships `"browser": {"./esm/unzip.js": "./esm/unzip-pako.js"}`.
// So the 2023 arm inflates with **node's native zlib** under plain node and with
// **pako, pure JavaScript,** in a browser. @gmod/bbi 11.2.2 has no browser field:
// it inflates through wasm everywhere, and the wasm call fuses decompression with
// parsing.
//
// Under node, then, the comparison is native C against wasm, which is the one
// matchup the wasm cannot win -- and JBrowse never runs there. In a browser it is
// pako against wasm, which is the matchup the wasm was written for. The recorded
// single-file BigWig numbers are a wash for exactly this reason: 0.93 ms against
// 0.96 ms at 20x short read, the current arm slightly SLOWER on five of six cases.
// That is not the library failing to improve, it is the harness handing the old
// arm a decompressor it would never have in production.
//
// @gmod/bgzf-filehandle 1.4.5 and @gmod/cram 1.7.3 carry the same swap, so BAM and
// CRAM are affected too -- their speedups are understated rather than erased,
// since 4x to 12x survives the handicap.
//
// Only string redirects are applied. cram-js 1.7.3 also maps
// `"./esm/io/localFile.js": false`, which a bundler turns into an empty module;
// stubbing a filesystem reader in a benchmark that reads files from disk would
// measure nothing, so those entries are skipped and traced.
const browserMapCache = new Map()

function browserMapFor(dir) {
  if (browserMapCache.has(dir)) {
    return browserMapCache.get(dir)
  }
  let found
  for (let d = dir; ; d = path.dirname(d)) {
    const pkg = path.join(d, 'package.json')
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'))
        const map = parsed.browser
        found = map && typeof map === 'object' ? { root: d, map } : undefined
      } catch {
        found = undefined
      }
      break
    }
    const up = path.dirname(d)
    if (up === d) {
      break
    }
  }
  browserMapCache.set(dir, found)
  return found
}

function browserRedirect(url) {
  if (!url.startsWith('file:')) {
    return undefined
  }
  const file = fileURLToPath(url)
  const entry = browserMapFor(path.dirname(file))
  if (!entry) {
    return undefined
  }
  const rel = `./${path.relative(entry.root, file).split(path.sep).join('/')}`
  const target = entry.map[rel]
  if (typeof target !== 'string') {
    if (target === false && process.env.SWEEP_TRACE_BROWSER) {
      process.stderr.write(`BROWSER skip (false) ${rel}\n`)
    }
    return undefined
  }
  const redirected = pathToFileURL(path.resolve(entry.root, target)).href
  if (process.env.SWEEP_TRACE_BROWSER) {
    process.stderr.write(`BROWSER ${rel} -> ${target}\n`)
  }
  return redirected
}

// ------------------------------------------------------------- specifier ---
//
// Tags from before roughly 2024 were emitted for bundlers and for TypeScript's
// `node` module resolution, so their ESM says `import './bai'` (extensionless),
// `import './cramFile'` (a directory with an index) and
// `import 'cross-fetch/polyfill'` (a subpath directory whose package.json main
// points elsewhere). Node's ESM resolver requires a full specifier and rejects
// all three; it used to offer `--experimental-specifier-resolution=node` for
// exactly this, and removed it.
//
// Rather than guess candidate shapes, hand the specifier to node's own CommonJS
// resolver, which IS the algorithm these builds were written against — so it
// gets the directory-main case right instead of only the two easy ones, and it
// cannot drift from what a 2023 bundler did.
export async function resolve(specifier, context, next) {
  try {
    const resolved = await next(specifier, context)
    if (process.env.BROWSER === '1') {
      const redirected = browserRedirect(resolved.url)
      if (redirected) {
        return { ...resolved, url: redirected }
      }
    }
    return resolved
  } catch (err) {
    const parent = context.parentURL
    if (!parent?.startsWith('file:')) {
      throw err
    }
    try {
      const resolved = createRequire(parent).resolve(specifier)
      return await next(pathToFileURL(resolved).href, context)
    } catch {
      throw err
    }
  }
}

// ---------------------------------------------------------------- format ---
//
// The 2023 dependencies are CommonJS — `generic-filehandle` 3.x, `pako` 2.x —
// and node discovers a CJS module's named exports by lexing its source. That
// lexer is a static approximation and misses exports assigned through the
// helpers TypeScript and Babel emit, so `import { LocalFile } from
// 'generic-filehandle'` fails to instantiate with "does not provide an export
// named 'LocalFile'" even though the property is plainly there at runtime.
//
// The fix is to stop guessing: require the module and read its keys. The hook
// then hands node an ESM facade re-exporting exactly those names. Requiring it
// here costs a second evaluation in the loader thread — the facade's own
// require runs in the main thread and is the instance the benchmark actually
// uses — which is acceptable for parser libraries with no install-time side
// effects, and is why this is scoped to node_modules rather than applied to
// everything.
const IDENT = /^[A-Za-z_$][\w$]*$/

export async function load(url, context, next) {
  const result = await next(url, context)
  if (
    result.format !== 'commonjs' ||
    !url.startsWith('file:') ||
    !url.includes('/node_modules/')
  ) {
    return result
  }

  const path = fileURLToPath(url)
  let mod
  try {
    mod = createRequire(url)(path)
  } catch {
    return result
  }
  if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) {
    return result
  }

  if (process.env.SWEEP_TRACE_FACADE) {
    process.stderr.write(`FACADE ${url}\n`)
  }
  const names = Object.keys(mod).filter(k => IDENT.test(k) && k !== 'default')

  // `__esModule` interop, and a deliberate divergence from node. Node's native
  // CJS-to-ESM interop always binds `default` to the whole `module.exports`.
  // Babel and TypeScript instead emit `{ __esModule: true, default: X }` and
  // expect a consumer to unwrap it, and the bundlers these libraries were built
  // for do unwrap it — so `abortable-promise-cache`, which every pre-2024
  // @gmod/bam and @gmod/cram constructs, arrives under node as the wrapper
  // object and fails with "AbortablePromiseCache is not a constructor".
  //
  // Unwrapping is therefore not a liberty taken with the measurement: it is what
  // the toolchain that produced these builds did, and it is what vitest does for
  // the two-point benchmarks in this directory. Guarded on the flag, so a module
  // that does not set it keeps node's binding.
  const defaultExpr = mod.__esModule === true ? 'mod.default' : 'mod'
  const literal = JSON.stringify(path)
  return {
    format: 'module',
    shortCircuit: true,
    source: [
      "import { createRequire } from 'node:module'",
      `const mod = createRequire(${JSON.stringify(url)})(${literal})`,
      `export default ${defaultExpr}`,
      ...names.map(n => `export const ${n} = mod[${JSON.stringify(n)}]`),
    ].join('\n'),
  }
}

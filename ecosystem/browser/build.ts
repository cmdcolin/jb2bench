// Bundle each library arm for a browser, one file per arm.
//
// Two reasons this exists rather than importing the arms directly.
//
// The arms cannot be loaded by a browser as they are. The 2023 builds import
// CommonJS dependencies -- `abortable-promise-cache`, `quick-lru`,
// `binary-parser`, `pako` -- with extensionless specifiers, which is why
// `lib/legacy-resolve.mjs` exists for the node side. A browser has neither a
// CommonJS loader nor a resolver hook.
//
// And `--platform=browser` resolves each package's `browser` field, which is the
// whole point. @gmod/bbi 3.0.0 maps `./esm/unzip.js` to `./esm/unzip-pako.js`
// there, so this bundle inflates with pako -- the pure-JavaScript decompressor a
// browser actually gets -- where a plain node import gets native zlib. @gmod/bbi
// 11.2.2 has no browser field and inflates through wasm either way. Measuring
// under node compares native C against wasm, a matchup that exists nowhere; this
// compares pako against wasm, which is the one JBrowse ships.
//
// Usage: node --experimental-strip-types ecosystem/browser/build.ts [lib ...]
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIBS = path.join(ROOT, '.libs')
const OUT = path.join(ROOT, 'browser/bundles')

const only = process.argv.slice(2)
if (!fs.existsSync(LIBS)) {
  throw new Error(
    `${LIBS} does not exist. Run ecosystem/setup.sh first -- it clones and builds each pinned tag.`,
  )
}
const libs = fs
  .readdirSync(LIBS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .filter(n => !only.length || only.includes(n))

if (!libs.length) {
  throw new Error(`no arms under ${LIBS} matching ${only.join(',') || '*'}`)
}

fs.mkdirSync(OUT, { recursive: true })
const built: string[] = []

for (const lib of libs) {
  for (const side of ['old', 'new']) {
    const entry = path.join(LIBS, lib, side, 'esm/index.js')
    if (!fs.existsSync(entry)) {
      console.log(`skip ${lib}/${side}: no ${entry}`)
      continue
    }
    const out = path.join(OUT, `${lib}-${side}.js`)
    // `--format=esm` so the harness can `import()` it and read named exports.
    // Wasm inlined as base64 rather than emitted as a separate asset: @gmod/bbi
    // 11.2.2 already ships `inflate-wasm-inlined.js`, but a bundler that decided
    // to split it out would add a network round trip to the very measurement
    // this is for, and at a 100 ms RTT that round trip is the whole result.
    execFileSync(
      'npx',
      [
        '--yes',
        'esbuild',
        entry,
        '--bundle',
        '--format=esm',
        '--platform=browser',
        '--target=es2022',
        '--loader:.wasm=base64',
        `--outfile=${out}`,
        '--log-level=warning',
      ],
      { stdio: 'inherit', cwd: ROOT },
    )
    console.log(
      `${lib}/${side} -> ${path.relative(ROOT, out)} ` +
        `(${(fs.statSync(out).size / 1024).toFixed(0)} KB)`,
    )
    built.push(`${lib}-${side}`)
  }
}

fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ arms: built }, null, 2),
)
console.log(`\n${built.length} bundles`)

// Build the two Gosling harness bundles: stock, and with its tile-width cap
// raised.
//
// gosling.js ships ESM with bare specifiers (`react`, `pixi.js`, `higlass`), so
// unlike igv.js and GenomeSpy — both of which ship a self-contained bundle
// `crosstool/` symlinks into place — a browser cannot load it out of
// node_modules. Both bundles come from the same tracked entry point,
// `crosstool/gosling-entry.js`.
//
// ## Why there are two, and why they are built the same way
//
// Stock Gosling draws BAM reads only while the visible tile is at most 20 kb
// wide, so it cannot reach the 100 kb window at all: `MAX_TILE_WIDTH = 2e4` on
// its `BamDataFetcher`, compared against every visible tile by
// `gosling-track.ts:calculateVisibleTiles`, which returns before fetching. The
// stock arm therefore has no 100 kb cell, and the runner records `n/a`.
//
// The patched bundle raises that cap, and the matching one in the BAM worker,
// so the same code renders the wider window. It is a **separate arm** and never
// a substitute for the stock column: a patched library is not the library
// anyone installs, and the point of the stock `n/a` is that a reader learns
// where Gosling stops.
//
// Both bundles are built bundle-then-minify in two passes, even though the
// stock one could be done in one: the patch has to be applied to readable
// output, and two bundles minified by different pipelines are not comparable
// cold-load arms. Parse time is part of what this benchmark measures.
//
// ## The patch asserts before it replaces
//
// A text patch against someone else's build output is exactly the thing that
// rots silently on a version bump — and a silent no-op here would hand the
// runner a "patched" bundle that is stock, at the one window where stock draws
// nothing, under the instrument that reports an empty page as fast. So each
// replacement asserts it matched exactly once and the build fails otherwise.
//
// Usage: node --experimental-strip-types scripts/crosstool/goslingbundle.ts
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const ENTRY = 'crosstool/gosling-entry.js'
const STOCK = 'crosstool/gosling.bundle.js'
const PATCHED = 'crosstool/gosling-patched.bundle.js'

/**
 * Every tile-width cap between Gosling and a wide window, and what to raise it
 * to.
 *
 * Two of them, in two places, and both matter. The fetcher's 20 kb is what
 * stops the 100 kb window. The worker's 200 kb sits behind it — it lives inside
 * an inlined worker source string, which is why the text differs — and would
 * stop anything wider than that once the first is raised. 1e9 is past the size
 * of any genome, so the cap is out of the way rather than moved to a new
 * arbitrary place.
 */
const CAPS = [
  {
    what: "BamDataFetcher's own cap, read by calculateVisibleTiles",
    from: '__publicField3(this, "MAX_TILE_WIDTH", 2e4);',
    to: '__publicField3(this, "MAX_TILE_WIDTH", 1e9);',
  },
  {
    what: "the BAM worker's cap, inside its inlined source string",
    from: 'MAX_TILE_WIDTH = 2e5',
    to: 'MAX_TILE_WIDTH = 1e9',
  },
]

const esbuild = (args: string[]) =>
  execFileSync('npx', ['esbuild', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goslingbundle-'))
const readable = path.join(tmp, 'gosling.js')
const patched = path.join(tmp, 'gosling-patched.js')

esbuild([
  ENTRY,
  '--bundle',
  '--format=esm',
  '--platform=browser',
  '--define:process.env.NODE_ENV="production"',
  '--loader:.js=jsx',
  `--outfile=${readable}`,
])

const source = fs.readFileSync(readable, 'utf8')
let out = source
for (const cap of CAPS) {
  const n = out.split(cap.from).length - 1
  if (n !== 1) {
    throw new Error(
      `gosling patch: expected exactly 1 match for ${cap.what}, found ${n}.\n` +
        `  looked for: ${cap.from}\n` +
        `A gosling.js bump has moved it. Re-read ` +
        `src/data-fetchers/bam/bam-data-fetcher.ts and bam-worker.ts, fix the ` +
        `pattern, and re-verify that the patched bundle draws at the wide window ` +
        `— an unpatched "patched" bundle draws nothing there and times fast.`,
    )
  }
  out = out.replace(cap.from, cap.to)
}
fs.writeFileSync(patched, out)

esbuild([readable, '--minify', '--format=esm', `--outfile=${STOCK}`])
esbuild([patched, '--minify', '--format=esm', `--outfile=${PATCHED}`])
fs.rmSync(tmp, { recursive: true, force: true })

for (const f of [STOCK, PATCHED]) {
  console.log(`${f}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`)
}

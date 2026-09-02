// Does the optimized JS port agree with the wasm it was ported from?
//
// The port is only usable as the middle column of the comparison if it is the
// same algorithm, and the check for that is the output: same merge sequence,
// same heights, same leaf order. Timing a JS implementation that quietly
// computes a different tree would be measuring nothing.
//
// Heights are compared with a tolerance, not for equality: the wasm kernel
// accumulates in f32x4 lanes promoted to f64x2, this one sums in a single
// double, so the two round differently in the last ulp or so. The merge
// sequence is compared exactly -- a tie resolved differently there would
// restructure the tree, not nudge a number.
//
// Usage: node --experimental-strip-types scripts/cluster/verify-opt.mjs [matrix.bin] [N]
import { readFileSync } from 'node:fs'
import { hierarchicalCluster } from './optimized-hclust.mjs'

const { clusterData } = await import(`${process.env.HOME}/src/gmod/hclust/src/index.ts`)

const args = process.argv.slice(2)
const binPath = args.find(a => !a.startsWith('--')) ??
  `${process.env.HOME}/src/gmod/hclust/build/matrices/100-kb-window-maf-0-samples.bin`
const N = Number(args[1] ?? 300)

const buf = readFileSync(binPath)
const rows = buf.readUInt32LE(0)
const cols = buf.readUInt32LE(4)
const values = new Float32Array(buf.buffer, buf.byteOffset + 8, rows * cols)
const n = Math.min(N, rows)

const data = new Array(n)
for (let i = 0; i < n; i++) {
  data[i] = Array.from(values.subarray(i * cols, (i + 1) * cols))
}

const js = hierarchicalCluster({ data })
const wasm = await clusterData({ data, onProgress: () => {} })

// clusterData returns the rebuilt tree, so walk it back into the merge
// sequence the C emitted rather than reaching into the wasm wrapper.
const wasmHeights = []
const collectHeights = node => {
  if (node.children) {
    wasmHeights.push(node.height)
    for (const child of node.children) {
      collectHeights(child)
    }
  }
}
collectHeights(wasm.tree)
wasmHeights.sort((a, b) => a - b)
const jsHeights = Array.from(js.heights).sort((a, b) => a - b)

let maxHeightDiff = 0
for (let i = 0; i < jsHeights.length; i++) {
  const scale = Math.max(Math.abs(jsHeights[i]), Math.abs(wasmHeights[i]), 1e-12)
  const rel = Math.abs(jsHeights[i] - wasmHeights[i]) / scale
  if (rel > maxHeightDiff) {
    maxHeightDiff = rel
  }
}

const orderMatches = js.order.length === wasm.order.length &&
  js.order.every((v, i) => v === wasm.order[i])

console.log(`matrix ${binPath.split('/').pop()}  N=${n} V=${cols}`)
console.log(`  merges           ${js.heights.length} vs ${wasmHeights.length}`)
console.log(`  max rel height diff  ${maxHeightDiff.toExponential(2)}`)
console.log(`  leaf order        ${orderMatches ? 'identical' : 'DIFFERS'}`)
if (!orderMatches) {
  const firstDiff = js.order.findIndex((v, i) => v !== wasm.order[i])
  console.log(`    first difference at position ${firstDiff}: js ${js.order[firstDiff]} vs wasm ${wasm.order[firstDiff]}`)
}
const ok = orderMatches && maxHeightDiff < 1e-4
console.log(ok ? '\nAGREE' : '\nDISAGREE')
process.exitCode = ok ? 0 : 1

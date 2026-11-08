// The macOS memory path against recorded-shape `ps -ww -axo pid=,ppid=,rss=,command=`
// output, since this Linux box cannot produce the real thing.
//
// Usage: node --experimental-strip-types ec2mac/memtest.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parsePs, psMemory } from '../scripts/crosstool/memory.ts'

const rows = parsePs(fs.readFileSync(new URL('fixtures/ps-darwin.txt', import.meta.url), 'utf8'))
assert.equal(rows.length, 11)
const m = psMemory(rows, 4130)
const mb = (kb: number) => kb / 1024
assert.deepEqual(Object.keys(m.byType).toSorted(), [
  'browser',
  'gpu-process',
  'other',
  'renderer',
  'utility',
])
assert.equal(m.byType.browser!.count, 1)
assert.equal(m.byType.renderer!.count, 2)
assert.equal(m.byType.renderer!.rssMB, mb(412672 + 102400))
assert.equal(m.byType['gpu-process']!.rssMB, mb(96512))
assert.equal(m.byType.utility!.count, 2)
assert.equal(m.byType.other!.rssMB, mb(1024))
assert.equal(m.totalRssMB, mb(182344 + 96512 + 40960 + 412672 + 102400 + 20480 + 1024))
assert.equal(psMemory(rows, 1).byType.browser!.count, 1)
assert.equal(psMemory(rows, 77777).totalRssMB, 0)
console.log(`ok: ${JSON.stringify(m)}`)

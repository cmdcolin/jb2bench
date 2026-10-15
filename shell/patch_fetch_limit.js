#!/usr/bin/env node
// Raise fetchSizeLimit on every bgzip-backed track in a build. Over the limit a
// track renders "Requested too much data" and never fetches — no error, no
// failing render, just an arm that is fast because it did nothing. The BAM
// tracks get this from patch_adapters.js already; the tabix ones do not, and a
// 3000-sample VCF over a 19 kb window is comfortably past the 5 MB default.
//
// This used to add a `.nopool` twin of each track too, off a
// `useBgzfWorkerPool` slot jbrowse-components removed; the pool A/B is now two
// builds (scripts/bgzfpool/endtoend.ts). Twins a config still carries from
// then are dropped.
//
// Usage: patch_fetch_limit.js <build-dir>
import fs from 'fs'
import path from 'path'

const POOLED_ADAPTERS = new Set([
  'BamAdapter',
  'VcfTabixAdapter',
  'Gff3TabixAdapter',
])
const FETCH_SIZE_LIMIT = 1e10

const build = process.argv[2]
if (!build) {
  throw new Error('usage: patch_fetch_limit.js <build-dir>')
}
const configPath = path.join(build, 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const tracks = config.tracks.filter(t => !t.trackId.endsWith('.nopool'))
let raised = 0
for (const track of tracks) {
  if (POOLED_ADAPTERS.has(track.adapter?.type)) {
    track.adapter.fetchSizeLimit = FETCH_SIZE_LIMIT
    raised++
  }
}
config.tracks = tracks
fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
console.log(`${build}: fetchSizeLimit raised on ${raised} bgzip-backed tracks`)

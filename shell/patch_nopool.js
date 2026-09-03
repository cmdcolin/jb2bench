#!/usr/bin/env node
// Give every bgzip-backed track in a build a `.nopool` twin, so the BGZF
// worker pool can be measured on vs off inside one build.
//
// The inflate runs in an RPC worker, so nothing on the page can reach in and
// toggle it, and without a twin an A/B costs two full builds of jbrowse-web.
// The twin is identical except for `useBgzfWorkerPool: false` on the adapter —
// which needs a jbrowse-components carrying that config slot (BamAdapter,
// VcfTabixAdapter, Gff3TabixAdapter). Against a build without it the twin is
// still created, mobx-state-tree drops the unknown key, and both arms run
// pooled: the benchmark then reports ~1.00x and nothing says why. That is what
// the blob-worker count in scripts/bgzfpool/endtoend.ts is there to catch.
//
// fetchSizeLimit is raised on both members of every pair. Over the limit a
// track renders "Requested too much data" and never fetches — no error, no
// failing render, just an arm that is fast because it did nothing. The BAM
// tracks get this from patch_adapters.js already; the tabix ones do not, and a
// 3000-sample VCF over a 19 kb window is comfortably past the 5 MB default.
//
// Usage: patch_nopool.js <build-dir>
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
  throw new Error('usage: patch_nopool.js <build-dir>')
}
const configPath = path.join(build, 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

// Rerunnable: the twins from a previous pass are dropped rather than twinned
// again, so a build can be reloaded without accumulating `.nopool.nopool`.
const tracks = config.tracks.filter(t => !t.trackId.endsWith('.nopool'))
const twins = []
for (const track of tracks) {
  if (POOLED_ADAPTERS.has(track.adapter?.type)) {
    track.adapter.fetchSizeLimit = FETCH_SIZE_LIMIT
    twins.push({
      ...structuredClone(track),
      trackId: `${track.trackId}.nopool`,
      name: `${track.name} (no pool)`,
      adapter: {
        ...structuredClone(track.adapter),
        useBgzfWorkerPool: false,
      },
    })
  }
}
config.tracks = [...tracks, ...twins]
fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
console.log(
  `${build}: ${twins.length} .nopool twin${twins.length === 1 ? '' : 's'} ` +
    `(${twins.map(t => t.trackId).join(', ')})`,
)

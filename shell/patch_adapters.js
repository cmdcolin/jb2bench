#!/usr/bin/env node
// Post-pass over a build's generated config.json, for the two adapter settings
// `jbrowse add-track` cannot express.
//
// It has to be a separate pass rather than a `--config` flag on `add-track`,
// because that flag SHALLOW-merges over the track it builds: naming `adapter`
// in it replaces the whole adapter and takes `bamLocation`/`cramLocation` with
// it, leaving a track that loads and shows nothing.
//
// 1. fetchSizeLimit, on every alignment track in every build.
//
//    `BamAdapter`/`CramAdapter` default the slot to 5 MB. Over that, the track
//    renders "Requested too much data (N Mb). Zoom in to see features, or force
//    load" and never fetches. Nothing errors — the page loads, the chrome
//    paints — so a benchmark either times an empty browser or, as here, burns
//    the full 120 s timeout on a display that never mounts.
//
//    Measured at the benchmark window on builds/current, 2026-08-23:
//    200x.longread.bam estimates 55.3 MB and refuses, 200x.longread.cram
//    estimates 21.0 MB and refuses, 1000x.shortread.bam refuses, and
//    1000x.shortread.cram does not. That last pair is the reason this is not
//    optional: the same coverage passes the gate in one format and fails it in
//    the other, because CRAM's estimate is of compressed bytes. A format
//    comparison in which one format is gated out is not a format comparison.
//
//    Raising the limit is a change to what is measured, and it is the right
//    one: the benchmark asks how long a render takes, and a refusal to render
//    is not a fast render. Both formats and all four builds get the identical
//    value, so the axis stays fair.
//
//    Note this contradicts README.md's "it does not currently fire on
//    builds/current", which was verified 2026-08-16 against the build staged
//    then. builds/current was restaged 2026-08-18 and it fires now.
//
// 2. sequenceAdapter, on CRAM tracks of a 2.x build only.
//
//    CRAM stores bases as differences against the reference, so the adapter
//    cannot decode a read without a sequence adapter to diff against. 2.x asks
//    for it in the track config and defaults the slot to null — its own schema
//    says "currently needs to be manually added". 4.x dropped the slot and
//    injects the enclosing assembly's sequence adapter itself, so writing the
//    key there would put an unknown property in a mobx-state-tree config.
//
//    Without it, every CRAM cell on builds/release-2.4.0 renders
//    `TypeError: Cannot convert undefined or null to object` instead of reads —
//    Object.keys(null) in core/util/idMaker.ts, reached from getAdapter() as it
//    builds the subadapter out of the null config.
//
// Usage: patch_adapters.js <build-dir>
import fs from 'fs'
import path from 'path'

// Comfortably past the heaviest window in this corpus (1000x longread BAM), and
// round enough to read as "off" rather than as a tuned threshold.
const FETCH_SIZE_LIMIT = 1e10
const ALIGNMENT_ADAPTERS = new Set(['BamAdapter', 'CramAdapter'])

const build = process.argv[2]
if (!build) {
  throw new Error('usage: patch_adapters.js <build-dir>')
}

const versionFile = path.join(build, 'version.txt')
const version = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : ''

const configPath = path.join(build, 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const tracks = (config.tracks ?? []).filter(t =>
  ALIGNMENT_ADAPTERS.has(t.adapter?.type),
)
if (!tracks.length) {
  process.exit(0)
}

for (const track of tracks) {
  track.adapter.fetchSizeLimit = FETCH_SIZE_LIMIT
}

// One assembly per build here, and the CRAM tracks all name it. Reading the
// sequence adapter off the assembly rather than rebuilding it keeps the two
// pointing at the same FASTA even if load_alignments.sh changes REF.
const cramTracks = version.startsWith('2.')
  ? tracks.filter(t => t.adapter.type === 'CramAdapter')
  : []
for (const track of cramTracks) {
  const assemblyName = track.assemblyNames?.[0]
  const assembly = (config.assemblies ?? []).find(a => a.name === assemblyName)
  const sequenceAdapter = assembly?.sequence?.adapter
  if (!sequenceAdapter) {
    throw new Error(
      `${build}: ${track.trackId} names assembly ${assemblyName}, which has no sequence adapter to hand it`,
    )
  }
  track.adapter.sequenceAdapter = sequenceAdapter
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
console.log(
  `  fetchSizeLimit raised on ${tracks.length} alignment track(s)` +
    (cramTracks.length
      ? `, sequenceAdapter added to ${cramTracks.length} CRAM track(s) (jbrowse ${version})`
      : ''),
)

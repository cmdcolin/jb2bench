#!/usr/bin/env node
// Fill in `adapter.sequenceAdapter` on every CramAdapter track of a JBrowse 2.x
// build. CRAM stores bases as differences against the reference, so the adapter
// cannot decode a read without a sequence adapter to diff against.
//
// 2.x asks for that adapter in the track config and defaults the slot to null --
// its own schema says "currently needs to be manually added". 4.x dropped the
// slot and injects the enclosing assembly's sequence adapter itself, so writing
// the key there would put an unknown property in a mobx-state-tree config.
// Hence the version gate, and hence this being a separate pass rather than a
// `--config` on `jbrowse add-track`: that flag shallow-merges over the track and
// naming `adapter` in it would drop cramLocation and craiLocation.
//
// Without this, every CRAM cell on builds/release-2.4.0 renders
// `TypeError: Cannot convert undefined or null to object` instead of reads --
// Object.keys(null) in core/util/idMaker.ts, reached from getAdapter() in
// core/data_adapters/dataAdapterCache.ts as it tries to build the subadapter out
// of the null config. The track mounts, so it is not the missing-trackId failure
// profile.ts warns about; it just never draws, and the cell burns the full 120 s
// WAIT_TIMEOUT before reporting FAIL.
//
// Usage: cram_seqadapter.js <build-dir>
import fs from 'fs'
import path from 'path'

const build = process.argv[2]
if (!build) {
  throw new Error('usage: cram_seqadapter.js <build-dir>')
}

const versionFile = path.join(build, 'version.txt')
const version = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : ''
if (!version.startsWith('2.')) {
  process.exit(0)
}

const configPath = path.join(build, 'config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const cramTracks = (config.tracks ?? []).filter(
  t => t.adapter?.type === 'CramAdapter',
)
if (!cramTracks.length) {
  process.exit(0)
}

// One assembly per build here, and the CRAM tracks all name it. Reading the
// sequence adapter off the assembly rather than rebuilding it keeps the two
// pointing at the same FASTA even if load_alignments.sh changes REF.
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
  `  sequenceAdapter added to ${cramTracks.length} CRAM track(s) (jbrowse ${version})`,
)

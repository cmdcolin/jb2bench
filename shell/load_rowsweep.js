// Add the row-sweep tracks to a staged build's config, the way
// load_alignments.sh does for the alignment corpus: symlink the files in beside
// the build's own assets, then register one track per sample count.
//
// Each track pins LinearMultiSampleVariantMatrixDisplay as its first display,
// so opening the track by `?tracks=` gets the many-row display rather than the
// default single-row variant one. That is the display the sweep is about.
//
//   node shell/load_rowsweep.js builds/current
import fs from 'node:fs'
import path from 'node:path'

const build = process.argv[2]
if (!build) {
  throw new Error('usage: load_rowsweep.js <build-dir>')
}

const ROWS = [100, 250, 500, 1000, 2000, 2504]
const src = path.resolve('data/rowsweep')
const cfgPath = path.join(build, 'config.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))

for (const n of ROWS) {
  for (const ext of ['gz', 'gz.tbi']) {
    const name = `rowsweep.${n}.vcf.${ext}`
    const dest = path.join(build, name)
    fs.rmSync(dest, { force: true })
    fs.symlinkSync(path.join(src, name), dest)
  }
}

cfg.tracks = cfg.tracks.filter(t => !t.trackId.startsWith('rowsweep_'))
for (const n of ROWS) {
  cfg.tracks.push({
    type: 'VariantTrack',
    trackId: `rowsweep_${n}`,
    name: `Row sweep, ${n} samples`,
    assemblyNames: [cfg.assemblies[0].name],
    adapter: {
      type: 'VcfTabixAdapter',
      vcfGzLocation: {
        uri: `rowsweep.${n}.vcf.gz`,
        locationType: 'UriLocation',
      },
      index: {
        location: {
          uri: `rowsweep.${n}.vcf.gz.tbi`,
          locationType: 'UriLocation',
        },
      },
    },
    displays: [
      {
        type: 'LinearMultiSampleVariantMatrixDisplay',
        displayId: `rowsweep_${n}-matrix`,
      },
      {
        type: 'LinearVariantDisplay',
        displayId: `rowsweep_${n}-default`,
      },
    ],
  })
}

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
console.log(
  `${build}: ${ROWS.length} row-sweep tracks registered (${ROWS.join(', ')} samples)`,
)

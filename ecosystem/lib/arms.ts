// The arm labels the bench files print, read out of versions.json rather than
// typed in.
//
// A label is the only place a reader of results/ecosystem.md learns which
// version a column is, and until 2026-08-18 every bench file spelled its own out
// by hand. That is one fact in two places: versions.json said `@gmod/bam`
// v2.0.0 and bam.bench.ts said `v2.0.0 (2023)`, and a repin would have moved the
// first and left the second describing a build it no longer runs. `cohort-bw.ts`
// already derived its labels this way; this is the same trick for the rest.
//
// `note` is for a library measured on more than one path — bgzf runs its browser
// and node paths as separate arms of one version — and lands between the tag and
// the vintage: `v1.4.5 native zlib (2023)`.
import { readFileSync } from 'node:fs'

interface Library {
  name: string
  old: { tag: string }
  new: { tag: string }
}

const versions = JSON.parse(
  readFileSync(new URL('../versions.json', import.meta.url), 'utf8'),
) as { libraries: Library[] }

function lib(name: string) {
  const l = versions.libraries.find(x => x.name === name)
  if (!l) {
    throw new Error(`no library "${name}" in versions.json`)
  }
  return l
}

/** the version v2.4.0 shipped, which is what the 2023 paper benchmarked */
export const oldArm = (name: string, note = '') =>
  `${lib(name).old.tag}${note} (2023)`

/** the current release, which is what main installs */
export const newArm = (name: string, note = '') =>
  `${lib(name).new.tag}${note} (current)`

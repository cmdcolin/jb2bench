// Is the cross-tool harness port serving THIS checkout, and can its pages reach
// the corpus?
//
// `servedbuild.ts` asks the same question of the JBrowse ports and has done
// since a correct measurement went out under the wrong build name. The harness
// port had no equivalent, and on 2026-09-06 that cost the whole 1 Mb cross-tool
// row: `make serve` had been run from a worktree three days earlier, so port
// 8003 was serving that checkout's `crosstool/` — a copy predating the `ref`
// parameter, whose relative `data -> ../data` symlink pointed at a worktree with
// no 2 Mb corpus in it. Every non-JBrowse arm at that window 404'd, drew
// nothing, and settled in 2.1 s, which the table recorded as igv.js being twice
// as fast as JBrowse and immune to coverage.
//
// The JBrowse arms came through the same run intact, which is why nothing looked
// wrong at a glance: `builds/*/` carries ABSOLUTE symlinks into the primary
// checkout's `data/`, so those ports serve the corpus from wherever they are
// started. Only the harness pages, which reach their data by a relative symlink,
// depend on the server's working directory.
//
// Two checks, because the failure had two halves and either alone can happen:
// the pages are the ones in this working tree, and the bytes they will ask for
// are there to be served.
import fs from 'fs'

/** harness pages whose served copy must match this checkout's */
const PAGES = ['index.html', 'genomespy.html', 'gosling.html']

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`)
  }
  return res.text()
}

/**
 * Throw unless every harness page on `port` is byte-identical to `crosstool/`.
 *
 * Byte-identical rather than "looks like a harness": the failure this exists for
 * served a page that was a perfectly good harness, just an older one from
 * somewhere else, and a looser check would have passed it.
 */
export async function checkHarnessPages(port: number): Promise<string> {
  for (const page of PAGES) {
    const local = fs.readFileSync(`crosstool/${page}`, 'utf8')
    const served = await fetchText(`http://localhost:${port}/${page}`)
    if (served !== local) {
      throw new Error(
        `port ${port} serves a ${page} that is not the one in this checkout — ` +
          `${served.length} bytes against ${local.length}. ` +
          `Restart it from ${process.cwd()}: make serve-stop && make serve`,
      )
    }
  }
  return `${PAGES.length} pages match crosstool/`
}

/** the index beside a container file, named the way every harness here names it */
const indexOf = (track: string) => `${track}${track.endsWith('.cram') ? '.crai' : '.bai'}`

/**
 * The corpus paths a harness page asks for, given the files a run will open.
 *
 * The harness reaches its data at `./data/<file>`, which is `crosstool/data`,
 * which is a relative symlink — so this resolves through whatever directory the
 * server was started in, and that is exactly what goes wrong.
 */
export const corpusPaths = (assembly: string, tracks: string[]) => [
  `data/${assembly}.fa`,
  `data/${assembly}.fa.fai`,
  ...tracks.flatMap(t => [`data/${t}`, `data/${indexOf(t)}`]),
]

/** The paths of `paths` that `port` will not serve. */
export async function unreachable(
  port: number,
  paths: string[],
): Promise<string[]> {
  const missing: string[] = []
  for (const p of paths) {
    // One byte, not a HEAD: the corpus runs to 215 MB a file, and asking for the
    // whole of it to prove it is there would move a gigabyte per preflight. The
    // body is cancelled rather than read, so a server that ignores the Range
    // costs nothing either.
    const res = await fetch(`http://localhost:${port}/${p}`, {
      headers: { Range: 'bytes=0-0' },
    }).catch(() => null)
    await res?.body?.cancel().catch(() => {})
    if (!res?.ok) {
      missing.push(p)
    }
  }
  return missing
}

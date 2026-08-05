// Which build sits on which port is set by hand when the http-servers are
// started, and for a long time nothing checked it: runner.ts hardcoded the label
// "current" for port 8000 while runner-interaction.ts hardcoded "webgl-poc" for
// the same port, and the README had to warn about the disagreement in prose. On
// 2026-08-05 port 8000 was in fact serving builds/current, so a correct
// measurement went out under the wrong build name.
//
// So resolve it instead of asserting it. Every build stamps a content-hashed
// bundle into its index.html, which makes the served index a fingerprint: fetch
// it and match the hash against builds/*/index.html to learn the real name. A
// port serving something not in builds/ is a hard error, because the alternative
// is a results table whose column headers are a guess.
import fs from 'fs'

const bundleOf = (html: string) => /main\.[a-z0-9]+\.js/.exec(html)?.[0]

function localBuilds() {
  const byBundle = new Map<string, string>()
  for (const dir of fs.readdirSync('builds')) {
    const index = `builds/${dir}/index.html`
    if (fs.existsSync(index)) {
      const hash = bundleOf(fs.readFileSync(index, 'utf8'))
      if (hash) {
        byBundle.set(hash, dir)
      }
    }
  }
  return byBundle
}

/** the name of the `builds/` directory actually being served on `port` */
export async function resolveBuild(port: number): Promise<string> {
  const res = await fetch(`http://localhost:${port}/index.html`)
  if (!res.ok) {
    throw new Error(`port ${port}: HTTP ${res.status} — is the build served?`)
  }
  const hash = bundleOf(await res.text())
  const name = hash && localBuilds().get(hash)
  if (!name) {
    throw new Error(
      `port ${port}: served bundle ${hash ?? '(none found)'} matches no builds/*/index.html`,
    )
  }
  return name
}

// Run the jbrowse-components MCP agent eval and copy its summary.json into results/.
//
//   node --experimental-strip-types scripts/agent-evals/run.ts <dev|heldout|tutorials> [--config-dir ~/.claude3] [--runs 3] [--model sonnet]
//
// Each task is a real `claude -p` session, so this bills model usage. The harness strips CLAUDE_* from the
// environment it spawns claude with, so --config-dir works through a `claude` wrapper placed first on PATH.
// JBROWSE sets the jbrowse-components checkout (default ~/src/jbrowse-components); its Desktop build must exist:
// `pnpm --filter @jbrowse/desktop build`. Needs xvfb-run and `claude` on PATH.

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const opt = (n: string, d?: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
const set = argv[0]
if (!set || !['dev', 'heldout', 'tutorials'].includes(set)) {
  console.error('usage: run.ts <dev|heldout|tutorials> [--config-dir dir] [--runs N] [--model name]')
  process.exit(2)
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jb = process.env.JBROWSE ?? resolve(homedir(), 'src/jbrowse-components')
const desktop = resolve(jb, 'products/jbrowse-desktop')
if (!existsSync(resolve(desktop, 'build/mcpServer.js'))) {
  console.error(`no Desktop build in ${desktop}; run: pnpm --filter @jbrowse/desktop build`)
  process.exit(1)
}

const env = { ...process.env }
const configDir = opt('--config-dir')
if (configDir) {
  const real = spawnSync('which', ['claude'], { encoding: 'utf8' }).stdout.trim()
  const bin = mkdtempSync(resolve(tmpdir(), 'claude-wrapper-'))
  writeFileSync(resolve(bin, 'claude'), `#!/bin/sh\nCLAUDE_CONFIG_DIR=${resolve(configDir)} exec ${real} "$@"\n`)
  chmodSync(resolve(bin, 'claude'), 0o755)
  env.PATH = `${bin}:${env.PATH}`
}

const r = spawnSync('xvfb-run', ['--auto-servernum', 'node', 'test/mcpAgentEval.ts', '--model', opt('--model', 'sonnet')!, '--runs', opt('--runs', '3')!, '--set', set], { cwd: desktop, env, encoding: 'utf8', maxBuffer: 1 << 28 })
process.stdout.write(r.stdout)
process.stderr.write(r.stderr)
const dirOut = /^results: (.+)$/m.exec(r.stdout)?.[1]
if (!dirOut) {
  console.error('the eval stopped before writing results; see the output above')
  process.exit(1)
}
mkdirSync(resolve(root, 'results'), { recursive: true })
const dest = resolve(root, `results/agent-evals-${set}.json`)
copyFileSync(resolve(dirOut, 'summary.json'), dest)
console.log(`→ ${dest}`)

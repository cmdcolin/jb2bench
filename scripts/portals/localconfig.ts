// Rewrite the cancer_sv demo config so every file it names is read from a local directory.
//
//   node --experimental-strip-types scripts/portals/localconfig.ts <dir>   → <dir>/config.local.json
//
// The demo config is fetched from jbrowse.org; each remote URL is matched to a file in <dir> by basename.

import { existsSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const DEMO = 'https://jbrowse.org/demos/cancer_sv/config.json'
const dir = resolve(process.argv[2] ?? '')
if (!process.argv[2]) {
  console.error('usage: localconfig.ts <dir>')
  process.exit(2)
}

const local = (uri: string) => {
  const p = resolve(dir, basename(uri))
  return existsSync(p) ? { localPath: p, locationType: 'LocalPathLocation' } : undefined
}

const adapterOf: Record<string, (a: Record<string, unknown>, uri: string) => void> = {
  BgzipFastaAdapter: (a, uri) => {
    a.fastaLocation = local(uri)
    a.faiLocation = local(`${uri}.fai`)
    a.gziLocation = local(`${uri}.gzi`)
  },
  RefNameAliasAdapter: (a, uri) => {
    a.location = local(uri)
  },
  BamAdapter: (a, uri) => {
    a.bamLocation = local(uri)
    a.index = { location: local(`${uri}.bai`), indexType: 'BAI' }
  },
}

const walk = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(walk)
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    const uri = typeof o.uri === 'string' && /^https?:/.test(o.uri) ? o.uri : undefined
    if (uri && typeof o.type === 'string' && adapterOf[o.type]) {
      delete o.uri
      adapterOf[o.type](o, uri)
    } else if (uri && local(uri)) {
      return local(uri)
    }
    for (const k of Object.keys(o)) {
      o[k] = walk(o[k])
    }
  }
  return node
}

const config = walk(await (await fetch(DEMO)).json())
writeFileSync(resolve(dir, 'config.local.json'), JSON.stringify(config, null, 2))
console.log(`wrote ${resolve(dir, 'config.local.json')}`)

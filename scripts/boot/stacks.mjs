import fs from 'fs'
import { SourceMapConsumer } from 'source-map'
const [trace, jsDir, fromS, toS, threadWant] = process.argv.slice(2)
const ev = JSON.parse(fs.readFileSync(trace)).traceEvents
const nav = ev.find(e => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.startsWith('http'))
const tn = new Map(); for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name)
const prof = new Map(), nodes = new Map(), cur = new Map(), agg = new Map()
const consumers = new Map()
async function res(cf) {
  if (!cf.url) return cf.functionName || '(native)'
  const base = cf.url.split('/').pop().split('?')[0]
  if (!consumers.has(base)) { const p = jsDir + '/' + base + '.map'; consumers.set(base, fs.existsSync(p) ? await new SourceMapConsumer(fs.readFileSync(p, 'utf8')) : null) }
  const c = consumers.get(base); const pos = c?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber })
  return pos?.source ? pos.source.replace(/^webpack:\/\/[^.]*?(\.\.\/)*/, '').replace(/^.*node_modules\//, '') + ':' + pos.line + (pos.name ? ' ' + pos.name : '') : (cf.functionName || '?') + ' ' + base
}
const from = Number(fromS), to = Number(toS)
const own = s => /packages\/|plugins\//.test(s) && !/mobx-state-tree|mobx\/|core\/src\/configuration\//.test(s)
for (const e of ev) {
  if (e.name === 'Profile') prof.set(e.pid + ":" + e.id, { pid: e.pid, tid: e.tid, t: e.args.data.startTime })
  if (e.name === 'ProfileChunk') {
    const o = prof.get(e.pid + ":" + e.id) ?? { pid: e.pid, tid: e.tid, t: e.ts }
    const th = tn.get(o.pid + ':' + o.tid); if (o.pid !== nav.pid || th !== threadWant) continue
    const nm = nodes.get(e.pid + ":" + e.id) ?? new Map(); nodes.set(e.pid + ":" + e.id, nm)
    for (const n of e.args.data.cpuProfile?.nodes ?? []) nm.set(n.id, n)
    let t = cur.get(e.pid + ":" + e.id) ?? o.t
    const ids = e.args.data.cpuProfile?.samples ?? [], dts = e.args.data.timeDeltas ?? []
    for (let i = 0; i < ids.length; i++) { t += dts[i]; const ms = (t - nav.ts) / 1000; if (ms >= from && ms < to) { const k = e.pid + ":" + e.id + ':' + ids[i]; agg.set(k, (agg.get(k) ?? 0) + 1) } }
    cur.set(e.pid + ":" + e.id, t)
  }
}
// roll up by the nearest "own code" ancestor frame, and by the leaf
const byOwn = new Map(), byPath = new Map(), byLeafPkg = new Map()
for (const [k, n] of agg) {
  const [pid, id, nid] = k.split(':'); const nm = nodes.get(pid + ':' + id)
  let node = nm.get(Number(nid)); const chain = []
  while (node) { chain.push(node.callFrame); node = node.parent ? nm.get(node.parent) : undefined }
  const names = []; for (const cf of chain.slice(0, 400)) names.push(await res(cf))
  if (names[0] === '(idle)' || names[0] === '(program)') continue
  const firstOwn = names.find(own) ?? '(none)'
  if (firstOwn === '(none)') {
    const leaf = names[0]
    const pkg = leaf.includes('webpack/') ? 'webpack runtime / module eval' : /^[^ ]*\.(t|j)sx?:/.test(leaf) ? leaf.split('/').slice(0, leaf.startsWith('@') ? 2 : 1).join('/') : leaf
    byLeafPkg.set(pkg, (byLeafPkg.get(pkg) ?? 0) + n)
  }
  byOwn.set(firstOwn, (byOwn.get(firstOwn) ?? 0) + n)
  const path = names.filter(own).slice(0, 4).join(' <- ')
  byPath.set(path, (byPath.get(path) ?? 0) + n)
}
const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 14)
console.log('samples (~0.1ms+ each) by nearest own-code frame:'); for (const [k, v] of top(byOwn)) console.log(String(v).padStart(6), k)
console.log('\nno own frame, by leaf package:'); for (const [k, v] of top(byLeafPkg)) console.log(String(v).padStart(6), k)
console.log('\nby own-code stack:'); for (const [k, v] of top(byPath)) console.log(String(v).padStart(6), k)

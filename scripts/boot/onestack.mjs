import fs from 'fs'
import { SourceMapConsumer } from 'source-map'
const [trace, jsDir, fromS, toS, needle] = process.argv.slice(2)
const ev = JSON.parse(fs.readFileSync(trace)).traceEvents
const nav = ev.find(e => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.startsWith('http'))
const tn = new Map(); for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name)
const prof = new Map(), nodes = new Map(), cur = new Map(), agg = new Map(), consumers = new Map()
async function res(cf) {
  if (!cf.url) return cf.functionName || '(native)'
  const base = cf.url.split('/').pop().split('?')[0]
  if (!consumers.has(base)) { const p = jsDir + '/' + base + '.map'; consumers.set(base, fs.existsSync(p) ? await new SourceMapConsumer(fs.readFileSync(p, 'utf8')) : null) }
  const c = consumers.get(base); const pos = c?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber })
  return pos?.source ? pos.source.replace(/^webpack:\/\/[^.]*?(\.\.\/)*/, '').replace(/^.*node_modules\//, '') + ':' + pos.line + (pos.name ? ' ' + pos.name : '') : (cf.functionName || '?') + ' ' + base
}
for (const e of ev) {
  if (e.name === 'Profile') prof.set(e.pid + ":" + e.id, { pid: e.pid, tid: e.tid, t: e.args.data.startTime })
  if (e.name === 'ProfileChunk') {
    const o = prof.get(e.pid + ":" + e.id) ?? { pid: e.pid, tid: e.tid, t: e.ts }
    if (o.pid !== nav.pid || tn.get(o.pid + ':' + o.tid) !== 'CrRendererMain') continue
    const nm = nodes.get(e.pid + ":" + e.id) ?? new Map(); nodes.set(e.pid + ":" + e.id, nm)
    for (const n of e.args.data.cpuProfile?.nodes ?? []) nm.set(n.id, n)
    let t = cur.get(e.pid + ":" + e.id) ?? o.t
    const ids = e.args.data.cpuProfile?.samples ?? [], dts = e.args.data.timeDeltas ?? []
    for (let i = 0; i < ids.length; i++) { t += dts[i]; const ms = (t - nav.ts) / 1000; if (ms >= +fromS && ms < +toS) { const k = e.pid + ":" + e.id + ':' + ids[i]; agg.set(k, (agg.get(k) ?? 0) + 1) } }
    cur.set(e.pid + ":" + e.id, t)
  }
}
// group by the root-most 12 frames for samples whose stack contains the needle
const groups = new Map()
for (const [k, n] of agg) {
  const [pid, id, nid] = k.split(':'); const nm = nodes.get(pid + ':' + id)
  let node = nm.get(Number(nid)); const chain = []
  while (node) { chain.push(node.callFrame); node = node.parent ? nm.get(node.parent) : undefined }
  const names = []; for (const cf of chain) names.push(await res(cf))
  if (!names.some(s => s.includes(needle))) continue
  const rootward = names.reverse().filter(s => !/mobx-state-tree|^mobx\/|\(root\)/.test(s)).slice(0, 14).join('\n    ')
  groups.set(rootward, (groups.get(rootward) ?? 0) + n)
}
for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`${v} samples:\n    ${k}\n`)

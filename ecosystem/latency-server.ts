// A static file server that serves the corpus over HTTP with a round trip you
// choose, and honours Range requests.
//
// Every HTTP number in this repo until now came off `localhost`, where a round
// trip costs about 0.05 ms. That makes a request free, and it makes every
// optimization about the SHAPE of a request -- fewer reads, reads issued
// together instead of one after another, a cache shared between files --
// unmeasurable. `ecosystem/results/cohort-bw.md` recorded that @gmod/bbi 11.2.2
// issues one MORE read per file than 3.0.0 for identical bytes, and on localhost
// that cost nothing at all; at a 50 ms round trip it is five seconds across a
// hundred-sample panel.
//
// So the counts were never the interesting quantity, they were a proxy for one.
// This serves the same bytes with a delay in front of them, so the benchmark can
// report the thing a user actually experiences.
//
// Usage: latency-server.ts --root data --port 9000 --rtt 50
//   --rtt N   milliseconds added to every response. One full round trip per
//             request, applied before the first byte, which is where a real
//             network puts it for a small ranged read.
//   --jitter  fraction of rtt to vary by, default 0. Deliberately off: a fixed
//             delay makes two runs comparable, and a benchmark that wants
//             realism more than repeatability should say so explicitly.
import fs from 'fs'
import http from 'http'
import path from 'path'

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1]! : dflt
}

const ROOT = path.resolve(arg('root', 'data'))
const PORT = Number(arg('port', '9000'))
const RTT = Number(arg('rtt', '0'))
const JITTER = Number(arg('jitter', '0'))

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Requests served and bytes moved, so a run can report what it actually cost. */
let requests = 0
let bytes = 0

const server = http.createServer(async (req, res) => {
  // CORS, because the harness page is served from a different port than the
  // corpus. `Accept-Ranges` and `Content-Range` have to be exposed explicitly or
  // a cross-origin reader cannot see them and falls back to whole-file GETs --
  // which would turn a 48-byte header read into a 268 MB download and measure
  // something else entirely.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Range')
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Accept-Ranges',
  )
  res.setHeader('Accept-Ranges', 'bytes')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ requests, bytes, rtt: RTT }))
    return
  }
  if (url.pathname === '/__reset') {
    requests = 0
    bytes = 0
    res.writeHead(200).end('ok')
    return
  }

  // Resolve inside ROOT and nowhere else.
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const file = path.resolve(ROOT, rel)
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('outside root')
    return
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404).end('not a file')
    return
  }

  requests++

  // The delay goes here: after the request is understood and before any byte of
  // the body. A real network charges the round trip once for a small read, and
  // these reads are 22 bytes to a few hundred kilobytes.
  const delay = JITTER ? RTT * (1 + (Math.random() * 2 - 1) * JITTER) : RTT
  if (delay > 0) {
    await sleep(delay)
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (!range) {
    bytes += stat.size
    res.writeHead(200, {
      'content-length': String(stat.size),
      'content-type': 'application/octet-stream',
    })
    fs.createReadStream(file).pipe(res)
    return
  }

  // An open-ended `bytes=N-` means "to the end", and `bytes=-N` the last N.
  const [, rawStart, rawEnd] = range
  let start: number
  let end: number
  if (rawStart === '') {
    const len = Number(rawEnd)
    start = Math.max(0, stat.size - len)
    end = stat.size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? stat.size - 1 : Math.min(Number(rawEnd), stat.size - 1)
  }
  if (!(start >= 0 && end >= start && start < stat.size)) {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end()
    return
  }

  bytes += end - start + 1
  res.writeHead(206, {
    'content-range': `bytes ${start}-${end}/${stat.size}`,
    'content-length': String(end - start + 1),
    'content-type': 'application/octet-stream',
  })
  fs.createReadStream(file, { start, end }).pipe(res)
})

server.listen(PORT, () => {
  console.log(`latency-server: ${ROOT} on :${PORT}, rtt ${RTT} ms`)
})

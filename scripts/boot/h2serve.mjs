// Static HTTP/2 server for the boot trace: TLS (self-signed), byte ranges for the
// alignment files, precompressed .gz served when the client accepts gzip, and a
// one-hour max-age. http-server is HTTP/1.1 only, where Chrome opens six
// connections per host and a 45-chunk wave queues behind them; a CDN speaks h2.
// Usage: node h2serve.mjs <root> <port> <key.pem> <cert.pem>
import fs from 'fs'
import http2 from 'http2'
import path from 'path'

const [root, port, key, cert] = process.argv.slice(2)
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }
const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), allowHTTP1: true })
server.on('stream', (stream, headers) => {
  const url = new URL(headers[':path'], 'https://x')
  let file = path.join(root, decodeURIComponent(url.pathname))
  if (file.endsWith('/')) file = path.join(file, 'index.html')
  let st
  try { st = fs.statSync(file) } catch { stream.respond({ ':status': 404 }); stream.end(); return }
  const base = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
  const range = /bytes=(\d+)-(\d*)/.exec(headers.range ?? '')
  if (range) {
    const start = Number(range[1])
    const end = Math.min(range[2] ? Number(range[2]) : st.size - 1, st.size - 1)
    send(stream, file, { ...base, ':status': 206, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 }, { start, end })
  } else if (/gzip/.test(headers['accept-encoding'] ?? '') && fs.existsSync(file + '.gz')) {
    send(stream, file + '.gz', { ...base, ':status': 200, 'content-encoding': 'gzip', vary: 'accept-encoding', 'content-length': fs.statSync(file + '.gz').size })
  } else {
    send(stream, file, { ...base, ':status': 200, 'content-length': st.size })
  }
})
function send(stream, file, headers, range) {
  stream.on('error', () => {})
  if (stream.destroyed) return
  stream.respond(headers)
  const rs = fs.createReadStream(file, range)
  rs.on('error', () => stream.destroy())
  rs.pipe(stream)
}
server.on('sessionError', () => {})
server.listen(Number(port))

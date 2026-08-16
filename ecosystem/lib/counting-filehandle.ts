// A filehandle that records every read.
//
// The point of counting rather than timing: a count is exact, identical on
// every machine, and does not decay. Every timing in this repository carries a
// caveat about the load the box was under, and most of `NEXT_STEPS.md` is
// blocked on a machine that has not been idle for weeks. A benchmark whose
// output is a count is one that can be run honestly anyway.
//
// It is also the quantity that transfers. Locally a read is a syscall and cheap;
// over HTTP it is a range request and a round trip, and round trips are what a
// genome browser actually waits on — which is the whole content of the Zarr
// comparison this directory reports (2,504 files, 15,048 requests, 24.5 s for
// 48 MB).
//
// **It wraps the library's own LocalFile rather than reimplementing one.** That
// is not fastidiousness; the first version of this file did reimplement it, and
// two majors of @gmod/bam then failed with "Not a BAI file" while their
// neighbours passed — a wrong answer produced by the instrument, in a shape that
// would have read as a library defect. The two filehandle interfaces in play
// differ in more than their signatures (whether `position` may be omitted, what
// a short read returns, whether the buffer is reused), and a benchmark whose
// whole output is "how many reads" must not be the thing deciding what a read
// is. Wrapping the real implementation also means the count is of calls the
// library would have made anyway, against the filehandle it would normally have
// been given.
import { createRequire } from 'node:module'

export interface Counter {
  reads: number
  bytes: number
  /** every read's length, in order — the access pattern, not just its size */
  sizes: number[]
}

/**
 * Resolve the `LocalFile` belonging to a particular library build, whichever of
 * the two filehandle packages it depends on, and wrap it in a counter.
 *
 * Resolution is from the build's own directory, so each version in a sweep is
 * measured through the filehandle it actually ships with rather than through
 * one version's copy imposed on all of them.
 */
export async function countingFile(libDir: string, path: string) {
  const require = createRequire(`${libDir}/package.json`)

  let LocalFile: any
  for (const pkg of ['generic-filehandle2', 'generic-filehandle']) {
    try {
      const mod = await import(require.resolve(pkg))
      LocalFile = mod.LocalFile ?? mod.default?.LocalFile
      if (LocalFile) break
    } catch {
      // try the other one
    }
  }
  if (!LocalFile) {
    throw new Error(`no generic-filehandle resolvable from ${libDir}`)
  }

  const inner = new LocalFile(path)
  const counter: Counter = { reads: 0, bytes: 0, sizes: [] }

  // `readFile` counts as a read, and leaving it out is not a detail: every
  // @gmod/bam slurps the whole .bai that way rather than ranging into it, so a
  // counter watching only `read` reports zero index requests and makes the index
  // look free. It is one request for the entire file, which is exactly the shape
  // worth seeing next to a data column made of many small ones.
  const COUNTED = new Set(['read', 'readFile'])

  // A Proxy rather than a hand-written facade, so every other method the library
  // reaches for — stat, close, and anything a future version adds — goes through
  // to the real implementation untouched. A facade would silently miss one and
  // change behaviour.
  const handle = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || !COUNTED.has(prop) || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return async (...args: any[]) => {
        const result = await value.apply(target, args)
        // The interfaces report length three ways: generic-filehandle's `read`
        // returns {bytesRead}, generic-filehandle2's returns the Uint8Array, and
        // `readFile` on either returns the buffer (or a string, if a version
        // ever asks for one).
        const n =
          typeof result?.bytesRead === 'number'
            ? result.bytesRead
            : (result?.length ?? 0)
        counter.reads++
        counter.bytes += n
        counter.sizes.push(n)
        return result
      }
    },
  })

  return { handle, counter }
}

/** Sum the counters of several handles — a query usually touches data + index. */
export function totals(counters: Counter[]) {
  return {
    reads: counters.reduce((n, c) => n + c.reads, 0),
    bytes: counters.reduce((n, c) => n + c.bytes, 0),
  }
}

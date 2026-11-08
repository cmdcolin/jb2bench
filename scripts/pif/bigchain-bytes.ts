// What UCSC bigChain + bigLink transfer beside a PIF, through the readers
// JBrowse uses: @gmod/bbi for the bigBed pair and @gmod/tabix for the PIF.
//
// Two views. A whole genome, drawn in PX columns, asks every chromosome for
// its full span at that scale; a window asks one region at base resolution.
// Each file is opened fresh for each view, so the header and index reads a
// cold reader makes are counted every time.
//
// bigBed has two routes to a whole genome. @gmod/bbi's BigBed reads the
// unzoomed items at every scale, so "full" is what JBrowse transfers. A reader
// that settled for the file's zoom levels, as the UCSC browser does when it
// draws a bigBed as coverage, reads summary bins instead; "summary" opens the
// same file through the BigWig class, which picks the zoom level for the scale
// the way the BigWig route picks it, and reads those bins. Summary bins carry
// item counts per bin, not chain geometry.
//
// The PIF's whole genome reads the coarsened `T` tier (the hs1 side), the tier
// the synteny track reads above its 10 kb/px threshold; the window reads the
// full-CIGAR `t` tier at base resolution.
//
// Requests are the filehandle's read() calls, which is one Range request each
// for a RemoteFile; bytes are what those reads returned. Sources may be local
// paths or https URLs.
//
//   node --experimental-strip-types scripts/pif/bigchain-bytes.ts \
//     --bigchain <chain.bb> --biglink <link.bb> --pif <file.pif.gz> \
//     --window chr1:195700000-196700000 [--px 2000] [--json out.json]

import { writeFileSync } from 'node:fs'

import { BigBed, BigWig } from '@gmod/bbi'
import { TabixIndexedFile } from '@gmod/tabix'
import { LocalFile, RemoteFile } from 'generic-filehandle2'

import type {
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
} from 'generic-filehandle2'

const TABIX_MAX = 1 << 29

class Counted implements GenericFilehandle {
  requests = 0
  bytes = 0
  readonly source?: string
  private readonly inner: GenericFilehandle

  constructor(inner: GenericFilehandle) {
    this.inner = inner
    this.source = inner.source
  }

  async read(length: number, position: number, opts?: FilehandleOptions) {
    const buf = await this.inner.read(length, position, opts)
    this.requests += 1
    this.bytes += buf.length
    return buf
  }

  readFile(options?: ReadFileOptions): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: ReadFileTextOptions): Promise<string>
  async readFile(options?: ReadFileOptions | ReadFileTextOptions) {
    const buf = await this.inner.readFile()
    this.requests += 1
    this.bytes += buf.length
    const encoding =
      typeof options === 'string'
        ? options
        : options && 'encoding' in options
          ? options.encoding
          : undefined
    return encoding ? new TextDecoder(encoding).decode(buf) : buf
  }

  stat() {
    return this.inner.stat()
  }

  close() {
    return this.inner.close()
  }
}

function open(src: string) {
  return new Counted(
    /^https?:/.test(src) ? new RemoteFile(src) : new LocalFile(src),
  )
}

async function sizeOf(src: string) {
  return (await open(src).stat()).size
}

interface Measure {
  file: string
  view: string
  route: string
  requests: number
  bytes: number
  items: number
  note: string
}

function arg(args: string[], name: string) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function parseWindow(w: string) {
  const m = /^(\S+):(\d+)-(\d+)$/.exec(w)
  if (!m) {
    throw new Error(`window must be chr:start-end, got ${w}`)
  }
  return { refName: m[1]!, start: Number(m[2]), end: Number(m[3]) }
}

async function bigBedFull(
  src: string,
  view: string,
  regions: { refName: string; start: number; end: number }[],
  basesPerSpan: number,
): Promise<Measure> {
  const fh = open(src)
  const bb = new BigBed({ filehandle: fh })
  let items = 0
  for (const r of regions) {
    const feats = await bb.getFeatures(r.refName, r.start, r.end, {
      basesPerSpan,
    })
    items += feats.length
    console.error(`${src.split('/').pop()} ${r.refName} ${feats.length} items, ${fh.bytes} bytes so far`)
  }
  return {
    file: src,
    view,
    route: 'full items',
    requests: fh.requests,
    bytes: fh.bytes,
    items,
    note: 'BigBed reads unzoomed items at every scale',
  }
}

async function bigBedSummary(
  src: string,
  view: string,
  regions: { refName: string; start: number; end: number }[],
  basesPerSpan: number,
): Promise<Measure> {
  const fh = open(src)
  const bw = new BigWig({ filehandle: fh })
  const { zoomLevels } = await bw.getHeader()
  const level = [...zoomLevels]
    .toReversed()
    .find(z => z.reductionLevel <= 2 * basesPerSpan)
  let items = 0
  for (const r of regions) {
    const feats = await bw.getFeatures(r.refName, r.start, r.end, {
      basesPerSpan,
    })
    items += feats.length
  }
  return {
    file: src,
    view,
    route: 'summary bins',
    requests: fh.requests,
    bytes: fh.bytes,
    items,
    note: level
      ? `zoom level ${level.reductionLevel} bp per bin of ${zoomLevels.map(z => z.reductionLevel).join(', ')}`
      : 'no zoom level coarse enough; unzoomed',
  }
}

async function bigBedRefs(src: string) {
  const bb = new BigBed({ filehandle: open(src) })
  const { refsByNumber } = await bb.getHeader()
  return Object.values(refsByNumber).map(ref => ({
    refName: ref.name,
    start: 0,
    end: ref.length,
  }))
}

async function pifView(
  src: string,
  view: string,
  regions: { refName: string; start: number; end: number }[],
  tier: string,
): Promise<Measure> {
  const fh = open(src)
  const tbi = open(`${src}.tbi`)
  const tabix = new TabixIndexedFile({ filehandle: fh, tbiFilehandle: tbi })
  let items = 0
  for (const r of regions) {
    await tabix.getLines(r.refName, r.start, r.end, () => {
      items += 1
    })
  }
  return {
    file: src,
    view,
    route: tier,
    requests: fh.requests + tbi.requests,
    bytes: fh.bytes + tbi.bytes,
    items,
    note: `index ${tbi.bytes} bytes in ${tbi.requests} request${tbi.requests === 1 ? '' : 's'}, data ${fh.bytes} in ${fh.requests}`,
  }
}

async function pifRefs(src: string, prefix: string) {
  const tabix = new TabixIndexedFile({
    filehandle: open(src),
    tbiFilehandle: open(`${src}.tbi`),
  })
  const { refIdToName } = await tabix.getMetadata()
  return refIdToName
    .filter(n => n.startsWith(prefix))
    .map(refName => ({ refName, start: 0, end: TABIX_MAX }))
}

function mb(n: number) {
  return (n / 1e6).toFixed(2)
}

async function main() {
  const args = process.argv.slice(2)
  const bigchain = arg(args, '--bigchain')
  const biglink = arg(args, '--biglink')
  const pif = arg(args, '--pif')
  const windowArg = arg(args, '--window')
  if (!bigchain || !biglink || !pif || !windowArg) {
    throw new Error(
      'usage: bigchain-bytes.ts --bigchain <bb> --biglink <bb> --pif <pif.gz> --window chr:start-end [--px 2000] [--json out.json]',
    )
  }
  const px = Number(arg(args, '--px') ?? 2000)
  const window = parseWindow(windowArg)
  const jsonOut = arg(args, '--json')

  const chainRefs = await bigBedRefs(bigchain)
  const genome = chainRefs.reduce((a, r) => a + r.end, 0)
  const bpPerPx = genome / px
  const whole = `whole genome, ${chainRefs.length} sequences, ${px} px, ${Math.round(bpPerPx)} bp/px`
  const win = `${windowArg} (${mb(window.end - window.start)} Mb)`

  const sizes = {
    bigchain: await sizeOf(bigchain),
    biglink: await sizeOf(biglink),
    pif: await sizeOf(pif),
    pifIndex: await sizeOf(`${pif}.tbi`),
  }

  const rows: Measure[] = [
    await bigBedFull(bigchain, whole, chainRefs, bpPerPx),
    await bigBedSummary(bigchain, whole, chainRefs, bpPerPx),
    await bigBedFull(biglink, whole, await bigBedRefs(biglink), bpPerPx),
    await bigBedSummary(biglink, whole, await bigBedRefs(biglink), bpPerPx),
    await pifView(pif, whole, await pifRefs(pif, 'T'), 'coarsened T tier'),
    await bigBedFull(bigchain, win, [window], 1),
    await bigBedFull(biglink, win, [window], 1),
    await pifView(
      pif,
      win,
      [{ ...window, refName: `t${window.refName}` }],
      'full-CIGAR t tier',
    ),
  ]

  console.log(
    `sizes: bigChain ${sizes.bigchain}, bigLink ${sizes.biglink}, pif ${sizes.pif} + index ${sizes.pifIndex}`,
  )
  console.log('')
  console.log('| file | view | route | requests | bytes | MB | items | note |')
  console.log('| --- | --- | --- | ---: | ---: | ---: | ---: | --- |')
  for (const r of rows) {
    console.log(
      `| ${r.file.split('/').pop()} | ${r.view} | ${r.route} | ${r.requests} | ${r.bytes} | ${mb(r.bytes)} | ${r.items} | ${r.note} |`,
    )
  }
  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify({ date: new Date().toISOString(), px, sizes, rows }, null, 2),
    )
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})

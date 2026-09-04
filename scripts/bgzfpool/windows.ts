/**
 * The windows both arms of the pool figure query, shared so that the
 * end-to-end and standalone panels differ in what surrounds the query and in
 * nothing else.
 *
 * 19 kb, marching along chr22_mask, none overlapping — jbrowse caches decoded
 * records per region and raw bytes per 256 KiB chunk, so a window that
 * overlaps its predecessor measures a cache hit rather than an inflate. The
 * first is the initial render in the end-to-end arm, which is also what spawns
 * the pool and instantiates its wasm, so it is never timed.
 */
export const REF = 'chr22_mask'

/** chr22_mask is 250,001 bp, which is what caps how wide a window can get. */
const CONTIG = 250001

/**
 * The 19 kb set the run of record was taken over, kept as a literal rather than
 * derived: it is what results/bgzfpool-standalone.json is comparable to, and a
 * tiling rule that happened to produce different bounds would silently make the
 * next run a different benchmark.
 */
const DEFAULT_WINDOWS = [
  [30000, 49000],
  [60000, 79000],
  [90000, 109000],
  [124000, 143000],
  [155000, 174000],
  [185000, 204000],
]

/**
 * WINDOW_KB widens them, for the regime jbrowse-components measured tabix in —
 * 50-400 kb, against these 19 kb. 400 kb does not fit: this contig is 250 kb,
 * which caps the sweep at 100 kb and is the reason the corpus, not the harness,
 * is what stands between this repo and that comparison.
 */
const tile = (kb: number) => {
  const width = kb * 1000
  const out: number[][] = []
  for (let start = 30000; start + width <= CONTIG; start += width) {
    out.push([start, start + width])
  }
  return out
}

export const WINDOW_KB = process.env.WINDOW_KB
  ? Number(process.env.WINDOW_KB)
  : undefined

export const WINDOWS = WINDOW_KB ? tile(WINDOW_KB) : DEFAULT_WINDOWS

/**
 * The first window is the end-to-end arm's initial render — what spawns the
 * pool and instantiates its wasm — so it is never timed. A wide set is only
 * two or three across this contig, and dropping one of those would leave too
 * little to take a median over, so those are all timed; the standalone arm has
 * its pool up from page load regardless.
 */
export const TIMED = WINDOWS.length > 3 ? WINDOWS.slice(1) : WINDOWS

export const DEFAULT_TRACKS = [
  '20x.shortread.bam',
  '200x.shortread.bam',
  '1000x.shortread.bam',
  '20x.longread.bam',
  '200x.longread.bam',
  '1000x.longread.bam',
  'variants.pool.100.wide.vcf.gz',
  'variants.pool.1000.wide.vcf.gz',
  'variants.pool.3000.wide.vcf.gz',
  'variants.pool.100.gtonly.vcf.gz',
  'variants.pool.1000.gtonly.vcf.gz',
  'variants.pool.3000.gtonly.vcf.gz',
]

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

export const WINDOWS = [
  [30000, 49000],
  [60000, 79000],
  [90000, 109000],
  [124000, 143000],
  [155000, 174000],
  [185000, 204000],
]

export const TIMED = WINDOWS.slice(1)

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

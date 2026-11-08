# bigChain + bigLink beside PIF, hs1-to-mm39

Measured 2026-11-08 for reviewer 1's comment 6 on the JBrowse 2 v5 paper, which
asks for a comparison of PIF with UCSC bigChain/bigLink. Script:
`scripts/pif/bigchain-bytes.ts`; raw output: `bigchain-vs-pif.json` beside this
file.

## Files

UCSC does not host the hs1-to-mm39 chains as bigChain/bigLink. The GenArk hub
for GCA_009914755.4
(https://hgdownload.soe.ucsc.edu/hubs/GCA/009/914/755/GCA_009914755.4/hub.txt)
carries bigChain tracks only against the HG002 pat/mat assemblies, and the hs1
database's bigChain files
(https://hgdownload.soe.ucsc.edu/gbdb/hs1/bbi/) are `chainHg38.bb`,
`chainHg19.bb`, the HG002 pair and their `Link.bb` companions; hs1's mm39 chain
track is a MySQL table, not a bigBed. The reverse liftOver file
(`mm39/liftOver/mm39ToHs1.over.chain.gz`) is not published at all (404), so
there is nothing to build a mm39-indexed pair from.

So the pair was built from the same chains the paper's PIF was made from, with
UCSC's own tools:

- input: https://hgdownload.soe.ucsc.edu/goldenPath/hs1/liftOver/hs1ToMm39.over.chain.gz
  (71,312,314 bytes, md5 cffb7e959cd5b4d8ba1567e4209e95b2, last modified
  2022-09-27; 75,076 chains, 30,985,873 aligned blocks)
- chrom sizes: https://hgdownload.soe.ucsc.edu/goldenPath/hs1/bigZips/hs1.chrom.sizes.txt
- autoSql: https://genome.ucsc.edu/goldenPath/help/examples/bigChain.as and
  https://genome.ucsc.edu/goldenPath/help/examples/bigLink.as
- tools: `chainToBigChain` from
  https://hgdownload.soe.ucsc.edu/admin/exe/linux.x86_64/chainToBigChain and
  `bedToBigBed` (installed, same directory), as in
  https://genome.ucsc.edu/goldenPath/help/bigChain.html

```
gzip -dc hs1ToMm39.over.chain.gz > hs1ToMm39.over.chain
chainToBigChain hs1ToMm39.over.chain bigChain.pre bigLink.pre
bedToBigBed -type=bed6+6 -as=bigChain.as -tab bigChain.pre hs1.chrom.sizes hs1ToMm39.bigChain.bb
bedToBigBed -type=bed4+1 -as=bigLink.as -tab bigLink.pre hs1.chrom.sizes hs1ToMm39.bigLink.bb
```

The build took 20 s for chainToBigChain (3.9 GB resident) and 45 s for the
bigLink bedToBigBed; the two `.pre` files were 6.5 MB and 1.12 GB.

| file | bytes | items | zoom levels (bp per bin) |
| --- | ---: | ---: | --- |
| hs1ToMm39.bigChain.bb (md5 30a717b2a5449cd1251379cf04c2d59a) | 2,403,714 | 75,076 | 7: 176,928 to 724,697,088 |
| hs1ToMm39.bigLink.bb (md5 234a1d9920a9120b04054ce003fb2729) | 260,780,372 | 30,985,873 | 10: 480 to 125,829,120 |
| hs1ToMm39.over.chain.pif.gz, hosted | 135,158,383 | 75,076 chains x 4 tiers | none; coarsened T/Q tiers |
| hs1ToMm39.over.chain.pif.gz.tbi | 816,271 | | |

The PIF is https://jbrowse.org/genomes/hs1_vs_mm39/hs1ToMm39.over.chain.pif.gz,
the file the paper's `tab:pif` describes.

## Method

```
node --max-old-space-size=4096 --experimental-strip-types scripts/pif/bigchain-bytes.ts \
  --bigchain hs1ToMm39.bigChain.bb --biglink hs1ToMm39.bigLink.bb \
  --pif https://jbrowse.org/genomes/hs1_vs_mm39/hs1ToMm39.over.chain.pif.gz \
  --window chr1:195700000-196700000 --json results/paper/bigchain-vs-pif.json
```

The readers are the ones JBrowse uses, @gmod/bbi 12.2.0 for the bigBeds and
@gmod/tabix 3.13 for the PIF, behind a filehandle that counts every `read()`
call and the bytes it returned. A `read()` is one Range request for a remote
file; the bigBeds were read from local disk and the PIF from jbrowse.org, and
the counts do not depend on which. Each view opens each file fresh, so the
header and index reads of a cold reader are counted every time.

Views:

- whole genome: every sequence in the file (25, chrM included) asked for its
  full span at 2,000 px across the 3.12 Gb genome, 1,558,646 bp/px
- 1 Mb window: hs1 chr1:195,700,000-196,700,000, the CFH locus (CFH through
  CFHR5; hs1 carries the CFHR3-CFHR1 deletion), the hs1 counterpart of the
  CFHR3-CFHR1 locus the paper's `tab:gbz-requests` uses for its 1 Mb window

bigBed has two whole-genome routes and both are reported. @gmod/bbi's
`BigBed` reads the unzoomed items at every scale, so "full items" is what
JBrowse transfers. A reader that drew from the file's zoom levels, as the UCSC
browser does when it shows a bigBed as coverage, reads summary bins; "summary
bins" opens the same file through the `BigWig` class, which picks the zoom
level for the scale the way bigWig readers do (the coarsest level at or below
2 x bp/px). Summary bins hold per-bin item counts and coverage, not chain
geometry, so that route cannot draw a synteny ribbon.

The PIF's whole genome reads the coarsened `T` tier (hs1 side), the tier the
synteny track reads above its 10 kb/px threshold; the window reads the
full-CIGAR `t` tier.

## Results

| file | view | route | requests | bytes | items |
| --- | --- | --- | ---: | ---: | ---: |
| bigChain.bb | whole genome | full items | 30 | 2,056,784 | 75,076 chains |
| bigChain.bb | whole genome | summary bins (2,830,848 bp) | 30 | 208,785 | 1,103 bins |
| bigLink.bb | whole genome | full items | 55 | 217,383,949 | 30,985,873 blocks |
| bigLink.bb | whole genome | summary bins (1,966,080 bp) | 30 | 241,881 | 1,629 bins |
| PIF | whole genome | coarsened T tier | 26 | 5,562,543 | 75,076 records |
| bigChain.bb | 1 Mb window | full items | 6 | 38,969 | 44 chains |
| bigLink.bb | 1 Mb window | full items | 7 | 89,673 | 9,790 blocks |
| PIF | 1 Mb window | full-CIGAR t tier | 2 | 2,045,272 | 44 records |

PIF rows include the 816,271-byte Tabix index, read once per cold open: the
whole-genome data is 4,746,272 bytes in 25 requests, the window's 1,229,001
bytes in 1.

Side by side, with the paper's `tab:pif` number for the same view:

| view | PIF (paper, index-derived) | PIF (reader, incl. index) | bigChain + bigLink, full items | bigChain + bigLink, summary bins |
| --- | ---: | ---: | ---: | ---: |
| whole genome | 3.1 MB (T tier) | 5.56 MB, 26 requests | 219.4 MB, 85 requests | 0.45 MB, 60 requests (no geometry) |
| 1 Mb window | not in the paper | 2.05 MB, 2 requests | 0.13 MB, 13 requests | |

## Reading the numbers

- The reader's whole-genome T figure is 4,746,272 bytes against the paper's
  3,107,872 chunk union: the difference is exactly 25 x 65,536. @gmod/tabix
  reads each reference's chunk through the end of its last BGZF block, one
  full block per reference. The paper's figure is the data the records
  occupy; the reader's is the transfer.
- bigChain alone (one row per chain: target span, query span, score) is 2.06
  MB for the whole genome, under the PIF's coarsened tier. It draws one
  rectangle or ribbon per chain with no gap structure, and a chain here spans
  up to a chromosome arm. The gap structure is in bigLink, and reading
  bigLink's items for the whole genome is 217 MB: bigBed zoom levels summarize
  coverage, so there is no coarsened geometry to fall back to. The PIF's
  coarsened tier carries the chain geometry folded to a stated bound (10 kb,
  with the deviation measured in the paper's supplementary figure) in 4.7 MB.
- In the 1 Mb window the bigBed pair wins on bytes, 0.13 MB against 1.23 MB of
  data plus the 0.82 MB index. bigLink stores every aligned block as its own
  interval, so a window reads only the blocks inside it; a PIF record is a
  whole chain with its full CIGAR, so a window reads every chain that overlaps
  it in full, and 44 chains overlap this one, among them long ones. The paper
  should say this.
- bigChain is indexed on the target genome only. Answering the same views from
  the mm39 side needs a second pair built from the reverse chains, which UCSC
  does not publish for this pair; the one PIF answers both sides (its Q/q
  tiers).
- Request counts: @gmod/bbi reads the header, the chromosome B-tree and the
  R-tree nodes for each query, and coalesces adjacent data blocks; a cold
  whole-genome pass is 30 requests per bigBed. The PIF is one index read plus
  one data request per reference.

# Supplementary comparison table, draft for reviewer 2 comment 4

Checked 8 November 2026 against each tool's own documentation or source at
the version named. "Version" is the newest release (or, where a project has
none, the newest commit on its default branch). The JBrowse 2 row comes from
`paper.tex` (Method and Results), which describes v5.0.0; the newest tag on
GitHub is v5.0.0-beta.20 (3 November 2026).

Column key:
- Browser: interactive in a web browser (pan, zoom)
- Pileup: BAM/CRAM read pileup
- Rows+cluster: one row per sample, and clustering or similarity ordering of
  the rows inside the tool
- 3+ genomes: three or more genomes in one synteny view
- CIGAR: base-level alignment drawn from CIGAR (reads, genome-to-genome)
- Graph+ref: pangenome graph linked to reference coordinates
- Config plots: plots defined in configuration (marks bound to data fields)
- Vector: SVG or PDF export
- Backend: what draws the pixels

| Tool | Version (month) | Browser | Pileup | Rows+cluster | 3+ genomes | CIGAR | Graph+ref | Config plots | Vector | Backend |
|---|---|---|---|---|---|---|---|---|---|---|
| JBrowse 2 | v5.0.0 (paper) | yes (also Electron desktop) | yes, BAM and CRAM | yes, hierarchical clustering in WebGPU, WASM fallback | yes | yes, reads and genome-to-genome | yes, rGFA or GFA indexed by gfa-to-tabix | yes | yes, SVG | WebGPU, WebGL 2, Canvas 2D fallback |
| igv.js | 3.8.10 (Oct 2026) | yes | yes, BAM and CRAM | partial, row per sample, sort and group, no clustering | no | yes, reads | no | no | yes, SVG | Canvas 2D |
| IGV desktop | 2.19.8 (Jun 2026); 3.0 beta 8 (Nov 2026) | no, Java desktop | yes, BAM and CRAM | partial, row per sample, sort and group, no clustering of VCF rows | no | yes, reads | no | no | yes, SVG | Java2D |
| UCSC Genome Browser | v505 (Oct 2026) | partial, server images with drag and zoom controls | yes, BAM and CRAM | yes, VCF haplotype sorting by local similarity | partial, many species as rows against one reference (multiz), no multi-genome ribbons | yes reads; partial genome-to-genome (halSnake substitutions, bigChain/bigPsl from sequence) | no | no | yes, PDF | server-side PNG |
| GenomeSpy | 1.3.0 (Nov 2026) | yes | partial, BAM only | partial, sort, filter and group; dendrogram from a precomputed tree, no clustering | no | yes, reads | no | yes | yes, SVG | WebGL 2, Canvas 2D fallback (WebGPU prototype, unreleased) |
| HiGlass | 2.3.5 (Jun 2026) | yes | partial, BAM via higlass-pileup plugin | partial, multivec rows with sort and filter, no clustering | no | partial, reads, plugin only | no | no | yes, SVG | PixiJS 5/6 WebGL (Canvas option) |
| Gosling | 1.0.7 (Dec 2025); 2.0.0-alpha.11 (Oct 2026) | yes | partial, BAM only | partial, row channel per field value, no clustering | no | partial, reads; worker parses CIGAR, spec must draw it | no | yes | no, PNG and raster PDF | PixiJS 6 WebGL via HiGlass (alpha: PixiJS 7) |
| D-GENIES | 1.5.0 (May 2023); 2.0b2 tag (Jun 2026) | yes | no | no | no, one query vs one target | no | no | no | yes, SVG | D3 SVG |
| SVbyEye | 0.99.0 (GitHub, Apr 2026 commit) | no, R | no | partial, plotAVA rows ordered by mismatch count | yes, all-vs-all stacked | yes, indels; mismatches collapsed | no | no, R code | yes, PDF and SVG via ggsave | ggplot2/grid |
| plotsr | 1.2.0 (Jul 2026) | no | no | no | yes | no | no | no | yes, PDF and SVG | matplotlib |
| ntSynt-viz | 1.1.5 (Oct 2026) | partial, HTML output with hover and click; static output primary | no | partial, genome rows ordered by a built NJ tree | yes | no | no, GFA converted to blocks | no | yes, PDF and SVG | ggplot2/gggenomes; ggiraph SVG for HTML |
| NGenomeSyn | 1.50B (Oct 2026) | no, CLI or Qt desktop GUI | no | no | yes | no | no | partial, styling only | yes, SVG (PDF from GUI) | static SVG from Perl |
| clinker | 0.0.32 (Dec 2025) | yes | no | partial, gene clusters ordered by hierarchical clustering before rendering | yes, gene clusters, not whole genomes | no, protein identity links | no | no | yes, SVG | D3 SVG |
| SynVisio | unversioned (master, Nov 2025) | yes | no | no | yes | no, MCScanX blocks | no | no | yes, SVG | SVG via React, d3 |
| Bandage | 0.9.0 (Jan 2022); Bandage-NG 2026.11.1 (Nov 2026) | no, Qt desktop | no | no | no | no | partial, graph without reference coordinates | no | yes, SVG | Qt QGraphicsScene |
| sequenceTubeMap | unversioned (master, Aug 2025) | yes | no, GAM/GAF reads | no | partial, haplotype paths through one graph | partial, edits from GAM/GAF, not BAM CIGAR | yes | no | yes, SVG | D3 SVG |
| MoMI-G | 1.0 Rev.1 (Jan 2019) | yes | yes, BAM via pileup.js | no | no | partial, inherited from pileup.js and tube map | yes | no | yes, SVG (tube map) | D3 SVG; pileup.js |
| Panache | 1.1.0 (Apr 2022) | yes | no | yes, HAC on presence/absence | no | no | partial, linearized matrix, no graph drawn | no | no | SVG via Vue; Canvas 2D miniature |

## Per-row sources

### JBrowse 2 (v5.0.0, as described in `paper.tex`)
- Browser and desktop: `paper.tex` Discussion l.625 ("single interactive application"), Method l.401-412 (JBrowse Desktop, JBrowse Web)
- Pileup: Method l.103-112 (BAM 4-bit decoding, CRAM codecs); benchmark l.419
- Rows+cluster: Method l.143-155 (row per sample or haplotype, hierarchical clustering in WebGPU compute shaders, WASM fallback)
- 3+ genomes: Method l.166-179 (linear synteny view stacks several genomes); Results l.517 (five genomes), l.519 (44 rows)
- CIGAR: Method l.176-178 (genome alignments, "insertions, deletions, and exact matches ... at base resolution"); SV section l.340-360 (read-level)
- Graph+ref: Method l.215-230 (graph nodes projected as a track below the reference), l.232-300 (rGFA, gfa-to-tabix)
- Config plots: Method l.375-389
- Vector: Method l.120 (vector SVG), l.393-396 (`@jbrowse/img`, "Export SVG")
- Backend: Method l.116-122 (Slang to WGSL and GLSL ES, Canvas/SVG painters); Discussion l.640 (WebGPU, WebGL 2, HTML5 Canvas backends)
- Version: https://github.com/GMOD/jbrowse-components/releases (v5.0.0-beta.20, 3 Nov; no final v5.0.0 tag yet)

### igv.js 3.8.10 (October 2026)
- Version: https://github.com/igvteam/igv.js/releases ; https://registry.npmjs.org/igv
- Browser: https://raw.githubusercontent.com/igvteam/igv.js/master/README.md
- Pileup, CIGAR: https://igv.org/doc/igvjs/tracks/Alignment-Track/
- Rows+cluster: https://igv.org/doc/igvjs/tracks/Variant-Track/ ; https://igv.org/doc/igvjs/SampleInfo/ ; https://github.com/igvteam/igv.js/blob/master/js/variant/variantTrack.js
- 3+ genomes, Graph+ref: https://igv.org/doc/igvjs/ ; https://igv.org/doc/igvjs/Browser-API/
- Config plots: https://igv.org/doc/igvjs/tracks/Wig-Track/
- Vector: https://igv.org/doc/igvjs/Browser-API/ (`toSVG()`); https://github.com/igvteam/igv.js/blob/master/js/browser.js
- Backend: https://github.com/igvteam/igv.js/blob/master/js/trackViewport.js (`getContext("2d")`)

### IGV desktop 2.19.8 (June 2026); 3.0 Beta 8 (November 2026)
- Version: https://igv.org/doc/desktop/DownloadPage/ ; https://github.com/igvteam/igv/tags ; https://igv.org/doc/desktop/ReleaseNotes/3.0.x/
- Browser: https://igv.org/doc/desktop/
- Pileup, CIGAR: https://igv.org/doc/desktop/UserGuide/tracks/alignments/viewing_alignments_basics/
- Rows+cluster: https://igv.org/doc/desktop/UserGuide/tracks/vcf/ ; https://github.com/igvteam/igv/blob/master/src/main/java/org/igv/alignment/AlignmentTrackMenuHelper.java (the only "cluster" is for reads)
- 3+ genomes: https://igv.org/doc/desktop/UserGuide/reference_genome/
- Graph+ref, Config plots: https://igv.org/doc/desktop/FileFormats/DataTracks/
- Vector: https://igv.org/doc/desktop/UserGuide/saving_images/ ; https://github.com/igvteam/igv/blob/master/src/main/java/org/igv/ui/util/SnapshotUtilities.java
- Backend: https://github.com/igvteam/igv/blob/master/src/main/java/org/igv/track/RenderContext.java

### UCSC Genome Browser v505 (October 2026)
- Version: https://genecats.gi.ucsc.edu/builds/versions-all/v505.html ; https://genome.ucsc.edu/goldenPath/newsarch.html
- Browser, 3+ genomes (chain/net pairwise), CIGAR (halSnake), Vector: https://genome.ucsc.edu/goldenPath/help/hgTracksHelp.html
- Pileup: https://genome.ucsc.edu/goldenPath/help/cram.html ; https://genome.ucsc.edu/goldenPath/help/bam.html ; mismatches https://genome.ucsc.edu/goldenPath/help/hgBamTrackHelp.html
- Rows+cluster: https://genome.ucsc.edu/goldenPath/help/vcf.html (`hapClusterEnabled`, `hapClusterMethod`)
- 3+ genomes (multiz rows): https://genome.ucsc.edu/cgi-bin/hgTrackUi?db=hg38&g=cons100way
- CIGAR (bigChain/bigPsl `baseColorUseSequence`), Graph+ref, Config plots: https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html
- Backend, Vector: https://github.com/ucscGenomeBrowser/kent/blob/master/src/hg/hgTracks/hgTracks.c (`hvGfxOpenPng`, `convertEpsToPdf`)

### GenomeSpy 1.3.0 (November 2026)
- Version: https://github.com/genome-spy/genome-spy/releases ; https://www.npmjs.com/package/@genome-spy/core
- Browser, Config plots: https://genomespy.app/ ; https://genomespy.app/docs/grammar/
- Pileup, Graph+ref: https://genomespy.app/docs/grammar/data/lazy/ ; https://genomespy.app/docs/examples/genomic-data/bam-read-alignments/
- Rows+cluster: https://genomespy.app/docs/sample-collections/analyzing/ ; https://genomespy.app/docs/grammar/transform/dendrogram/
- 3+ genomes: https://genomespy.app/docs/examples/
- CIGAR: https://genomespy.app/docs/grammar/transform/ (`flattenCigar`, `alignmentMismatches`)
- Vector: https://genomespy.app/docs/api/instance/ (`imageExport.svg()`)
- Backend: https://genomespy.app/docs/api/embed-options/ (`renderer: auto | canvas | webgl`); https://raw.githubusercontent.com/genome-spy/genome-spy/master/packages/core/CHANGELOG.md (WebGPU "development-only")

### HiGlass 2.3.5 (June 2026)
- Version: https://www.npmjs.com/package/higlass ; https://github.com/higlass/higlass/blob/develop/CHANGELOG.md
- Browser: https://github.com/higlass/higlass/blob/develop/README.md
- Pileup, CIGAR: https://github.com/higlass/higlass-pileup/blob/master/README.md ; https://raw.githubusercontent.com/higlass/higlass-pileup/master/src/bam-utils.js
- Rows+cluster, 3+ genomes, Graph+ref: https://docs.higlass.io/track_types.html
- Config plots: https://docs.higlass.io/plugin_track.html
- Vector: https://docs.higlass.io/javascript_api.html (`exportAsSvg()`); https://raw.githubusercontent.com/higlass/higlass/develop/app/scripts/ConfigViewMenu.jsx
- Backend: https://registry.npmjs.org/higlass/2.3.5 (pixi.js ^5 || ^6); https://raw.githubusercontent.com/higlass/higlass/develop/app/scripts/HiGlassComponent.jsx

### Gosling 1.0.7 (December 2025); 2.0.0-alpha.11 (October 2026)
- Version: https://www.npmjs.com/package/gosling.js ; https://github.com/gosling-lang/gosling.js/releases/tag/v2.0.0-alpha.11
- Browser: https://raw.githubusercontent.com/gosling-lang/gosling.js/v1.0.7/README.md
- Pileup, Rows+cluster, Graph+ref: https://gosling-lang.org/docs/data ; https://gosling-lang.org/examples/
- 3+ genomes: https://gosling-lang.org/docs/genome-builds ; https://gosling-lang.org/docs/mark
- CIGAR: https://raw.githubusercontent.com/gosling-lang/gosling.js/v1.0.7/src/data-fetchers/bam/bam-worker.ts ; https://raw.githubusercontent.com/gosling-lang/gosling.js/v1.0.7/editor/example/json-spec/pileup.ts
- Config plots: https://gosling-lang.org/docs/mark
- Vector: https://gosling-lang.org/docs/js-api ; https://raw.githubusercontent.com/gosling-lang/gosling.js/v1.0.7/src/api/api.ts (`exportPdf` embeds a JPEG)
- Backend: https://registry.npmjs.org/gosling.js/1.0.7 (higlass ^1.13.4, pixi.js ^6.3.0)

### D-GENIES 1.5.0 (May 2023); tags v2.0b1/v2.0b2 (2026) without releases
- Version: https://github.com/genotoul-bioinfo/dgenies/releases ; https://pypi.org/project/dgenies/
- Browser, Rows+cluster, Config plots, Vector: https://raw.githubusercontent.com/genotoul-bioinfo/dgenies/master/src/dgenies/md/user_manual.md
- Pileup, 3+ genomes: https://dgenies.toulouse.inra.fr/documentation/run
- CIGAR: https://raw.githubusercontent.com/genotoul-bioinfo/dgenies/master/src/dgenies/lib/paf.py (cg tag never read)
- Backend: https://raw.githubusercontent.com/genotoul-bioinfo/dgenies/master/src/dgenies/static/js/d3.dgenies.js

### SVbyEye 0.99.0 (GitHub master, April 2026 commit; no release)
- Version: https://raw.githubusercontent.com/daewoooo/SVbyEye/master/DESCRIPTION ; https://github.com/daewoooo/SVbyEye/tags
- Browser, Pileup, Graph+ref, Config plots: https://raw.githubusercontent.com/daewoooo/SVbyEye/master/vignettes/SVbyEye.Rmd
- Rows+cluster, 3+ genomes: https://raw.githubusercontent.com/daewoooo/SVbyEye/master/R/plotAVA.R
- CIGAR: https://raw.githubusercontent.com/daewoooo/SVbyEye/master/R/plotMiro.R ; .../R/breakPafAlignment.R ; .../R/cigarUtils.R
- Vector, Backend: https://raw.githubusercontent.com/daewoooo/SVbyEye/master/NAMESPACE (ggplot2 geoms, grid)

### plotsr 1.2.0 (July 2026)
- Version: https://github.com/schneebergerlab/plotsr/releases
- Browser, Vector, Backend: https://raw.githubusercontent.com/schneebergerlab/plotsr/master/plotsr/plotsr.py
- Pileup, Rows+cluster, 3+ genomes: https://raw.githubusercontent.com/schneebergerlab/plotsr/master/README.md
- CIGAR, Graph+ref: https://raw.githubusercontent.com/schneebergerlab/plotsr/master/plotsr/func.py
- Config plots: https://raw.githubusercontent.com/schneebergerlab/plotsr/master/config/base.cfg

### ntSynt-viz 1.1.5 (October 2026)
- Version: https://github.com/bcgsc/ntSynt-viz/releases
- Browser, 3+ genomes: https://raw.githubusercontent.com/bcgsc/ntSynt-viz/main/README.md
- Pileup, CIGAR, Config plots, Vector: https://raw.githubusercontent.com/bcgsc/ntSynt-viz/main/bin/ntsynt_viz.py
- Rows+cluster: https://raw.githubusercontent.com/bcgsc/ntSynt-viz/main/bin/ntsynt_viz.smk (`make_nj_tree`); .../bin/ntsynt_viz_synteny_distance_estimation.py
- Graph+ref: https://github.com/bcgsc/ntSynt-viz/tree/main/conversion_scripts
- Backend: https://raw.githubusercontent.com/bcgsc/ntSynt-viz/main/bin/ntsynt_viz_plot_synteny_blocks_ribbon_plot.R ; .../bin/ntsynt_viz_ribbon-webgl.js (WebGL for hit-picking only)

### NGenomeSyn 1.50B (October 2026)
- Version: https://github.com/hewm2008/NGenomeSyn/releases
- Browser: https://raw.githubusercontent.com/hewm2008/NGenomeSyn/main/gui/ui/preview.py (QtSvg desktop preview); README GUI section
- Pileup, Rows+cluster, 3+ genomes, Graph+ref, Config plots: https://github.com/hewm2008/NGenomeSyn (README, conf example); https://raw.githubusercontent.com/hewm2008/NGenomeSyn/main/bin/in-En.conf
- CIGAR, Vector, Backend: https://raw.githubusercontent.com/hewm2008/NGenomeSyn/main/bin/NGenomeSyn (Perl `SVG` module, ImageMagick convert)

### clinker 0.0.32 (December 2025)
- Version: https://pypi.org/project/clinker/ ; https://github.com/gamcil/clinker/releases
- Browser, Backend: https://raw.githubusercontent.com/gamcil/clustermap.js/master/src/clusterMap.js
- Pileup, 3+ genomes, Graph+ref: https://github.com/gamcil/clinker (README)
- Rows+cluster, CIGAR: https://raw.githubusercontent.com/gamcil/clinker/master/clinker/align.py (scipy ward linkage; protein identity)
- Config plots, Vector: https://raw.githubusercontent.com/gamcil/clinker/master/clinker/plot/clinker.js

### SynVisio (no release; master commit ac4fc61, November 2025)
- Version: https://github.com/kiranbandi/synvisio/releases ; https://raw.githubusercontent.com/kiranbandi/synvisio/master/package.json
- Browser, Pileup, 3+ genomes, Vector: https://raw.githubusercontent.com/kiranbandi/synvisio/master/src/pages/Home.jsx
- Rows+cluster: https://raw.githubusercontent.com/kiranbandi/synvisio/master/src/redux/actions/actions.jsx
- 3+ genomes (stacked rows): https://raw.githubusercontent.com/kiranbandi/synvisio/master/src/components/TreeView/index.jsx
- CIGAR, Backend: https://raw.githubusercontent.com/kiranbandi/synvisio/master/src/components/GenomeView/index.jsx
- Vector: https://raw.githubusercontent.com/kiranbandi/synvisio/master/src/components/Misc/SaveModal.jsx

### Bandage 0.9.0 (January 2022); Bandage-NG 2026.11.1 (November 2026)
- Version: https://github.com/rrwick/Bandage/releases ; https://github.com/asl/BandageNG/releases
- Browser: https://github.com/rrwick/Bandage/blob/main/README.md
- Pileup, Rows+cluster, 3+ genomes, CIGAR, Graph+ref: https://github.com/rrwick/Bandage/wiki ; https://rrwick.github.io/Bandage/
- Config plots, Vector (CLI): https://github.com/rrwick/Bandage/wiki/Command-line
- Vector (GUI): https://raw.githubusercontent.com/rrwick/Bandage/main/ui/mainwindow.cpp (`QSvgGenerator`)
- Backend: https://raw.githubusercontent.com/rrwick/Bandage/main/ui/mygraphicsscene.h

### sequenceTubeMap (no release; master commit August 2025)
- Version: https://github.com/vgteam/sequenceTubeMap/releases ; https://raw.githubusercontent.com/vgteam/sequenceTubeMap/master/package.json
- Browser: https://github.com/vgteam/sequenceTubeMap/blob/master/README.md
- Pileup, Graph+ref: https://raw.githubusercontent.com/vgteam/sequenceTubeMap/master/src/server.mjs
- Rows+cluster, Config plots: https://raw.githubusercontent.com/vgteam/sequenceTubeMap/master/src/components/HeaderForm.js
- CIGAR, Backend, Graph+ref (ruler): https://raw.githubusercontent.com/vgteam/sequenceTubeMap/master/src/util/tubemap.js
- Vector: https://raw.githubusercontent.com/vgteam/sequenceTubeMap/master/src/components/DataPositionFormRow.js

### MoMI-G 1.0 Rev.1 (January 2019; dependency bumps through October 2026)
- Version: https://github.com/MoMI-G/MoMI-G/blob/master/README.md ; https://raw.githubusercontent.com/MoMI-G/MoMI-G/master/package.json
- Browser, Graph+ref, 3+ genomes, Vector (BED export): https://momi-g.readthedocs.io/en/latest/view_modules.html
- Pileup, Rows+cluster, Config plots: MoMI-G `docs/source/configure_file.rst` (https://momi-g.readthedocs.io/en/latest/); https://raw.githubusercontent.com/MoMI-G/MoMI-G/master/src/widgets/Linear.tsx
- CIGAR: https://raw.githubusercontent.com/MoMI-G/MoMI-G/master/src/widgets/tubemap.js (`drawMismatches`)
- Vector (SVG), Backend: https://raw.githubusercontent.com/MoMI-G/MoMI-G/master/src/widgets/SequenceTubeMap.tsx ; .../src/widgets/Circos.tsx

### Panache 1.1.0 (April 2022)
- Version: https://github.com/SouthGreenPlatform/panache/releases/tag/v1.1.0
- Browser: https://github.com/SouthGreenPlatform/panache/blob/main/README.md ; https://github.com/SouthGreenPlatform/panache/wiki/Functionalities-tour
- Pileup, Graph+ref: https://github.com/SouthGreenPlatform/panache/wiki/Files-&-formats
- Rows+cluster: https://github.com/SouthGreenPlatform/panache/wiki/Sorting-options ; https://raw.githubusercontent.com/SouthGreenPlatform/panache/main/src/components/SortOption_LocalPavPattern.vue
- CIGAR: Functionalities-tour (no nucleotide-level zoom)
- Vector: https://raw.githubusercontent.com/SouthGreenPlatform/panache/main/src/components/ExportLocalRegionAnnotated.vue (TSV only)
- Backend: https://raw.githubusercontent.com/SouthGreenPlatform/panache/main/src/components/PavMatrix.vue

## Cells that needed a judgement

- "Rows+cluster" is "partial" wherever a tool orders rows by similarity
  without a clustering step the user can run (igv.js, IGV, GenomeSpy,
  HiGlass, Gosling), or clusters before rendering rather than inside the
  view (clinker, ntSynt-viz, SVbyEye). Only UCSC (hapCluster), Panache (HAC)
  and JBrowse 2 cluster rows inside the tool.
- "3+ genomes" is "yes" for clinker only in the gene-cluster sense; the row
  says so.
- No cell is "unverified". Bandage-NG's GAF/CIGAR loaders are present in
  source but undocumented, so the Bandage row reports Bandage 0.9.0 and the
  note names the fork.

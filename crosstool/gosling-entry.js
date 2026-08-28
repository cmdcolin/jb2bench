// Bundle entry for the Gosling harness page.
//
// gosling.js ships as ESM with bare specifiers (`react`, `pixi.js`, `higlass`,
// `lodash-es`, ...), so a browser cannot load it out of node_modules the way it
// loads igv.js and GenomeSpy — both of which ship a self-contained bundle this
// repo symlinks straight into crosstool/. Gosling has to be bundled first, and
// `make crosstool-bundles` is what does it.
//
// The bundle is generated, so it is gitignored like the corpus. gosling.html
// refuses to run without it rather than painting an empty frame.
export { embed } from 'gosling.js'

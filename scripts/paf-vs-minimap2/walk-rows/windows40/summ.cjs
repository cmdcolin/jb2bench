const fs=require("fs");
const rows=fs.readFileSync(process.argv[2],"utf8").trim().split("\n").map(JSON.parse).filter(r=>r.kind==="parity");
const by=new Map();
for(const r of rows){const k=r.locus+" "+(r.end-r.start);const g=by.get(k)??{n:0,walk:0,paf:0,same:0,wc:0,pc:0,exact:0,refused:r.refused};by.set(k,g);if(!r.refused){g.n++;g.walk+=r.walkBp;g.paf+=r.pafBp;g.same+=r.sameDiagonalBp;g.wc+=r.walkCoveredRef;g.pc+=r.pafCoveredRef;if(r.walkBp===r.pafBp&&r.pafBp===r.sameDiagonalBp)g.exact++}}
console.log("window\tlanes\texact\twalkBp\tpafBp\tsame\twalkCov\tpafCov\tsame/walk\tsame/paf");
const T={walk:0,paf:0,same:0,n:0,exact:0,wc:0,pc:0};
for(const [k,g] of by){console.log([k,g.n,g.exact,g.walk,g.paf,g.same,g.wc,g.pc,(g.same/g.walk).toFixed(5),(g.same/g.paf).toFixed(5),g.refused??""].join("\t"));T.walk+=g.walk;T.paf+=g.paf;T.same+=g.same;T.n+=g.n;T.exact+=g.exact;T.wc+=g.wc;T.pc+=g.pc}
console.log(JSON.stringify(T), (T.same/T.walk).toFixed(6),(T.same/T.paf).toFixed(6));

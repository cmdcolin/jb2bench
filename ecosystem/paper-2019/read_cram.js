/* 
 * Sample call
 * node read_cram.js -r ../test_data/GRCh38_full_analysis_set_plus_decoy_hla.fa -c ../test_data/NA12878.alt_bwamem_GRCh38DH.20150718.CEU.low_coverage.cram --id 0 -s 10000 -e 20000
*/

const microtime = require('microtime')
const totTimeStart = microtime.nowDouble()

const program = require('commander');
const { IndexedCramFile, CramFile, CraiIndex } = require('@gmod/cram')
const { IndexedFasta, BgzipIndexedFasta } = require('@gmod/indexedfasta')

//Sample call
//node read_cram.js -r ../test_data/GRCh38_full_analysis_set_plus_decoy_hla.fa -c ../test_data/NA12878.alt_bwamem_GRCh38DH.20150718.CEU.low_coverage.cram --id 0 -s 10000 -e 20000

program
    .option('-r, --ref [ref_seq]', 'Ref sequence path')
    .option('-c, --cram [cram_file]', 'Cram file path')
    .option('--id [seq_id]', 'Sequence id (numerical)')
    .option('-s, --start [start]', 'Interval start')
    .option('-e, --end [end]', 'Interval end')
    .parse(process.argv);

const ref_path = program.ref
const cram_path = program.cram
const interval = {id: parseInt(program.id), start: parseInt(program.start), end: parseInt(program.end)}

//console.log('Executing Cram-JS with following reference, cram file and interval:');
//if (program.ref) console.log(ref_path);
//if (program.cram) console.log(cram_path);
//if (program.id && program.start && program.end) console.log(interval);


// open local files
const t = new IndexedFasta({
  path: ref_path,
  faiPath: `${ref_path}.fai`,
});

const indexedFile = new IndexedCramFile({
    cramPath: require.resolve(`${cram_path}`),
    index: new CraiIndex({
        path: require.resolve(`${cram_path}.crai`),
    }),
    seqFetch: async (seqId, start, end) => {
        return seq = await t.getResiduesById(seqId, start-1, end);
    },
    cacheSize: 50*20000,
    fetchSizeLimit: 50*1024*1024,
    checkSequenceMD5: false,
})

// example of fetching records from an indexed CRAM file.
// NOTE: only numeric IDs for the reference sequence are accepted


run = async () => {
    
    const runTimeStart = microtime.nowDouble()

    const records = await indexedFile.getRecordsForRange(interval.id,
        interval.start, interval.end)

    //Array.from(records).forEach(record => { 
    //    console.log(`got a record named ${record.readName}`) 
    //    if (record.hasOwnProperty('readFeatures')){
    //        record.readFeatures.forEach( ({ code, pos, refPos, data }) => {
    //            console.log(`${record.readName} has ${code} and ${data} associated at ${refPos}`,)
    //        }
    //        )
    //    }
    //})
    
    const runTime = microtime.nowDouble() - totTimeStart
    console.log(runTime)
}

run()
// can also pass `cramUrl`, and `url` params to open remote URLs

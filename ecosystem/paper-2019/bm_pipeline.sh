
# Downloads necessary benchmark data, runs the benchmark and generates plot of
# runtimes

# Get all benchmark data

wget -P test_data -nd -N -i bm_data_files.txt
wget -nc https://raw.githubusercontent.com/allanroscoche/PathTree/master/data/DH10B_WithDup_FinalEdit_validated.fasta -O ./test_data/DH10B_WithDup_FinalEdit_validated.fasta.txt 

# Convert the E coli bam file into a cram file (and create .crai file) and
# generate .fai for the ref sequences if needed

if [ ! -f ./test_data/DH10B_WithDup_FinalEdit_validated.fasta.txt.fai ]; then
    echo "Fasta index for reference E Coli not found, generating..."
    samtools faidx ./test_data/DH10B_WithDup_FinalEdit_validated.fasta.txt
fi

if [ ! -f ./test_data/GRCh38_full_analysis_set_plus_decoy_hla.fa.fai ]; then
    echo "Fasta index for reference human not found, generating..."
    samtools faidx ./test_data/GRCh38_full_analysis_set_plus_decoy_hla.fa
fi

if [ ! -f ./test_data/MiSeq_Ecoli_DH10B_110721_PF.bam.cram ]; then
    echo "Cram file for MiSeq E Coli not found, generating..."
    samtools view -h -C ./test_data/MiSeq_Ecoli_DH10B_110721_PF.bam
elif [ ! -f ./test_data/MiSeq_Ecoli_DH10B_110721_PF.bam.cram.crai ]; then
    echo "Cram index for MiSeq E Coli not found, generating..."
    samtools index ./test_data/MiSeq_Ecoli_DH10B_110721_PF.bam.cram
fi

# Run benchmark test (to change number of tests, edit num_tests in script;
# default is 100 tests)
python cram_js_benchmark.py

# Generate graph
python make_bm_plot.py

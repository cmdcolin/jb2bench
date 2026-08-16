#!/usr/bin/env python

'''
Compares CRAM-JS to samtools view for reading cram files

Input: Paths of reference sequences and cram files, output filename
Output: A tsv table containing times for each execution under different
conditions
'''
import os
import random
import subprocess

# Number of tests
num_tests = 100

# Paths to ref sequences and cram files
human_ref = './test_data/GRCh38_full_analysis_set_plus_decoy_hla.fa'
e_coli_ref = './test_data/DH10B_WithDup_FinalEdit_validated.fasta.txt'

human_low_coverage = './test_data/NA12878.alt_bwamem_GRCh38DH.20150718.CEU.low_coverage.cram'
human_exome = './test_data/NA12878.alt_bwamem_GRCh38DH.20150826.CEU.exome.cram' 
e_coli = './test_data/MiSeq_Ecoli_DH10B_110721_PF.bam.cram'

coverages = {human_low_coverage: 'low',
        human_exome: 'exome',
        e_coli: 'high',}

filepaths = [ [human_ref, human_low_coverage], [human_ref, human_exome],
        [e_coli_ref, e_coli] ]

chr_lengths = {0:239000000, 1:239000000, 2:199000000, 3:189000000, 4:179000000,
        5:169000000, 6:149000000, 7:139000000, 8:129000000, 9:129000000,
        10:129000000, 11:129000000, 12:109000000, 13:99000000, 14:99000000,
        15:89000000, 16:79000000, 17:69000000, 18:59000000, 19:59000000,
        20:39000000, 21:39000000, 22:149000000, 23:49000000}


class Condition:
    def __init__(self, filepaths, coverage, interval_query):
        self.ref_path = filepaths[0]
        self.cram_path = filepaths[1]
        self.filename = filepaths[1].split('/')[-1]
        self.filesize = float(os.path.getsize(self.cram_path))/(1024*1024)
        self.coverage = coverage
        self.seqid = interval_query[0]
        self.start = interval_query[1]
        self.end = interval_query[2]
        self.interval_length = self.end - self.start

    def append_output(self, output_dict, result):
        output_dict['Filename'].append(self.filename)
        output_dict['File Size'].append(self.filesize)
        output_dict['Coverage'].append(self.coverage)
        output_dict['Interval Length'].append(self.interval_length)

        output_dict['Samtools'].append(result[0])
        output_dict['CRAM-JS'].append(result[1])

def benchmark_wrapper(conditions):
    '''Wrapper function that calls samtools and the cramjs scripts with the
    given conditions and then outputs a pandas dataframe for writing'''

    import pandas

    output_data = {'Filename':[], 'File Size':[], 'Coverage':[], 'Interval Length':[], 'CRAM-JS':[], 'Samtools':[]}

    for condition in conditions:
        print('Running with conditions: name {0}, interval {1}:{2}:{3}'.format(
            condition.filename, condition.seqid, condition.start,
            condition.end))

        # Samtools
        samtools = exec_script('samtools', condition.ref_path,
                condition.cram_path, condition.seqid, condition.start,
                condition.end)
        
        # CRAM-JS
        cramjs = exec_script('cramjs', condition.ref_path,
                condition.cram_path, condition.seqid, condition.start,
                condition.end)

        result = [samtools, cramjs]
        condition.append_output(output_data, result)

    output_df = pandas.DataFrame(data=output_data)

    return output_df

def exec_script(tool, ref_path, cram_path, seqid, start, end):

    if tool == 'samtools':
        adj_seqid = None
        if seqid == 22:
            adj_seqid = 'chrX'
        elif seqid == 23:
            adj_seqid = 'chrY'
        elif 'Ecoli' in cram_path:
            adj_seqid = 'EcoliDH10B.fa'
        else:
            adj_seqid = 'chr{}'.format(seqid+1)

        samtools_comm = 'time samtools view -o samtools_buffer.txt -t {0} {1} {2}:{3}-{4}'.format(
                    ref_path, 
                    cram_path,
                    adj_seqid, start, end)

        output = subprocess.check_output(samtools_comm.split(' '),
                stderr=subprocess.STDOUT)

        time = output.decode('utf-8').split()[0]
        #print ('samtools:', time)
        return time

    elif tool == 'cramjs':
        cramjs_comm = 'node read_cram.js -r {0} -c {1} --id {2} -s {3} -e {4}'.format(
            ref_path,
            cram_path,
            seqid, start, end)

        output = subprocess.check_output(cramjs_comm.split(' '))
        time = output.decode('utf-8').strip()
        #print ('cramjs:', time)
        return time

def run_tests(num_tests):
    intervals = []  # Change intervals into a dict
    random.seed()
    for i in range(num_tests):
        for path in filepaths:
            seqid = None
            interval_start = None
            if 'Ecoli' in path[1]:
                seqid = 0
                interval_start = random.randrange(1, 4000000)
            else:
                seqid = random.randrange(24)
                interval_start = random.randrange(1, chr_lengths[seqid])

            interval_1000 = interval_start + 1000
            interval_10000 = interval_start + 10000
            interval_100000 = interval_start + 100000
            #interval_500000 = interval_start + 500000
        
            interval_ends = [interval_1000, interval_10000, interval_100000]
            for interval_end in interval_ends:
                intervals.append((path, (seqid, interval_start, interval_end)))

    conditions = []
    for interval in intervals:
        condition = Condition(interval[0], coverages[interval[0][1]], interval[1])
        conditions.append(condition)

    return conditions

conditions = run_tests(num_tests)
output_df = benchmark_wrapper(conditions)
output_df.to_csv('cram_js_runtime.tsv', sep='\t')

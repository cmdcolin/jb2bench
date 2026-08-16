#!/usr/bin/env python

'''
Makes a nice bar histogram that averages and displays the benchmark data

Input: TSV file with all the benchmark data
Output: An image with the graph
'''

import numpy as np
import matplotlib.pyplot as plt
import pandas 

# Get all the means and stds across the runtimes for each file over the random
# intervals

bm_df = pandas.read_table('cram_js_runtime.tsv')
#bm_df.to_latex('cram_js_runtime.tex')

grouped = bm_df.groupby(['Coverage', 'Interval Length'])

bm_means = grouped.mean()
bm_stds = grouped.std()

bm_est = { 'low':{}, 'exome':{}, 'high':{} }

for key in bm_est:
    cramjs_means = bm_means.loc[key]['CRAM-JS'].tolist()
    samtools_means = bm_means.loc[key]['Samtools'].tolist()
    
    cramjs_stds = bm_stds.loc[key]['CRAM-JS'].tolist()   
    samtools_stds = bm_stds.loc[key]['Samtools'].tolist()
    
    bm_est[key]['cramjs'] = [cramjs_means, cramjs_stds]
    bm_est[key]['samtools'] = [samtools_means, samtools_stds]

# bm_est['low'] -> {'cramjs': [means, stds], 'samtools':[means, stds]}

print ('Building figure...')
fig, axs = plt.subplots(1,3)

def make_axis(ax, title, means, stds):
    width = 0.35  # the width of the bars
    ind = np.arange(len(means[0]))  # the x locations for the groups

    rects1 = ax.bar(ind - width/2, means[0], width, yerr=stds[0],
                    color='SkyBlue', label='CRAM-JS')
    rects2 = ax.bar(ind + width/2, means[1], width, yerr=stds[1],
                    color='IndianRed', label='Samtools')

    # Add some text for labels, title and custom x-axis tick labels, etc.
    from matplotlib.ticker import FuncFormatter

    formatter = FuncFormatter(lambda y, _: '{:.16g}'.format(y))

    ax.set_ylabel('Runtime (seconds)')
    ax.set_title(title)
    ax.set_xticks(ind)
    ax.set_xlabel('Interval Length (# of bases)')
    ax.set_xticklabels(('1000', '10000', '100000'))
    ax.set_yscale('log')
    ax.yaxis.set_major_formatter(formatter)
    #ax.formatter.useoffset
    ax.legend(loc=2)

    return (rects1, rects2)

def autolabel(ax, rects, xpos='center'):
    """
    Attach a text label above each bar in *rects*, displaying its height.

    *xpos* indicates which side to place the text w.r.t. the center of
    the bar. It can be one of the following {'center', 'right', 'left'}.
    """

    xpos = xpos.lower()  # normalize the case of the parameter
    ha = {'center': 'center', 'right': 'left', 'left': 'right'}
    offset = {'center': 0.5, 'right': 0.57, 'left': 0.43}  # x_txt = x + w*off
    
    for rect in rects:
        height = round(rect.get_height(), 3)
        ax.text(rect.get_x() + rect.get_width()*offset[xpos], 1.01*height,
                '{}'.format(height), ha=ha[xpos], va='bottom')


titles = {'low':'Human Low Coverage', 'exome':'Human Exome', 
        'high':'E. Coli High Coverage'}

for ax, coverage in zip(axs, bm_est):
    cramjs_means = bm_est[coverage]['cramjs'][0]
    samtools_means = bm_est[coverage]['samtools'][0]
    cramjs_std = bm_est[coverage]['cramjs'][1]
    samtools_std = bm_est[coverage]['samtools'][1]

    rects = make_axis(ax, titles[coverage], (cramjs_means, samtools_means),
           (cramjs_std, samtools_std))

    autolabel(ax, rects[0], 'right')
    autolabel(ax, rects[1], 'right')

plt.subplots_adjust(wspace=0.4)
plt.show()
fig.savefig('benchmark_data_graph.png')

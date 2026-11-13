"""fetch_contig.py <sample#hap#contig> <asm_index.csv> <outdir>

One contig of an HPRC release 2 assembly by HTTP range request: the .fai gives
the contig's byte span in the uncompressed FASTA, the .gzi maps it to bgzip
block offsets, and one ranged GET of those blocks is inflated member by member.
Writes <outdir>/<sample>.<hap>.<contig>.fa (60-column lines).
"""
import csv
import os
import struct
import sys
import urllib.request
import zlib

name, index_csv, outdir = sys.argv[1:4]
sample, hap, contig = name.split('#', 2)
with open(index_csv, newline='') as fh:
    rows = [r for r in csv.DictReader(fh) if r['sample_id'] == sample and r['haplotype'] == hap]
assert len(rows) == 1, rows
url = 'https://s3-us-west-2.amazonaws.com/' + rows[0]['assembly'][len('s3://'):]
os.makedirs(os.path.join(outdir, 'index'), exist_ok=True)


def cached(suffix):
    path = os.path.join(outdir, 'index', os.path.basename(url) + suffix)
    if not os.path.exists(path):
        with urllib.request.urlopen(url + suffix) as r, open(path + '.part', 'wb') as out:
            out.write(r.read())
        os.rename(path + '.part', path)
    return path


fai = [l.split('\t') for l in open(cached('.fai'))]
entry = [l for l in fai if l[0] == name]
assert len(entry) == 1, name
length, offset, linebases, linewidth = (int(x) for x in entry[0][1:5])
nlines = -(-length // linebases)
ustart = offset
uend = offset + length + nlines * (linewidth - linebases)

gzi = open(cached('.gzi'), 'rb').read()
(nblocks,) = struct.unpack('<Q', gzi[:8])
blocks = [(0, 0)] + [struct.unpack('<QQ', gzi[8 + 16 * i:24 + 16 * i]) for i in range(nblocks)]
cstart = max(c for c, u in blocks if u <= ustart)
ustart_block = max(u for c, u in blocks if u <= ustart)
later = [c for c, u in blocks if u >= uend]
cend = min(later) - 1 if later else ''
print(f'{name}: {length} bp, uncompressed bytes {ustart}-{uend}, compressed range {cstart}-{cend}', file=sys.stderr)

req = urllib.request.Request(url, headers={'Range': f'bytes={cstart}-{cend}'})
out = bytearray()
upos = ustart_block
with urllib.request.urlopen(req) as r:
    data = b''
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    while True:
        chunk = r.read(1 << 20)
        if not chunk and not data:
            break
        data += chunk
        while data:
            piece = d.decompress(data)
            if piece:
                lo = max(ustart, upos)
                hi = min(uend, upos + len(piece))
                if hi > lo:
                    out += piece[lo - upos:hi - upos]
                upos += len(piece)
            if d.eof:
                data = d.unused_data
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
            else:
                data = b''
        if upos >= uend:
            break
seq = bytes(out).replace(b'\n', b'').replace(b'\r', b'')
assert len(seq) == length, (len(seq), length)
path = os.path.join(outdir, f'{sample}.{hap}.{contig}.fa')
with open(path + '.part', 'wb') as fh:
    fh.write(f'>{name}\n'.encode())
    for i in range(0, length, 60):
        fh.write(seq[i:i + 60] + b'\n')
os.rename(path + '.part', path)
print(path)

#!/usr/bin/env python3
"""Spliced BAMs that differ ONLY in how many bytes their MD tag holds.

Why this exists: reading a few tags off a record can be done two ways — walk the
tag block per name, or decode the whole block once — and which wins is decided
almost entirely by the size of the largest Z-typed value in the way, because a
walk steps over a Z value by scanning byte-by-byte to its null terminator.
Real corpora give you two far-apart points (short reads at ~75 tag bytes,
long reads at ~9,000) and no idea where the line between them is.

So: same read count, same CIGAR, same everything, one variable.

    ./make-mdsweep.py            # writes data/mdsweep.<n>.bam + .bai

Every read is spliced (an N op), because the consumer this was built for
(`getEffectiveStrand` in jbrowse's alignments plugin) only runs on reads that
carry one. Tags mimic minimap2's output — the same names, types and order it
emits — so the walk sees a realistic layout rather than MD alone.

MD content is synthetic but well-formed: `<n>` match runs separated by
single-base substitutions, padded to hit the target byte count. Nothing under
test parses it; it is there to be stepped over, which is the whole point.

TWO FAMILIES, because MD size is not the only variable — tag ORDER is, and it
is the one that is easy to miss. A walk looking for XS stops when it finds it,
so a read carrying XS *before* MD never scans MD at all, and the whole question
disappears. The first version of this generator put XS immediately before MD and
measured 13.7x for the targeted form at 1,550 tag bytes, which is the best case
dressed up as the general one.

  mdsweep.<n>.bam       XS present, ahead of MD  — the walk short-circuits
  mdsweep.<n>.noxs.bam  no XS/TS/ts at all       — the walk must cross MD, and
                                                   the two-lookup form crosses
                                                   it twice

Real data does both: STAR emits XS only for spliced reads, minimap2 emits ts
only where it can infer orientation, so a spliced read with no strand tag is
ordinary rather than pathological. `noxs` is the case the trade actually turns
on.
"""

import subprocess
import sys
from pathlib import Path

DATA = Path(__file__).parent / "data"
CONTIG = "ctgA"
CONTIG_LEN = 60_000_000
N_READS = 50_000
# the sweep: bytes of MD payload per read
MD_BYTES = [10, 100, 400, 1500, 4000, 9000]

# one exon-intron-exon read, 200 bases of sequence
CIGAR = "100M2000N100M"
SEQ = ("ACGT" * 50)[:200]
QUAL = "I" * 200


def md_of(target: int) -> str:
    """A well-formed MD string of about `target` bytes."""
    out = []
    n = 0
    while n < target:
        out.append("50A")
        n += 3
    s = "".join(out)
    # trim to target, then make sure it still ends on a digit run
    s = s[:target]
    if s.endswith("A"):
        s = s[:-1] + "5"
    return s


def build(md_bytes: int, with_xs: bool = True) -> None:
    md = md_of(md_bytes)
    suffix = "" if with_xs else ".noxs"
    out = DATA / f"mdsweep.{md_bytes}{suffix}.bam"
    print(f"  {out.name}: {N_READS} reads, MD {len(md)} bytes", flush=True)

    proc = subprocess.Popen(
        ["samtools", "view", "-b", "-o", str(out), "-"],
        stdin=subprocess.PIPE,
        text=True,
    )
    w = proc.stdin
    w.write("@HD\tVN:1.6\tSO:coordinate\n")
    w.write(f"@SQ\tSN:{CONTIG}\tLN:{CONTIG_LEN}\n")
    w.write("@PG\tID:make-mdsweep\tPN:make-mdsweep\n")

    # spread the reads out so a range query selects a realistic subset, and keep
    # them coordinate-sorted (samtools index requires it)
    step = 1000
    for i in range(N_READS):
        pos = 1 + i * step
        strand = "+" if i % 2 == 0 else "-"
        # minimap2's tag set, in its order, with MD where minimap2 --MD puts it
        xs = f"XS:A:{strand}\t" if with_xs else ""
        tags = (
            f"NM:i:5\tms:i:180\tAS:i:170\tnn:i:0\ttp:A:P\tcm:i:12\t"
            f"s1:i:150\ts2:i:0\tde:f:0.02\trl:i:0\t{xs}MD:Z:{md}"
        )
        w.write(
            f"read{i}\t0\t{CONTIG}\t{pos}\t60\t{CIGAR}\t*\t0\t0\t"
            f"{SEQ}\t{QUAL}\t{tags}\n"
        )
    w.close()
    if proc.wait() != 0:
        sys.exit(f"samtools view failed for {out}")
    subprocess.run(["samtools", "index", str(out)], check=True)


def main() -> None:
    DATA.mkdir(exist_ok=True)
    print(f"writing {len(MD_BYTES)} fixtures to {DATA}")
    for n in MD_BYTES:
        build(n, with_xs=True)
        build(n, with_xs=False)
    print("done")


if __name__ == "__main__":
    main()

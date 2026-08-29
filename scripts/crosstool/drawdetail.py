#!/usr/bin/env python3
"""How much base-level detail did each arm actually draw?

`drewcheck.ts` asks whether a page drew anything from corpus bytes. Every arm
passes that, including one painting flat rectangles -- which is how the
GenomeSpy arm spent weeks being timed on a picture nobody else was drawing.
This asks the next question, off the screenshots `shots.ts` leaves behind.

The proxy is the number of distinct saturated colours in the read band. A tool
drawing reads and nothing else lands at 0-2 whatever its palette; a tool drawing
per-base mismatches lands in the tens or hundreds. It needs no per-tool
knowledge, which is the point -- anything tool-specific would rot once per tool.

It is also how the MD dependency shows up. GenomeSpy filters on `datum.md` and
Gosling computes substitutions only `if (segment.md)`, so on a BAM without MD
tags both draw a pileup with no mismatches and report success; JBrowse and
igv.js reconstruct them from the reference and are unaffected. Run this over
20x.shortread.bam and 20x.shortread.nomd.bam to see the split.

  python3 scripts/crosstool/drawdetail.py screenshots/crosstool/*.png
"""
import sys
from collections import defaultdict

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow: pip install Pillow")

# Saturation floor for "this pixel is a coloured mark rather than grey or white".
# 25 rather than 60 because a sub-pixel mismatch blends toward the read under it
# -- Gosling has no minimum mark width, so at 15 bp/px its mismatches arrive as
# pale tints and a stricter floor scores a drawing tool as a flat one.
CHROMA = 25
# Quantised to kill antialiasing, which otherwise inflates a flat fill's count
# into the hundreds by counting every edge blend as its own colour.
QUANT = 24
# The vertical slice to read, as a fraction of image height: inside the pileup
# for every arm, below the coverage track and above where the rows run out.
BAND = (0.45, 0.60)


def detail(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    hues, colours = set(), set()
    for y in range(int(h * BAND[0]), int(h * BAND[1])):
        for x in range(0, w, 2):
            c = px[x, y]
            colours.add(c)
            if max(c) - min(c) > CHROMA:
                hues.add(tuple(v // QUANT for v in c))
    return len(hues), len(colours)


def main(paths):
    rows = defaultdict(dict)
    for p in paths:
        stem = p.split("/")[-1].rsplit(".", 1)[0]
        track, _, arm = stem.rpartition("-")
        rows[track][arm] = detail(p)
    for track in sorted(rows):
        print(f"\n{track}")
        print(f"  {'arm':12} {'hues':>6} {'colours':>8}   drawn")
        for arm in sorted(rows[track]):
            hues, colours = rows[track][arm]
            verdict = "base detail" if hues > 5 else "FLAT — reads only"
            print(f"  {arm:12} {hues:>6} {colours:>8}   {verdict}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])

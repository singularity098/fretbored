#!/usr/bin/env python3
"""Prints the SVG paths of the header wordmark ("Fret", "bored") for index.html.

The app can't load fonts, so the Audiowide lettering (SIL Open Font License) is converted to paths.
Usage: python3 tools/make-wordmark.py Audiowide-Regular.ttf   (needs `pip install fonttools`; dev-time only)
Paste the two lines into the `.wm-fret` / `.wm-bored` paths; the viewBox there is the ink box (7 23 565 77).
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont(sys.argv[1])
glyphs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
scale = 100 / font['head'].unitsPerEm  # 100 units per em
top = font['hhea'].ascent * scale
x = 0
for part in ('Fret', 'bored'):
    pen = SVGPathPen(glyphs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    for ch in part:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, top)))
        x += hmtx[name][0] * scale
    print(pen.getCommands())

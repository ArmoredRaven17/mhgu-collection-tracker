#!/usr/bin/env python3
"""Slice the Guild Card's weapon glyphs out of the Armor Viewer's extracted sprite strip.

    python scripts/extract-plate-icons.py [path to mhgu-armor-viewer]

These are the icons the game puts beside a hunter's name on their Guild Card. They were
extracted from the ROM for mhgu-armor-viewer, which keeps them as one 384x24 strip of
sixteen 24x24 cells indexed by the game's own weapon enum — w00 Great Sword through w14
Charge Blade, with cell 5 empty where the Medium Bowgun was removed.

They are greyscale, and the game colours its own class icons by multiplying that shading
by a colour rather than replacing it. The tracker does the same: these are written out
with their shading intact and CSS multiplies the completion-tier colour through them, so
the dark outline stays dark instead of thinning into a faded edge.
"""
import os, struct, sys, zlib

# The game's weapon enum -> our slug. From mhgu-armor-viewer's mount-rom.js CLASS_TYPE.
CELLS = {
    0: 'great_sword', 1: 'sword_and_shield', 2: 'hammer', 3: 'lance', 4: 'heavy_bowgun',
    # 5 was the Medium Bowgun, removed before release; its cell is blank.
    6: 'light_bowgun', 7: 'long_sword', 8: 'switch_axe', 9: 'gunlance', 10: 'bow',
    11: 'dual_blades', 12: 'hunting_horn', 13: 'insect_glaive', 14: 'charge_blade',
}
CELL = 24
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'assets', 'weapon-icons')


def read_png(path):
    b = open(path, 'rb').read()
    pos, idat, w, h = 8, b'', 0, 0
    while pos < len(b):
        ln = struct.unpack_from('>I', b, pos)[0]
        tag, d = b[pos + 4:pos + 8], b[pos + 8:pos + 8 + ln]
        if tag == b'IHDR':
            w, h = struct.unpack_from('>II', d, 0)
            if d[8] != 8 or d[9] != 6:
                sys.exit('expected 8-bit RGBA')
        elif tag == b'IDAT':
            idat += d
        pos += 12 + ln
    raw, bpp = zlib.decompress(idat), 4
    px, prev, o = bytearray(w * h * 4), bytearray(w * bpp), 0
    for y in range(h):                       # undo the per-row filters
        f = raw[o]; o += 1
        line = bytearray(raw[o:o + w * bpp]); o += w * bpp
        for x in range(len(line)):
            a = line[x - bpp] if x >= bpp else 0
            bb = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + bb) & 255
            elif f == 3: line[x] = (line[x] + ((a + bb) >> 1)) & 255
            elif f == 4:
                p = a + bb - c
                pa, pb, pc = abs(p - a), abs(p - bb), abs(p - c)
                line[x] = (line[x] + (a if (pa <= pb and pa <= pc) else bb if pb <= pc else c)) & 255
        px[y * w * 4:(y + 1) * w * 4] = line
        prev = line
    return w, h, px


def write_png(path, w, h, rgba):
    raw = b''.join(b'\0' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else r'C:\Coding Repos\mhgu-armor-viewer'
    strip = os.path.join(root, 'docs', 'ui', 'plate-icons.png')
    if not os.path.exists(strip):
        sys.exit('plate-icons.png not found at ' + strip)
    w, h, px = read_png(strip)
    if h != CELL:
        sys.exit(f'expected a {CELL}px-tall strip, got {h}')
    print(f'{strip}: {w}x{h}, {w // CELL} cells')
    os.makedirs(OUT, exist_ok=True)
    for idx, slug in CELLS.items():
        x0 = idx * CELL
        # Copied as-is: the greyscale is the shading CSS multiplies the tier colour
        # through, and the alpha is the shape it is clipped to. Flattening one into the
        # other would cost the outline, which is the darkest part of the glyph.
        cell = bytearray(CELL * CELL * 4)
        ink = 0
        for y in range(CELL):
            for x in range(CELL):
                s = ((y) * w + x0 + x) * 4
                d = (y * CELL + x) * 4
                cell[d:d + 4] = px[s:s + 4]
                if px[s + 3] > 32:
                    ink += 1
        if ink < 10:
            sys.exit(f'cell {idx} ({slug}) looks empty — has the strip changed?')
        path = os.path.join(OUT, slug + '.png')
        write_png(path, CELL, CELL, cell)
        print(f'  cell {idx:2d} -> {slug}.png ({ink} px, {os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()

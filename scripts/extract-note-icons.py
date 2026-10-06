#!/usr/bin/env python3
"""Pull the hunting horn note glyph out of a local MHGU dump and tint it per note.

    python scripts/extract-note-icons.py "<path to nativeNX>"

MHGU draws one note sprite and colours it at draw time — the same base-icon-plus-tint
trick it uses for subspecies monster icons — so the ROM has a single white glyph and no
coloured set. This writes the eight tinted copies the app needs into
docs/assets/notes/. Nothing from the dump is committed; only the generated PNGs are.

The glyph lives in the common icon atlas (every icon in it is a white mask with a black
outline), so tinting is a straight multiply: colour x luminance keeps the outline black
and paints the interior.

Pipeline, in case any of it is ever needed again:
  .arc            magic "ARC\\0", u16 version (17), u16 file count, 4 pad bytes, then
                  80-byte entries (64-byte name, u32 ext hash, u32 csize, u32 dsize,
                  u32 offset); each file is zlib-deflated. The .tex ext hash is
                  0x241f5deb.
  .tex            magic "TEX\\0" then three u32: [1] flags, [2] mip count in bits 0-5,
                  width in 6-18, height in 19-31, [3] format in BYTE 1 (not byte 0) —
                  0x07 uncompressed RGBA8, 0x13 BC1, 0x17 BC3. 24-byte header.
  swizzle         Switch textures are Tegra block-linear, not linear. GOB height is
                  whatever makes pitch * round_up(height, gob) fit the payload.
"""
import os, re, struct, sys, zlib

ATLAS = 'HD_cmn_icon'          # the common icon atlas, uncompressed RGBA8
CELL = 32                      # the atlas is a 32px grid
NOTE_CELL = (15, 22)           # grid cell holding the quaver
TEX_HASH = 0x241f5deb
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'assets', 'notes')

# Must match --note-* in docs/styles.css and NOTE_LETTER in docs/app.js.
NOTES = {
    'W': (0xf0, 0xf4, 0xf0), 'P': (0xcc, 0x44, 0xff), 'R': (0xff, 0x66, 0x66),
    'B': (0x00, 0x99, 0xff), 'G': (0x3c, 0xb0, 0x5d), 'Y': (0xe6, 0xcb, 0x00),
    'C': (0x66, 0xcc, 0xff), 'O': (0xff, 0x99, 0x00),
}


def round_up(x, n):
    return ((x + n - 1) // n) * n


def addr_block_linear(x, y, width, bpp, gob_height):
    gobs_wide = round_up(width * bpp, 64) // 64
    gob = ((y // (8 * gob_height)) * 512 * gob_height * gobs_wide
           + (x * bpp // 64) * 512 * gob_height
           + ((y % (8 * gob_height)) // 8) * 512)
    xb = x * bpp
    return (gob + ((xb % 64) // 32) * 256 + ((y % 8) // 2) * 64
            + ((xb % 32) // 16) * 32 + (y % 2) * 16 + (xb % 16))


def deswizzle(data, w, h, gob_height, bpp):
    out = bytearray(w * h * bpp)
    for y in range(h):
        for x in range(w):
            src = addr_block_linear(x, y, w, bpp, gob_height)
            if src + bpp <= len(data):
                dst = (y * w + x) * bpp
                out[dst:dst + bpp] = data[src:src + bpp]
    return out


def write_png(path, w, h, rgba):
    raw = b''.join(b'\0' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def find_atlas(root):
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if not fn.endswith('.arc'):
                continue
            p = os.path.join(dirpath, fn)
            try:
                raw = open(p, 'rb').read()
            except OSError:
                continue
            if raw[:4] != b'ARC\0':
                continue
            cnt = struct.unpack_from('<H', raw, 6)[0]
            for i in range(cnt):
                e = raw[12 + i * 80: 12 + (i + 1) * 80]
                if len(e) < 80 or struct.unpack_from('<I', e, 64)[0] != TEX_HASH:
                    continue
                nm = e[:64].split(b'\0')[0].decode('ascii', 'replace')
                if ATLAS not in nm:
                    continue
                _, csize, _, off = struct.unpack_from('<IIII', e, 64)
                return nm, zlib.decompress(raw[off:off + csize])
    return None, None


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\humph\OneDrive\Documents\MHGU Stuff\nativeNX'
    name, blob = find_atlas(root)
    if not blob:
        sys.exit(f'{ATLAS} not found under {root}')
    v2, v3 = struct.unpack_from('<II', blob, 8)
    w, h = (v2 >> 6) & 0x1FFF, (v2 >> 19) & 0x1FFF
    fmt = (v3 >> 8) & 0xFF
    if fmt != 0x07:
        sys.exit(f'expected uncompressed RGBA (0x07), got 0x{fmt:02x}')
    payload = blob[24:]
    for gob in (16, 8, 4, 2, 1):
        if round_up(w * 4, 64) * round_up(h, gob) <= len(payload) + 4:
            break
    px = deswizzle(payload, w, h, gob, 4)
    print(f'{name}: {w}x{h} RGBA, GOB height {gob}')

    x0, y0 = NOTE_CELL[0] * CELL, NOTE_CELL[1] * CELL
    glyph = bytearray(CELL * CELL * 4)
    for y in range(CELL):
        src = ((y0 + y) * w + x0) * 4
        glyph[y * CELL * 4:(y + 1) * CELL * 4] = px[src:src + CELL * 4]
    opaque = sum(1 for i in range(0, len(glyph), 4) if glyph[i + 3] > 32)
    print(f'glyph at cell {NOTE_CELL}: {opaque} opaque pixels')
    if not 100 < opaque < 700:
        sys.exit('that cell does not look like the glyph — has the atlas changed?')

    os.makedirs(OUT_DIR, exist_ok=True)
    for letter, (r, g, b) in NOTES.items():
        out = bytearray(glyph)
        for i in range(0, len(out), 4):
            if out[i + 3] == 0:
                continue
            lum = (out[i] * 299 + out[i + 1] * 587 + out[i + 2] * 114) // 1000
            out[i] = r * lum // 255
            out[i + 1] = g * lum // 255
            out[i + 2] = b * lum // 255
        path = os.path.join(OUT_DIR, f'note-{letter}.png')
        write_png(path, CELL, CELL, out)
        print(f'  wrote {os.path.relpath(path)} ({os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()

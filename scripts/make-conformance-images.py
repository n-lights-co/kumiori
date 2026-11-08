#!/usr/bin/env python3
"""
対応仕様説明書 (docs/conformance) の画像の見本を作る。

Kumiori が読める画像の形式ごとに、同じ絵 (夕暮れの空・星・夕日・4 層の山並み・織り目の帯。240 × 150 の格子で描く) を書き出す。
絵はこのスクリプトで描いた自作のもので、ほかの画像を使っていない。

- ラスター画像 (PNG・JPEG・GIF・BMP・TIFF・WebP) は Pillow で書き出す。解像度は 144 dpi (幅 240 画素 = 1.667 インチ)
- ベクター画像 (SVG・EPS・WMF・EMF・CGM) は、このスクリプトがファイルの中身を直接組み立てる
  (WMF は [MS-WMF]、EMF は [MS-EMF]、CGM は ISO/IEC 8632-3 の 2 進符号化、EPS は PostScript と DSC の決まりに従う)

使い方: python3 scripts/make-conformance-images.py
       (docs/conformance/fo/images と docs/conformance/html/images に同じものを書く)
"""
import io
import os
import struct
import sys

from PIL import Image, ImageDraw

W, H = 240, 150
DPI = 144

# 夕暮れの山並みと織り目の帯。色はロゴの紺 (#1E3550) と朱 (#C9482B) に合わせる
SKY_TOP = (30, 53, 80)
SKY_BOTTOM = (238, 150, 110)
SUN = (255, 214, 150)
SUN_CORE = (255, 241, 214)  # SVG の放射グラデーションの中心
STAR = (255, 240, 220)
GROUND = (22, 32, 54)
WARP = [(201, 72, 43), (224, 110, 70)]  # 経糸 (朱)
WEFT = [(242, 230, 208), (214, 196, 160)]  # 緯糸 (生成り)

HORIZON = 118  # 空と地面の境
SUN_C, SUN_R = (166, 76), 24
STARS = [(18, 14), (42, 30), (63, 9), (88, 22), (111, 12), (137, 27), (152, 8), (176, 18), (199, 31), (214, 11), (231, 24), (29, 44), (124, 40), (205, 47)]
STAR_R = 1


def ridge(base, amp, seed, step):
    """稜線 (整数の座標の多角形)。決まった数列で峰の高さを決め、峰と峰の間は 2 次の曲線でつなぐ
    (乱数を使わないので、毎回同じ形)"""
    k = seed
    peaks = []
    for x in range(-step, W + 2 * step, step):
        k = (k * 1103515245 + 12345) % (1 << 31)
        peaks.append((x, base - (k >> 8) % (amp + 1)))
    pts = [(0, HORIZON)]
    # 峰の中点を通り、峰を制御点にする 2 次ベジェ曲線を、細かい折れ線にする
    for (x0, y0), (x1, y1), (x2, y2) in zip(peaks, peaks[1:], peaks[2:]):
        a = ((x0 + x1) / 2, (y0 + y1) / 2)
        c = ((x1 + x2) / 2, (y1 + y2) / 2)
        for i in range(6):
            t = i / 6
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * x1 + t * t * c[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * y1 + t * t * c[1]
            if 0 <= x <= W:
                pts.append((round(x), round(y)))
    pts.append((W, pts[-1][1]))
    pts.append((W, HORIZON))
    return pts


MOUNTAINS = [  # 遠い山から近い山へ (遠いほど淡い)
    ((150, 104, 122), ridge(80, 30, 7, 34)),
    ((92, 78, 112), ridge(94, 24, 19, 28)),
    ((52, 58, 92), ridge(104, 16, 31, 22)),
    ((30, 40, 66), ridge(113, 8, 43, 18)),
]
GROUND_RECT = (0, HORIZON, 240, 150)
CELL = 12
WEAVE_X0, WEAVE_Y0, COLS, ROWS = 30, 124, 15, 2
BAND = 9  # 糸の太さ (糸と糸の間に地の紺が見える)
LABEL = (8, 13)  # ベクター画像の形式の名前を書く位置 (左上)


def weave_rects():
    """織り目を描く長方形 (色, x0, y0, x1, y1) の並び。経糸 → 緯糸 → 上に出る経糸の順に描く"""
    out = []
    for i in range(COLS):
        x = WEAVE_X0 + i * CELL + (CELL - BAND) // 2
        out.append((WARP[i % 2], x, WEAVE_Y0, x + BAND, WEAVE_Y0 + ROWS * CELL))
    for j in range(ROWS):
        y = WEAVE_Y0 + j * CELL + (CELL - BAND) // 2
        out.append((WEFT[j % 2], WEAVE_X0, y, WEAVE_X0 + COLS * CELL, y + BAND))
    for i in range(COLS):
        for j in range(ROWS):
            if (i + j) % 2 == 0:
                x = WEAVE_X0 + i * CELL + (CELL - BAND) // 2
                y = WEAVE_Y0 + j * CELL
                out.append((WARP[i % 2], x, y, x + BAND, y + CELL))
    return out


def sky_color(y):
    t = y / (HORIZON - 1)
    return tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM))


def hexc(c):
    return '#%02x%02x%02x' % c


# ---------------------------------------------------------------- ラスター


def raster(scale=1):
    im = Image.new('RGB', (W * scale, H * scale))
    d = ImageDraw.Draw(im)
    for y in range(GROUND_RECT[1] * scale):
        d.line([(0, y), (W * scale, y)], fill=sky_color(y / scale))
    for sx, sy in STARS:
        d.ellipse([(sx - STAR_R) * scale, (sy - STAR_R) * scale, (sx + STAR_R) * scale, (sy + STAR_R) * scale], fill=STAR)
    cx, cy = SUN_C
    d.ellipse([(cx - SUN_R) * scale, (cy - SUN_R) * scale, (cx + SUN_R) * scale, (cy + SUN_R) * scale], fill=SUN)
    for col, pts in MOUNTAINS:
        d.polygon([(x * scale, y * scale) for x, y in pts], fill=col)
    x0, y0, x1, y1 = GROUND_RECT
    d.rectangle([x0 * scale, y0 * scale, x1 * scale - 1, y1 * scale - 1], fill=GROUND)
    for col, a, b, c, e in weave_rects():
        d.rectangle([a * scale, b * scale, c * scale - 1, e * scale - 1], fill=col)
    if scale != 1:
        im = im.resize((W, H), Image.LANCZOS)
    return im


def checker():
    """解像度 (image-resolution) の見本に使う、48 × 24 画素の市松 (8 画素の升)。解像度の情報 (pHYs) を持たない PNG にして、
    指定した解像度だけで大きさが決まるようにする"""
    im = Image.new('RGB', (48, 24), (195, 204, 200))
    d = ImageDraw.Draw(im)
    for j in range(3):
        for i in range(6):
            if (i + j) % 2 == 0:
                d.rectangle([i * 8, j * 8, i * 8 + 7, j * 8 + 7], fill=(79, 122, 100))
    return im


def rounded_mask():
    m = Image.new('L', (W * 4, H * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, W * 4 - 1, H * 4 - 1], radius=18 * 4, fill=255)
    return m.resize((W, H), Image.LANCZOS)


def write_rasters(out):
    im = raster(4)
    rgba = im.copy()
    rgba.putalpha(rounded_mask())  # 角の丸い透明 (アルファ付き PNG・WebP)
    rgba.save(os.path.join(out, 'woven.png'), dpi=(DPI, DPI), optimize=True)
    im.save(os.path.join(out, 'woven.jpg'), quality=86, dpi=(DPI, DPI))
    # GIF: 64 色のパレット。角は透明の色
    pal = im.quantize(colors=63, method=Image.Quantize.MEDIANCUT)
    p = pal.getpalette()[: 63 * 3] + [255, 0, 255]
    g = Image.new('P', (W, H))
    g.putpalette(p)
    g.paste(pal, (0, 0))
    mask = rounded_mask().point(lambda v: 255 if v < 128 else 0)
    g.paste(63, (0, 0), mask)
    g.save(os.path.join(out, 'woven.gif'), transparency=63)
    im.quantize(colors=256).save(os.path.join(out, 'woven.bmp'), dpi=(DPI, DPI))  # 8 ビットのパレットの BMP
    im.save(os.path.join(out, 'woven.tif'), compression='tiff_lzw', dpi=(DPI, DPI))
    rgba.save(os.path.join(out, 'woven.webp'), quality=82, method=6)
    rgba.save(os.path.join(out, 'woven-lossless.webp'), lossless=True, method=6)


# ---------------------------------------------------------------- SVG


def svg():
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '  <title>織り目 (Kumiori の対応仕様説明書の見本)</title>',
        '  <defs>',
        '    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
        f'      <stop offset="0" stop-color="{hexc(SKY_TOP)}"/>',
        f'      <stop offset="1" stop-color="{hexc(SKY_BOTTOM)}"/>',
        '    </linearGradient>',
        '    <radialGradient id="sun" cx="0.4" cy="0.4" r="0.6">',
        f'      <stop offset="0" stop-color="{hexc(SUN_CORE)}"/>',
        f'      <stop offset="1" stop-color="{hexc(SUN)}"/>',
        '    </radialGradient>',
        '  </defs>',
        f'  <rect width="{W}" height="{GROUND_RECT[1]}" fill="url(#sky)"/>',
    ]
    for sx, sy in STARS:
        s.append(f'  <circle cx="{sx}" cy="{sy}" r="{STAR_R}" fill="{hexc(STAR)}"/>')
    s.append(f'  <circle cx="{SUN_C[0]}" cy="{SUN_C[1]}" r="{SUN_R}" fill="url(#sun)"/>')
    for col, pts in MOUNTAINS:
        s.append(f'  <polygon points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="{hexc(col)}"/>')
    x0, y0, x1, y1 = GROUND_RECT
    s.append(f'  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="{hexc(GROUND)}"/>')
    s.append('  <g shape-rendering="crispEdges">')
    for col, a, b, c, e in weave_rects():
        s.append(f'    <rect x="{a}" y="{b}" width="{c - a}" height="{e - b}" fill="{hexc(col)}"/>')
    s.append('  </g>')
    s.append(f'  <text x="{LABEL[0]}" y="{LABEL[1]}" font-family="sans-serif" font-size="8" letter-spacing="1" fill="{hexc(WEFT[0])}">SVG</text>')
    s.append('</svg>')
    return '\n'.join(s) + '\n'


# ---------------------------------------------------------------- EPS


def eps():
    """EPS (PostScript の座標は左下が原点。y を H − y に置き換える)"""
    f = lambda c: ' '.join('%.4f' % (v / 255) for v in c)
    s = [
        '%!PS-Adobe-3.0 EPSF-3.0',
        f'%%BoundingBox: 0 0 {W} {H}',
        '%%Title: woven.eps (Kumiori conformance sample)',
        '%%Creator: scripts/make-conformance-images.py',
        '%%EndComments',
        '/R { 4 dict begin /y1 exch def /x1 exch def /y0 exch def /x0 exch def',
        '  newpath x0 y0 moveto x1 y0 lineto x1 y1 lineto x0 y1 lineto closepath fill end } bind def',
        '% sky: one band per point',
        f'0 1 {GROUND_RECT[1] - 1} {{ /i exch def',
        f'  /t i {GROUND_RECT[1] - 1} div def',
    ]
    for k in range(3):
        s.append(f'  {SKY_TOP[k] / 255:.4f} {SKY_BOTTOM[k] / 255:.4f} {SKY_TOP[k] / 255:.4f} sub t mul add')
    s += ['  setrgbcolor', f'  0 {H} i sub 1 sub {W} {H} i sub R', '} for']
    for sx, sy in STARS:
        s.append(f'{f(STAR)} setrgbcolor newpath {sx} {H - sy} {STAR_R} 0 360 arc fill')
    s.append(f'{f(SUN)} setrgbcolor newpath {SUN_C[0]} {H - SUN_C[1]} {SUN_R} 0 360 arc fill')
    for col, pts in MOUNTAINS:
        p = [f'{x} {H - y}' for x, y in pts]
        s.append(f'{f(col)} setrgbcolor newpath {p[0]} moveto ' + ' '.join(q + ' lineto' for q in p[1:]) + ' closepath fill')
    x0, y0, x1, y1 = GROUND_RECT
    s.append(f'{f(GROUND)} setrgbcolor {x0} {H - y1} {x1} {H - y0} R')
    for col, a, b, c, e in weave_rects():
        s.append(f'{f(col)} setrgbcolor {a} {H - e} {c} {H - b} R')
    s += [f'{f(WEFT[0])} setrgbcolor /Helvetica findfont 8 scalefont setfont', f'{LABEL[0]} {H - LABEL[1]} moveto (EPS) show', 'showpage', '%%EOF']
    return '\n'.join(s) + '\n'


# ---------------------------------------------------------------- WMF ([MS-WMF])


def colorref(c):
    return struct.pack('<BBBB', c[0], c[1], c[2], 0)


def wmf():
    recs = []
    max_rec = 0

    def rec(func, params=b''):
        nonlocal max_rec
        size = 3 + len(params) // 2
        max_rec = max(max_rec, size)
        recs.append(struct.pack('<IH', size, func) + params)

    rec(0x0103, struct.pack('<h', 8))  # META_SETMAPMODE MM_ANISOTROPIC
    rec(0x020B, struct.pack('<hh', 0, 0))  # META_SETWINDOWORG (y, x)
    rec(0x020C, struct.pack('<hh', H, W))  # META_SETWINDOWEXT (y, x)
    rec(0x02FA, struct.pack('<HhhI', 5, 0, 0, 0))  # META_CREATEPENINDIRECT PS_NULL → 0
    rec(0x012D, struct.pack('<H', 0))  # META_SELECTOBJECT

    def fill(col, draw):
        rec(0x02FC, struct.pack('<H', 0) + colorref(col) + struct.pack('<H', 0))  # META_CREATEBRUSHINDIRECT BS_SOLID → 1
        rec(0x012D, struct.pack('<H', 1))
        draw()
        rec(0x01F0, struct.pack('<H', 1))  # META_DELETEOBJECT

    # 空: 24 段の帯で、上から下へ色を変える
    bands = 24
    for k in range(bands):
        y0 = HORIZON * k // bands
        y1 = HORIZON * (k + 1) // bands
        fill(sky_color((y0 + y1) / 2), lambda y0=y0, y1=y1: rec(0x041B, struct.pack('<hhhh', y1 + 1, W + 1, y0, 0)))
    for sx, sy in STARS:
        fill(STAR, lambda sx=sx, sy=sy: rec(0x0418, struct.pack('<hhhh', sy + STAR_R, sx + STAR_R, sy - STAR_R, sx - STAR_R)))
    cx, cy = SUN_C
    fill(SUN, lambda: rec(0x0418, struct.pack('<hhhh', cy + SUN_R, cx + SUN_R, cy - SUN_R, cx - SUN_R)))  # META_ELLIPSE
    for col, pts in MOUNTAINS:
        fill(col, lambda pts=pts: rec(0x0324, struct.pack('<h', len(pts)) + b''.join(struct.pack('<hh', x, y) for x, y in pts)))  # META_POLYGON
    x0, y0, x1, y1 = GROUND_RECT
    # META_RECTANGLE (bottom, right, top, left)。WMF の長方形は右と下の端を含まないので 1 足す
    fill(GROUND, lambda: rec(0x041B, struct.pack('<hhhh', y1 + 1, x1 + 1, y0, x0)))
    for col, a, b, c, e in weave_rects():
        fill(col, lambda a=a, b=b, c=c, e=e: rec(0x041B, struct.pack('<hhhh', e + 1, c + 1, b, a)))
    recs.append(struct.pack('<IH', 3, 0))  # META_EOF
    body = b''.join(recs)
    size_words = (18 + len(body)) // 2
    header = struct.pack('<HHHIHIH', 1, 9, 0x0300, size_words, 2, max_rec, 0)
    # 置き場所の見出し (placeable header): 1 インチ = 96 論理単位
    ph = struct.pack('<IHhhhhHI', 0x9AC6CDD7, 0, 0, 0, W, H, 96, 0)
    chk = 0
    for (w,) in struct.iter_unpack('<H', ph):
        chk ^= w
    return ph + struct.pack('<H', chk) + header + body


# ---------------------------------------------------------------- EMF ([MS-EMF])


def emf():
    recs = []
    handles = 1

    def rec(typ, params=b''):
        recs.append(struct.pack('<II', typ, 8 + len(params)) + params)

    rec(37, struct.pack('<I', 0x80000008))  # EMR_SELECTOBJECT NULL_PEN (既定の物)

    def fill(col, draw):
        nonlocal handles
        rec(39, struct.pack('<II', 1, 0) + colorref(col) + struct.pack('<I', 0))  # EMR_CREATEBRUSHINDIRECT ihBrush=1 BS_SOLID
        handles = max(handles, 2)
        rec(37, struct.pack('<I', 1))
        draw()
        rec(37, struct.pack('<I', 0x80000000))  # WHITE_BRUSH を選び直してから消す
        rec(40, struct.pack('<I', 1))  # EMR_DELETEOBJECT

    def rect(a, b, c, e):
        rec(43, struct.pack('<iiii', a, b, c, e))  # EMR_RECTANGLE (右・下の端を含む)

    # 空: グラデーション (EMR_GRADIENTFILL、GRADIENT_FILL_RECT_V)
    v = lambda x, y, c: struct.pack('<iiHHHH', x, y, c[0] << 8, c[1] << 8, c[2] << 8, 0)
    gy = HORIZON
    rec(118, struct.pack('<iiii', 0, 0, W, gy) + struct.pack('<III', 2, 1, 1) + v(0, 0, SKY_TOP) + v(W, gy, SKY_BOTTOM) + struct.pack('<III', 0, 1, 0))  # 頂点の番号の後ろに VertexPadding (4 バイト)
    for sx, sy in STARS:
        fill(STAR, lambda sx=sx, sy=sy: rec(42, struct.pack('<iiii', sx - STAR_R, sy - STAR_R, sx + STAR_R, sy + STAR_R)))
    cx, cy = SUN_C
    fill(SUN, lambda: rec(42, struct.pack('<iiii', cx - SUN_R, cy - SUN_R, cx + SUN_R, cy + SUN_R)))  # EMR_ELLIPSE
    for col, pts in MOUNTAINS:
        xs = [x for x, _ in pts]
        ys = [y for _, y in pts]
        body = struct.pack('<iiii', min(xs), min(ys), max(xs), max(ys)) + struct.pack('<I', len(pts)) + b''.join(struct.pack('<hh', x, y) for x, y in pts)
        fill(col, lambda body=body: rec(86, body))  # EMR_POLYGON16
    x0, y0, x1, y1 = GROUND_RECT
    fill(GROUND, lambda: rect(x0, y0, x1, y1))
    for col, a, b, c, e in weave_rects():
        fill(col, lambda a=a, b=b, c=c, e=e: rect(a, b, c, e))
    rec(14, struct.pack('<III', 0, 16, 20))  # EMR_EOF
    body = b''.join(recs)
    # 参照の装置: 1 画素 = 0.25 mm (W 画素 = 60 mm)
    dev = (1000, 1000)
    mm = (250, 250)
    frame = (0, 0, W * 25 - 1, H * 25 - 1)  # 0.01 mm
    nrec = len(recs) + 1
    hdr_size = 88
    total = hdr_size + len(body)
    header = (
        struct.pack('<II', 1, hdr_size)
        + struct.pack('<iiii', 0, 0, W - 1, H - 1)
        + struct.pack('<iiii', *frame)
        + struct.pack('<IIIIHHIII', 0x464D4520, 0x10000, total, nrec, handles, 0, 0, 0, 0)
        + struct.pack('<ii', *dev)
        + struct.pack('<ii', *mm)
    )
    assert len(header) == hdr_size
    return header + body


# ---------------------------------------------------------------- CGM (ISO/IEC 8632-3、2 進符号化)


def cgm():
    out = io.BytesIO()

    def el(cls, eid, params=b''):
        n = len(params)
        if n < 31:
            out.write(struct.pack('>H', (cls << 12) | (eid << 5) | n))
        else:
            out.write(struct.pack('>HH', (cls << 12) | (eid << 5) | 31, n))
        out.write(params)
        if n % 2:
            out.write(b'\0')

    sstr = lambda t: bytes([len(t)]) + t.encode('latin-1')
    i16 = lambda *v: struct.pack('>' + 'h' * len(v), *v)
    flip = lambda x, y: (x, H - y)  # CGM の VDC は y が上向き

    el(0, 1, sstr('woven.cgm'))  # BEGIN METAFILE
    el(1, 1, i16(1))  # METAFILE VERSION
    el(1, 11, i16(1, -1, 0))  # METAFILE ELEMENT LIST: DRAWING SET
    el(0, 3, sstr('woven'))  # BEGIN PICTURE
    el(2, 2, i16(1))  # COLOUR SELECTION MODE: direct
    el(2, 6, i16(0, 0, W, H))  # VDC EXTENT
    el(0, 4)  # BEGIN PICTURE BODY
    el(5, 22, i16(1))  # INTERIOR STYLE: solid
    el(5, 30, i16(0))  # EDGE VISIBILITY: off
    color = lambda c: el(5, 23, bytes(c))  # FILL COLOUR (direct、各 8 ビット)

    def rect(a, b, c, e):
        el(4, 11, i16(*flip(a, b), *flip(c, e)))  # RECTANGLE

    bands = 24
    for k in range(bands):
        y0 = HORIZON * k // bands
        y1 = HORIZON * (k + 1) // bands
        color(sky_color((y0 + y1) / 2))
        rect(0, y0, W, y1)
    color(STAR)
    for sx, sy in STARS:
        el(4, 12, i16(*flip(sx, sy), STAR_R))  # CIRCLE
    color(SUN)
    el(4, 12, i16(*flip(*SUN_C), SUN_R))  # CIRCLE
    for col, pts in MOUNTAINS:
        color(col)
        el(4, 7, b''.join(i16(*flip(x, y)) for x, y in pts))  # POLYGON
    color(GROUND)
    rect(*GROUND_RECT)
    for col, a, b, c, e in weave_rects():
        color(col)
        rect(a, b, c, e)
    el(0, 5)  # END PICTURE
    el(0, 2)  # END METAFILE
    return out.getvalue()


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'conformance')
    for sub in ('fo', 'html'):
        out = os.path.join(root, sub, 'images')
        os.makedirs(out, exist_ok=True)
        write_rasters(out)
        files = {'woven.svg': svg().encode('utf-8'), 'woven.eps': eps().encode('latin-1'), 'woven.wmf': wmf(), 'woven.emf': emf(), 'woven.cgm': cgm()}
        for name, data in files.items():
            with open(os.path.join(out, name), 'wb') as f:
                f.write(data)
    # 解像度の見本の市松は、HTML 編 (A.11 節) だけで使う
    checker().save(os.path.join(root, 'html', 'images', 'checker.png'), optimize=True)
    print('ok')


if __name__ == '__main__':
    sys.exit(main())

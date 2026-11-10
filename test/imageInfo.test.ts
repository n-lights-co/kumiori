import { describe, expect, it } from 'vitest';
import { epsPreview, imageInfo, pixelDensity } from '../src/imageInfo';

const bytes = (n: number, f: (v: DataView) => void) => {
  const b = new Uint8Array(n);
  f(new DataView(b.buffer));
  return b;
};

describe('imageInfo: 描けない形式の大きさ', () => {
  it('TIFF: 幅・高さと解像度 (dpi) から 96dpi の px', () => {
    // II*\0、IFD は 8 から: 256=100, 257=50, 282=192/1, 283=192/1, 296=2
    const b = bytes(200, (v) => {
      v.setUint8(0, 0x49), v.setUint8(1, 0x49), v.setUint16(2, 42, true), v.setUint32(4, 8, true);
      v.setUint16(8, 5, true);
      const ent = (k: number, tag: number, type: number, val: number) => {
        const e = 10 + k * 12;
        v.setUint16(e, tag, true), v.setUint16(e + 2, type, true), v.setUint32(e + 4, 1, true), v.setUint32(e + 8, val, true);
      };
      ent(0, 256, 3, 100), ent(1, 257, 3, 50), ent(2, 282, 5, 120), ent(3, 283, 5, 120), ent(4, 296, 3, 2);
      v.setUint32(120, 192, true), v.setUint32(124, 1, true);
    });
    expect(imageInfo(b)).toEqual({ mime: 'image/tiff', width: 50, height: 25 });
  });
  it('WMF の Placeable ヘッダ・EMF の rclFrame・EPS の BoundingBox', () => {
    const wmf = bytes(22, (v) => {
      v.setUint32(0, 0x9ac6cdd7, true), v.setInt16(10, 1440, true), v.setInt16(12, 720, true), v.setUint16(14, 1440, true);
    });
    expect(imageInfo(wmf)).toEqual({ mime: 'image/wmf', width: 96, height: 48 });
    const emf = bytes(100, (v) => {
      v.setUint32(0, 1, true), v.setInt32(32, 2540, true), v.setInt32(36, 5080, true), v.setUint32(40, 0x464d4520, true);
    });
    const e = imageInfo(emf)!;
    expect([e.mime, Math.round(e.width), Math.round(e.height)]).toEqual(['image/emf', 96, 192]);
    // 左右・上下が逆に書かれた枠 (rclFrame) でも、大きさは正の値。幅か高さが 0 の枠からは、大きさを決めない
    const rev = bytes(100, (v) => {
      v.setUint32(0, 1, true), v.setInt32(24, 2540, true), v.setInt32(28, 5080, true), v.setUint32(40, 0x464d4520, true);
    });
    const re = imageInfo(rev)!;
    expect([re.mime, Math.round(re.width), Math.round(re.height)]).toEqual(['image/emf', 96, 192]);
    const flat = bytes(100, (v) => {
      v.setUint32(0, 1, true), v.setInt32(32, 2540, true), v.setUint32(40, 0x464d4520, true);
    });
    expect(imageInfo(flat)).toBeUndefined();
    const eps = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 72 36\n');
    expect(imageInfo(eps)).toEqual({ mime: 'application/postscript', width: 96, height: 48 });
    expect(epsPreview(eps)).toBeUndefined();
  });
});

describe('metafile: WMF・EMF を SVG に', () => {
  it('WMF: ペン・ブラシ・多角形・文字を SVG の図形にする', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    const recs: number[][] = [];
    const rec = (fn: number, words: number[]) => recs.push([3 + words.length, fn, ...words]);
    rec(0x02fa, [0, 0, 0, 0x00ff, 0x0000]); // CREATEPENINDIRECT: 実線・赤 (0x000000ff)
    rec(0x02fc, [0, 0xff00, 0x0000, 0]); // CREATEBRUSHINDIRECT: 緑 (0x0000ff00)
    rec(0x012d, [0]); // SELECTOBJECT 0 (ペン)
    rec(0x012d, [1]); // SELECTOBJECT 1 (ブラシ)
    rec(0x0324, [3, 0, 0, 100, 0, 50, 80]); // POLYGON
    rec(0x0000, []); // EOF
    const words: number[] = [];
    for (const r of recs) words.push(r[0] & 0xffff, r[0] >> 16, ...r.slice(1));
    const head = [1, 9, 0x300, 0, 0, 0, 0, 0, 0];
    const b = new Uint8Array(22 + (head.length + words.length) * 2);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x9ac6cdd7, true);
    v.setInt16(10, 100, true), v.setInt16(12, 80, true), v.setUint16(14, 1440, true);
    [...head, ...words].forEach((w, k) => v.setUint16(22 + k * 2, w & 0xffff, true));
    const svg = wmfToSvg(b)!;
    expect(svg).toContain('viewBox="0 0 100 80"');
    expect(svg).toContain('<path d="M0 0L100 0L50 80Z" fill="#00ff00"');
    expect(svg).toContain('stroke="#ff0000"');
  });

  /** WMF の記録 (関数番号と 16 ビットの語の並び) から、Placeable ヘッダ付きのバイト列を作る */
  const wmfOf = (list: Array<[number, number[]]>) => {
    const words: number[] = [];
    for (const [fn, w] of [...list, [0, []] as [number, number[]]]) words.push((3 + w.length) & 0xffff, (3 + w.length) >> 16, fn, ...w);
    const head = [1, 9, 0x300, 0, 0, 0, 0, 0, 0];
    const b = new Uint8Array(22 + (head.length + words.length) * 2);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x9ac6cdd7, true);
    v.setInt16(10, 1000, true), v.setInt16(12, 1000, true), v.setUint16(14, 1440, true);
    [...head, ...words].forEach((w, k) => v.setUint16(22 + k * 2, w & 0xffff, true));
    return b;
  };
  it('WMF: EXTTEXTOUT の Dx (字の原点の間の距離) で字を 1 つずつ置く ([MS-WMF] 2.3.3.5)', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // y=500, x=100, 3 字 "ABC" (奇数なので 1 バイト埋める)、fwOpts 0、Dx 200・300・100
    const svg = wmfToSvg(wmfOf([[0x0a32, [500, 100, 3, 0, 0x4241, 0x0043, 200, 300, 100]]]))!;
    const xs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>(.)<\/text>/g)].map((m) => [m[2], parseFloat(m[1])]);
    expect(xs).toEqual([['A', 100], ['B', 300], ['C', 600]]);
  });
  it('WMF: ペンの線の端・角 (PS_ENDCAP_FLAT・PS_JOIN_MITER) と、PS_INSIDEFRAME の矩形は太さの半分だけ内側に', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // CREATEPENINDIRECT: style = PS_ENDCAP_FLAT | PS_JOIN_MITER (0x2200)、太さ 20
    let svg = wmfToSvg(wmfOf([[0x02fa, [0x2200, 20, 0, 0, 0]], [0x012d, [0]], [0x041b, [300, 300, 100, 100]]]))!;
    expect(svg).toContain('stroke-linejoin="miter" stroke-linecap="butt"');
    // PS_INSIDEFRAME (6)、太さ 20: RECTANGLE (100,100)-(300,300) は (110,110)-(290,290)
    svg = wmfToSvg(wmfOf([[0x02fa, [6, 20, 0, 0, 0]], [0x012d, [0]], [0x041b, [300, 300, 100, 100]]]))!;
    expect(svg).toContain('M110 110H290V290H110Z');
  });
  it('WMF: ペンの幅は論理単位 (幅 1 は 1 論理単位。[MS-EMF] 2.1.25 PS_COSMETIC)。幅 0 は出来上がりの 1px', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // CREATEPENINDIRECT: PS_COSMETIC (0)、幅 1 / 幅 0。Placeable の外接矩形 1000 単位を 1 インチ (96px) に置く
    const w1 = wmfToSvg(wmfOf([[0x02fa, [0, 1, 0, 0, 0]], [0x012d, [0]], [0x041b, [300, 300, 100, 100]]]))!;
    expect(w1).toContain('stroke="#000000" stroke-width="1"');
    const w0 = wmfToSvg(wmfOf([[0x02fa, [0, 0, 0, 0, 0]], [0x012d, [0]], [0x041b, [300, 300, 100, 100]]]))!;
    // 1000 ÷ (1000 / 1440 × 96 = 66.67px) = 15
    expect(w0).toContain('stroke="#000000" stroke-width="15"');
  });
  it('WMF: EXTTEXTOUT の ETO_OPAQUE は矩形を背景色 (SETBKCOLOR) で塗り、ETO_CLIPPED は字を矩形で切り抜く', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // SETBKCOLOR 青 (0x00ff0000)、EXTTEXTOUT: fwOpts 6、Rect (0,0)-(400,200)、"A"
    const svg = wmfToSvg(wmfOf([[0x0201, [0x0000, 0x00ff]], [0x0a32, [100, 50, 1, 6, 0, 0, 400, 200, 0x0041]]]))!;
    expect(svg).toContain('<rect x="0" y="0" width="400" height="200" fill="#0000ff"');
    expect(svg).toMatch(/<clipPath id="kmMfClip1"><rect x="0" y="0" width="400" height="200"\/><\/clipPath><g clip-path="url\(#kmMfClip1\)"><text/);
  });

  /** 1 ビットの DIB (BitmapInfoHeader・2 色の表・画素)。rows は上から下の行の 0/1 */
  const dib1 = (rows: number[][]) => {
    const w = rows[0].length;
    const h = rows.length;
    const stride = Math.floor((w + 31) / 32) * 4;
    const b = new Uint8Array(40 + 8 + stride * h);
    const v = new DataView(b.buffer);
    v.setUint32(0, 40, true);
    v.setInt32(4, w, true);
    v.setInt32(8, h, true);
    v.setUint16(12, 1, true);
    v.setUint16(14, 1, true);
    b.set([0, 0, 0, 0, 255, 255, 255, 0], 40); // 0 黒・1 白
    rows.forEach((r, y) => r.forEach((bit, x) => bit && (b[48 + (h - 1 - y) * stride + (x >> 3)] |= 0x80 >> (x & 7))));
    return b;
  };
  const words16 = (b: Uint8Array) => Array.from({ length: Math.ceil(b.length / 2) }, (_, k) => b[2 * k] | ((b[2 * k + 1] ?? 0) << 8));
  /** SVG の中の data: の PNG を読んで、画素 (RGBA) を返す (無圧縮のブロックだけ) */
  const pngPixels = (svg: string) => {
    const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg)!;
    const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const dv = new DataView(bin.buffer);
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    const idatLen = dv.getUint32(33);
    const z = bin.subarray(41, 41 + idatLen);
    const raw: number[] = [];
    for (let o = 2; o < z.length - 4; ) {
      const last = z[o] & 1;
      const len = z[o + 1] | (z[o + 2] << 8);
      raw.push(...z.subarray(o + 5, o + 5 + len));
      o += 5 + len;
      if (last) break;
    }
    const px: number[][] = [];
    for (let y = 0; y < h; y++) px.push(Array.from({ length: w }, (_, x) => raw[y * (w * 4 + 1) + 1 + x * 4]));
    return { w, h, px };
  };
  it('WMF: STRETCHDIB の DIB を PNG にして描き先の矩形に置く。元の矩形で切り出し、NOTSRCCOPY は色を反転', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    const dib = dib1([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    // RasterOperation SRCCOPY (0x00CC0020)、ColorUsage 0、元 (0,0) 3×2、描き先 (10,20) 300×200
    let svg = wmfToSvg(wmfOf([[0x0f43, [0x0020, 0x00cc, 0, 2, 3, 0, 0, 200, 300, 20, 10, ...words16(dib)]]]))!;
    expect(svg).toContain('<image x="0" y="0" width="300" height="200" preserveAspectRatio="none" transform="matrix(1 0 0 1 10 20)" href="data:image/png;base64,');
    expect(pngPixels(svg)).toEqual({
      w: 3,
      h: 2,
      px: [
        [255, 0, 0],
        [0, 255, 0],
      ],
    });
    // 元の矩形 (1,0) 2×2 だけ、NOTSRCCOPY (0x00330008)
    svg = wmfToSvg(wmfOf([[0x0f43, [0x0008, 0x0033, 0, 2, 2, 0, 1, 200, 200, 20, 10, ...words16(dib)]]]))!;
    expect(pngPixels(svg)).toEqual({
      w: 2,
      h: 2,
      px: [
        [255, 255],
        [0, 255],
      ],
    });
    // 描き先と混ぜる演算 SRCAND (0x008800C6) は、元が白黒なので乗算の層 (白はそのまま・黒は黒に)
    svg = wmfToSvg(wmfOf([[0x0f43, [0x00c6, 0x0088, 0, 2, 3, 0, 0, 200, 300, 20, 10, ...words16(dib)]]]))!;
    expect(svg).toContain('style="mix-blend-mode:multiply"');
    expect(pngPixels(svg)).toEqual({ w: 3, h: 2, px: [[255, 0, 0], [0, 255, 0]] });
  });
  /** SVG の中の n 番目の data: の PNG の画素 (RGBA) */
  const pngRgba = (svg: string, n = 0) => {
    const m = [...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)][n];
    const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const dv = new DataView(bin.buffer);
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    const z = bin.subarray(41, 41 + dv.getUint32(33));
    const raw: number[] = [];
    for (let o = 2; o < z.length - 4; ) {
      const len = z[o + 1] | (z[o + 2] << 8);
      raw.push(...z.subarray(o + 5, o + 5 + len));
      if (z[o] & 1) break;
      o += 5 + len;
    }
    return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => raw.slice(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 5 + x * 4)));
  };
  it('WMF: SRCAND (マスク) と同じ所への SRCINVERT (画像) の組は、透明の部分を持つ画像 1 枚に', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    const stretch = (rop: number, dib: Uint8Array): [number, number[]] => [0x0f43, [rop & 0xffff, rop >>> 16, 0, 1, 2, 0, 0, 10, 20, 0, 0, ...words16(dib)]];
    // マスク: 白 (透明にする所)・黒、画像: 黒 (マスクの白の所)・白
    const svg = wmfToSvg(wmfOf([stretch(0x008800c6, dib1([[1, 0]])), stretch(0x00660046, dib1([[0, 1]]))]))!;
    expect(svg.match(/<image/g)).toHaveLength(1);
    expect(svg).not.toContain('mix-blend-mode');
    expect(pngRgba(svg)).toEqual([[[0, 0, 0, 0], [255, 255, 255, 255]]]);
  });
  it('WMF: 元の無い描き先の演算 (DSTINVERT) は、差の描画モードで白の矩形', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    const svg = wmfToSvg(wmfOf([[0x061d, [0x0009, 0x0055, 50, 80, 20, 10]]]))!;
    expect(svg).toContain('<path d="M10 20H90V70H10Z" fill="#ffffff" stroke="none" style="mix-blend-mode:difference"/>');
  });
  it('WMF: 論理パレット (CREATEPALETTE・SELECTPALETTE) で DIB_PAL_COLORS の DIB の色を決める', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // 2×1、1 ビット、色の表は 16 ビットのパレットの番号 [1, 0]、画素 [1, 0]
    const dib = new Uint8Array(40 + 4 + 4);
    const dv = new DataView(dib.buffer);
    (dv.setUint32(0, 40, true), dv.setInt32(4, 2, true), dv.setInt32(8, 1, true), dv.setUint16(12, 1, true), dv.setUint16(14, 1, true));
    dib.set([1, 0, 0, 0], 40);
    dib[44] = 0x80;
    // パレット: 0 赤、1 青 (PaletteEntry: Red, Green, Blue, Values)
    const pal = [0x0300, 2, 0x00ff, 0x0000, 0x0000, 0x00ff];
    const svg = wmfToSvg(wmfOf([[0x00f7, pal], [0x0234, [0]], [0x0f43, [0x0020, 0x00cc, 1, 1, 2, 0, 0, 10, 20, 0, 0, ...words16(dib)]]]))!;
    expect(pngRgba(svg)).toEqual([[[255, 0, 0, 255], [0, 0, 255, 255]]]);
    // パレットが無ければ描かない
    expect(wmfToSvg(wmfOf([[0x0f43, [0x0020, 0x00cc, 1, 1, 2, 0, 0, 10, 20, 0, 0, ...words16(dib)]]]))).not.toContain('<image');
  });
  it('WMF: PATBLT と DIB の無い DIBBITBLT は、型 (ブラシ) か黒・白で矩形を塗る', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // CREATEBRUSHINDIRECT 赤、SELECTOBJECT、PATBLT PATCOPY (0x00F00021) 高さ 50・幅 80・(20, 10)
    let svg = wmfToSvg(
      wmfOf([
        [0x02fc, [0, 0x00ff, 0, 0]],
        [0x012d, [0]],
        [0x061d, [0x0021, 0x00f0, 50, 80, 20, 10]],
      ]),
    )!;
    expect(svg).toContain('<path d="M10 20H90V70H10Z" fill="#ff0000" stroke="none"/>');
    // DIBBITBLT (DIB 無し: RecordSize = 上位バイト + 3) BLACKNESS (0x00000042)
    const words = [0x0042, 0x0000, 0, 0, 0, 50, 80, 20, 10];
    svg = wmfToSvg(wmfOf([[0x0940 | (words.length << 8), words]]))!;
    expect(svg).toContain('<path d="M10 20H90V70H10Z" fill="#000000" stroke="none"/>');
  });
  it('WMF: INTERSECTCLIPRECT・EXCLUDECLIPRECT で切り抜き、SAVEDC・RESTOREDC で戻す', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    const rect: [number, number[]] = [0x041b, [1000, 1000, 0, 0]];
    // SAVEDC、INTERSECTCLIPRECT (0,0)-(500,400)、EXCLUDECLIPRECT (100,100)-(200,200)、RECTANGLE、RESTOREDC、RECTANGLE
    const svg = wmfToSvg(wmfOf([[0x001e, []], [0x0416, [400, 500, 0, 0]], [0x0415, [200, 200, 100, 100]], rect, [0x0127, [-1]], rect]))!;
    const m = /<clipPath id="(kmMfRgn\d+)"><path d="([^"]+)"\/><\/clipPath><g clip-path="url\(#\1\)"><path d="M0 0H1000V1000H0Z"[^>]*\/><\/g><path d="M0 0H1000V1000H0Z"/.exec(svg);
    expect(m).not.toBeNull();
    // (0,0)-(500,400) から (100,100)-(200,200) を抜いた矩形の集まり
    expect(m![2]).toBe('M0 0H500V100H0ZM0 100H100V200H0ZM200 100H500V200H200ZM0 200H500V400H0Z');
  });
  it('WMF: CREATEREGION・SELECTCLIPREGION・FILLREGION (Region の走査線)', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // Region: nextInChain, ObjectType 6, ObjectCount (2 語), RegionSize, ScanCount 1, maxScan, Bounding (4 語),
    // Scan: Count 4, Top 10, Bottom 20, (0,30), (50,60), Count2
    const region = [0, 6, 0, 0, 0, 1, 4, 0, 10, 60, 20, 4, 10, 20, 0, 30, 50, 60, 4];
    const svg = wmfToSvg(
      wmfOf([
        [0x06ff, region],
        [0x02fc, [0, 0xff00, 0, 0]],
        [0x0228, [0, 1]],
        [0x012c, [0]],
        [0x041b, [100, 100, 0, 0]],
      ]),
    )!;
    expect(svg).toContain('<path d="M0 10H30V20H0ZM50 10H60V20H50Z" fill="#00ff00" stroke="none"/>');
    expect(svg).toMatch(/<clipPath id="kmMfRgn1"><path d="M0 10H30V20H0ZM50 10H60V20H50Z"\/><\/clipPath><g clip-path="url\(#kmMfRgn1\)"><path d="M0 0H100V100H0Z"/);
  });
  it('WMF: ARC・CHORD・PIE は反時計回り (既定) に、始まりと終わりの放射線と楕円の交点を結ぶ', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // 外接矩形 (0,0)-(200,100)、始まり (200,50) (右)、終わり (100,0) (上): 反時計回りなら右 → 上の 4 分の 1
    const svg = wmfToSvg(
      wmfOf([
        [0x0817, [0, 100, 50, 200, 100, 200, 0, 0]],
        [0x081a, [0, 100, 50, 200, 100, 200, 0, 0]],
      ]),
    )!;
    expect(svg).toContain('<path d="M200 50A100 50 0 0 0 170.71 14.64A100 50 0 0 0 100 0" fill="none"');
    expect(svg).toContain('<path d="M100 50L200 50A100 50 0 0 0 170.71 14.64A100 50 0 0 0 100 0Z" fill="#ffffff"');
  });
  /** EMF の記録 (型と 32 ビットの値の並び。小数は {f: 値}) から、頭 (EMR_HEADER) 付きのバイト列を作る */
  const emfOf = (list: Array<[number, Array<number | { f: number } | Uint8Array>]>) => {
    // 頭: Bounds, Frame (0.01 mm), 署名, …, Device (100 画素), Millimeters (10 mm)
    const recs = [
      [1, [0, 0, 1000, 1000, 0, 0, 1000, 1000, 0x464d4520, 0x10000, 0, 0, 0, 0, 0, 0, 100, 100, 10, 10]] as [number, Array<number | { f: number } | Uint8Array>],
      ...list,
      [14, [0, 0, 0]] as [number, number[]],
    ];
    const parts = recs.map(([type, vals]) => {
      const len = 8 + vals.reduce<number>((t, x) => t + (x instanceof Uint8Array ? Math.ceil(x.length / 4) * 4 : 4), 0);
      const b = new Uint8Array(len);
      const v = new DataView(b.buffer);
      v.setUint32(0, type, true);
      v.setUint32(4, len, true);
      let o = 8;
      for (const x of vals) {
        if (x instanceof Uint8Array) {
          b.set(x, o);
          o += Math.ceil(x.length / 4) * 4;
        } else {
          if (typeof x === 'number') v.setUint32(o, x >>> 0, true);
          else v.setFloat32(o, x.f, true);
          o += 4;
        }
      }
      return b;
    });
    const out = new Uint8Array(parts.reduce((t, x) => t + x.length, 0));
    let o = 0;
    for (const x of parts) out.set(x, (o += x.length) - x.length);
    return out;
  };
  it('EMF: SETWORLDTRANSFORM・MODIFYWORLDTRANSFORM の変換で描く ([MS-EMF] 2.2.28)', async () => {
    const { emfToSvg } = await import('../src/metafile');
    // SETWORLDTRANSFORM: 2 倍・(10, 20) ずらす。MODIFYWORLDTRANSFORM (左から掛ける): (5, 0) ずらす → 先にずらしてから 2 倍
    const svg = emfToSvg(
      emfOf([
        [35, [{ f: 2 }, { f: 0 }, { f: 0 }, { f: 2 }, { f: 10 }, { f: 20 }]],
        [36, [{ f: 1 }, { f: 0 }, { f: 0 }, { f: 1 }, { f: 5 }, { f: 0 }, 2]],
        [43, [0, 0, 100, 100]],
      ]),
    )!;
    expect(svg).toContain('<g transform="matrix(2 0 0 2 20 20)"><path d="M0 0H100V100H0Z"');
  });
  it('EMF: EXTSELECTCLIPRGN (RegionData) と SELECTCLIPPATH (パス) で切り抜く', async () => {
    const { emfToSvg } = await import('../src/metafile');
    // RegionData: Size 32, Type 1, CountRects 1, RgnSize 16, Bounds, (10,10)-(50,50)
    const rgn = [32, 1, 1, 16, 10, 10, 50, 50, 10, 10, 50, 50];
    let svg = emfToSvg(
      emfOf([
        [75, [rgn.length * 4, 5, ...rgn]],
        [43, [0, 0, 100, 100]],
      ]),
    )!;
    expect(svg).toMatch(/<clipPath id="kmMfRgn1"><path d="M10 10H50V50H10Z"\/><\/clipPath><g clip-path="url\(#kmMfRgn1\)"><path d="M0 0H100V100H0Z"/);
    // BEGINPATH・RECTANGLE・ENDPATH・SELECTCLIPPATH (RGN_DIFF): 外側を残す
    svg = emfToSvg(
      emfOf([
        [59, []],
        [43, [20, 20, 40, 40]],
        [60, []],
        [67, [4]],
        [43, [0, 0, 100, 100]],
      ]),
    )!;
    expect(svg).toMatch(/<clipPath id="kmMfRgn1"><path d="M-10000000 -10000000L10000000 -10000000L10000000 10000000L-10000000 10000000ZM20 20H40V40H20Z" clip-rule="evenodd"\/>/);
  });
  it('EMF: STRETCHDIBITS の DIB と、ANGLEARC (現在の位置から始点へ線、反時計回りの円弧)', async () => {
    const { emfToSvg } = await import('../src/metafile');
    const dib = dib1([[1, 0]]);
    // Bounds (4), xDest 10, yDest 20, xSrc 0, ySrc 0, cxSrc 2, cySrc 1, offBmi, cbBmi 48, offBits, cbBits 4, Usage 0, SRCCOPY, cxDest 40, cyDest 10
    const fixed = 8 + 18 * 4;
    let svg = emfToSvg(emfOf([[81, [0, 0, 0, 0, 10, 20, 0, 0, 2, 1, fixed, 48, fixed + 48, 4, 0, 0x00cc0020, 40, 10, dib]]]))!;
    expect(svg).toContain('width="40" height="10" preserveAspectRatio="none" transform="matrix(1 0 0 1 10 20)"');
    // MOVETOEX (0,0)、ANGLEARC 中心 (100,100) 半径 50、始まり 0 度、掃く 90 度
    svg = emfToSvg(
      emfOf([
        [27, [0, 0]],
        [41, [100, 100, 50, { f: 0 }, { f: 90 }]],
      ]),
    )!;
    expect(svg).toContain('<path d="M0 0L150 100A50 50 0 0 0 135.36 64.64A50 50 0 0 0 100 50" fill="none"');
  });
  it('EMF: ALPHABLEND の画素ごとの不透明度 (AC_SRC_ALPHA。色は不透明度を掛けた値) を、色を戻した不透明度付きの PNG に', async () => {
    const { emfToSvg } = await import('../src/metafile');
    // 2×1、32 ビット BI_RGB。画素 (B, G, R, A): (0, 0, 128, 128) と (0, 0, 0, 0)
    const dib = new Uint8Array(40 + 8);
    const dv = new DataView(dib.buffer);
    (dv.setUint32(0, 40, true), dv.setInt32(4, 2, true), dv.setInt32(8, 1, true), dv.setUint16(12, 1, true), dv.setUint16(14, 32, true));
    dib.set([0, 0, 128, 128, 0, 0, 0, 0], 40);
    const fixed = 8 + 25 * 4;
    // Bounds, xDest 0, yDest 0, cx 20, cy 10, BLENDFUNCTION (0, 0, 255, 1), xSrc, ySrc, XformSrc (6), BkColor, Usage, offBmi, cbBmi, offBits, cbBits, cxSrc, cySrc
    const vals = [0, 0, 0, 0, 0, 0, 20, 10, 0x01ff0000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, fixed, 40, fixed + 40, 8, 2, 1, dib];
    const svg = emfToSvg(emfOf([[114, vals]]))!;
    const m = /href="data:image\/png;base64,([^"]+)"/.exec(svg)!;
    const bin = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    // IDAT の中の無圧縮のブロック: フィルタ 0、(255, 0, 0, 128)、(0, 0, 0, 0)
    const at = 41 + 2 + 5;
    expect(Array.from(bin.subarray(at, at + 9))).toEqual([0, 255, 0, 0, 128, 0, 0, 0, 0]);
  });
  it('EMF: 模様のブラシ (CREATEDIBPATTERNBRUSHPT) は、装置の画素の大きさのタイルの pattern で塗る', async () => {
    const { emfToSvg } = await import('../src/metafile');
    const dib = dib1([[1, 0]]);
    // ihBrush 1, Usage 0, offBmi, cbBmi 48, offBits, cbBits 4
    const fixed = 8 + 6 * 4;
    const svg = emfToSvg(emfOf([[94, [1, 0, fixed, 48, fixed + 48, 4, dib]], [37, [1]], [43, [0, 0, 100, 100]]]))!;
    // 1 画素 = 10 mm ÷ 100 = 0.1 mm。ページの座標の 1 単位 = frame 10 mm ÷ viewBox の幅 1001
    expect(svg).toMatch(/<pattern id="kmMfPat1" patternUnits="userSpaceOnUse" x="0" y="0" width="20.02" height="10.01"><path d="M0 0H10.01V10.01H0Z" fill="#ffffff"\/><path d="M10.01 0H20.02V10.01H10.01Z" fill="#000000"\/><\/pattern>/);
    expect(svg).toContain('<path d="M0 0H100V100H0Z" fill="url(#kmMfPat1)"');
  });
  it('EMF: パスを含む切り抜きの OR は、多角形の和の 1 つの層にする', async () => {
    const { emfToSvg } = await import('../src/metafile');
    // INTERSECTCLIPRECT (0,0)-(10,10)、BEGINPATH・RECTANGLE (20,20)-(30,30)・ENDPATH、SELECTCLIPPATH (RGN_OR)
    const svg = emfToSvg(emfOf([[30, [0, 0, 10, 10]], [59, []], [43, [20, 20, 30, 30]], [60, []], [67, [2]], [43, [0, 0, 100, 100]]]))!;
    expect(svg).toMatch(/<clipPath id="kmMfRgn1"><path d="M0 0L10 0L10 10L0 10ZM20 20L30 20L30 30L20 30Z" clip-rule="nonzero"\/><\/clipPath>/);
  });
  it('WMF・EMF: ハッチのブラシ (BS_HATCHED) は、装置の 8 画素ごとに 1 画素の線の模様 (利用者の指定。仕様書に間隔の決まりは無い)', async () => {
    const { wmfToSvg, emfToSvg } = await import('../src/metafile');
    // CREATEBRUSHINDIRECT: BS_HATCHED、赤、HS_CROSS (4)。写像モードが無い WMF は装置の画素の大きさが決まらないので塗らない
    const brush: [number, number[]] = [0x02fc, [2, 0x00ff, 0, 4]];
    const rect: [number, number[]] = [0x041b, [100, 100, 0, 0]];
    expect(wmfToSvg(wmfOf([brush, [0x012d, [0]], rect]))!).toContain('<path d="M0 0H100V100H0Z" fill="none"');
    // MM_TEXT (1 論理単位 = 1 画素): 8×8 のタイル。線の間は塗らない (背景のモードが OPAQUE でない)
    let w = wmfToSvg(wmfOf([[0x0103, [1]], brush, [0x012d, [0]], rect]))!;
    expect(w).toContain('<pattern id="kmMfPat1" patternUnits="userSpaceOnUse" x="0" y="0" width="8" height="8"><path d="M0 0H8V1H0ZM0 1H1V2H0ZM0 2H1V3H0ZM0 3H1V4H0ZM0 4H1V5H0ZM0 5H1V6H0ZM0 6H1V7H0ZM0 7H1V8H0Z" fill="#ff0000"/></pattern>');
    expect(w).toContain('<path d="M0 0H100V100H0Z" fill="url(#kmMfPat1)"');
    // SETBKMODE OPAQUE と SETBKCOLOR (青) なら、線の間を背景色で
    w = wmfToSvg(wmfOf([[0x0103, [1]], [0x0102, [2]], [0x0201, [0x0000, 0x00ff]], brush, [0x012d, [0]], rect]))!;
    expect(w).toMatch(/<pattern [^>]*><path d="[^"]*" fill="#ff0000"\/><path d="M1 1H8V2H1Z[^"]*" fill="#0000ff"\/><\/pattern>/);
    // EMF: 1 画素 = 10.01 (ページの座標)、HS_HORIZONTAL (0)
    const e = emfToSvg(emfOf([[39, [1, 2, 0x0000ff, 0]], [37, [1]], [43, [0, 0, 100, 100]]]))!;
    expect(e).toContain('width="80.08" height="80.08"><path d="M0 0H80.08V10.01H0Z" fill="#ff0000"/></pattern>');
  });
  it('EMF: EXTTEXTOUTA の 2 バイトの文字コードの字は、バイトごとの送りの値を足して 1 字の送りにする', async () => {
    const { emfToSvg } = await import('../src/metafile');
    // EXTCREATEFONTINDIRECTW: ih 1、LOGFONTW (高さ -200、lfCharSet 128 = Shift_JIS)
    const lf = new Uint8Array(92);
    new DataView(lf.buffer).setInt32(0, -200, true);
    lf[23] = 128;
    // EXTTEXTOUTA: Bounds、GraphicsMode、exScale、eyScale、EmrText (Reference (100, 50)、Chars 4 バイト、offString 76、Options 0、Rectangle、offDx 80)、
    // 文字列「有利」(Shift_JIS 97 4C 97 98)、送り (バイトごと) 0・200・0・200
    const svg = emfToSvg(
      emfOf([
        [82, [1, lf]],
        [37, [1]],
        [83, [0, 0, 0, 0, 1, { f: 1 }, { f: 1 }, 100, 50, 4, 76, 0, 0, 0, 0, 0, 80, new Uint8Array([0x97, 0x4c, 0x97, 0x98]), 0, 200, 0, 200]],
      ]),
    )!;
    const xs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>(.)<\/text>/g)].map((m) => [m[2], parseFloat(m[1])]);
    expect(xs).toEqual([['有', 100], ['利', 300]]);
  });
  it('WMF: RLE8 の DIB を戻して描く ([MS-WMF] 3.1.6.2)', async () => {
    const { wmfToSvg } = await import('../src/metafile');
    // 4×2、8 ビット、BI_RLE8、色の表 2 色 (0 黒・1 白)。下の行: 2 個の 1、2 個の 0 / 行の終わり / 上の行: 絶対の形 4 個 (0,1,0,1) / 終わり
    const rle = [2, 1, 2, 0, 0, 0, 0, 4, 0, 1, 0, 1, 0, 1];
    const b = new Uint8Array(40 + 8 + rle.length);
    const v = new DataView(b.buffer);
    (v.setUint32(0, 40, true), v.setInt32(4, 4, true), v.setInt32(8, 2, true), v.setUint16(12, 1, true), v.setUint16(14, 8, true));
    (v.setUint32(16, 1, true), v.setUint32(20, rle.length, true), v.setUint32(32, 2, true));
    b.set([0, 0, 0, 0, 255, 255, 255, 0], 40);
    b.set(rle, 48);
    const svg = wmfToSvg(wmfOf([[0x0f43, [0x0020, 0x00cc, 0, 2, 4, 0, 0, 2, 4, 0, 0, ...words16(b)]]]))!;
    expect(pngPixels(svg)).toEqual({
      w: 4,
      h: 2,
      px: [
        [0, 255, 0, 255],
        [255, 255, 0, 0],
      ],
    });
  });
});

describe('pixelDensity', () => {
  it('PNG の pHYs と JPEG の JFIF の解像度を読む', () => {
    // PNG: シグネチャ + IHDR (13 バイト) + pHYs (300dpi = 11811 / m、単位 1)
    const chunk = (type: string, data: number[]) => {
      const len = [0, 0, 0, data.length];
      return [...len, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    };
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('pHYs', [...be32(11811), ...be32(11811), 1])]);
    expect(pixelDensity(png)).toBeCloseTo(300, 0);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 150, 0, 150, 0, 0]);
    expect(pixelDensity(jpeg)).toBe(150);
    expect(pixelDensity(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))).toBeUndefined();
  });
});

describe('ファイルの頭から読む画像の大きさ (Node 用)', () => {
  it('PNG・GIF・SVG (width / height / viewBox)', async () => {
    const { headerSize } = await import('../src/assets');
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    png.set([0, 0, 1, 44, 0, 0, 0, 200], 16);
    expect(headerSize(png, 'image/png')).toEqual({ width: 300, height: 200 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0]);
    expect(headerSize(gif, 'image/gif')).toEqual({ width: 10, height: 20 });
    const svg = (a: string) => headerSize(new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${a}></svg>`), 'image/svg+xml');
    expect(svg('width="40" height="30"')).toEqual({ width: 40, height: 30 });
    expect(svg('viewBox="0 0 80 40"')).toEqual({ width: 80, height: 40 });
    expect(svg('width="160" viewBox="0 0 80 40"')).toEqual({ width: 160, height: 80 });
  });

  it('BMP の大きさ。拡張子だけが画像の、中身の違うファイル (HTML など) は読まない', async () => {
    const { headerSize } = await import('../src/assets');
    const bmp = bytes(26, (v) => {
      v.setUint8(0, 0x42);
      v.setUint8(1, 0x4d);
      v.setInt32(18, 120, true);
      v.setInt32(22, -80, true); // 上から下へ並べる BMP は高さが負
    });
    expect(headerSize(bmp, 'image/bmp')).toEqual({ width: 120, height: 80 });
    const html = new TextEncoder().encode('<!DOCTYPE html>\r\n<html lang="ja"><head><title>404</title></head></html>');
    for (const mime of ['image/png', 'image/gif', 'image/jpeg', 'image/bmp', 'image/webp']) expect(headerSize(html, mime)).toBeUndefined();
  });
});

describe('文書に名前が出てくる画像のファイル (mentionedFiles)', () => {
  it('HTML の src・srcset、CSS の url()、FO の external-graphic から、ファイル名 (小文字) を拾う', async () => {
    const { mentionedFiles } = await import('../src/assets');
    const html = '<img src="img/A.png"><img srcset="b.jpg 1x, sub/c.webp 2x"><div style="background:url(d.gif)"></div><img src="my image.png"><img src="e%20f.svg#frag">';
    const css = '.x { background-image: url("../g.jpeg?v=1") } .y { mask: url(h.svgz) }';
    const fo = `<fo:external-graphic src="url('pic/i.tif')"/><fo:external-graphic src="m.mml"/>`;
    const got = mentionedFiles([html, css, fo]);
    for (const n of ['a.png', 'b.jpg', 'c.webp', 'd.gif', 'my image.png', 'e f.svg', 'g.jpeg', 'h.svgz', 'i.tif', 'm.mml']) expect(got.has(n), n).toBe(true);
  });

  it('画像の拡張子で終わらない名前・文の中の語は拾わない', async () => {
    const { mentionedFiles } = await import('../src/assets');
    const got = mentionedFiles(['<a href="page.html">png の説明</a> file.pngx a.png.bak']);
    expect([...got]).toEqual([]);
  });
});

describe('ネットワーク上の画像の取得 (AssetStore.addUrl)', () => {
  it('応答の無い接続は、時限を過ぎたら取得をやめる (止まり続けない)', async () => {
    const http = await import('node:http');
    const { AssetStore } = await import('../src/assets');
    // 接続は受けるが、応答を返さないサーバー
    const server = http.createServer(() => {});
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const t0 = Date.now();
      const got = await new AssetStore().addUrl(`http://127.0.0.1:${port}/a.png`, 300);
      expect(got).toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('data URI の画像 (AssetStore.addDataUri)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><text x="0" y="15">日本語 é</text></svg>';
  it('base64 でない data URI: %xx はバイト (UTF-8) として戻す。日本語の SVG が化けない (RFC 2397 §2)', async () => {
    const { AssetStore, percentDecodeBytes } = await import('../src/assets');
    const a = await new AssetStore().addDataUri('data:image/svg+xml,' + encodeURIComponent(svg));
    expect(new TextDecoder().decode(a!.bytes)).toBe(svg);
    expect([a!.mime, a!.width, a!.height]).toEqual(['image/svg+xml', 100, 20]);
    // % で書いていない ASCII 以外の字は UTF-8 のバイトに、16 進の続かない % はそのまま (投げない)
    expect([...percentDecodeBytes('a%E6%97%A5日%zz%4')]).toEqual([0x61, 0xe6, 0x97, 0xa5, 0xe6, 0x97, 0xa5, 0x25, 0x7a, 0x7a, 0x25, 0x34]);
    // 0x80 以上のバイトもそのまま (UTF-8 として読み直さない)
    expect([...percentDecodeBytes('%ff%80%00')]).toEqual([0xff, 0x80, 0]);
  });
  it('種類の後ろのパラメータ (;charset=utf-8) があっても読む (RFC 2397 §3)。base64 はこれまでどおり', async () => {
    const { AssetStore } = await import('../src/assets');
    const a = await new AssetStore().addDataUri('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    expect(new TextDecoder().decode(a!.bytes)).toBe(svg);
    const b64 = Buffer.from(svg, 'utf8').toString('base64');
    for (const head of ['data:image/svg+xml;base64,', 'data:image/svg+xml;charset=utf-8;base64,']) {
      const b = await new AssetStore().addDataUri(head + b64);
      expect(new TextDecoder().decode(b!.bytes)).toBe(svg);
    }
  });
});

describe('pixelDensity: BMP', () => {
  it('BITMAPINFOHEADER の biXPelsPerMeter (2834 ≒ 72dpi)。0 なら書かれていない', () => {
    const bmp = (ppm: number) =>
      bytes(60, (v) => {
        v.setUint8(0, 0x42);
        v.setUint8(1, 0x4d);
        v.setUint32(14, 40, true);
        v.setInt32(38, ppm, true);
      });
    expect(pixelDensity(bmp(2834))).toBeCloseTo(72, 0);
    expect(pixelDensity(bmp(0))).toBeUndefined();
  });
});

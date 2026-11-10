import { describe, expect, it } from 'vitest';
import { cgmToSvg } from '../src/cgm';
import { METAFILE_TOTAL_IMAGE_PIXELS } from '../src/imageLimits';
import { emfToSvg, wmfToSvg } from '../src/metafile';
import { decodeBmp } from '../src/pixels';

/**
 * メタファイル (WMF・EMF) と CGM の読み取り が、細工した小さな入力で、止まらない・落ちない・メモリを使い切らない。
 * 止まらないことは、結果と vitest の制限時間で確かめる (時間の差は測らない)
 */

/** 止まる入力のテストの制限時間 (直す前は、どれも分の単位か、プロセスが落ちる) */
const T = { timeout: 30_000 };

const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
};
const count = (s: string, what: string) => s.split(what).length - 1;
/** SVG の中の PNG (data: の URI) の幅と高さ (IHDR) */
const pngSizes = (svg: string) =>
  [...svg.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => {
    const b = Uint8Array.from(atob(m[1].slice(0, 44)), (c) => c.charCodeAt(0));
    const v = new DataView(b.buffer);
    return [v.getUint32(16), v.getUint32(20)];
  });

// ───────────── EMF・WMF のバイト列 ─────────────

/** EMF の頭 (EMR_HEADER。[MS-EMF] 2.3.4.2): 外接矩形 100×100、枠 10mm×10mm、参照装置 1000×1000 画素・300×300 mm */
const emfHeader = () => {
  const h = new Uint8Array(88);
  const v = new DataView(h.buffer);
  v.setUint32(0, 1, true);
  v.setUint32(4, 88, true);
  v.setInt32(16, 100, true);
  v.setInt32(20, 100, true);
  v.setInt32(32, 1000, true);
  v.setInt32(36, 1000, true);
  v.setUint32(40, 0x464d4520, true);
  v.setInt32(72, 1000, true);
  v.setInt32(76, 1000, true);
  v.setInt32(80, 300, true);
  v.setInt32(84, 300, true);
  return h;
};
/** EMF の記録 (Type, Size, 中身の 32 ビットの値の並び) */
const emr = (type: number, words: number[], size = 8 + words.length * 4) => {
  const r = new Uint8Array(8 + words.length * 4);
  const v = new DataView(r.buffer);
  v.setUint32(0, type, true);
  v.setUint32(4, size, true);
  words.forEach((w, k) => v.setUint32(8 + 4 * k, w >>> 0, true));
  return r;
};
/** BitmapInfoHeader ([MS-WMF] 2.2.2.3) */
const bmiOf = (w: number, h: number, bpp: number, comp: number, used: number) => {
  const m = new Uint8Array(40);
  const v = new DataView(m.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, w, true);
  v.setInt32(8, h, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, bpp, true);
  v.setUint32(16, comp, true);
  v.setUint32(32, used, true);
  return m;
};
/** EMR_STRETCHDIBITS ([MS-EMF] 2.3.1.7): 頭と色の表 bmi、画素 bits を、(0, 0) から 100×100 に SRCCOPY で描く */
const stretchDib = (bmi: Uint8Array, bits: Uint8Array, srcW: number, srcH: number) => {
  const size = 80 + bmi.length + bits.length + ((4 - (bits.length % 4)) % 4);
  const r = new Uint8Array(size);
  const v = new DataView(r.buffer);
  v.setUint32(0, 81, true);
  v.setUint32(4, size, true);
  v.setInt32(8 + 32, srcW, true);
  v.setInt32(8 + 36, srcH, true);
  v.setUint32(8 + 40, 80, true);
  v.setUint32(8 + 44, bmi.length, true);
  v.setUint32(8 + 48, 80 + bmi.length, true);
  v.setUint32(8 + 52, bits.length, true);
  v.setUint32(8 + 60, 0x00cc0020, true);
  v.setInt32(8 + 64, 100, true);
  v.setInt32(8 + 68, 100, true);
  r.set(bmi, 80);
  r.set(bits, 80 + bmi.length);
  return r;
};
/** WMF の記録 (RecordSize (語の数)・RecordFunction・16 ビットの値の並び) */
const wmr = (fn: number, words: number[], sizeWords = 3 + words.length) => {
  const r = new Uint8Array(6 + words.length * 2);
  const v = new DataView(r.buffer);
  v.setUint32(0, sizeWords, true);
  v.setUint16(4, fn, true);
  words.forEach((w, k) => v.setUint16(6 + 2 * k, w & 0xffff, true));
  return r;
};
/** WMF (頭 18 バイト + 記録) */
const wmf = (...records: Uint8Array[]) => {
  const h = new Uint8Array(18);
  const v = new DataView(h.buffer);
  v.setUint16(0, 1, true);
  v.setUint16(2, 9, true);
  v.setUint16(4, 0x0300, true);
  return cat(h, ...records, wmr(0, []));
};

// ───────────── CGM のバイト列 ─────────────

/** CGM の命令 (ISO/IEC 8632-3 5.4。長さ 31 以上は長い形) */
function cmd(cls: number, id: number, data: number[] = []): number[] {
  const out = data.length < 31 ? [((cls << 12) | (id << 5) | data.length) >> 8, ((cls << 12) | (id << 5) | data.length) & 0xff] : [((cls << 12) | (id << 5) | 31) >> 8, ((cls << 12) | (id << 5) | 31) & 0xff, data.length >> 8, data.length & 0xff];
  out.push(...data);
  if (data.length % 2) out.push(0);
  return out;
}
const i16 = (...v: number[]) => v.flatMap((x) => [(x >> 8) & 0xff, x & 0xff]);
const i32 = (...v: number[]) => v.flatMap((x) => [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
const cgm = (body: number[], descriptor: number[] = []) =>
  new Uint8Array([...cmd(0, 1, [1, 116]), ...descriptor, ...cmd(0, 3, [1, 112]), ...cmd(2, 6, i16(0, 0, 100, 100)), ...cmd(0, 4), ...body, ...cmd(0, 5), ...cmd(0, 2)]);
/** CELL ARRAY (角 P (0,0)・Q (100,100)・R (100,0)、nx × ny、局所の色の精度 8、表し方 mode、色の並び) */
const cellArray = (nx: number, ny: number, mode: number, data: number[]) => cmd(4, 9, [...i16(0, 0, 100, 100, 100, 0, nx, ny, 8, mode), ...data]);

describe('WMF・EMF: 細工した入力 (IMG-02・IMG-04・IMG-05・IMG-13)', () => {
  it('DIB の ColorUsed が 2^bpp や記録の長さを超えても、その数の色の表を確保しない ([MS-WMF] 2.2.2.3)', T, () => {
    // 1×1・8 ビット・色の表 2 項 (青・赤)・画素は 1 番。ColorUsed だけが違う 2 つは、同じ絵になる
    const table = Uint8Array.from([255, 0, 0, 0, 0, 0, 255, 0]);
    const svgOf = (used: number) => emfToSvg(cat(emfHeader(), stretchDib(cat(bmiOf(1, 1, 8, 0, used), table), Uint8Array.from([1, 0, 0, 0]), 1, 1)))!;
    const plain = svgOf(2);
    expect(count(plain, '<image')).toBe(1);
    expect(svgOf(250_000_000)).toBe(plain);
    expect(svgOf(0xffffffff)).toBe(plain);
    // 色の表も画素も無い (頭だけの) 記録: 描かない
    expect(count(emfToSvg(cat(emfHeader(), stretchDib(bmiOf(1, 1, 8, 0, 250_000_000), new Uint8Array(0), 1, 1)))!, '<image')).toBe(0);
  });
  it('BMP: biClrUsed が大きくても、色の表は 2^bpp 項まで', () => {
    const bmp = (used: number) => {
      const f = new Uint8Array(14 + 40 + 8 + 4);
      const v = new DataView(f.buffer);
      f.set([0x42, 0x4d]);
      v.setUint32(2, f.length, true);
      v.setUint32(10, 62, true);
      f.set(bmiOf(1, 1, 1, 0, used), 14);
      f.set([0, 0, 255, 0, 0, 255, 0, 0], 54); // 0 番 = 赤、1 番 = 緑
      f[62] = 0x80; // 画素は 1 番
      return f;
    };
    expect(Array.from(decodeBmp(bmp(0xffffffff))!.rgba)).toEqual([0, 255, 0, 255]);
    expect(decodeBmp(bmp(0xffffffff))).toEqual(decodeBmp(bmp(2)));
  });

  it('EMF: 点の数が記録に入りきらない POLYLINE16 を並べても、記録ごとにファイルの終わりまでを読まない', T, () => {
    // 28 バイトの記録 (点は 0 個ぶんの長さ) に、ファイルの終わりまでの点の数を書く
    const N = 2000;
    const b = new Uint8Array(88 + 28 * N);
    b.set(emfHeader());
    const v = new DataView(b.buffer);
    for (let k = 0; k < N; k++) {
      const p = 88 + 28 * k;
      v.setUint32(p, 87, true);
      v.setUint32(p + 4, 28, true);
      v.setUint32(p + 24, Math.floor((b.length - p - 28) / 4), true);
    }
    // 直す前は 66MB の SVG になる。記録に入りきらない数は、途中で切れた記録と同じ (そこで読むのをやめる)
    expect(emfToSvg(b)!.length).toBeLessThan(1000);
    // 記録に収まる点は、これまでどおり描く (POLYLINE16: Bounds 16 バイト、Count、PointS の並び)
    const ok = emfToSvg(cat(emfHeader(), emr(87, [0, 0, 0, 0, 2, (20 << 16) | 10, (40 << 16) | 30])))!;
    expect(ok).toContain('d="M10 20L30 40"');
  });
  it('EMF: 字の数が記録に入りきらない EXTTEXTOUTW は描かない (ファイルのほかの所を字として読まない)', T, () => {
    // EMRTEXT ([MS-EMF] 2.2.5): Reference (x, y)、Chars、offString、Options (ETO_NO_RECT)、offDx
    const text = (chars: number) => {
      const r = emr(84, [0, 0, 0, 0, 1, 0, 0, 10, 20, chars, 64, 0x100, 0, 0, 0x00420041]);
      return cat(emfHeader(), r, new Uint8Array(4000).fill(0x41));
    };
    expect(emfToSvg(text(2))).toContain('>AB</text>');
    expect(count(emfToSvg(text(1500))!, '<text')).toBe(0);
  });
  it('EMF: 項の数が記録に入りきらないパレット (CREATEPALETTE・SETPALETTEENTRIES) は、記録の中の項だけを読む', T, () => {
    // 16 バイトの CREATEPALETTE (項は 1 個ぶん) に 65,535 個と書いた記録を並べる
    const N = 4000;
    const one = emr(49, [1, (0xffff << 16) | 0x0300, 0]);
    const b = cat(emfHeader(), ...Array.from({ length: N }, () => one), emr(50, [1, 0, 0xffffffff, 0], 0xfffffff0));
    expect(emfToSvg(b)).toContain('<svg');
  });
  it('WMF: 点・字・項の数が記録に入りきらない記録は、途中で切れた記録と同じに扱う', T, () => {
    const line = wmr(0x0213, [40, 30]); // LINETO (y, x)
    // POLYLINE: 点 2 個ぶんの記録に 3 個と書く → そこで読むのをやめる (後ろの LINETO は描かない)
    expect(count(wmfToSvg(wmf(wmr(0x0325, [3, 1, 2, 3, 4]), line))!, '<path')).toBe(0);
    expect(wmfToSvg(wmf(wmr(0x0325, [2, 1, 2, 3, 4]), line))).toContain('d="M1 2L3 4"');
    // TEXTOUT: 字数が記録より長い・負の数
    const filler = wmr(0x0000 | 0x0626, new Array(2000).fill(0x4141)); // (ESCAPE: 読み飛ばす記録)
    expect(count(wmfToSvg(wmf(wmr(0x0521, [3000, 0x4241, 10, 20]), filler))!, '<text')).toBe(0);
    expect(count(wmfToSvg(wmf(wmr(0x0521, [-3000, 0x4241, 10, 20]), filler))!, '<text')).toBe(0);
    expect(wmfToSvg(wmf(wmr(0x0521, [2, 0x4241, 20, 10]), filler))).toContain('>AB</text>');
    // CREATEPALETTE: 項 1 個ぶんの記録に 65,535 個と書いたものを並べる (記録ごとにファイルの終わりまでを読まない)
    const pal = wmr(0x00f7, [0x0300, 0xffff, 0, 0]);
    expect(wmfToSvg(wmf(...Array.from({ length: 20_000 }, () => pal), line))).toContain('<path');
  });

  it('画素の合計の上限: RLE の DIB は、寸法だけで大きな画素を作れるので、文書の合計が上限を超える画像は描かない', T, () => {
    // RLE8 の画素は「画像の終わり」だけ (2 バイト)。色の表は 2 項
    const rle = (n: number) => stretchDib(cat(bmiOf(n, n, 8, 1, 2), new Uint8Array(8)), Uint8Array.from([0, 1, 0, 0]), n, n);
    // 1 枚で上限を超える (8,100 × 8,100 = 6,561 万画素。1 枚ごとの上限 1 億画素よりは小さい): 確保せずに描かない
    expect(8100 * 8100).toBeGreaterThan(METAFILE_TOTAL_IMAGE_PIXELS);
    expect(count(emfToSvg(cat(emfHeader(), rle(8100)))!, '<image')).toBe(0);
    // 上限の中の画像は描き、合計が上限を超えた所から先は描かない (小さい画像はまだ入る)
    const out = emfToSvg(cat(emfHeader(), rle(16), rle(8100), rle(8), rle(8100)))!;
    expect(pngSizes(out)).toEqual([
      [16, 16],
      [8, 8],
    ]);
  });

  it('切り抜きの下で描く数が多くても、描くたびに切り抜きの全体を文字列にしない。出力はこれまでと同じ', T, () => {
    // EXTSELECTCLIPRGN ([MS-EMF] 2.3.2.2): RgnDataSize, RegionMode (RGN_COPY), RegionData (頭 32 バイト + 矩形)
    const clip = (n: number) => {
      const rg = new Uint8Array(16 + 32 + 16 * n);
      const v = new DataView(rg.buffer);
      v.setUint32(0, 75, true);
      v.setUint32(4, rg.length, true);
      v.setUint32(8, 32 + 16 * n, true);
      v.setUint32(12, 5, true);
      v.setUint32(16 + 8, n, true);
      for (let k = 0; k < n; k++) [k * 2, 0, k * 2 + 1, 1].forEach((x, j) => v.setInt32(48 + 16 * k + 4 * j, x, true));
      return rg;
    };
    const pixel = emr(15, [3, 4, 0x0000ff]); // SETPIXELV
    // 切り抜き 1 つの下で 2 つ描く: 組 (g) は 1 つ
    expect(emfToSvg(cat(emfHeader(), clip(2), pixel, pixel))).toContain(
      '<clipPath id="kmMfRgn1"><path d="M0 0H1V1H0ZM2 0H3V1H2Z"/></clipPath><g clip-path="url(#kmMfRgn1)"><path d="M3 4H4V5H3Z" fill="#ff0000" stroke="none"/><path d="M3 4H4V5H3Z" fill="#ff0000" stroke="none"/></g>',
    );
    // 同じ中身の切り抜きに置き換えても、組は開き直さない (鍵は中身で比べる)。違う中身なら開き直す
    expect(count(emfToSvg(cat(emfHeader(), clip(2), pixel, clip(2), pixel))!, '<clipPath')).toBe(1);
    expect(count(emfToSvg(cat(emfHeader(), clip(2), pixel, clip(3), pixel))!, '<clipPath')).toBe(2);
    // SAVEDC・RESTOREDC で同じ切り抜きに戻るときも同じ
    expect(count(emfToSvg(cat(emfHeader(), clip(2), pixel, emr(33, []), clip(3), pixel, emr(34, [-1]), pixel))!, '<clipPath')).toBe(3);
    // 矩形 20,000 個の切り抜きの下で 20,000 個描く (直す前は、描く数 × 切り抜きの大きさの手間で、分の単位)
    const N = 20_000;
    const big = emfToSvg(cat(emfHeader(), clip(N), ...Array.from({ length: N }, () => pixel)))!;
    expect(count(big, '<clipPath')).toBe(1);
    expect(count(big, 'fill="#ff0000"')).toBe(N);
  });
});

describe('CGM: 細工した入力 (IMG-05・IMG-07)', () => {
  it('CELL ARRAY: データの無い (寸法だけの) 要素を並べても、大きな画像を作らない', T, () => {
    // 3000 × 3000 の詰めた並び (データ無し) を 6 個 (144 バイトの CGM。直す前は 288MB の SVG)
    const cells = Array.from({ length: 6 }, () => cellArray(3000, 3000, 1, [])).flat();
    expect(cgmToSvg(cgm(cells))).toBeUndefined(); // (描くものが無い)
    const r = cgmToSvg(cgm([...cells, ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
    expect(count(r.svg, '<image')).toBe(0);
    expect(r.svg).toContain('<path');
    expect(r.svg.length).toBeLessThan(1000);
  });
  it('CELL ARRAY: データのある行だけを画素にする (行が足りなくても、描かれる所は同じ)', () => {
    // 2 × 4 のセルのうち、データは 2 行ぶん (1 行 = 2 バイト)。色は 1 番 (既定の色表)
    const whole = cgmToSvg(cgm(cellArray(2, 4, 1, [1, 1, 1, 1, 1, 1, 1, 1])))!.svg;
    const half = cgmToSvg(cgm(cellArray(2, 4, 1, [1, 1, 1, 1])))!.svg;
    expect(pngSizes(whole)).toEqual([[2, 4]]);
    expect(pngSizes(half)).toEqual([[2, 2]]);
    // 行の進む向きの長さは、行の数の割合で縮む (全体は 100 単位ぶん、半分は 50 単位ぶん)
    const matrixOf = (s: string) => /transform="matrix\(([^)]+)\)"/.exec(s)![1].split(' ').map(Number);
    const mw = matrixOf(whole);
    const mh = matrixOf(half);
    expect([mh[0], mh[1], mh[4], mh[5]]).toEqual([mw[0], mw[1], mw[4], mw[5]]);
    expect(mh[2]).toBeCloseTo(mw[2] / 2, 3);
    expect(mh[3]).toBeCloseTo(mw[3] / 2, 3);
    // 連なりの並び: 1 行は少なくとも 1 組 (数 2 バイト + 色 1 バイト)。行は語の境目から始まるので、2 行ぶんのデータは 8 バイトで、
    // 行の数の上の限りは 8 ÷ 3 を切り上げた 3 (3 行目は読むものが無く、透明のまま)
    expect(pngSizes(cgmToSvg(cgm(cellArray(2, 4, 0, [0, 2, 1, 0, 0, 2, 1])))!.svg)).toEqual([[2, 3]]);
  });
  it('画素の合計の上限: 上限を超えるタイルの並びは、確保せずに警告して描かない', T, () => {
    // BEGIN TILE ARRAY: 位置、セルの向き・行の向き、タイルの数 1×1、タイルのセルの数 8100×8100、セルの大きさ (実数 2 つ)、画像のずれ・セルの数
    const begin = cmd(0, 19, [...i16(0, 0, 0, 0, 1, 1, 8100, 8100), ...i32(0x10000, 0x10000), ...i16(0, 0, 8100, 8100)]);
    const r = cgmToSvg(cgm([...begin, ...cmd(0, 20), ...cmd(4, 1, i16(0, 0, 10, 10))]))!;
    expect(r.warnings.join()).toContain('画素の合計が上限');
    expect(count(r.svg, '<image')).toBe(0);
    expect(r.svg).toContain('<path'); // 後ろの折れ線は描く
  });
  it('TILE: 行の埋めの数が巨大でも、行の長さがタイルの大きさと関係なく膨らまない', T, () => {
    // 1 × 4000 のタイル。行の埋め 32767 で、1 行は 32767 セル (× 4000 行は 1 億セルを超える)。連なり (6) の数は 2^31 − 1
    const begin = cmd(0, 19, [...i16(0, 0, 0, 0, 1, 1, 1, 4000), ...i32(0x10000, 0x10000), ...i16(0, 0, 1, 4000)]);
    // TILE: 圧縮の形 6、行の埋め、セルの色の精度 8、SDR (整数 2 つ + 連なりの数の精度 31)、BS
    const tile = cmd(4, 29, [...i16(6, 32767, 8), 6, ...i16(0, 0, 31), 0xff, 0xff, 0xff, 0xfe, 1, 0xff, 0xff, 0xff, 0xfe, 1, 0xff, 0xff, 0xff, 0xfe, 1]);
    const r = cgmToSvg(cgm([...begin, ...Array.from({ length: 3 }, () => tile).flat(), ...cmd(0, 20)]))!;
    expect(r.svg).toContain('<svg');
  });
  it('INTERPOLATED INTERIOR: 段の数は、残りの引数に入る数まで', T, () => {
    // 整数の精度 32 で、段の数 2^31 − 1 (データは無い)
    const b = cgm([...cmd(5, 43, [...i16(1), 0, 1, 0, 1, ...i32(0x7fffffff)]), ...cmd(4, 1, i16(0, 0, 10, 10))], cmd(1, 4, i16(32)));
    expect(cgmToSvg(b)!.svg).toContain('<path');
  });
});

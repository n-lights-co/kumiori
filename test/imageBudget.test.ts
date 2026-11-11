/**
 * 画像の復号の大きさの上限 (IMG-19)。頭の寸法・長さだけを大きくした小さなファイルで、巨大な配列を作らせない。
 *  - (1) WebP (VP8・VP8L)・JPEG・CCITT: 画素の数を、データの大きさでも縛る (imageLimits.ts の pixelBudget と形式ごとの密度の上限)
 *  - (2) PNG (pdf-lib が展開するもの)・WOFF・WOFF2: 展開の大きさに上限を置く
 *  - (5) RLE4・RLE8 の BMP を Node で描く
 *  - (4) CGM・WMF・EMF の警告 (上限で描かなかった画像など) を組版の警告に出す
 * 直す前は、どの場合も数秒〜20 秒と 1〜2.6GB を使った (ここでは、読まないこと・小さく終わることを確かめる。時間は測らない)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import {
  CCITT_2D_PIXELS_PER_BYTE,
  IMAGE_FREE_PIXELS,
  JPEG_PIXELS_PER_BYTE,
  MAX_PIXELS,
  VP8L_PIXELS_PER_BYTE,
  VP8_PIXELS_PER_BYTE,
  WEBFONT_MAX_SFNT_BYTES,
  pixelBudget,
  webFontSfntBudget,
} from '../src/imageLimits';
import { decodeWebp } from '../src/webp';
import { decodeJpeg } from '../src/jpeg';
import { decodeModifiedHuffman } from '../src/ccitt';
import { decodeBmp, encodePng, pngWithinLimits, type Pixels } from '../src/pixels';
import { embedPngChecked } from '../src/pdfLibPatches';
import { toSfnt } from '../src/webFont';
import { AssetStore } from '../src/assets';
import { LayoutEngine } from '../src/layoutEngine';
import { FAMILY, doc, makeEngine } from './helpers';
import { cgmCellRuns, emfRle, wmfRle } from './metafileExpansionInputs';

const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const be16 = (v: number) => [(v >> 8) & 255, v & 255];
const be32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const riff = (chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return Uint8Array.from([...ascii('RIFF'), ...le32(body.length), ...body]);
};
const chunk = (id: string, data: number[]) => [...ascii(id), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];

/** VP8 のキーフレームの頭 (寸法 w × h) と、0 のバイトだけの最初の区画 */
function vp8(w: number, h: number): Uint8Array {
  const first = 16;
  const tag = (first << 5) | 0x10;
  return riff([chunk('VP8 ', [tag & 255, (tag >> 8) & 255, (tag >> 16) & 255, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, ...new Array(first + 4).fill(0)])]);
}

/** VP8L: 変換なし、5 つの符号がどれも字 1 つの簡単な符号 (0 ビットで読む) = 全部が 1 色 (透明な黒) の画像 */
function vp8l(w: number, h: number): Uint8Array {
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = 0; i < n; i++) bits.push((v >> i) & 1);
  };
  put(w - 1, 14);
  put(h - 1, 14);
  put(0, 1);
  put(0, 3);
  put(0, 3); // 変換・色のキャッシュ・メタの符号なし
  for (let k = 0; k < 5; k++) put(0b0001, 4); // 簡単な符号・字 1 つ・1 ビットの字・字 0
  const bytes = [0x2f];
  for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b, k) => a | (b << k), 0));
  return riff([chunk('VP8L', bytes), chunk('EXIF', [0, 0])]);
}

/** 濃淡の逐次の JPEG の頭 (寸法 w × h)。DC・AC の表は 1 ビットの符号 1 つ。走査のデータは無い */
function jpegHead(w: number, h: number): Uint8Array {
  const seg = (m: number, d: number[]) => [0xff, m, ...be16(d.length + 2), ...d];
  const bits16 = [1, ...new Array(15).fill(0)];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),
    ...seg(0xc0, [8, ...be16(h), ...be16(w), 1, 1, 0x11, 0]),
    ...seg(0xc4, [0x00, ...bits16, 0, 0x10, ...bits16, 0]),
    ...seg(0xda, [1, 1, 0x00, 0, 63, 0]),
    0xff, 0xd9,
  ]);
}

describe('WebP・JPEG・CCITT: 画素の数を、データの大きさでも縛る (IMG-19 (1))', () => {
  it('VP8 (非可逆): 50 バイトのファイルで 10000×10000 画素を読まない。上限の内の寸法は読む', () => {
    expect(decodeWebp(vp8(10000, 10000))).toBeUndefined();
    // VP8 のチャンクは 30 バイト: 1024×1024 (ファイルの大きさに依らない分の内) は読み、2048×2048 は読まない
    expect(pixelBudget(30, VP8_PIXELS_PER_BYTE)).toBeGreaterThanOrEqual(1024 * 1024);
    expect(decodeWebp(vp8(1024, 1024))?.width).toBe(1024);
    expect(decodeWebp(vp8(2048, 2048))).toBeUndefined();
    // 正当な VP8 の密度の上限 (マクロブロックごとに −log2(145/256) − log2(142/256) ビット以上) は上限の内
    const bitsPerMb = -Math.log2(145 / 256) - Math.log2(142 / 256);
    expect(VP8_PIXELS_PER_BYTE).toBeGreaterThan((256 * 8) / bitsPerMb);
  });

  it('VP8L (可逆): 38 バイトの 1 色の 10000×10000 画素を読まない。ファイルの大きさに依らない分の内は読む', () => {
    expect(decodeWebp(vp8l(10000, 10000))).toBeUndefined();
    const p = decodeWebp(vp8l(1024, 1024))!;
    expect([p.width, p.height]).toEqual([1024, 1024]);
    expect(pixelBudget(4000, VP8L_PIXELS_PER_BYTE)).toBe(MAX_PIXELS);
  });

  it('JPEG: 136 バイトの 10000×10000 画素を読まない。小さな寸法は (データが無くても) これまでどおり読む', () => {
    const big = jpegHead(10000, 10000);
    expect(big.length).toBeLessThan(200);
    expect(decodeJpeg(big)).toBeUndefined();
    const p = decodeJpeg(jpegHead(1000, 1000))!;
    expect([p.width, p.height]).toEqual([1000, 1000]);
    // 正当な JPEG の密度 (区画ごとに 1 ビット以上。濃淡は 1 バイトで 512 画素、最も偏った標本化で約 910 画素) は上限の内
    expect(JPEG_PIXELS_PER_BYTE).toBeGreaterThan((64 * 16 * 8) / 9);
  });

  it('CCITT: 2 次元の符号の行はデータのビット数まで。白紙 (1 行 1 ビット) の正当なデータは読む', () => {
    const ff = (n: number) => new Uint8Array(n).fill(0xff); // V0 の符号 (1) だけ = 全部白の行
    // 16 バイトは 128 行まで
    expect(decodeModifiedHuffman(ff(16), { width: 10, rows: 129, compression: 4 })).toBeUndefined();
    expect(decodeModifiedHuffman(ff(16), { width: 10, rows: 128, compression: 4 })?.length).toBe(1280);
    // 寸法だけが大きい: 16 バイトで 10000×10000 画素を確保しない
    expect(decodeModifiedHuffman(ff(16), { width: 10000, rows: 10000, compression: 4 })).toBeUndefined();
    // A4 を 600dpi で走査した白紙 (4960 × 7016 画素、T.6 で 877 バイト) は読む
    const a4 = decodeModifiedHuffman(ff(877), { width: 4960, rows: 7016, compression: 4 })!;
    expect(a4.length).toBe(4960 * 7016);
    expect(a4.every((v) => v === 0)).toBe(true);
    expect(4960 * 7016).toBeLessThanOrEqual(pixelBudget(877, CCITT_2D_PIXELS_PER_BYTE));
    // 1 次元の符号: 1 バイトで 2,048 画素 + ファイルの大きさに依らない分まで
    expect(decodeModifiedHuffman(ff(16), { width: 10000, rows: 1000, compression: 2 })).toBeUndefined();
  });

  it('CCITT の TIFF: 138 バイトの T.6 の 10000×10000 画素を、自前の復号でも utif でも確保しない', async () => {
    const { ccittWithinLimits } = await import('../src/assets');
    const ifd = (bytes: number) => ({ t256: [10000], t257: [10000], t259: [4], t273: [0], t279: [bytes] });
    expect(ccittWithinLimits(ifd(16), new ArrayBuffer(1000))).toBe(false);
    expect(ccittWithinLimits(ifd(1250), new ArrayBuffer(1250))).toBe(true);
    // データの長さは、ファイルに入っている所まで
    expect(ccittWithinLimits(ifd(1250), new ArrayBuffer(16))).toBe(false);
    // CCITT でない TIFF は、ここでは縛らない
    expect(ccittWithinLimits({ t256: [10000], t257: [10000], t259: [5] }, new ArrayBuffer(16))).toBe(true);
  });
});

describe('PNG・WOFF・WOFF2: 展開の大きさに上限を置く (IMG-19 (2))', () => {
  /** 寸法 w × h の RGBA の PNG で、IDAT は空のデータの zlib */
  const bigPng = (w: number, h: number) => {
    const small = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = [...ascii('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0];
    const idat = [...ascii('IDAT'), 0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01];
    return new Uint8Array([...small, ...be32(13), ...ihdr, 0, 0, 0, 0, ...be32(8), ...idat, 0, 0, 0, 0, ...be32(0), ...ascii('IEND'), 0, 0, 0, 0]);
  };
  it('65 バイトの 10000×10000 画素の PNG は展開しない (pdf-lib の embedPng に渡さない)。正当な PNG は埋め込む', async () => {
    const big = bigPng(10000, 10000);
    expect(pngWithinLimits(big)).toBe(false);
    const pdf = await PDFDocument.create();
    await expect(embedPngChecked(pdf, big)).rejects.toThrow(/上限/);
    // 1 色の 1000×1000 の RGBA (よく縮む PNG) は通る
    const px: Pixels = { width: 1000, height: 1000, rgba: new Uint8Array(4e6).fill(255) };
    const ok = await encodePng(px);
    expect(pngWithinLimits(ok)).toBe(true);
    expect((await embedPngChecked(pdf, ok)).width).toBe(1000);
    // 走査線が IDAT (8 バイト) の 1,032 倍 (8,256 バイト) を超えるものは、正当な deflate では作れない
    expect(pngWithinLimits(bigPng(40, 40))).toBe(true); // 6,400 バイト
    expect(pngWithinLimits(bigPng(50, 50))).toBe(false); // 10,000 バイト
  });

  it('WOFF: 表の origLength が上限 (128MB・ファイルの 100 倍 + 1MB) と deflate の比 (1,032 倍) を超えるなら展開しない', () => {
    const woff = (origLength: number, comp: Uint8Array) => {
      const head = [...ascii('wOFF'), ...be32(0x00010000), ...be32(0), ...be16(1), ...be16(0), ...be32(0), ...be16(1), ...be16(0), ...new Array(20).fill(0)];
      const dir = [...ascii('glyf'), ...be32(64), ...be32(comp.length), ...be32(origLength), ...be32(0)];
      return new Uint8Array([...head, ...dir, ...comp]).buffer;
    };
    const zeros = (n: number) => new Uint8Array(deflateSync(new Uint8Array(n)));
    // 4GB 近い origLength
    expect(() => toSfnt(woff(0xffffffff, zeros(1000)))).toThrow(/too large/);
    // 2MB を 2KB ほどに縮めたもの: 比は 1,032 倍の内だが、ファイルの 100 倍 + 1MB を超える
    const z = zeros(2 << 20);
    expect(z.length).toBeLessThan(4000);
    expect(() => toSfnt(woff(2 << 20, z))).toThrow(/too large/);
    // deflate では作れない比
    expect(() => toSfnt(woff(500_000, new Uint8Array(100)))).toThrow(/compression ratio/);
    expect(webFontSfntBudget(1 << 30)).toBe(WEBFONT_MAX_SFNT_BYTES);
  });

  it('WOFF2: 目録の長さの合計が上限を超えるなら、Brotli の展開の配列を作らない', () => {
    const N = 300 * 1024 * 1024;
    const comp = new Uint8Array(brotliCompressSync(new Uint8Array(1 << 20)));
    const base128 = (v: number) => {
      const r = [v & 0x7f];
      for (let n = v >>> 7; n; n >>>= 7) r.unshift((n & 0x7f) | 0x80);
      return r;
    };
    const head = [...ascii('wOF2'), ...be32(0x00010000), ...be32(0), ...be16(1), ...be16(0), ...be32(N), ...be32(comp.length), ...be16(1), ...be16(0), ...new Array(20).fill(0)];
    const b = new Uint8Array([...head, 0x3f, ...ascii('____'), ...base128(N), ...comp]);
    expect(() => toSfnt(b.buffer)).toThrow(/too large/);
  });
});

describe('RLE4・RLE8 の BMP (IMG-19 (5))', () => {
  /** BITMAPINFOHEADER の BMP (色の表は黒・赤・緑・青) */
  const bmp = (bpp: 4 | 8, comp: 1 | 2, w: number, h: number, data: number[]) => {
    const pal = [0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0];
    const off = 14 + 40 + pal.length;
    const info = [...le32(40), ...le32(w), ...le32(h), 1, 0, bpp, 0, ...le32(comp), ...le32(data.length), ...le32(2835), ...le32(2835), ...le32(4), ...le32(0)];
    return new Uint8Array([0x42, 0x4d, ...le32(off + data.length), 0, 0, 0, 0, ...le32(off), ...info, ...pal, ...data]);
  };
  const at = (p: Pixels, x: number, y: number) => Array.from(p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));
  const K = [0, 0, 0, 255];
  const R = [255, 0, 0, 255];
  const G = [0, 255, 0, 255];
  const B = [0, 0, 255, 255];
  it('RLE8: 符号化の形・絶対の形・行の終わり・ずれ・画像の終わり。下の行から。指定の無い画素は色の表の 0 番', () => {
    const p = decodeBmp(
      bmp(8, 1, 4, 3, [
        ...[4, 1, 0, 0], // 一番下の行: 赤 4 つ、行の終わり
        ...[0, 3, 2, 3, 1, 0, 0, 0], // 絶対の形 3 画素 (緑・青・赤) と語の境目の埋め、行の終わり
        ...[0, 2, 1, 0, 2, 3, 0, 1], // ずれ (右へ 1)、青 2 つ、画像の終わり
      ]),
    )!;
    expect([p.width, p.height]).toEqual([4, 3]);
    expect([0, 1, 2, 3].map((x) => at(p, x, 0))).toEqual([K, B, B, K]);
    expect([0, 1, 2, 3].map((x) => at(p, x, 1))).toEqual([G, B, R, K]);
    expect([0, 1, 2, 3].map((x) => at(p, x, 2))).toEqual([R, R, R, R]);
  });
  it('RLE4: 符号化の形は上位・下位の 4 ビットを交互に', () => {
    const p = decodeBmp(bmp(4, 2, 5, 1, [5, 0x12, 0, 1]))!;
    expect([0, 1, 2, 3, 4].map((x) => at(p, x, 0))).toEqual([R, G, R, G, R]);
  });
  it('「画像の終わり」だけの 10000×10000 画素の RLE8 は読まない (ファイルの大きさで縛る)', () => {
    expect(decodeBmp(bmp(8, 1, 10000, 10000, [0, 1]))).toBeUndefined();
    expect(decodeBmp(bmp(8, 1, 1024, 1024, [0, 1]))?.width).toBe(1024);
    expect(IMAGE_FREE_PIXELS).toBe(1024 * 1024);
  });
});

describe('CGM・WMF・EMF の警告を組版の警告に出す (IMG-19 (4))', () => {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
  /** WMF の前に Placeable の頭 ([MS-WMF] 2.3.2.3。枠は 0〜100、1 インチは 1440) を付ける (画像の大きさを読めるように) */
  const placeable = (wmf: Uint8Array) => {
    const h = new Uint8Array(22);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x9ac6cdd7, true);
    v.setInt16(10, 100, true);
    v.setInt16(12, 100, true);
    v.setUint16(14, 1440, true);
    return new Uint8Array([...h, ...wmf]);
  };
  it('上限を超えて描かなかった画像 (WMF・EMF の DIB、CGM の CELL ARRAY) を、画像の notes にして組版の警告に出す', async () => {
    const { fonts, measurer } = await makeEngine();
    const assets = new AssetStore({ parseXml: parse });
    const line = [0x40, 0x28, 0, 0, 0, 0, 0, 10, 0, 10]; // POLYLINE (0,0)-(10,10)
    const cells = cgmCellRuns((3000 * 3000) / 64, 64);
    const cgm = new Uint8Array([...cells.subarray(0, cells.length - 4), ...line, ...cells.subarray(cells.length - 4)]);
    const files: Array<[string, Uint8Array]> = [
      ['a.wmf', placeable(wmfRle(3000, 3000))],
      ['b.emf', emfRle(3000, 3000)],
      ['c.cgm', cgm],
    ];
    for (const [name, bytes] of files) {
      const a = await assets.addBlob(name, new Blob([bytes as BlobPart]));
      expect(a?.mime).toBe('image/svg+xml');
      expect(a?.notes?.join()).toMatch(/は、文書の画像の画素の合計が上限 \(\d+ バイトのファイルでは \d+ 画素\) を超えるので描きません/);
    }
    // 上限の内の画像には notes が無い
    expect((await assets.addBlob('ok.emf', new Blob([emfRle(100, 100) as BlobPart])))?.notes).toBeUndefined();
    const engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY, assets });
    const tree = engine.layout(doc([{ type: 'block', children: files.map(([src]) => ({ type: 'image' as const, src, width: 30, height: 30 })) }]));
    expect(tree.warnings).toEqual([
      expect.stringMatching(/^画像 a\.wmf の一部を描けません: DIB の画像 は、文書の画像の画素の合計が上限/),
      expect.stringMatching(/^画像 b\.emf の一部を描けません: DIB の画像 は、/),
      expect.stringMatching(/^画像 c\.cgm の一部を描けません: CELL ARRAY は、/),
    ]);
  });
});

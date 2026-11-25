/**
 * PNG の埋め込み (imageEmbed.ts の embedPngChecked・embedPngAsIs・embedCmykImage) の確かめ。
 *  - 展開せずに入れる形 (色の表・16 ビット・1/2/4 ビットの灰を含む) と、展開して入れる形 (α・tRNS・飛び越しなど) のどれも、
 *    PDF の画像の流れを読み戻した画素が、仕様から求めた画素と同じ。pdf-lib の展開 (UPNG) の誤りに当たらない形は、UPNG の画素とも同じ
 *    (いままでの埋め込みと見た目が変わらない)
 *  - Node の zlib の無い環境 (ブラウザ・Web Worker と同じ道。DecompressionStream で展開する) でも同じ画素。動く PNG は断る
 *  - 16 ビットは bits16 のときだけそのまま入れる (PDF 1.5 からの BitsPerComponent 16)
 *  - 展開した画素は、渡した圧縮の関数 (deflate) で圧縮し、pdf-lib の pako を通さない
 *  - 同じ入力からは、同じバイト列の流れになる
 *  - 画素のデータが切れた PNG は、展開せずに入れる形でも断る (Node の zlib の無い環境でも)
 *  - 圧縮の関数を決める順 (imageDeflater) の、Node の zlib・CompressionStream・pako のどの道も zlib の形 (RFC 1950) を出す。
 *    sha256 は、Node の crypto の道と自前の計算の道で同じ値
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { PNG } from 'pdf-lib/cjs/utils/png';
import { embedCmykImage, embedPngAsIs, embedPngChecked } from '../src/imageEmbed';
import { imageDeflater, inflateZlib } from '../src/imageDeflate';
import { decodePngForPdf } from '../src/pixels';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = ~0;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** 走査線 (成分の値の並び) を、行ごとに違うフィルタ (0〜4) を掛けて詰める */
function scanlines(w: number, h: number, ct: number, depth: number, sample: (x: number, y: number) => number[], xs = (x: number) => x, ys = (y: number) => y, filterOf = (y: number) => y % 5): Buffer {
  const bits = CHANNELS[ct] * depth;
  const rowBytes = Math.ceil((w * bits) / 8);
  const bpp = Math.max(1, bits >> 3);
  const out = Buffer.alloc((rowBytes + 1) * h);
  let up = Buffer.alloc(rowBytes);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(rowBytes);
    let bit = 0;
    for (let x = 0; x < w; x++)
      for (const v of sample(xs(x), ys(y))) {
        if (depth === 16) line.writeUInt16BE(v, bit >> 3);
        else if (depth === 8) line[bit >> 3] = v;
        else line[bit >> 3] |= v << (8 - depth - (bit & 7));
        bit += depth;
      }
    const f = filterOf(y);
    const r = y * (rowBytes + 1);
    out[r] = f;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = up[i];
      const c = i >= bpp ? up[i - bpp] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[r + 1 + i] = (line[i] - p) & 255;
    }
    up = line;
  }
  return out;
}

interface PngSpec {
  w: number;
  h: number;
  ct: number;
  depth: number;
  sample: (x: number, y: number) => number[];
  palette?: number[][];
  trns?: number[];
  interlace?: boolean;
  /** IDAT を分ける大きさ */
  split?: number;
  /** 行 (飛び越しはパスの中の行) のフィルタの種類 (既定は y % 5。パスの最初の行は 0) */
  filterOf?: (y: number) => number;
}
function png(s: PngSpec): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s.w, 0);
  ihdr.writeUInt32BE(s.h, 4);
  ihdr[8] = s.depth;
  ihdr[9] = s.ct;
  ihdr[12] = s.interlace ? 1 : 0;
  let raw: Buffer;
  if (!s.interlace) raw = scanlines(s.w, s.h, s.ct, s.depth, s.sample, undefined, undefined, s.filterOf);
  else {
    // Adam7 (PNG の仕様 §8.2)
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    const parts: Buffer[] = [];
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((s.w - x0) / dx);
      const ph = Math.ceil((s.h - y0) / dy);
      if (pw > 0 && ph > 0) parts.push(scanlines(pw, ph, s.ct, s.depth, s.sample, (x) => x0 + x * dx, (y) => y0 + y * dy, s.filterOf));
    }
    raw = Buffer.concat(parts);
  }
  const list = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (s.palette) list.push(chunk('PLTE', Uint8Array.from(s.palette.flat())));
  if (s.trns) list.push(chunk('tRNS', Uint8Array.from(s.trns)));
  const z = deflateSync(raw);
  const step = s.split ?? z.length;
  for (let i = 0; i < z.length; i += step) list.push(chunk('IDAT', z.subarray(i, i + step)));
  list.push(chunk('IEND', new Uint8Array(0)));
  return new Uint8Array(Buffer.concat(list));
}

const W = 23;
const H = 17;
const v8 = (x: number, y: number, k = 0) => (x * 37 + y * 11 + k * 53) & 255;
const PAL = Array.from({ length: 200 }, (_, i) => [i, (i * 7) & 255, 255 - i]);
/** 試す PNG の形と、展開せずに入れるか (bits16 のとき / bits16 でないとき) */
const CASES: [string, PngSpec, boolean, boolean][] = [
  ['灰 1 ビット', { w: W, h: H, ct: 0, depth: 1, sample: (x, y) => [(x + y) & 1] }, true, true],
  ['灰 2 ビット', { w: W, h: H, ct: 0, depth: 2, sample: (x, y) => [(x + y) & 3] }, true, true],
  ['灰 4 ビット', { w: W, h: H, ct: 0, depth: 4, sample: (x, y) => [(x * 3 + y) & 15] }, true, true],
  ['灰 8 ビット', { w: W, h: H, ct: 0, depth: 8, sample: (x, y) => [v8(x, y)], split: 40 }, true, true],
  ['灰 16 ビット', { w: W, h: H, ct: 0, depth: 16, sample: (x, y) => [v8(x, y) * 256 + ((x * y) & 255)] }, true, false],
  ['RGB 8 ビット', { w: W, h: H, ct: 2, depth: 8, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2)] }, true, true],
  ['RGB 16 ビット', { w: W, h: H, ct: 2, depth: 16, sample: (x, y) => [0, 1, 2].map((k) => v8(x, y, k) * 256 + (x & 255)) }, true, false],
  ['色の表 1 ビット', { w: W, h: H, ct: 3, depth: 1, palette: [[255, 255, 255], [200, 0, 10]], sample: (x, y) => [(x ^ y) & 1] }, true, true],
  ['色の表 2 ビット (表に無い番号を含む)', { w: W, h: H, ct: 3, depth: 2, palette: [[0, 0, 255], [255, 255, 0]], sample: (x) => [x % 4] }, true, true],
  ['色の表 4 ビット', { w: W, h: H, ct: 3, depth: 4, palette: PAL.slice(0, 16), sample: (x, y) => [(x + y) & 15] }, true, true],
  ['色の表 8 ビット', { w: W, h: H, ct: 3, depth: 8, palette: PAL, sample: (x, y) => [(x + y * 3) % 200] }, true, true],
  ['色の表と tRNS', { w: W, h: H, ct: 3, depth: 8, palette: PAL, trns: [0, 128, 255, 64], sample: (x, y) => [(x + y) % 200] }, false, false],
  ['RGB と tRNS', { w: W, h: H, ct: 2, depth: 8, trns: [0, 10, 0, 20, 0, 30], sample: (x, y) => (x === y ? [10, 20, 30] : [v8(x, y), 0, 0]) }, false, false],
  ['灰と tRNS', { w: W, h: H, ct: 0, depth: 4, trns: [0, 3], sample: (x, y) => [(x + y) & 15] }, false, false],
  ['飛び越しの RGB', { w: W, h: H, ct: 2, depth: 8, interlace: true, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2)] }, false, false],
  ['飛び越しの色の表', { w: W, h: H, ct: 3, depth: 4, interlace: true, palette: PAL.slice(0, 16), sample: (x, y) => [(x + y) & 15] }, false, false],
  ['灰と α', { w: W, h: H, ct: 4, depth: 8, sample: (x, y) => [v8(x, y), x % 3 ? 255 : 100] }, false, false],
  ['RGBA 8 ビット', { w: W, h: H, ct: 6, depth: 8, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2), y % 4 ? 255 : 60] }, false, false],
  ['RGBA 8 ビット (不透明)', { w: W, h: H, ct: 6, depth: 8, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2), 255] }, false, false],
  ['RGBA 16 ビット', { w: W, h: H, ct: 6, depth: 16, sample: (x, y) => [0, 1, 2, 3].map((k) => (k === 3 ? (x % 2 ? 65535 : 30000) : v8(x, y, k) * 256)) }, false, false],
  ['RGBA 8 ビット (1 行目が平均のフィルタ)', { w: W, h: H, ct: 6, depth: 8, filterOf: (y) => (y + 3) % 5, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2), (x * 9 + y) & 255] }, false, false],
  ['RGBA 8 ビット (1 行目が Paeth のフィルタ)', { w: W, h: H, ct: 6, depth: 8, filterOf: (y) => (y + 4) % 5, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2), (x * 9 + y) & 255] }, false, false],
  ['灰と α 8 ビット (1 行目が Paeth のフィルタ)', { w: W, h: H, ct: 4, depth: 8, filterOf: (y) => (y + 4) % 5, sample: (x, y) => [v8(x, y), x % 3 ? 255 : 100] }, false, false],
  ['灰と α 16 ビット', { w: W, h: H, ct: 4, depth: 16, sample: (x, y) => [v8(x, y) * 256 + 7, (x % 3 ? 255 : 100) * 256] }, false, false],
  ['RGB 16 ビットと tRNS', { w: W, h: H, ct: 2, depth: 16, trns: [1, 2, 3, 4, 5, 6], sample: (x, y) => (x === y ? [0x102, 0x304, 0x506] : [v8(x, y) * 256, 0, 1]) }, false, false],
  ['灰 16 ビットと tRNS', { w: W, h: H, ct: 0, depth: 16, trns: [0x12, 0x34], sample: (x, y) => [x === y ? 0x1234 : 0x1200 + x] }, false, false],
  ['灰 1 ビットと tRNS', { w: W, h: H, ct: 0, depth: 1, trns: [0, 1], sample: (x, y) => [(x + y) & 1] }, false, false],
  ['色の表 2 ビットと短い tRNS', { w: W, h: H, ct: 3, depth: 2, palette: [[0, 0, 255], [255, 255, 0], [9, 9, 9]], trns: [30], sample: (x) => [x % 4] }, false, false],
  ['飛び越しの RGBA (パスの最初の行も平均・Paeth のフィルタ)', { w: W, h: H, ct: 6, depth: 8, interlace: true, filterOf: (y) => (y + 3) % 5, sample: (x, y) => [v8(x, y), v8(x, y, 1), v8(x, y, 2), y % 4 ? 255 : 60] }, false, false],
  ['飛び越しの灰 2 ビット', { w: W, h: H, ct: 0, depth: 2, interlace: true, filterOf: (y) => (y + 1) % 5, sample: (x, y) => [(x * 3 + y) & 3] }, false, false],
  ['飛び越しの RGB 16 ビット', { w: 9, h: 11, ct: 2, depth: 16, interlace: true, sample: (x, y) => [0, 1, 2].map((k) => v8(x, y, k) * 256 + 3) }, false, false],
];

/** 画像の流れの辞書の値 */
const num = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as PDFNumber | undefined)?.asNumber();

/**
 * PDF の画像の XObject (FlateDecode、Predictor 15 か無し) を、8 ビットの RGB と α (SMask) に読み戻す (ISO 32000-2 §7.4.4.4・§8.9.5)。
 * 16 ビットの成分は、pdf-lib の展開 (UPNG) と同じく上位の 8 ビットにする (比べるため)
 */
function readImage(pdf: PDFDocument, ref: PDFRef): { rgb: number[]; alpha?: number[]; bpc: number; asIs: boolean } {
  const s = pdf.context.lookup(ref) as PDFRawStream;
  expect(s).toBeInstanceOf(PDFRawStream);
  const d = s.dict;
  expect(d.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
  const w = num(d, 'Width')!;
  const h = num(d, 'Height')!;
  const bpc = num(d, 'BitsPerComponent')!;
  const csObj = d.lookup(PDFName.of('ColorSpace'));
  let colors = 3;
  let table: Uint8Array | undefined;
  if (csObj === PDFName.of('DeviceGray')) colors = 1;
  else if (csObj instanceof PDFArray) {
    expect(csObj.lookup(0)).toBe(PDFName.of('Indexed'));
    expect(csObj.lookup(1)).toBe(PDFName.of('DeviceRGB'));
    const hival = (csObj.lookup(2) as PDFNumber).asNumber();
    table = (csObj.lookup(3) as PDFHexString).asBytes();
    expect(table.length).toBe((hival + 1) * 3);
    colors = 1;
  } else expect(csObj).toBe(PDFName.of('DeviceRGB'));
  let data = new Uint8Array(inflateSync(s.contents));
  const parms = d.lookup(PDFName.of('DecodeParms')) as PDFDict | undefined;
  const rowBytes = Math.ceil((w * colors * bpc) / 8);
  if (parms) {
    expect(num(parms, 'Predictor')).toBe(15);
    expect(num(parms, 'Colors')).toBe(colors);
    expect(num(parms, 'BitsPerComponent')).toBe(bpc);
    expect(num(parms, 'Columns')).toBe(w);
    const bpp = Math.max(1, (colors * bpc) >> 3);
    const out = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      const f = data[y * (rowBytes + 1)];
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? out[y * rowBytes + i - bpp] : 0;
        const b = y ? out[(y - 1) * rowBytes + i] : 0;
        const c = y && i >= bpp ? out[(y - 1) * rowBytes + i - bpp] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
        out[y * rowBytes + i] = (data[y * (rowBytes + 1) + 1 + i] + p) & 255;
      }
    }
    data = out;
  }
  expect(data.length).toBe(rowBytes * h);
  const sampleAt = (y: number, k: number) => {
    const bit = k * bpc;
    const at = y * rowBytes + (bit >> 3);
    if (bpc === 16) return data[at];
    if (bpc === 8) return data[at];
    return (data[at] >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1);
  };
  const rgb: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (table) {
        const i = sampleAt(y, x);
        rgb.push(table[i * 3], table[i * 3 + 1], table[i * 3 + 2]);
      } else if (colors === 1) {
        const v = sampleAt(y, x);
        const g = bpc >= 8 ? v : (v * 255) / ((1 << bpc) - 1);
        rgb.push(g, g, g);
      } else for (let k = 0; k < 3; k++) rgb.push(sampleAt(y, x * 3 + k));
    }
  const smask = d.get(PDFName.of('SMask'));
  const alpha = smask instanceof PDFRef ? readImage(pdf, smask).rgb.filter((_, i) => i % 3 === 0) : undefined;
  return { rgb, alpha, bpc, asIs: !!parms };
}

/**
 * 仕様 (W3C の PNG の仕様 (Second Edition) §11.2〜11.3・§13.12) から求めた画素: 8 ビットの RGB と α (全部 255 なら無し)。
 * 16 ビットは上位の 8 ビット、色の表に無い番号は黒 (pdf-lib の展開と同じ決め)
 */
function expected(s: PngSpec) {
  const rgb: number[] = [];
  const alpha: number[] = [];
  const max = (1 << Math.min(s.depth, 8)) - 1;
  const hi = (v: number) => (s.depth === 16 ? v >> 8 : s.depth < 8 ? (v * 255) / max : v);
  const t16 = (i: number) => (s.trns![i] << 8) | s.trns![i + 1];
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const v = s.sample(x, y);
      let a = 255;
      if (s.ct === 3) {
        const c = s.palette![v[0]] ?? [0, 0, 0];
        rgb.push(...c);
        if (s.trns && v[0] < s.trns.length) a = s.trns[v[0]];
      } else if (s.ct === 0 || s.ct === 4) {
        rgb.push(hi(v[0]), hi(v[0]), hi(v[0]));
        if (s.ct === 4) a = hi(v[1]);
        else if (s.trns && v[0] === t16(0)) a = 0;
      } else {
        rgb.push(hi(v[0]), hi(v[1]), hi(v[2]));
        if (s.ct === 6) a = hi(v[3]);
        else if (s.trns && v[0] === t16(0) && v[1] === t16(2) && v[2] === t16(4)) a = 0;
      }
      alpha.push(a);
    }
  return { rgb, alpha: alpha.every((a) => a === 255) ? undefined : alpha };
}

/**
 * pdf-lib の展開 (UPNG) が仕様と違う画素を出す形: 飛び越しの PNG (走査線の大きさを少なく見積もり、終わりの画素を落とすことがある。
 * この大きさの 4 ビットの画像など。パスの最初の行の平均のフィルタも、1 つ目のパスの位置を戻す) と、16 ビットの灰の tRNS (違う位置の 2 バイトと比べる)
 */
const upngDiffers = (s: PngSpec) => !!s.interlace || (s.ct === 0 && s.depth === 16 && !!s.trns);

/** pdf-lib の展開 (UPNG) の画素 (いままでの埋め込みの画素) */
function upng(b: Uint8Array) {
  const p = PNG.load(b);
  return { rgb: Array.from(p.rgbChannel), alpha: p.alphaChannel ? Array.from(p.alphaChannel) : undefined };
}

describe('PNG の埋め込み (embedPngChecked)', () => {
  for (const [name, spec, asIs16, asIs8] of CASES)
    it(`${name}: 読み戻した画素が仕様の画素と同じ${upngDiffers(spec) ? '' : ' (pdf-lib の展開とも同じ)'}${asIs16 ? ' (展開せずに入れる)' : ''}`, async () => {
      const b = png(spec);
      const ref = expected(spec);
      // いままでの埋め込み (pdf-lib の展開) と同じ画素 (pdf-lib の展開の誤りに当たる形のほか)
      if (!upngDiffers(spec)) expect(upng(b)).toEqual(ref);
      for (const bits16 of [true, false]) {
        const pdf = await PDFDocument.create();
        const img = await embedPngChecked(pdf, b, { bits16 });
        expect([img.width, img.height]).toEqual([spec.w, spec.h]);
        const got = readImage(pdf, img.ref);
        expect(got.asIs).toBe(bits16 ? asIs16 : asIs8);
        if (!bits16) expect(got.bpc).toBeLessThanOrEqual(8);
        expect(got.rgb).toEqual(ref.rgb);
        expect(got.alpha).toEqual(ref.alpha);
      }
    });

  it('展開した画素は、渡した圧縮の関数で圧縮する (pdf-lib の pako を通さない)。同じ入力は同じバイト列', async () => {
    const b = png(CASES.find((c) => c[0] === 'RGBA 8 ビット')![1]);
    const calls: number[] = [];
    const deflate = imageDeflater((d) => (calls.push(d.length), deflateSync(d, { level: 1 })));
    const streams = async () => {
      const pdf = await PDFDocument.create();
      await embedPngChecked(pdf, b, { deflate });
      return pdf.context
        .enumerateIndirectObjects()
        .map(([, o]) => o)
        .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
        .map((o) => [o.dict.toString(), Buffer.from(o.contents).toString('hex')]);
    };
    const first = await streams();
    // RGB と α の 2 つ
    expect(calls).toEqual([W * H * 3, W * H]);
    expect(first.length).toBe(2);
    expect(await streams()).toEqual(first);
  });

  it('展開せずに入れない PNG: IHDR が最初でない・色の表が IDAT の後・色の表の項が多すぎる・色の表が無い', async () => {
    const base = png(CASES.find((c) => c[0] === '色の表 4 ビット')![1]);
    const pdf = await PDFDocument.create();
    expect(await embedPngAsIs(pdf, base)).toBeDefined();
    const parts: { type: string; at: number; end: number }[] = [];
    for (let at = 8; at < base.length; ) {
      const len = new DataView(base.buffer).getUint32(at);
      parts.push({ type: String.fromCharCode(...base.subarray(at + 4, at + 8)), at, end: at + 12 + len });
      at += 12 + len;
    }
    const part = (t: string) => base.subarray(parts.find((p) => p.type === t)!.at, parts.find((p) => p.type === t)!.end);
    const join = (...xs: Uint8Array[]) => new Uint8Array(Buffer.concat([base.subarray(0, 8), ...xs]));
    expect(await embedPngAsIs(pdf, join(part('PLTE'), part('IHDR'), part('IDAT'), part('IEND')))).toBeUndefined();
    expect(await embedPngAsIs(pdf, join(part('IHDR'), part('IDAT'), part('PLTE'), part('IEND')))).toBeUndefined();
    expect(await embedPngAsIs(pdf, join(part('IHDR'), chunk('PLTE', new Uint8Array(17 * 3)), part('IDAT'), part('IEND')))).toBeUndefined();
    expect(await embedPngAsIs(pdf, join(part('IHDR'), part('IDAT'), part('IEND')))).toBeUndefined();
    // 16 ビットは bits16 のときだけ
    const g16 = png(CASES.find((c) => c[0] === '灰 16 ビット')![1]);
    expect(await embedPngAsIs(pdf, g16)).toBeUndefined();
    expect(await embedPngAsIs(pdf, g16, { bits16: true })).toBeDefined();
  });

  it('PDF/X の灰色の PNG (embedCmykImage): 16 ビットは bits16 のときだけそのまま入れ、ほかは展開して 8 ビットの DeviceGray にする', async () => {
    const g16 = png(CASES.find((c) => c[0] === '灰 16 ビット')![1]);
    const toCmyk = () => [0, 0, 0, 1];
    for (const bits16 of [true, false]) {
      const pdf = await PDFDocument.create();
      const r = await embedCmykImage(pdf, g16, 'png', toCmyk, 'smask', { bits16 });
      const got = readImage(pdf, r!.image!.ref);
      expect(got.bpc).toBe(bits16 ? 16 : 8);
      expect(got.rgb).toEqual(upng(g16).rgb);
    }
  });
});

/** PNG の IDAT をつないだ zlib の列を、終わりの cut バイト (cut が 1 未満なら、その割合) を切ったものにする (チャンクの CRC は付け直す) */
function cutIdat(b: Uint8Array, cut: number): Uint8Array {
  const list: Buffer[] = [Buffer.from(b.subarray(0, 8))];
  const idat: Uint8Array[] = [];
  for (let at = 8; at < b.length; ) {
    const len = new DataView(b.buffer, b.byteOffset).getUint32(at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    const body = b.subarray(at + 8, at + 8 + len);
    if (type === 'IDAT') idat.push(body);
    else {
      const all = Buffer.concat(idat);
      if (type === 'IEND') list.push(chunk('IDAT', all.subarray(0, all.length - (cut < 1 ? Math.ceil(all.length * cut) : cut))));
      list.push(chunk(type, body));
    }
    at += 12 + len;
  }
  return new Uint8Array(Buffer.concat(list));
}

/** Node の process.getBuiltinModule を一時に無くして f を呼ぶ (束の道具が process を差し込む環境など) */
async function withoutBuiltins<T>(f: () => Promise<T>): Promise<T> {
  const proc = process as { getBuiltinModule?: unknown };
  const orig = proc.getBuiltinModule;
  proc.getBuiltinModule = undefined;
  try {
    return await f();
  } finally {
    proc.getBuiltinModule = orig;
  }
}

describe('画素のデータが切れた PNG (展開せずに入れる形も断る)', () => {
  const asIsCases = CASES.filter(([, , asIs16]) => asIs16);
  for (const [name, spec] of asIsCases)
    it(`${name}: IDAT の終わりを切ったものは「画素のデータが壊れています」`, async () => {
      const b = cutIdat(png(spec), 0.5);
      for (const bits16 of [true, false]) await expect(embedPngChecked(await PDFDocument.create(), b, { bits16 })).rejects.toThrow(/壊れて/);
      // Node の zlib の無い環境 (自前の展開で確かめる) でも同じ
      await withoutBuiltins(async () => expect(embedPngChecked(await PDFDocument.create(), b, { bits16: true })).rejects.toThrow(/壊れて/));
    });

  it('切れていない PNG は、Node の zlib の無い環境でも、展開せずに入れる', async () => {
    for (const [, spec] of asIsCases) {
      const pdf = await PDFDocument.create();
      const img = await withoutBuiltins(() => embedPngChecked(pdf, png(spec), { bits16: true }));
      expect(readImage(pdf, img.ref).asIs).toBe(true);
    }
  });

  it('IDAT の後に余りのあるもの (走査線の大きさより長く展開できる) は、そのまま入れる', async () => {
    const spec = CASES.find((c) => c[0] === '色の表 8 ビット')![1];
    const raw = scanlines(spec.w, spec.h, spec.ct, spec.depth, spec.sample);
    const longer = png({ ...spec });
    // 走査線のあとに 100 バイト多い zlib の列にした PNG
    const z = deflateSync(Buffer.concat([raw, Buffer.alloc(100)]));
    const b = cutIdat(longer, 0);
    const parts: Buffer[] = [];
    for (let at = 8; at < b.length; ) {
      const len = new DataView(b.buffer, b.byteOffset).getUint32(at);
      const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
      parts.push(type === 'IDAT' ? chunk('IDAT', z) : Buffer.from(b.subarray(at, at + 12 + len)));
      at += 12 + len;
    }
    const pdf = await PDFDocument.create();
    const img = await embedPngChecked(pdf, new Uint8Array(Buffer.concat([Buffer.from(b.subarray(0, 8)), ...parts])));
    expect(readImage(pdf, img.ref).rgb.length).toBe(spec.w * spec.h * 3);
  });
});

/** PNG の最後の走査線のフィルタの種類のバイトを value にしたもの (IDAT を作り直す。飛び越しでも、最後のパスの最後の行は全幅) */
function withLastFilter(spec: PngSpec, value: number): Uint8Array {
  const b = png(spec);
  const idat: Uint8Array[] = [];
  const rest: Buffer[] = [];
  for (let at = 8; at < b.length; ) {
    const len = new DataView(b.buffer, b.byteOffset).getUint32(at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + len));
    else rest.push(Buffer.from(b.subarray(at, at + 12 + len)));
    at += 12 + len;
  }
  const raw = Buffer.from(inflateSync(Buffer.concat(idat)));
  raw[raw.length - (Math.ceil((spec.w * CHANNELS[spec.ct] * spec.depth) / 8) + 1)] = value;
  const iend = rest.pop()!;
  return new Uint8Array(Buffer.concat([Buffer.from(b.subarray(0, 8)), ...rest, chunk('IDAT', deflateSync(raw)), iend]));
}

describe('走査線のフィルタの種類のバイトが 5 以上の PNG (PNG の仕様 §9.2 に無い種類)', () => {
  for (const [name, spec] of CASES)
    it(`${name}: 最後の行の種類を 9 にしたものは「画素のデータが壊れています」(展開せずに入れる形も、pdf-lib の展開に渡す形も)`, async () => {
      const b = withLastFilter(spec, 9);
      for (const bits16 of [true, false]) await expect(embedPngChecked(await PDFDocument.create(), b, { bits16 })).rejects.toThrow(/壊れて/);
      await withoutBuiltins(async () => expect(embedPngChecked(await PDFDocument.create(), b, { bits16: true })).rejects.toThrow(/壊れて/));
      // 種類 4 (Paeth) までは入れる
      await expect(embedPngChecked(await PDFDocument.create(), withLastFilter(spec, 4), { bits16: true })).resolves.toBeDefined();
    });
});

describe('圧縮の関数を決める順 (imageDeflater) と sha256 の道', () => {
  afterEach(() => vi.unstubAllGlobals());
  const data = new Uint8Array(70000).map((_, i) => (i * 31) ^ (i >> 7));

  it('Node の zlib の道: zlib の形で、元に戻る', async () => {
    expect(Buffer.from(inflateSync(await imageDeflater()(data))).equals(Buffer.from(data))).toBe(true);
  });

  it('process.getBuiltinModule の無い環境では CompressionStream の道 (zlib の形。RFC 1950)', async () => {
    expect(typeof CompressionStream).toBe('function');
    const out = await withoutBuiltins(() => imageDeflater()(data));
    // zlib の頭 (RFC 1950 §2.2: CM = 8、CMF・FLG が 31 の倍数)
    expect(out[0] & 15).toBe(8);
    expect(((out[0] << 8) | out[1]) % 31).toBe(0);
    expect(Buffer.from(inflateSync(out)).equals(Buffer.from(data))).toBe(true);
    // 空のバイト列も
    expect(inflateSync(await withoutBuiltins(() => imageDeflater()(new Uint8Array(0)))).length).toBe(0);
  });

  it('CompressionStream も無い環境では pako の道 (zlib の形)', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const out = await withoutBuiltins(() => imageDeflater()(data));
    expect(Buffer.from(inflateSync(out)).equals(Buffer.from(data))).toBe(true);
  });

  it('どの道で入れた PNG も、読み戻した画素が同じ', async () => {
    const b = png(CASES.find((c) => c[0] === 'RGBA 8 ビット')![1]);
    const read = async (pdf: PDFDocument, p: Promise<{ ref: PDFRef }>) => readImage(pdf, (await p).ref);
    const pdfs = [await PDFDocument.create(), await PDFDocument.create(), await PDFDocument.create()];
    const node = await read(pdfs[0], embedPngChecked(pdfs[0], b));
    const cs = await withoutBuiltins(() => read(pdfs[1], embedPngChecked(pdfs[1], b)));
    vi.stubGlobal('CompressionStream', undefined);
    const pako = await withoutBuiltins(() => read(pdfs[2], embedPngChecked(pdfs[2], b)));
    expect(cs).toEqual(node);
    expect(pako).toEqual(node);
  });

  it('sha256: Node の crypto の道 (64KB 以上) と、自前の計算の道 (64KB 未満・crypto の無い環境) が同じ値', async () => {
    const { createHash } = await import('node:crypto');
    const ref = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');
    const small = data.subarray(0, 1000);
    const { sha256, sha256Js } = await import('../src/sha256');
    expect(sha256(data)).toBe(ref(data));
    expect(sha256(small)).toBe(ref(small));
    expect(sha256Js(data)).toBe(ref(data));
    // crypto の無い環境で読み込んだもの (読み込むときに Node の crypto を取るので、読み込み直す)
    vi.resetModules();
    const bare = await withoutBuiltins(() => import('../src/sha256'));
    expect(bare.sha256).not.toBe(sha256);
    expect(bare.sha256(data)).toBe(ref(data));
    expect(bare.sha256(small)).toBe(ref(small));
  });
});

describe('ブラウザ・Web Worker の展開の道 (DecompressionStream) と、動く PNG', () => {
  it('Node の zlib の無い環境 (DecompressionStream で展開する) でも、どの形も同じ画素になる', async () => {
    expect(typeof DecompressionStream).toBe('function');
    for (const [, spec] of CASES) {
      const b = png(spec);
      const node = await decodePngForPdf(b);
      const ds = await withoutBuiltins(() => decodePngForPdf(b));
      expect(ds).toEqual(node);
    }
  });

  it('inflateZlib: DecompressionStream の道は、走査線の大きさに届いたら読むのを止め、初めの limit バイトを返す。壊れた圧縮は、壊れた所まで (自前の展開)', async () => {
    const data = new Uint8Array(300000).map((_, i) => (i * 7) ^ (i >> 9));
    const z = new Uint8Array(deflateSync(data));
    const head = await withoutBuiltins(() => inflateZlib(z, 1000));
    expect(head.length).toBe(1000);
    expect(Buffer.from(head).equals(Buffer.from(data.subarray(0, 1000)))).toBe(true);
    const whole = await withoutBuiltins(() => inflateZlib(z, data.length));
    expect(Buffer.from(whole).equals(Buffer.from(data))).toBe(true);
    // 途中で切れた圧縮: 出せた所まで (limit に足りない)
    const cut = await withoutBuiltins(() => inflateZlib(z.subarray(0, z.length >> 1), data.length));
    expect(cut.length).toBeLessThan(data.length);
    expect(cut.length).toBeGreaterThan(0);
    expect(Buffer.from(cut).equals(Buffer.from(data.subarray(0, cut.length)))).toBe(true);
    // 壊れた圧縮 (頭の後を乱す)
    const bad = z.slice();
    for (let i = 10; i < 40; i++) bad[i] = 0xff;
    const broken = await withoutBuiltins(() => inflateZlib(bad, data.length));
    expect(broken.length).toBeLessThan(data.length);
  });

  it('動く PNG (acTL のコマが 2 つ以上) は断る。コマが 1 つなら、IDAT の画像を入れる', async () => {
    const spec = CASES.find((c) => c[0] === 'RGBA 8 ビット')![1];
    const b = png(spec);
    const actl = (frames: number) => {
      const body = Buffer.alloc(8);
      body.writeUInt32BE(frames, 0);
      // IHDR の後に acTL を入れる
      return new Uint8Array(Buffer.concat([Buffer.from(b.subarray(0, 33)), chunk('acTL', body), Buffer.from(b.subarray(33))]));
    };
    expect(await decodePngForPdf(actl(2))).toBe('animated');
    await expect(embedPngChecked(await PDFDocument.create(), actl(2))).rejects.toThrow(/動く PNG/);
    const one = await decodePngForPdf(actl(1));
    expect(one).toEqual(await decodePngForPdf(b));
  });
});

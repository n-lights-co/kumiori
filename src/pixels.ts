/**
 * pixels — 画像を Canvas に描けない環境 (Node) のための、画素の読み書き。
 *  - GIF (最初の画像。LZW・飛び越し・透明色) と BMP (1・4・8・16・24・32 ビット。圧縮なしとビットフィールド) の画素を読む
 *  - 画素を PNG にする (PDF には PNG として入れる。圧縮は CompressionStream の deflate)
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA (1 画素 4 バイト、上の行から) */
  rgba: Uint8Array;
}

import { inflateZlib } from './imageDeflate';
import { BMP_RLE_PIXELS_PER_BYTE, DEFLATE_MAX_RATIO, maxPixels, gifPixelBudget, pixelBudget } from './imageLimits';
import { msg } from './messages';
import { rejoin, thisCall } from './callContext';

/** 画素の数の上限 (imageLimits.ts。ここからも引けるようにしてある) */
export { MAX_PIXELS, maxPixels } from './imageLimits';

/** GIF の最初の画像の画素。読めなければ undefined */
export function decodeGif(b: Uint8Array): Pixels | undefined {
  if (b.length < 13 || String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') return undefined;
  const u16 = (o: number) => b[o] | (b[o + 1] << 8);
  const W = u16(6);
  const H = u16(8);
  // 画素の数は、MAX_PIXELS とファイルの大きさの両方で縛る (imageLimits.ts の gifPixelBudget)
  const budget = gifPixelBudget(b.length);
  if (!W || !H || W * H > budget) return undefined;
  let p = 13;
  let gct: Uint8Array | undefined;
  if (b[10] & 0x80) {
    const n = 3 * (1 << ((b[10] & 7) + 1));
    gct = b.subarray(p, p + n);
    p += n;
  }
  let transparent = -1;
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x21) {
      // 拡張: 画像の制御 (透明色) だけ読み、ほかは読み飛ばす
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4 && b[p + 1] & 1) transparent = b[p + 4];
      while (p < b.length && b[p] !== 0) p += b[p] + 1;
      p++;
    } else if (t === 0x2c) {
      const ix = u16(p);
      const iy = u16(p + 2);
      const iw = u16(p + 4);
      const ih = u16(p + 6);
      const f = b[p + 8];
      p += 9;
      let ct = gct;
      if (f & 0x80) {
        const n = 3 * (1 << ((f & 7) + 1));
        ct = b.subarray(p, p + n);
        p += n;
      }
      if (!ct || iw * ih > budget) return undefined;
      const minSize = b[p++];
      if (minSize < 2 || minSize > 11) return undefined;
      // データの小区画をつなぐ
      let size = 0;
      for (let q = p; q < b.length && b[q] !== 0; q += b[q] + 1) size += b[q];
      const data = new Uint8Array(size);
      for (let o = 0; p < b.length && b[p] !== 0; p += b[p] + 1) {
        data.set(b.subarray(p + 1, p + 1 + b[p]), o);
        o += b[p];
      }
      const idx = lzw(data, minSize, iw * ih);
      // 飛び越し (interlace) の行の順: 8 行おき (0 から・4 から)、4 行おき (2 から)、2 行おき (1 から)
      const rows: number[] = [];
      if (f & 0x40) for (const [s, d] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = s; r < ih; r += d) rows.push(r);
      else for (let r = 0; r < ih; r++) rows.push(r);
      const rgba = new Uint8Array(W * H * 4);
      rows.forEach((row, k) => {
        const y = iy + row;
        if (y >= H) return;
        for (let x = 0; x < iw && ix + x < W; x++) {
          const ci = idx[k * iw + x];
          if (ci === transparent || ci * 3 + 2 >= ct!.length) continue;
          const o = (y * W + ix + x) * 4;
          rgba[o] = ct![ci * 3];
          rgba[o + 1] = ct![ci * 3 + 1];
          rgba[o + 2] = ct![ci * 3 + 2];
          rgba[o + 3] = 255;
        }
      });
      return { width: W, height: H, rgba };
    } else return undefined;
  }
  return undefined;
}

/** GIF の LZW を展開して、色の番号を n 個返す (足りない分は 0) */
function lzw(data: Uint8Array, minSize: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const len = new Int32Array(4096);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    len[i] = 1;
  }
  let size = minSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let acc = 0;
  let bits = 0;
  let ip = 0;
  let op = 0;
  while (op < n) {
    while (bits < size) {
      if (ip >= data.length) return out;
      acc |= data[ip++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi || code > next || (prev === -1 && code >= clear)) break;
    if (prev !== -1 && next < 4096) {
      // 新しい列 = 前の列 + (いまの列の最初の字。いまの列がまだ無ければ前の列の最初の字)
      prefix[next] = prev;
      suffix[next] = code === next ? first[prev] : first[code];
      first[next] = first[prev];
      len[next] = len[prev] + 1;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    // 列を書く (後ろから、前の列へたどる)
    const l = len[code];
    for (let k = l - 1, c = code; k >= 0; k--, c = prefix[c]) if (op + k < n) out[op + k] = suffix[c];
    op += l;
    prev = code;
  }
  return out;
}

/**
 * PNG を展開してよいか (画素の数が MAX_PIXELS まで、かつ、展開した走査線の大きさが IDAT の大きさの DEFLATE_MAX_RATIO 倍まで)。
 * 画像を描けない環境 (Node) で、pdf-lib の embedPng は、IHDR の寸法のとおりに走査線・RGBA・RGB・透明度の配列を作ってから展開するので、
 * 寸法だけが大きい 65 バイトの PNG で、9 秒・1.3GB を使っていた。PNG の画素の並びは zlib (deflate) で圧縮する
 * (W3C の PNG の仕様 (Second Edition) §10.1) ので、正当な PNG の走査線は IDAT の 1,032 倍より大きくならない (RFC 1951)。
 * 走査線の大きさは、少なく見積もる (幅 × 高さ × 1 画素のビット数 / 8。インターレースの PNG はこれより大きい) ので、正当な PNG は断らない。
 * PNG でない・頭の読めないものは false
 */
export function pngWithinLimits(b: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pixelBits = 0;
  let pixels = 0;
  let idat = 0;
  let width = 0;
  let height = 0;
  let framePixels = 0;
  for (let at = 8; at + 12 <= b.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    // IHDR は、最初のチャンクで、長さ 13、1 つだけ (PNG の仕様 §5.6・§11.2.2)。そうでない IHDR のある PNG は読まない: 展開する側 (pdf-lib の UPNG) は、
    // 長さも位置も見ずに、最後に出てきた IHDR の寸法を使うので、ここで見た寸法と違う寸法 (2 つ目の IHDR の 10000 × 10000) で配列を作らせられる
    if (type === 'IHDR' && (at !== 8 || len !== 13)) return false;
    // 動く PNG (APNG) のコマ (fcTL: 連番 4 バイト、幅・高さ、位置 x・y …。APNG の仕様の「fcTL」): コマの矩形は画像の中に収まること。
    // 展開する側は、コマごとに、矩形の大きさの配列と画像の全体の写しを作るので、コマの画素と画像の画素の合計を、上限の内にする
    if (type === 'fcTL') {
      if (len < 26 || at + 8 + 20 > b.length) return false;
      const fw = dv.getUint32(at + 12);
      const fh = dv.getUint32(at + 16);
      if (!fw || !fh || fw + dv.getUint32(at + 20) > width || fh + dv.getUint32(at + 24) > height) return false;
      framePixels += fw * fh + width * height;
      if (framePixels > maxPixels()) return false;
    }
    if (type === 'IHDR' && len >= 13 && at + 21 <= b.length) {
      width = dv.getUint32(at + 8);
      height = dv.getUint32(at + 12);
      pixels = dv.getUint32(at + 8) * dv.getUint32(at + 12);
      // 1 画素のビット数 = 標本の数 × ビットの深さ (PNG の仕様 §11.2.2 の Table 11.1: 色の型 0 灰・2 RGB・3 色の表・4 灰と α・6 RGBA)
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[b[at + 17]] ?? 0;
      pixelBits = channels * b[at + 16];
    } else if (type === 'IDAT') idat += Math.min(len, b.length - at - 8);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  return pixels > 0 && pixelBits > 0 && pixels <= maxPixels() && (pixels * pixelBits) / 8 <= DEFLATE_MAX_RATIO * idat;
}

/** 飛び越し (Adam7。PNG の仕様 §8.2) の 7 つのパスの、始めの位置と間隔 (x0, y0, dx, dy) */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** 飛び越しの PNG の、展開した走査線の大きさ (パスごとの「(1 行のバイト数 + 1) × 行の数」の和。画素の無いパスは行も無い。§8.2) */
function adam7Size(width: number, height: number, bpp: number): number {
  let n = 0;
  for (const [x0, y0, dx, dy] of ADAM7) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw > 0 && ph > 0) n += (Math.ceil((pw * bpp) / 8) + 1) * ph;
  }
  return n;
}

/**
 * 展開した PNG の走査線の、各行の頭のフィルタの種類のバイトが 0〜4 か (PNG の仕様 §9.2。5 以上は無い種類で、PDF の PNG の予測
 * (Predictor 15) の読み手によって描き方が違う)。bpp は 1 画素のビット数、interlace は Adam7 の飛び越し
 */
export function pngFilterBytesOk(raw: Uint8Array, width: number, height: number, bpp: number, interlace: boolean): boolean {
  const check = (pw: number, ph: number, at: number): number => {
    const stride = Math.ceil((pw * bpp) / 8) + 1;
    for (let y = 0; y < ph; y++) if (raw[at + y * stride] > 4) return -1;
    return at + stride * ph;
  };
  if (!interlace) return check(width, height, 0) >= 0;
  let at = 0;
  for (const [x0, y0, dx, dy] of ADAM7) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    at = check(pw, ph, at);
    if (at < 0) return false;
  }
  return true;
}

/** BMP の画素 (圧縮なし、16・32 ビットのビットフィールド、または RLE8・RLE4)。読めなければ undefined */
export function decodeBmp(b: Uint8Array): Pixels | undefined {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = dv.getUint32(10, true);
  const hs = dv.getUint32(14, true);
  const core = hs === 12;
  // 頭が短い (BITMAPINFOHEADER の 40 バイトに足りない) ファイルは読まない (DataView の範囲外で RangeError を投げない: 約束は undefined)
  if (!core && b.length < 54) return undefined;
  const w = core ? dv.getUint16(18, true) : dv.getInt32(18, true);
  const h = core ? dv.getInt16(20, true) : dv.getInt32(22, true);
  const bpp = dv.getUint16(core ? 24 : 28, true);
  const comp = core ? 0 : dv.getUint32(30, true);
  const W = Math.abs(w);
  const H = Math.abs(h);
  if (!W || !H || W * H > maxPixels()) return undefined;
  // 1 画素のビット数は 1・4・8・16・24・32 だけ ([MS-WMF] 2.1.1.3 の BitCount。0 は JPEG・PNG を入れる形で、ここでは読まない)。
  // 0 を通すと、1 行のバイト数が 0 になって、下のファイルの大きさの検査を、54 バイトのファイルの 10000 × 10000 が通る
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return undefined;
  // RLE8 (BI_RLE8 = 1、8 ビット) と RLE4 (BI_RLE4 = 2、4 ビット) は、メタファイルの DIB と同じ符号 ([MS-WMF] 2.1.1.7 の Compression・3.1.6 の
  // Bitmap Compression) なので、expandRle で圧縮しない行に戻してから読む。指定の無い画素 (行の終わり・画像の終わり・ずれで飛ばした所) は
  // 色の表の 0 番 (expandRle と同じ、仕様書の例のとおり)
  const rle = (comp === 1 && bpp === 8) || (comp === 2 && bpp === 4);
  if (comp !== 0 && !rle && !(comp === 3 && (bpp === 16 || bpp === 32))) return undefined;
  // RLE の画素の数は、ファイルの大きさでも縛る (「画像の終わり」「ずれ」の符号で、数バイトから大きな画像を作れる。imageLimits.ts の BMP_RLE_PIXELS_PER_BYTE)
  if (rle && W * H > pixelBudget(b.length, BMP_RLE_PIXELS_PER_BYTE)) return undefined;
  // BITFIELDS のマスク (54〜65、V4 以降は α も 66〜69) が入りきらない壊れたファイル
  if (comp === 3 && b.length < (hs >= 56 ? 70 : 66)) return undefined;
  // 色の表 (BGR。OS/2 の頭は 3 バイト、ほかは 4 バイト)
  const pal: number[][] = [];
  if (bpp <= 8) {
    const used = core ? 0 : dv.getUint32(46, true);
    const entry = core ? 3 : 4;
    // 色の表の項は 2^bpp 個まで (biClrUsed は、8 ビット以下では使う色の数で、2^bpp を超えない: [MS-WMF] 2.2.2.3 の ColorUsed)
    const n = Math.min(used || 1 << bpp, 1 << bpp);
    for (let i = 0, o = 14 + hs; i < n && o + 2 < b.length; i++, o += entry) pal.push([b[o + 2], b[o + 1], b[o]]);
  }
  // ビットフィールド (無ければ 16 ビットは 5-5-5、32 ビットは 8-8-8)
  const masks = comp === 3 ? [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true), hs >= 56 ? dv.getUint32(66, true) : 0] : bpp === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0];
  /** ビットフィールドのマスク m の値を 0..255 にする関数 (マスクが 0 なら −1)。シフトの量と最大値は、マスクごとに 1 度だけ求める */
  const fieldOf = (m: number): ((v: number) => number) => {
    if (!m) return () => -1;
    let s = 0;
    while (!((m >>> s) & 1)) s++;
    const max = m >>> s;
    return (v: number) => Math.round((((v & m) >>> s) * 255) / max);
  };
  const rowSize = Math.floor((bpp * W + 31) / 32) * 4;
  // 画素の行を読む所: 圧縮しないものはファイルそのもの (off から)、RLE は戻した行 (0 から。行の順は圧縮した列の順のまま)。
  // RLE のデータの長さは biSizeImage (34〜37。0 ならファイルの終わりまで)
  let px = b;
  let base = off;
  if (rle) {
    if (off >= b.length) return undefined;
    const size = dv.getUint32(34, true);
    px = expandRle(b.subarray(off, size ? Math.min(b.length, off + size) : b.length), W, H, bpp as 4 | 8);
    base = 0;
  } else if (off + rowSize * H > b.length) return undefined;
  // 画素ごとに色の配列を作らず、RGBA の配列へじかに書く (1 億画素の上限ちょうどの RLE の BMP (98KB) で、画素ごとの配列の分だけで 6 秒あまりかかった)
  const rgba = new Uint8Array(W * H * 4);
  if (bpp <= 8) {
    // 色の表 (無い番号は黒)
    const lut = new Uint8Array(256 * 3);
    pal.forEach((c, i) => lut.set(c, i * 3));
    const mask = (1 << bpp) - 1;
    for (let y = 0; y < H; y++) {
      const r = base + (h < 0 ? y : H - 1 - y) * rowSize;
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        const bit = x * bpp;
        const i = ((px[r + (bit >> 3)] >> (8 - bpp - (bit & 7))) & mask) * 3;
        rgba[o] = lut[i];
        rgba[o + 1] = lut[i + 1];
        rgba[o + 2] = lut[i + 2];
        rgba[o + 3] = 255;
      }
    }
  } else if (bpp === 24) {
    for (let y = 0; y < H; y++) {
      const r = base + (h < 0 ? y : H - 1 - y) * rowSize;
      for (let x = 0, o = y * W * 4, q = r; x < W; x++, o += 4, q += 3) {
        rgba[o] = b[q + 2];
        rgba[o + 1] = b[q + 1];
        rgba[o + 2] = b[q];
        rgba[o + 3] = 255;
      }
    }
  } else if (bpp === 16 || bpp === 32) {
    const [fr, fg, fb, fa] = masks.map(fieldOf);
    for (let y = 0; y < H; y++) {
      const r = base + (h < 0 ? y : H - 1 - y) * rowSize;
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        const v = bpp === 16 ? dv.getUint16(r + x * 2, true) : dv.getUint32(r + x * 4, true);
        const a = fa(v);
        rgba[o] = fr(v);
        rgba[o + 1] = fg(v);
        rgba[o + 2] = fb(v);
        rgba[o + 3] = a < 0 ? 255 : a;
      }
    }
  } else return undefined;
  return { width: W, height: H, rgba };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (PNG の仕様 §5.5・附属書 D)。添字のループで引く (for…of の反復子は、1 億画素の画像で数秒かかっていた) */
function crc32(b: Uint8Array, c = 0xffffffff): number {
  for (let i = 0, n = b.length; i < n; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c;
}

/** PNG の生の走査線 (行ごとに先頭にフィルタの種類 0 を置いた RGBA。rgb なら α を除いた RGB) */
function pngRaw(px: Pixels, rgb = false): Uint8Array {
  const { width, height, rgba } = px;
  const ch = rgb ? 3 : 4;
  const raw = new Uint8Array((width * ch + 1) * height);
  for (let y = 0; y < height; y++) {
    const r = y * (width * ch + 1) + 1;
    if (!rgb) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), r);
    else
      for (let x = 0, i = y * width * 4, o = r; x < width; x++, i += 4, o += 3) {
        raw[o] = rgba[i];
        raw[o + 1] = rgba[i + 1];
        raw[o + 2] = rgba[i + 2];
      }
  }
  return raw;
}

/** α が全部 255 (不透明) か */
function opaque(rgba: Uint8Array): boolean {
  for (let i = 3, n = rgba.length; i < n; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG のファイル (署名・IHDR (8 ビット。色の型 colorType は 6 RGBA か 2 RGB)・IDAT・IEND) を、1 つの配列に書く。IDAT の中身 (zLength バイト) は、
 * body が out の at から書く (中身を別の配列に作ってから写す手間を省く)
 */
function pngFile(width: number, height: number, zLength: number, body: (out: Uint8Array, at: number) => void, colorType = 6): Uint8Array {
  const out = new Uint8Array(8 + 25 + 12 + zLength + 12);
  const dv = new DataView(out.buffer);
  out.set(PNG_SIG);
  let o = 8;
  const chunk = (type: string, length: number, write: (at: number) => void) => {
    dv.setUint32(o, length);
    for (let k = 0; k < 4; k++) out[o + 4 + k] = type.charCodeAt(k);
    write(o + 8);
    dv.setUint32(o + 8 + length, (crc32(out.subarray(o + 4, o + 8 + length)) ^ 0xffffffff) >>> 0);
    o += 12 + length;
  };
  chunk('IHDR', 13, (at) => {
    dv.setUint32(at, width);
    dv.setUint32(at + 4, height);
    out.set([8, colorType, 0, 0, 0], at + 8);
  });
  chunk('IDAT', zLength, (at) => body(out, at));
  chunk('IEND', 0, () => {});
  return out;
}

/**
 * 画素を PNG (8 ビット。RGBA、α が全部 255 なら RGB) にする。
 * 不透明の画像を RGB (色の型 2。PNG の仕様 §11.2.2) にするのは、PDF に入れるとき、展開せずに圧縮のデータのまま埋め込めるようにするため
 * (pdfLibPatches の embedPngAsIs。RGBA は、展開して RGB と α に分けてから圧縮し直すので、1 億画素で数秒かかる)
 */
export async function encodePng(px: Pixels): Promise<Uint8Array> {
  const rgb = opaque(px.rgba);
  const raw = pngRaw(px, rgb);
  const z = new Uint8Array(rejoin(thisCall(), await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()));
  return pngFile(px.width, px.height, z.length, (out, at) => out.set(z, at), rgb ? 2 : 6);
}

/**
 * 画素を PNG (RGBA・8 ビット) にする (同期版)。圧縮はせず、zlib の「無圧縮のブロック」(RFC 1950・1951 の stored block) で包む。
 * メタファイルの中の画像のように、同期の処理の中で data: の URI にするときに使う
 */
export function encodePngStored(px: Pixels): Uint8Array {
  const { width, height, rgba } = px;
  const row = width * 4 + 1;
  const rawLength = row * height;
  // zlib: CMF=0x78 FLG=0x01 (CM=8, CINFO=7, FCHECK で 31 の倍数)、無圧縮のブロック (最大 65535 バイト)、Adler-32。
  // 走査線は、別の配列に作らずに、ブロックの中へじかに書く (1 億画素の画像で、400MB の写しを 2 度作っていた)
  const nBlocks = Math.max(1, Math.ceil(rawLength / 65535));
  return pngFile(width, height, 2 + rawLength + nBlocks * 5 + 4, (z, start) => {
    z[start] = 0x78;
    z[start + 1] = 0x01;
    // 走査線のバイト i (0 から) の、z の中の位置: 頭の 2 バイトと、i の前のブロックの頭 (5 バイトずつ) の後ろ
    const at = (i: number) => start + 2 + i + (Math.floor(i / 65535) + 1) * 5;
    for (let k = 0; k < nBlocks; k++) {
      const len = Math.min(65535, rawLength - k * 65535);
      const h = start + 2 + k * (65535 + 5);
      z[h] = k === nBlocks - 1 ? 1 : 0;
      z[h + 1] = len & 0xff;
      z[h + 2] = len >> 8;
      z[h + 3] = ~len & 0xff;
      z[h + 4] = (~len >> 8) & 0xff;
    }
    // 行ごとに、フィルタの種類 0 と RGBA を、ブロックの切れ目で分けて書く
    let a = 1;
    let b = 0;
    const put = (src: Uint8Array, i: number) => {
      for (let s = 0; s < src.length; ) {
        const q = i + s;
        const n = Math.min(src.length - s, 65535 - (q % 65535));
        z.set(src.subarray(s, s + n), at(q));
        s += n;
      }
    };
    const zero = new Uint8Array(1);
    for (let y = 0; y < height; y++) {
      const line = rgba.subarray(y * width * 4, (y + 1) * width * 4);
      put(zero, y * row);
      put(line, y * row + 1);
      // Adler-32 (RFC 1950 §8.2): 5552 バイトごとに剰余を取る (それまでは 32 ビットの整数に収まる)
      b = (b + a) % 65521;
      for (let i = 0, n = line.length; i < n; ) {
        const end = Math.min(n, i + 5552);
        for (; i < end; i++) {
          a += line[i];
          b += a;
        }
        a %= 65521;
        b %= 65521;
      }
    }
    new DataView(z.buffer, z.byteOffset).setUint32(start + 2 + rawLength + nBlocks * 5, ((b << 16) | a) >>> 0);
  });
}

/**
 * RLE で圧縮した 4・8 ビットの画素 ([MS-WMF] 3.1.6) を、圧縮しない行 (4 バイト境界に揃えた行) に戻す。
 * 行の順は圧縮した列の順のまま (下から上の DIB なら、先頭が一番下の行)。指定の無い画素は 0 (仕様書の例のとおり)
 */
export function expandRle(src: Uint8Array, width: number, height: number, bpp: 4 | 8): Uint8Array {
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (width * height > maxPixels()) throw new RangeError(msg(`画像が大きすぎます (${width}×${height})`, `the image is too large (${width}×${height})`));
  const out = new Uint8Array(stride * height);
  let x = 0;
  let y = 0;
  const put = (v: number) => {
    if (x < width && y < height) {
      if (bpp === 8) out[y * stride + x] = v;
      else {
        const o = y * stride + (x >> 1);
        out[o] = x & 1 ? (out[o] & 0xf0) | (v & 0x0f) : (out[o] & 0x0f) | ((v & 0x0f) << 4);
      }
    }
    x++;
  };
  for (let i = 0; i + 1 < src.length; ) {
    const n = src[i];
    const c = src[i + 1];
    i += 2;
    if (n > 0) {
      // 符号化の形: n 個の画素を c で (4 ビットなら上位・下位の 4 ビットを交互に)
      for (let k = 0; k < n; k++) put(bpp === 8 ? c : k & 1 ? c & 0x0f : c >> 4);
      continue;
    }
    if (c === 0) {
      x = 0;
      y++;
    } else if (c === 1) break;
    else if (c === 2) {
      if (i + 1 >= src.length) break;
      x += src[i];
      y += src[i + 1];
      i += 2;
    } else {
      // 絶対の形: c 個の画素の値が続く。語 (2 バイト) の境界に揃える
      const bytes = bpp === 8 ? c : Math.ceil(c / 2);
      for (let k = 0; k < c && i + (bpp === 8 ? k : k >> 1) < src.length; k++) {
        const v = bpp === 8 ? src[i + k] : k & 1 ? src[i + (k >> 1)] & 0x0f : src[i + (k >> 1)] >> 4;
        put(v);
      }
      i += bytes + (bytes & 1);
    }
  }
  return out;
}

/** PDF に入れるための PNG の画素 (8 ビットの RGB と、透明な画素があれば α) */
export interface PngPixelsForPdf {
  width: number;
  height: number;
  /** 8 ビットの RGB (灰は R = G = B) */
  rgb: Uint8Array;
  /** 8 ビットの α (全部 255 なら無し) */
  alpha?: Uint8Array;
}

/**
 * PDF に入れるための PNG の画素: どの形の PNG (色の型 0 灰・2 RGB・3 色の表・4 灰と α・6 RGBA、ビットの深さ 1〜16、tRNS、
 * Adam7 の飛び越し。W3C の PNG の仕様 (Second Edition) §11.2.2 の表 11.1) も、8 ビットの RGB と α にする。
 * 値は、いままで使っていた pdf-lib の展開 (UPNG の toRGBA8 と、embedPng の RGB と α の分け方) と同じ:
 *  - 16 ビットの成分は上位の 8 ビット (切り捨て)。1・2・4 ビットの灰は 255 / (2^深さ − 1) 倍 (§13.12 の拡げ方)
 *  - 色の表に無い番号の画素は黒 (0, 0, 0)、tRNS の項の無い番号は不透明
 *  - tRNS (§11.3.2.1): 灰・RGB は、成分の値 (元の深さのまま) が tRNS の値と同じ画素を透明 (α 0)、色の表は番号ごとの α
 *  - α が全部 255 なら alpha は無し
 * ただし、pdf-lib の展開の誤りは引き継がない: 16 ビットの灰の tRNS (pdf-lib は違う位置の 2 バイトと比べていた)、
 * 飛び越しの 2 つ目からのパスの最初の行の平均のフィルタ (pdf-lib は 1 つ目のパスの位置を戻していた)、1・2・4 ビットの飛び越しの PNG の
 * 走査線の大きさ (pdf-lib は少なく見積もり、終わりの画素を 0 にしていた。§8.2 のパスごとの行のバイト数の和) は、仕様のとおりにする。
 * 展開 (imageDeflate.ts の inflateZlib。Node は zlib、ブラウザ・Web Worker は DecompressionStream) した走査線を、行ごとに、
 * フィルタを戻して (§9.2〜9.4) すぐ RGB と α に書く (1 度の走査。行がキャッシュにあるうちに分ける)。
 * 戻り値: 画素のデータが終わりまで展開できない・フィルタの種類が 0〜4 でない行がある PNG は 'broken'。
 * 動く PNG (acTL のコマが 2 つ以上。APNG) は 'animated' (pdf-lib も断っていた。コマが 1 つなら IDAT の画像を使う)。
 * PNG でない・IHDR が読めない・色の型とビットの深さの組が無いもの・圧縮やフィルタの方式が 0 でない・色の表の要る PNG に色の表が無いものは undefined。
 * pngWithinLimits を通った PNG に使う
 */
export async function decodePngForPdf(b: Uint8Array): Promise<PngPixelsForPdf | 'broken' | 'animated' | undefined> {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let depth = 0;
  let ct = -1;
  let interlace = false;
  let plte: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  for (let at = 8; at + 12 <= b.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    const body = b.subarray(at + 8, Math.min(at + 8 + len, b.length));
    if (type === 'IHDR' && len === 13 && body.length === 13) {
      width = dv.getUint32(at + 8);
      height = dv.getUint32(at + 12);
      depth = b[at + 16];
      ct = b[at + 17];
      // 圧縮の方式 0・フィルタの方式 0・飛び越し 0 か 1 (§11.2.2)
      if (b[at + 18] || b[at + 19] || b[at + 20] > 1) return undefined;
      interlace = b[at + 20] === 1;
    } else if (type === 'IDAT') parts.push(body);
    else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'acTL' && body.length >= 4 && dv.getUint32(at + 8) > 1) return 'animated';
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  // 色の型ごとの、使えるビットの深さ (§11.2.2 の表 11.1)
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!width || !height || !depths[ct]?.includes(depth) || (ct === 3 && !plte) || !parts.length) return undefined;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  const bits = channels * depth;
  const all = parts.length === 1 ? parts[0] : new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  if (parts.length > 1) parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  const need = interlace ? adam7Size(width, height, bits) : (Math.ceil((width * bits) / 8) + 1) * height;
  const raw = rejoin(thisCall(), await inflateZlib(all, need));
  if (raw.length < need) return 'broken';
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  if (ct === 6 && depth === 8 && !interlace && LITTLE_ENDIAN) {
    const opaque = rgba8Rows(raw, width, height, rgb, alpha);
    if (opaque === undefined) return 'broken';
    return opaque ? { width, height, rgb } : { width, height, rgb, alpha };
  }
  const put = rowWriter(ct, depth, width, rgb, alpha, plte, trns);
  // フィルタを戻す 1 画素のバイト数 (1 バイトより小さい画素は 1。§9.2)
  const bpp = Math.max(1, bits >> 3);
  let at = 0;
  const passes = interlace ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bits) / 8);
    for (let y = 0; y < ph; y++) {
      const r = at + y * (stride + 1) + 1;
      if (!unfilterRow(raw, r, y ? r - stride - 1 : -1, stride, bpp)) return 'broken';
      put(raw, r, pw, y0 + y * dy, x0, dx);
    }
    at += (stride + 1) * ph;
  }
  return put.opaque() ? { width, height, rgb } : { width, height, rgb, alpha };
}

/** 数の並び (Uint32Array) が、下位のバイトが先か (ほとんどの環境。そうでない環境は、rgba8Rows を使わない) */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * 8 ビット・飛び越しでない RGBA の PNG の走査線 (decodePngForPdf): 行ごとに、行を 4 バイト境界の作業の行に写し、フィルタを 1 画素 (4 バイト) ずつ
 * まとめて戻して (§9.2〜9.4。1 画素のバイト数が 4 なので、左の画素は 1 つ前の数)、RGB と α に分ける。
 * 4 つのバイトの足し算・平均は、桁の上がりがバイトをまたがない形で 32 ビットの数のまま計算する (足し算は下位の 7 ビットを足して最上位のビットを
 * 排他的論理和で、平均は (a AND b) + ((a XOR b) の各バイトの 1 ビット右) で)。Paeth だけはバイトごと。
 * α が全部 255 なら true、透明な画素があれば false、フィルタの種類が 0〜4 でない行があれば undefined
 */
function rgba8Rows(raw: Uint8Array, width: number, height: number, rgb: Uint8Array, alpha: Uint8Array): boolean | undefined {
  const stride = width * 4;
  // 前の行 (初めは 0。§9.2 の「1 行目の上の行は 0」) と、いまの行
  let prevB = new Uint8Array(stride);
  let curB = new Uint8Array(stride);
  let prev = new Uint32Array(prevB.buffer);
  let cur = new Uint32Array(curB.buffer);
  const add = (x: number, y: number) => (((x & 0x7f7f7f7f) + (y & 0x7f7f7f7f)) ^ ((x ^ y) & 0x80808080)) >>> 0;
  const avg = (x: number, y: number) => ((x & y) + (((x ^ y) & 0xfefefefe) >>> 1)) >>> 0;
  let acc = 255;
  for (let y = 0, q = 0, k = 0; y < height; y++) {
    const r = y * (stride + 1) + 1;
    const f = raw[r - 1];
    if (f > 4) return undefined;
    curB.set(raw.subarray(r, r + stride));
    if (f === 1) {
      for (let x = 1; x < width; x++) cur[x] = add(cur[x], cur[x - 1]);
    } else if (f === 2) {
      for (let x = 0; x < width; x++) cur[x] = add(cur[x], prev[x]);
    } else if (f === 3) {
      cur[0] = add(cur[0], (prev[0] >>> 1) & 0x7f7f7f7f);
      for (let x = 1; x < width; x++) cur[x] = add(cur[x], avg(cur[x - 1], prev[x]));
    } else if (f === 4) {
      // Paeth (§9.4)。左の画素の無い所では a = c = 0 なので、上 (b) になる。前の行が 0 (1 行目) なら、左 (a) になる
      cur[0] = add(cur[0], prev[0]);
      for (let i = 4; i < stride; i++) {
        const a = curB[i - 4];
        const b = prevB[i];
        const c = prevB[i - 4];
        const db = b - c;
        const da = a - c;
        const pa = db < 0 ? -db : db;
        const pb = da < 0 ? -da : da;
        const s = da + db;
        const pc = s < 0 ? -s : s;
        curB[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
    }
    for (let x = 0; x < width; x++, q += 3, k++) {
      const w = cur[x];
      rgb[q] = w;
      rgb[q + 1] = w >>> 8;
      rgb[q + 2] = w >>> 16;
      const a = w >>> 24;
      alpha[k] = a;
      acc &= a;
    }
    [prevB, curB] = [curB, prevB];
    [prev, cur] = [cur, prev];
  }
  return acc === 255;
}

/**
 * 1 行のフィルタを、その場で戻す (PNG の仕様 §9.2〜9.4)。r は行の画素の初め (フィルタの種類のバイトの次)、p は前の行の画素の初め
 * (パスの最初の行は −1。前の行を 0 とみなす)、n は行のバイト数、bpp は 1 画素のバイト数 (1 より小さければ 1)。
 * フィルタの種類が 0〜4 でなければ false
 */
function unfilterRow(raw: Uint8Array, r: number, p: number, n: number, bpp: number): boolean {
  // 足した値は、Uint8Array に書くときに 256 の剰余になる (§9.2 の「mod 256」)
  const f = raw[r - 1];
  const end = r + n;
  if (f === 0) return true;
  if (f > 4) return false;
  if (f === 1) {
    for (let i = r + bpp; i < end; i++) raw[i] += raw[i - bpp];
  } else if (f === 2) {
    if (p >= 0) for (let i = r, j = p; i < end; i++, j++) raw[i] += raw[j];
  } else if (f === 3) {
    if (p >= 0) {
      for (let i = r, j = p; i < r + bpp && i < end; i++, j++) raw[i] += raw[j] >> 1;
      for (let i = r + bpp, j = p + bpp; i < end; i++, j++) raw[i] += (raw[i - bpp] + raw[j]) >> 1;
    } else for (let i = r + bpp; i < end; i++) raw[i] += raw[i - bpp] >> 1;
  } else if (p >= 0) {
    // Paeth (§9.4): 予測は、左 a・上 b・左上 c のうち a + b − c に最も近いもの (同じなら a、b、c の順)。
    // |p − a| = |b − c|、|p − b| = |a − c|、|p − c| = |(b − c) + (a − c)|。左の画素の無い所では a = c = 0 なので、上 (b) になる
    for (let i = r, j = p; i < r + bpp && i < end; i++, j++) raw[i] += raw[j];
    for (let i = r + bpp, j = p + bpp; i < end; i++, j++) {
      const a = raw[i - bpp];
      const b = raw[j];
      const c = raw[j - bpp];
      const db = b - c;
      const da = a - c;
      const pa = db < 0 ? -db : db;
      const pb = da < 0 ? -da : da;
      const s = da + db;
      const pc = s < 0 ? -s : s;
      raw[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  } else {
    // パスの最初の行の Paeth: 上の行が 0 なので、左 (a) になる
    for (let i = r + bpp; i < end; i++) raw[i] += raw[i - bpp];
  }
  return true;
}

/** フィルタを戻した 1 行を、RGB と α に書く関数 (row: 走査線、r: 行の画素の初め、n: 画素の数、y: 画像の行、x0・dx: 画素の列の初めと間隔)。opaque() は、α が全部 255 か */
type RowWriter = ((row: Uint8Array, r: number, n: number, y: number, x0: number, dx: number) => void) & { opaque(): boolean };

/** 色の型 ct・ビットの深さ depth の行を書く関数 (decodePngForPdf)。8 ビットの RGBA・灰と α・RGB は、飛び越しでなければ速い道を通る */
function rowWriter(ct: number, depth: number, width: number, rgb: Uint8Array, alpha: Uint8Array, plte: Uint8Array | undefined, trns: Uint8Array | undefined): RowWriter {
  // α の論理積 (全部 255 なら 255)
  let all = 255;
  const sample16 = (v: Uint8Array, i: number) => (v[i] << 8) | v[i + 1];
  // tRNS の値 (§11.3.2.1: 灰は 2 バイト、RGB は 2 バイト × 3。足りない tRNS は無いものとする)
  const tg = ct === 0 && trns && trns.length >= 2 ? sample16(trns, 0) : -1;
  const trgb = ct === 2 && trns && trns.length >= 6 ? [sample16(trns, 0), sample16(trns, 2), sample16(trns, 4)] : undefined;
  let write: (row: Uint8Array, r: number, n: number, y: number, x0: number, dx: number) => void;
  if (ct === 6 && depth === 8) {
    write = (row, r, n, y, x0, dx) => {
      if (dx === 1) {
        let acc = all;
        for (let i = r, end = r + n * 4, q = (y * width + x0) * 3, k = y * width + x0; i < end; i += 4, q += 3, k++) {
          rgb[q] = row[i];
          rgb[q + 1] = row[i + 1];
          rgb[q + 2] = row[i + 2];
          const a = row[i + 3];
          alpha[k] = a;
          acc &= a;
        }
        all = acc;
        return;
      }
      let q = (y * width + x0) * 3;
      let k = y * width + x0;
      const qs = dx * 3;
      let acc = all;
      for (let i = r, end = r + n * 4; i < end; i += 4, q += qs, k += dx) {
        rgb[q] = row[i];
        rgb[q + 1] = row[i + 1];
        rgb[q + 2] = row[i + 2];
        const a = row[i + 3];
        alpha[k] = a;
        acc &= a;
      }
      all = acc;
    };
  } else if (ct === 4 && depth === 8) {
    write = (row, r, n, y, x0, dx) => {
      let q = (y * width + x0) * 3;
      let k = y * width + x0;
      const qs = dx * 3;
      let acc = all;
      for (let i = r, end = r + n * 2; i < end; i += 2, q += qs, k += dx) {
        rgb[q] = rgb[q + 1] = rgb[q + 2] = row[i];
        const a = row[i + 1];
        alpha[k] = a;
        acc &= a;
      }
      all = acc;
    };
  } else if (ct === 2 && depth === 8 && !trgb) {
    write = (row, r, n, y, x0, dx) => {
      if (dx === 1) rgb.set(row.subarray(r, r + n * 3), (y * width + x0) * 3);
      else for (let i = r, q = (y * width + x0) * 3, end = r + n * 3; i < end; i += 3, q += dx * 3) (rgb[q] = row[i]), (rgb[q + 1] = row[i + 1]), (rgb[q + 2] = row[i + 2]);
      alpha.fill(255, y * width + x0, y * width + x0 + (n - 1) * dx + 1);
    };
  } else {
    // ほかの形: 画素ごとに成分を読む。1・2・4 ビットは上位のビットから (§7.2)、16 ビットは上位のバイトが先 (§7.1)
    const spp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
    const max = (1 << Math.min(depth, 8)) - 1;
    const scale = depth < 8 ? 255 / max : 1;
    write = (row, r, n, y, x0, dx) => {
      let acc = all;
      for (let x = 0; x < n; x++) {
        const s = (c: number): number => {
          if (depth === 16) return sample16(row, r + (x * spp + c) * 2);
          if (depth === 8) return row[r + x * spp + c];
          const bit = (x * spp + c) * depth;
          return (row[r + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
        };
        const hi = (v: number) => (depth === 16 ? v >> 8 : depth < 8 ? v * scale : v);
        const k = y * width + x0 + x * dx;
        const q = k * 3;
        let a = 255;
        if (ct === 3) {
          const j = s(0);
          // 色の表に無い番号は黒、tRNS の項の無い番号は不透明 (pdf-lib の展開と同じ)
          const c = j * 3;
          rgb[q] = c + 2 < plte!.length ? plte![c] : 0;
          rgb[q + 1] = c + 2 < plte!.length ? plte![c + 1] : 0;
          rgb[q + 2] = c + 2 < plte!.length ? plte![c + 2] : 0;
          if (trns && j < trns.length) a = trns[j];
        } else if (ct === 0 || ct === 4) {
          const v = s(0);
          rgb[q] = rgb[q + 1] = rgb[q + 2] = hi(v);
          if (ct === 4) a = hi(s(1));
          else if (v === tg) a = 0;
        } else {
          const r0 = s(0);
          const g0 = s(1);
          const b0 = s(2);
          rgb[q] = hi(r0);
          rgb[q + 1] = hi(g0);
          rgb[q + 2] = hi(b0);
          if (ct === 6) a = hi(s(3));
          else if (trgb && r0 === trgb[0] && g0 === trgb[1] && b0 === trgb[2]) a = 0;
        }
        alpha[k] = a;
        acc &= a;
      }
      all = acc;
    };
  }
  return Object.assign(write, { opaque: () => all === 255 });
}

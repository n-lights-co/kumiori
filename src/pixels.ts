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

import { inflateBytes } from './psFilters';
import { BMP_RLE_PIXELS_PER_BYTE, DEFLATE_MAX_RATIO, MAX_PIXELS, gifPixelBudget, pixelBudget } from './imageLimits';

/** 画素の数の上限 (imageLimits.ts。ここからも引けるようにしてある) */
export { MAX_PIXELS } from './imageLimits';

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
 * 寸法だけが大きい 65 バイトの PNG で、9 秒・1.3GB を使っていた (IMG-19)。PNG の画素の並びは zlib (deflate) で圧縮する
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
      if (framePixels > MAX_PIXELS) return false;
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
  return pixels > 0 && pixelBits > 0 && pixels <= MAX_PIXELS && (pixels * pixelBits) / 8 <= DEFLATE_MAX_RATIO * idat;
}

/**
 * PNG の画素のデータ (IDAT をつないだ zlib の列) が、終わりまで展開できるか。pdf-lib の embedPng (UPNG) の展開は、壊れたデータ
 * (割り当ての無い符号) に当たると、読む位置が進まないまま回り続けて止まらない。UPNG に渡す前に、誤りで止まる自前の展開
 * (psFilters の inflateBytes。壊れた所までを返す) で、走査線の大きさ (飛び越しでない並びの「(1 行のバイト数 + フィルタの 1 バイト) × 高さ」。
 * PNG の仕様 §7.2・§9.1。飛び越しの並びはこれより大きい) まで出ることを確かめる。pngWithinLimits を通った PNG に使う
 */
export function pngDataComplete(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [];
  let need = 0;
  for (let at = 8; at + 12 <= b.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (type === 'IHDR' && len === 13) {
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[b[at + 17]] ?? 0;
      need = (Math.ceil((dv.getUint32(at + 8) * channels * b[at + 16]) / 8) + 1) * dv.getUint32(at + 12);
    } else if (type === 'IDAT') parts.push(b.subarray(at + 8, Math.min(at + 8 + len, b.length)));
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!need || !parts.length) return false;
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return inflateBytes(all, need).length >= need;
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
  if (!W || !H || W * H > MAX_PIXELS) return undefined;
  // 1 画素のビット数は 1・4・8・16・24・32 だけ ([MS-WMF] 2.1.1.3 の BitCount。0 は JPEG・PNG を入れる形で、ここでは読まない)。
  // 0 を通すと、1 行のバイト数が 0 になって、下のファイルの大きさの検査を、54 バイトのファイルの 10000 × 10000 が通る
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return undefined;
  // RLE8 (BI_RLE8 = 1、8 ビット) と RLE4 (BI_RLE4 = 2、4 ビット) は、メタファイルの DIB と同じ符号 ([MS-WMF] 2.1.1.7 の Compression・3.1.6 の
  // Bitmap Compression) なので、expandRle で圧縮しない行に戻してから読む (IMG-19 (5))。指定の無い画素 (行の終わり・画像の終わり・ずれで飛ばした所) は
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

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG の生の走査線 (行ごとに先頭にフィルタの種類 0 を置いた RGBA) */
function pngRaw(px: Pixels): Uint8Array {
  const { width, height, rgba } = px;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return raw;
}

/** PNG のファイル (署名・IHDR (8 ビット RGBA)・IDAT (zlib のデータ z)・IEND) */
function pngFile(width: number, height: number, z: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    c.set(new TextEncoder().encode(type), 4);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    return c;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

/** 画素を PNG (RGBA・8 ビット) にする */
export async function encodePng(px: Pixels): Promise<Uint8Array> {
  const raw = pngRaw(px);
  const z = new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  return pngFile(px.width, px.height, z);
}

/**
 * 画素を PNG (RGBA・8 ビット) にする (同期版)。圧縮はせず、zlib の「無圧縮のブロック」(RFC 1950・1951 の stored block) で包む。
 * メタファイルの中の画像のように、同期の処理の中で data: の URI にするときに使う
 */
export function encodePngStored(px: Pixels): Uint8Array {
  const raw = pngRaw(px);
  // zlib: CMF=0x78 FLG=0x01 (CM=8, CINFO=7, FCHECK で 31 の倍数)、無圧縮のブロック (最大 65535 バイト)、Adler-32
  const nBlocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let o = 2;
  for (let k = 0; k < nBlocks; k++) {
    const s = k * 65535;
    const len = Math.min(65535, raw.length - s);
    z[o++] = k === nBlocks - 1 ? 1 : 0;
    z[o++] = len & 0xff;
    z[o++] = len >> 8;
    z[o++] = ~len & 0xff;
    z[o++] = (~len >> 8) & 0xff;
    z.set(raw.subarray(s, s + len), o);
    o += len;
  }
  let a = 1;
  let b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(z.buffer).setUint32(o, ((b << 16) | a) >>> 0);
  return pngFile(px.width, px.height, z);
}

/**
 * RLE で圧縮した 4・8 ビットの画素 ([MS-WMF] 3.1.6) を、圧縮しない行 (4 バイト境界に揃えた行) に戻す。
 * 行の順は圧縮した列の順のまま (下から上の DIB なら、先頭が一番下の行)。指定の無い画素は 0 (仕様書の例のとおり)
 */
export function expandRle(src: Uint8Array, width: number, height: number, bpp: 4 | 8): Uint8Array {
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (width * height > MAX_PIXELS) throw new RangeError(`画像が大きすぎます (${width}×${height})`);
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

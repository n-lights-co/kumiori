/**
 * webp — WebP の画素を読む (画像を Canvas に描けない環境 (Node) 用。RFC 9649)。
 *  - 可逆 (VP8L): 変換 (予測・色の変換・緑を引く・色の表)、色のキャッシュ、メタの符号 (場所ごとの符号の組)、LZ77 の後方参照
 *  - 非可逆 (VP8): src/vp8.ts で読み、透明度 (ALPH。生・可逆、予測のフィルタ) を重ねる
 */
import type { Pixels } from './pixels';
import { MAX_PIXELS } from './imageLimits';
import { decodeVp8 } from './vp8';

class Bits {
  private pos = 0;
  constructor(private b: Uint8Array) {}
  /** n ビット (下位のビットから) */
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw new Error('webp: データが足りない');
      v += ((byte >> (this.pos & 7)) & 1) * 2 ** i;
    }
    return v;
  }
}

/** 正準ハフマン符号 (符号の長さから)。符号は 1 ビットずつ読む (DEFLATE と同じ並び) */
class Huffman {
  private count = new Int32Array(16);
  private symbols: Int32Array;
  /** 符号を持つ字が 1 つだけなら、その字 (0 ビットで読む) */
  private single = -1;
  constructor(lengths: ArrayLike<number>) {
    let n = 0;
    let last = -1;
    for (let s = 0; s < lengths.length; s++) {
      if (lengths[s]) {
        this.count[lengths[s]]++;
        n++;
        last = s;
      }
    }
    if (n === 0) throw new Error('webp: 空の符号');
    if (n === 1) this.single = last;
    const offs = new Int32Array(16);
    for (let l = 1; l < 16; l++) offs[l] = offs[l - 1] + this.count[l - 1];
    this.symbols = new Int32Array(n);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) this.symbols[offs[lengths[s]]++] = s;
  }
  read(br: Bits): number {
    if (this.single >= 0) return this.single;
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= br.read(1);
      const c = this.count[len];
      if (code - first < c) return this.symbols[index + code - first];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('webp: 読めない符号');
  }
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function readCode(br: Bits, size: number): Huffman {
  const lengths = new Uint8Array(size);
  if (br.read(1)) {
    // 簡単な符号: 1 つか 2 つの字
    const n = br.read(1) + 1;
    const s0 = br.read(br.read(1) ? 8 : 1);
    lengths[s0] = 1;
    if (n === 2) lengths[br.read(8)] = 1;
    return new Huffman(lengths);
  }
  const cl = new Uint8Array(19);
  const k = br.read(4) + 4;
  for (let i = 0; i < k; i++) cl[CODE_LENGTH_ORDER[i]] = br.read(3);
  const clCode = new Huffman(cl);
  let max = size;
  if (br.read(1)) {
    const nbits = 2 + 2 * br.read(3);
    max = 2 + br.read(nbits);
  }
  let prev = 8;
  for (let s = 0; s < size; ) {
    if (max-- === 0) break;
    const c = clCode.read(br);
    if (c < 16) {
      lengths[s++] = c;
      if (c) prev = c;
    } else {
      const [extra, base, v] = c === 16 ? [2, 3, prev] : c === 17 ? [3, 3, 0] : [7, 11, 0];
      const r = base + br.read(extra);
      if (s + r > size) throw new Error('webp: 符号の長さが多すぎる');
      lengths.fill(v, s, s + r);
      s += r;
    }
  }
  return new Huffman(lengths);
}

/** 後方参照の距離の符号 (1〜120) → 近くの画素の (x, y) (RFC 9649 §4.2.2) */
const PLANE = [
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a, 0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35,
  0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03, 0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12,
  0x1e, 0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f, 0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75,
  0x7b, 0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41, 0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60,
  0x70,
];

const sub = (size: number, bits: number) => (size + (1 << bits) - 1) >> bits;

interface Transform {
  type: number;
  xsize: number;
  bits: number;
  data: Uint32Array;
}

/** 画像の本体を読む (top: いちばん外の画像なら、変換とメタの符号を読む) */
function decodeImage(br: Bits, xsize0: number, ysize: number, top: boolean): Uint32Array {
  let xsize = xsize0;
  const transforms: Transform[] = [];
  if (top) {
    while (br.read(1)) {
      const type = br.read(2);
      if (transforms.some((t) => t.type === type)) throw new Error('webp: 同じ変換が 2 度');
      if (type === 0 || type === 1) {
        const bits = br.read(3) + 2;
        transforms.push({ type, xsize, bits, data: decodeImage(br, sub(xsize, bits), sub(ysize, bits), false) });
      } else if (type === 2) transforms.push({ type, xsize, bits: 0, data: new Uint32Array(0) });
      else {
        const n = br.read(8) + 1;
        const pal = decodeImage(br, n, 1, false);
        // 色の表は、前の色との差で書いてある
        for (let i = 1; i < n; i++) pal[i] = addPixels(pal[i], pal[i - 1]);
        const bits = n <= 2 ? 3 : n <= 4 ? 2 : n <= 16 ? 1 : 0;
        transforms.push({ type, xsize, bits, data: pal });
        xsize = sub(xsize, bits);
      }
    }
  }
  const useCache = br.read(1);
  const cacheBits = useCache ? br.read(4) : 0;
  if (useCache && (cacheBits < 1 || cacheBits > 11)) throw new Error('webp: 色のキャッシュの大きさ');
  let metaBits = 0;
  let meta: Uint32Array | undefined;
  if (top && br.read(1)) {
    metaBits = br.read(3) + 2;
    meta = decodeImage(br, sub(xsize, metaBits), sub(ysize, metaBits), false);
  }
  let groups = 1;
  if (meta) for (const p of meta) groups = Math.max(groups, ((p >> 8) & 0xffff) + 1);
  const cacheSize = cacheBits ? 1 << cacheBits : 0;
  const codes = Array.from({ length: groups }, () => [256 + 24 + cacheSize, 256, 256, 256, 40].map((n) => readCode(br, n)));
  const cache = new Uint32Array(cacheSize);
  const out = new Uint32Array(xsize * ysize);
  const metaW = sub(xsize, metaBits);
  const prefixValue = (sym: number) => {
    if (sym < 4) return sym + 1;
    const extra = (sym - 2) >> 1;
    return ((2 + (sym & 1)) << extra) + br.read(extra) + 1;
  };
  let cached = 0; // キャッシュに入れた画素の数 (out の位置)
  const flush = (to: number) => {
    if (!cacheSize) return;
    for (; cached < to; cached++) cache[Math.imul(out[cached], 0x1e35a7bd) >>> (32 - cacheBits)] = out[cached];
  };
  for (let pos = 0; pos < out.length; ) {
    const x = pos % xsize;
    const y = (pos - x) / xsize;
    const g = meta ? codes[(meta[(y >> metaBits) * metaW + (x >> metaBits)] >> 8) & 0xffff] : codes[0];
    const code = g[0].read(br);
    if (code < 256) {
      const r = g[1].read(br);
      const b = g[2].read(br);
      const a = g[3].read(br);
      out[pos++] = ((a << 24) | (r << 16) | (code << 8) | b) >>> 0;
    } else if (code < 280) {
      const len = prefixValue(code - 256);
      const dc = prefixValue(g[4].read(br));
      let dist: number;
      if (dc > 120) dist = dc - 120;
      else {
        const v = PLANE[dc - 1];
        dist = (v >> 4) * xsize + (8 - (v & 0xf));
        if (dist < 1) dist = 1;
      }
      if (dist > pos || pos + len > out.length) throw new Error('webp: 後方参照が範囲の外');
      for (let i = 0; i < len; i++, pos++) out[pos] = out[pos - dist];
    } else {
      flush(pos);
      out[pos++] = cache[code - 280];
    }
    flush(pos);
  }
  // 変換を逆の順に戻す
  let data: Uint32Array = out;
  for (let i = transforms.length - 1; i >= 0; i--) data = inverse(transforms[i], data, ysize);
  return data;
}

function addPixels(a: number, b: number): number {
  const ag = (a & 0xff00ff00) >>> 0;
  const bg = (b & 0xff00ff00) >>> 0;
  const rb = ((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff;
  return ((((ag + bg) & 0xff00ff00) >>> 0) | rb) >>> 0;
}

const ch = (p: number, s: number) => (p >>> s) & 0xff;
const avg2 = (a: number, b: number) => ((((a ^ b) & 0xfefefefe) >>> 1) + ((a & b) >>> 0)) >>> 0;
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const pack = (a: number, r: number, g: number, b: number) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

function predict(mode: number, L: number, T: number, TR: number, TL: number): number {
  switch (mode) {
    case 0:
      return 0xff000000;
    case 1:
      return L;
    case 2:
      return T;
    case 3:
      return TR;
    case 4:
      return TL;
    case 5:
      return avg2(avg2(L, TR), T);
    case 6:
      return avg2(L, TL);
    case 7:
      return avg2(L, T);
    case 8:
      return avg2(TL, T);
    case 9:
      return avg2(T, TR);
    case 10:
      return avg2(avg2(L, TL), avg2(T, TR));
    case 11: {
      let pl = 0;
      let pt = 0;
      for (const s of [24, 16, 8, 0]) {
        const p = ch(L, s) + ch(T, s) - ch(TL, s);
        pl += Math.abs(p - ch(L, s));
        pt += Math.abs(p - ch(T, s));
      }
      return pl < pt ? L : T;
    }
    case 12:
      return pack(...([24, 16, 8, 0].map((s) => clamp(ch(L, s) + ch(T, s) - ch(TL, s))) as [number, number, number, number]));
    case 13: {
      const a = avg2(L, T);
      return pack(...([24, 16, 8, 0].map((s) => clamp(ch(a, s) + Math.trunc((ch(a, s) - ch(TL, s)) / 2))) as [number, number, number, number]));
    }
    default:
      return 0xff000000; // 14・15 は使われない
  }
}

/** 符号付き 8 ビットの掛け算 (色の変換) */
const delta = (t: number, c: number) => (((t << 24) >> 24) * ((c << 24) >> 24)) >> 5;

function inverse(t: Transform, d: Uint32Array, ysize: number): Uint32Array {
  const w = t.xsize;
  if (t.type === 0) {
    const bw = sub(w, t.bits);
    for (let y = 0; y < ysize; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let pred: number;
        if (y === 0) pred = x === 0 ? 0xff000000 : d[i - 1];
        else if (x === 0) pred = d[i - w];
        else pred = predict((t.data[(y >> t.bits) * bw + (x >> t.bits)] >> 8) & 0xf, d[i - 1], d[i - w], d[i - w + 1], d[i - w - 1]);
        d[i] = addPixels(d[i], pred);
      }
    }
    return d;
  }
  if (t.type === 1) {
    const bw = sub(w, t.bits);
    for (let y = 0; y < ysize; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const e = t.data[(y >> t.bits) * bw + (x >> t.bits)];
        const g2r = e & 0xff;
        const g2b = (e >> 8) & 0xff;
        const r2b = (e >> 16) & 0xff;
        const p = d[i];
        const g = ch(p, 8);
        const r = (ch(p, 16) + delta(g2r, g)) & 0xff;
        const b = (ch(p, 0) + delta(g2b, g) + delta(r2b, r)) & 0xff;
        d[i] = ((p & 0xff00ff00) | (r << 16) | b) >>> 0;
      }
    }
    return d;
  }
  if (t.type === 2) {
    for (let i = 0; i < d.length; i++) {
      const g = ch(d[i], 8);
      d[i] = ((d[i] & 0xff00ff00) | (((ch(d[i], 16) + g) & 0xff) << 16) | ((ch(d[i], 0) + g) & 0xff)) >>> 0;
    }
    return d;
  }
  // 色の表: 詰めた画素 (緑に 1・2・4・8 個の番号) を、表の色に戻す
  const out = new Uint32Array(w * ysize);
  const pw = sub(w, t.bits);
  const per = 1 << t.bits;
  const nb = 8 >> t.bits;
  const mask = (1 << nb) - 1;
  for (let y = 0; y < ysize; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (ch(d[y * pw + (x >> t.bits)], 8) >> ((x & (per - 1)) * nb)) & mask;
      out[y * w + x] = t.data[idx] ?? 0;
    }
  }
  return out;
}

/** ARGB → RGBA */
function argbToRgba(argb: Uint32Array, width: number, height: number): Pixels {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < argb.length; i++) {
    const v = argb[i];
    rgba[i * 4] = (v >>> 16) & 0xff;
    rgba[i * 4 + 1] = (v >>> 8) & 0xff;
    rgba[i * 4 + 2] = v & 0xff;
    rgba[i * 4 + 3] = v >>> 24;
  }
  return { width, height, rgba };
}

/**
 * 非可逆の画像の透明度 (ALPH チャンク)。頭の 1 バイトは 圧縮 (下 2 ビット: 0 生・1 可逆) と予測のフィルタ (次の 2 ビット: 0 なし・1 横・2 縦・3 傾き)。
 * 可逆なら VP8L の画像の本体 (頭なし) の緑が透明度
 */
function decodeAlpha(a: Uint8Array, width: number, height: number): Uint8Array | undefined {
  const comp = a[0] & 3;
  const filter = (a[0] >> 2) & 3;
  let alpha: Uint8Array;
  if (comp === 0) alpha = a.slice(1, 1 + width * height);
  else if (comp === 1) {
    const argb = decodeImage(new Bits(a.subarray(1)), width, height, true);
    alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = (argb[i] >>> 8) & 0xff;
  } else return undefined;
  if (alpha.length < width * height) return undefined;
  if (filter) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const left = x > 0 ? alpha[i - 1] : -1;
        const up = y > 0 ? alpha[i - width] : -1;
        // 端: 左上は 0、左端は上 (横・傾き)、上端は左 (縦・傾き)
        let pred: number;
        if (x === 0 && y === 0) pred = 0;
        else if (filter === 1) pred = x > 0 ? left : up;
        else if (filter === 2) pred = y > 0 ? up : left;
        else if (x === 0) pred = up;
        else if (y === 0) pred = left;
        else {
          const g = left + up - alpha[i - width - 1];
          pred = g < 0 ? 0 : g > 255 ? 255 : g;
        }
        alpha[i] = (alpha[i] + pred) & 0xff;
      }
    }
  }
  return alpha;
}

/** WebP の画素 (可逆・非可逆。非可逆の透明度 (ALPH) も)。読めなければ undefined */
export function decodeWebp(b: Uint8Array): Pixels | undefined {
  if (b.length < 21 || String.fromCharCode(b[0], b[1], b[2], b[3], b[8], b[9], b[10], b[11]) !== 'RIFFWEBP') return undefined;
  // チャンク (VP8X の拡張形式の中にあっても)
  const chunks = new Map<string, Uint8Array>();
  for (let p = 12; p + 8 <= b.length; ) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0;
    if (!chunks.has(id)) chunks.set(id, b.subarray(p + 8, p + 8 + size));
    p += 8 + size + (size & 1);
  }
  try {
    const vp8l = chunks.get('VP8L');
    if (vp8l) {
      if (vp8l[0] !== 0x2f) return undefined;
      const br = new Bits(vp8l.subarray(1));
      const width = br.read(14) + 1;
      const height = br.read(14) + 1;
      // 頭に書かれた大きさで画素の配列を作るので、ほかの形式と同じ上限で止める (28 バイトのファイルで数 GB を要求できる)
      if (width * height > MAX_PIXELS) return undefined;
      br.read(1); // 透明を使うか (画素の値のまま使う)
      if (br.read(3) !== 0) return undefined;
      return argbToRgba(decodeImage(br, width, height, true), width, height);
    }
    const vp8 = chunks.get('VP8 ');
    if (!vp8) return undefined;
    const px = decodeVp8(vp8);
    if (!px) return undefined;
    const alph = chunks.get('ALPH');
    const alpha = alph && decodeAlpha(alph, px.width, px.height);
    if (alpha) for (let i = 0; i < alpha.length; i++) px.rgba[i * 4 + 3] = alpha[i];
    return px;
  } catch {
    return undefined;
  }
}

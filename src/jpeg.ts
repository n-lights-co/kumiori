/**
 * jpeg — JPEG (ITU-T T.81 | ISO/IEC 10918-1) の画素の読み書きと、大きな写真の縮小。
 *
 * 出典: CCITT Rec. T.81 (1992 E) (https://www.w3.org/Graphics/JPEG/itu-t81.pdf、2026-11-05 取得) と
 * JPEG File Interchange Format Version 1.02 (https://www.w3.org/Graphics/JPEG/jfif3.pdf、2026-11-05 取得)。
 *  - 読む: ハフマン符号の逐次 (SOF0・SOF1) と漸進 (SOF2) の 8 ビットの画像。成分は 1 (濃淡) か 3 (JFIF の YCbCr)。
 *    手順は Annex F.2 (逐次の復号)・Annex G.1.2 (漸進の復号)・Annex C (符号表の作り方)・A.3.3 (IDCT)
 *  - 書く: 基本の逐次 (SOF0)。量子化表は Annex K の Table K.1・K.2 の値を半分にしたもの
 *    (K.1 の注記「この値を 2 で割ると、元の画像とほとんど区別できない」)、ハフマン符号は Table K.3〜K.6。手順は Annex F.1
 *  - 色の変換は JFIF の「Conversion to and from RGB」の式
 *
 *  - APP14 (Adobe) の印は Adobe Technical Note #5116 (24 November 1992) の §18 の並び
 *    (長さ 2 バイト・"Adobe" 5 バイト・版 2 バイト・flags0 2 バイト・flags1 2 バイト・色の変換の符号 1 バイト) で読む
 *    (TN #5116 は利用者から受け取った PDF、2026-11-05)。符号の値は、PostScript Language Reference Manual の DCTEncode の
 *    「この印は使った ColorTransform の値を示す」と ColorTransform の値 (0: 変換なし、1: 3 成分なら RGB を YCbCr に) から、
 *    3 成分の 0 (RGB のまま) と 1 (YCbCr) だけを扱う。flags1 に 1 のビットがある (§18: 復号に欠かせない情報) ものは扱わない
 *
 * 算術符号・可逆・階層・12 ビット・4 成分 (CMYK)・上の場合以外の APP14 の画像は扱わない (読まずに undefined を返す)。
 */
import { AC_CHROMA, AC_LUMA, DC_CHROMA, DC_LUMA, QUANT_CHROMA, QUANT_LUMA, UNZIGZAG, ZIGZAG, type HuffmanSpec } from './jpegTables';
import { MAX_PIXELS } from './imageLimits';

/** 画素: 濃淡 (1 画素 1 バイト) か RGB (1 画素 3 バイト)、上の行から */
export interface JpegPixels {
  width: number;
  height: number;
  components: 1 | 3;
  data: Uint8Array;
}

/** JPEG の頭から読める情報 */
export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** 標本の精度 (ビット) */
  precision: number;
  /** フレームの印 (0xC0〜0xCF の下 4 ビット。0 基本・1 拡張逐次・2 漸進 など) */
  process: number;
  /** APP14 "Adobe" の印 (TN #5116 §18) の flags1 と色の変換の符号。印が無ければ undefined */
  adobe?: AdobeMarker;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

export interface AdobeMarker {
  flags1: number;
  transform: number;
}

/** APP14 の中身 (長さの欄の後ろ) が "Adobe" で始まれば、その flags1 と色の変換の符号。短すぎる印は flags1 を 0xffff (扱えない) にする */
function adobeMarker(seg: Uint8Array): AdobeMarker | undefined {
  if (seg.length < 5 || String.fromCharCode(...seg.subarray(0, 5)) !== 'Adobe') return undefined;
  if (seg.length < 12) return { flags1: 0xffff, transform: -1 };
  return { flags1: be16(seg, 9), transform: seg[11] };
}

/** 3 成分の色の変換: 'ycc' (YCbCr から RGB に戻す)・'none' (RGB のまま)。扱えなければ undefined */
function colorTransformOf(adobe: AdobeMarker | undefined, components: number): 'ycc' | 'none' | undefined {
  if (!adobe) return components === 3 ? 'ycc' : 'none';
  if (adobe.flags1 !== 0) return undefined;
  if (components !== 3) return 'none';
  return adobe.transform === 1 ? 'ycc' : adobe.transform === 0 ? 'none' : undefined;
}

/** 印の区切りをたどり、最初のフレームの頭を読む。JPEG でなければ undefined */
export function jpegInfo(b: Uint8Array): JpegInfo | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let adobe: AdobeMarker | undefined;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return undefined;
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      p += 2;
      continue;
    }
    const len = be16(b, p + 2);
    if (len < 2 || p + 2 + len > b.length) return undefined;
    if (m === 0xee) adobe = adobeMarker(b.subarray(p + 4, p + 2 + len)) ?? adobe;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { precision: b[p + 4], height: be16(b, p + 5), width: be16(b, p + 7), components: b[p + 9], process: m - 0xc0, ...(adobe ? { adobe } : {}) };
    }
    if (m === 0xd9 || m === 0xda) return undefined;
    p += 2 + len;
  }
  return undefined;
}

// ---- 符号表 (Annex C・F.2.2.3) ----

interface DecodeTable {
  /** 先頭 9 ビットで引く表: (符号長 << 8) | 値。0 は 9 ビットより長い符号 */
  fast: Uint16Array;
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  values: Uint8Array;
}

const FAST_BITS = 9;

function decodeTable(bits: ArrayLike<number>, values: ArrayLike<number>): DecodeTable {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  const fast = new Uint16Array(1 << FAST_BITS);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = bits[l - 1];
    valptr[l] = k;
    mincode[l] = code;
    for (let i = 0; i < n; i++, code++, k++) {
      if (l <= FAST_BITS) {
        const shift = FAST_BITS - l;
        for (let j = 0; j < 1 << shift; j++) fast[(code << shift) | j] = (l << 8) | values[k];
      }
    }
    maxcode[l] = n ? code - 1 : -1;
    code <<= 1;
  }
  return { fast, maxcode, valptr, mincode, values: Uint8Array.from(values as ArrayLike<number>) };
}

// ---- IDCT・FDCT (A.3.3) ----

/** T[x * 8 + u] = C(u) / 2 · cos((2x + 1)uπ / 16)。式の 1/4 を行と列の 1/2 ずつに分ける */
const DCT_T = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

/** 逆変換: 係数 S[v * 8 + u] (自然な順) から標本 s[y * 8 + x] (水準を戻す前) */
function idct(S: Float64Array, out: Float64Array, tmp: Float64Array) {
  // 行 (v ごと) に u について和をとる: tmp[v * 8 + x] = Σ_u T[x][u] S[v][u]
  for (let v = 0; v < 8; v++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += DCT_T[x * 8 + u] * S[v * 8 + u];
      tmp[v * 8 + x] = s;
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += DCT_T[y * 8 + v] * tmp[v * 8 + x];
      out[y * 8 + x] = s;
    }
}

/** 順変換: 標本 s[y * 8 + x] (水準を移したもの) から係数 S[v * 8 + u] */
function fdct(s: Float64Array, out: Float64Array, tmp: Float64Array) {
  for (let y = 0; y < 8; y++)
    for (let u = 0; u < 8; u++) {
      let a = 0;
      for (let x = 0; x < 8; x++) a += DCT_T[x * 8 + u] * s[y * 8 + x];
      tmp[y * 8 + u] = a;
    }
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      let a = 0;
      for (let y = 0; y < 8; y++) a += DCT_T[y * 8 + v] * tmp[y * 8 + u];
      out[v * 8 + u] = a;
    }
}

// ---- 読む ----

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** 係数の区画の横・縦の数 (MCU の数 × 標本化の係数) */
  bw: number;
  bh: number;
  coef: Int16Array;
  quant?: Uint16Array;
  pred: number;
  dc?: DecodeTable;
  ac?: DecodeTable;
}

class JpegError extends Error {}

/** JPEG の画素を読む。扱えない形式や壊れたデータなら undefined */
export function decodeJpeg(b: Uint8Array): JpegPixels | undefined {
  try {
    return decode(b);
  } catch (e) {
    if (e instanceof JpegError || e instanceof RangeError) return undefined;
    throw e;
  }
}

function decode(b: Uint8Array): JpegPixels | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const qt: (Uint16Array | undefined)[] = [];
  const dcTables: (DecodeTable | undefined)[] = [];
  const acTables: (DecodeTable | undefined)[] = [];
  const comps: Component[] = [];
  let X = 0;
  let Y = 0;
  let hmax = 1;
  let vmax = 1;
  let mcusX = 0;
  let mcusY = 0;
  let progressive = false;
  let restart = 0;
  let adobe: AdobeMarker | undefined;
  let framed = false;
  let p = 2;
  for (;;) {
    if (p + 2 > b.length) break;
    if (b[p] !== 0xff) {
      p++;
      continue;
    }
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    p += 2;
    if (m === 0xd9) break;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x00 || m === 0x01) continue;
    if (p + 2 > b.length) throw new JpegError('truncated');
    const len = be16(b, p);
    const seg = b.subarray(p + 2, p + len);
    if (len < 2 || seg.length !== len - 2) throw new JpegError('segment');
    if (m === 0xdb) {
      // DQT (B.2.4.1): 値はジグザグ順
      for (let i = 0; i < seg.length; ) {
        const pq = seg[i] >> 4;
        const tq = seg[i] & 15;
        i++;
        const t = new Uint16Array(64);
        for (let k = 0; k < 64; k++) {
          t[UNZIGZAG[k]] = pq ? be16(seg, i + 2 * k) : seg[i + k];
        }
        i += pq ? 128 : 64;
        if (i > seg.length) throw new JpegError('DQT');
        qt[tq & 3] = t;
      }
    } else if (m === 0xc4) {
      // DHT (B.2.4.2)
      for (let i = 0; i < seg.length; ) {
        const tc = seg[i] >> 4;
        const th = seg[i] & 15;
        const bits = seg.subarray(i + 1, i + 17);
        let n = 0;
        for (const c of bits) n += c;
        const values = seg.subarray(i + 17, i + 17 + n);
        if (bits.length !== 16 || values.length !== n || n > 256) throw new JpegError('DHT');
        (tc ? acTables : dcTables)[th & 3] = decodeTable(bits, values);
        i += 17 + n;
      }
    } else if (m === 0xdd) {
      restart = be16(seg, 0);
    } else if (m === 0xee) {
      adobe = adobeMarker(seg) ?? adobe;
    } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (framed || (m !== 0xc0 && m !== 0xc1 && m !== 0xc2)) return undefined;
      framed = true;
      progressive = m === 0xc2;
      if (seg[0] !== 8) return undefined;
      Y = be16(seg, 1);
      X = be16(seg, 3);
      const nf = seg[5];
      if (nf !== 1 && nf !== 3) return undefined;
      if (!X || !Y || X * Y > MAX_PIXELS) return undefined;
      for (let i = 0; i < nf; i++) {
        const hv = seg[7 + 3 * i];
        const c = { id: seg[6 + 3 * i], h: hv >> 4, v: hv & 15, tq: seg[8 + 3 * i] & 3 } as Component;
        if (c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4) throw new JpegError('sampling');
        comps.push(c);
      }
      hmax = Math.max(...comps.map((c) => c.h));
      vmax = Math.max(...comps.map((c) => c.v));
      mcusX = Math.ceil(X / (8 * hmax));
      mcusY = Math.ceil(Y / (8 * vmax));
      for (const c of comps) {
        c.bw = mcusX * c.h;
        c.bh = mcusY * c.v;
        c.coef = new Int16Array(c.bw * c.bh * 64);
        c.pred = 0;
      }
    } else if (m === 0xda) {
      if (!framed) throw new JpegError('SOS before SOF');
      const ns = seg[0];
      const sc: Component[] = [];
      for (let i = 0; i < ns; i++) {
        const c = comps.find((x) => x.id === seg[1 + 2 * i]);
        if (!c) throw new JpegError('SOS component');
        c.dc = dcTables[seg[2 + 2 * i] >> 4];
        c.ac = acTables[seg[2 + 2 * i] & 15];
        // 量子化表は、その成分の最初の走査の時点のものを使う
        c.quant ??= qt[c.tq];
        sc.push(c);
      }
      const ss = seg[1 + 2 * ns];
      const se = seg[2 + 2 * ns];
      const ah = seg[3 + 2 * ns] >> 4;
      const al = seg[3 + 2 * ns] & 15;
      p = decodeScan(b, p + len, sc, { X, Y, hmax, vmax, mcusX, mcusY, progressive, restart, ss, se, ah, al });
      continue;
    }
    p += len;
  }
  if (!framed) return undefined;
  const transform = colorTransformOf(adobe, comps.length);
  if (!transform) return undefined;
  // 逆量子化・IDCT・水準を戻す (A.3.1)
  const planes = comps.map((c) => {
    const q = c.quant;
    if (!q) throw new JpegError('no DQT');
    const W = c.bw * 8;
    const plane = new Uint8Array(W * c.bh * 8);
    const S = new Float64Array(64);
    const s = new Float64Array(64);
    const tmp = new Float64Array(64);
    for (let by = 0; by < c.bh; by++)
      for (let bx = 0; bx < c.bw; bx++) {
        const off = (by * c.bw + bx) * 64;
        for (let i = 0; i < 64; i++) S[i] = c.coef[off + i] * q[i];
        idct(S, s, tmp);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const val = Math.round(s[y * 8 + x] + 128);
            plane[(by * 8 + y) * W + bx * 8 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
          }
      }
    return toFullSize(plane, W, Math.ceil((X * c.h) / hmax), Math.ceil((Y * c.v) / vmax), hmax / c.h, vmax / c.v, X, Y);
  });
  const n = comps.length as 1 | 3;
  if (n === 1) return { width: X, height: Y, components: 1, data: planes[0] };
  const data = new Uint8Array(X * Y * 3);
  const [Yp, Cb, Cr] = planes;
  if (transform === 'none') {
    // APP14 の色の変換の符号 0: 成分は R・G・B の順
    for (let i = 0; i < X * Y; i++) {
      data[3 * i] = Yp[i];
      data[3 * i + 1] = Cb[i];
      data[3 * i + 2] = Cr[i];
    }
    return { width: X, height: Y, components: 3, data };
  }
  for (let i = 0; i < X * Y; i++) {
    // JFIF: YCbCr から RGB
    const y = Yp[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    data[3 * i] = clamp(y + 1.402 * cr);
    data[3 * i + 1] = clamp(y - 0.34414 * cb - 0.71414 * cr);
    data[3 * i + 2] = clamp(y + 1.772 * cb);
  }
  return { width: X, height: Y, components: 3, data };
}

/**
 * 成分の面 (横 W 標本の行、使うのは左上の cw × ch) を、画像の大きさ X × Y にする。rx・ry は標本化の比 (Hmax / Hi・Vmax / Vi)。
 * 標本化した成分の標本の中心は、JFIF の「Spatial Relationship of Components」の位置 (最初の標本は (比 / 2 − 0.5) だけずれる) とし、
 * その間を縦横に線形に補間する
 */
function toFullSize(plane: Uint8Array, W: number, cw: number, ch: number, rx: number, ry: number, X: number, Y: number): Uint8Array {
  const out = new Uint8Array(X * Y);
  if (rx === 1 && ry === 1) {
    for (let y = 0; y < Y; y++) out.set(plane.subarray(y * W, y * W + X), y * X);
    return out;
  }
  const x0 = new Int32Array(X);
  const fx = new Float64Array(X);
  for (let x = 0; x < X; x++) {
    const c = Math.min(cw - 1, Math.max(0, (x + 0.5) / rx - 0.5));
    x0[x] = Math.floor(c);
    fx[x] = c - x0[x];
  }
  for (let y = 0; y < Y; y++) {
    const c = Math.min(ch - 1, Math.max(0, (y + 0.5) / ry - 0.5));
    const y0 = Math.floor(c);
    const fy = c - y0;
    const r0 = y0 * W;
    const r1 = Math.min(ch - 1, y0 + 1) * W;
    for (let x = 0; x < X; x++) {
      const a = x0[x];
      const b2 = Math.min(cw - 1, a + 1);
      const f = fx[x];
      const top = plane[r0 + a] * (1 - f) + plane[r0 + b2] * f;
      const bot = plane[r1 + a] * (1 - f) + plane[r1 + b2] * f;
      out[y * X + x] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return out;
}

const clamp = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

interface ScanParams {
  X: number;
  Y: number;
  hmax: number;
  vmax: number;
  mcusX: number;
  mcusY: number;
  progressive: boolean;
  restart: number;
  ss: number;
  se: number;
  ah: number;
  al: number;
}

/** 1 つの走査の符号を読み、係数に足す。読み終えた位置 (次の印の位置) を返す */
function decodeScan(b: Uint8Array, start: number, sc: Component[], P: ScanParams): number {
  let pos = start;
  let acc = 0;
  let nbits = 0;
  let marker = false;
  const fill = () => {
    while (nbits <= 24) {
      let byte = 0;
      if (!marker && pos < b.length) {
        byte = b[pos];
        if (byte === 0xff) {
          const nx = b[pos + 1];
          if (nx === 0) pos += 2;
          else {
            marker = true;
            byte = 0;
          }
        } else pos++;
      }
      acc |= byte << (24 - nbits);
      nbits += 8;
    }
  };
  const consume = (k: number) => {
    acc <<= k;
    nbits -= k;
  };
  /** F.2.2.3 DECODE */
  const decodeSym = (t: DecodeTable | undefined): number => {
    if (!t) throw new JpegError('no Huffman table');
    fill();
    const f = t.fast[acc >>> (32 - FAST_BITS)];
    if (f) {
      consume(f >> 8);
      return f & 255;
    }
    for (let l = FAST_BITS + 1; l <= 16; l++) {
      const code = acc >>> (32 - l);
      if (code <= t.maxcode[l]) {
        consume(l);
        return t.values[t.valptr[l] + code - t.mincode[l]];
      }
    }
    throw new JpegError('bad Huffman code');
  };
  /** F.2.2.4 RECEIVE */
  const receive = (s: number): number => {
    if (s === 0) return 0;
    fill();
    const v = acc >>> (32 - s);
    consume(s);
    return v;
  };
  /** F.2.2.1 EXTEND */
  const extend = (v: number, s: number) => (v < 1 << (s - 1) ? v - (1 << s) + 1 : v);

  const { progressive, ss, se, ah, al } = P;
  if (progressive ? ss > se || se > 63 || (ss === 0 && se !== 0) || (ss > 0 && sc.length !== 1) : ss !== 0 || se !== 63) throw new JpegError('spectral selection');
  let eobrun = 0;

  const decodeBlock = (c: Component, off: number) => {
    const coef = c.coef;
    if (!progressive) {
      const t = decodeSym(c.dc);
      if (t > 16) throw new JpegError('DC size'); // 壊れた DC の表 (receive のシフト量が負になる)
      c.pred += t ? extend(receive(t), t) : 0;
      coef[off] = c.pred;
      for (let k = 1; k < 64; ) {
        const rs = decodeSym(c.ac);
        const r = rs >> 4;
        const s = rs & 15;
        if (s === 0) {
          if (r !== 15) break;
          k += 16;
          continue;
        }
        k += r;
        if (k > 63) throw new JpegError('AC index');
        coef[off + UNZIGZAG[k]] = extend(receive(s), s);
        k++;
      }
      return;
    }
    if (ss === 0) {
      // G.1.2.1 DC の最初の走査と、続く走査 (1 ビットずつ足す)
      if (ah === 0) {
        const t = decodeSym(c.dc);
        if (t > 16) throw new JpegError('DC size');
        c.pred += t ? extend(receive(t), t) : 0;
        coef[off] = c.pred * (1 << al);
      } else if (receive(1)) coef[off] |= 1 << al;
      return;
    }
    if (ah === 0) {
      // G.1.2.2 AC の最初の走査 (EOBRUN)
      if (eobrun > 0) {
        eobrun--;
        return;
      }
      for (let k = ss; k <= se; ) {
        const rs = decodeSym(c.ac);
        const r = rs >> 4;
        const s = rs & 15;
        if (s === 0) {
          if (r < 15) {
            eobrun = (1 << r) - 1 + receive(r);
            break;
          }
          k += 16;
          continue;
        }
        k += r;
        if (k > 63) throw new JpegError('AC index');
        coef[off + UNZIGZAG[k]] = extend(receive(s), s) * (1 << al);
        k++;
      }
      return;
    }
    // G.1.2.3 AC の続く走査: 0 でない係数には 1 ビットずつ足し、新しく 0 でなくなる係数を置く
    const p1 = 1 << al;
    const m1 = -1 << al;
    const refine = (z: number) => {
      if (receive(1) && (coef[z] & p1) === 0) coef[z] += coef[z] >= 0 ? p1 : m1;
    };
    let k = ss;
    if (eobrun <= 0) {
      for (; k <= se; k++) {
        const rs = decodeSym(c.ac);
        let r = rs >> 4;
        const s = rs & 15;
        let val = 0;
        if (s) {
          if (s !== 1) throw new JpegError('refinement size');
          val = receive(1) ? p1 : m1;
        } else if (r !== 15) {
          eobrun = (1 << r) + receive(r);
          break;
        }
        while (k <= se) {
          const z = off + UNZIGZAG[k];
          if (coef[z] !== 0) refine(z);
          else if (--r < 0) break;
          k++;
        }
        if (val && k <= se) coef[off + UNZIGZAG[k]] = val;
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k++) {
        const z = off + UNZIGZAG[k];
        if (coef[z] !== 0) refine(z);
      }
      eobrun--;
    }
  };

  const nextRestart = () => {
    // 次の RSTn の印まで進む (F.2.1.3.1・E.2.4)
    acc = 0;
    nbits = 0;
    marker = false;
    while (pos + 1 < b.length && !(b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) pos++;
    pos += 2;
    for (const c of sc) c.pred = 0;
    eobrun = 0;
  };

  let units = 0;
  const restartCheck = () => {
    if (P.restart && units > 0 && units % P.restart === 0) nextRestart();
    units++;
  };
  if (sc.length === 1) {
    // 1 成分の走査は区画ごと (A.2.2)。区画の数はその成分の標本の数から
    const c = sc[0];
    const cw = Math.ceil(Math.ceil((P.X * c.h) / P.hmax) / 8);
    const ch = Math.ceil(Math.ceil((P.Y * c.v) / P.vmax) / 8);
    for (let by = 0; by < ch; by++)
      for (let bx = 0; bx < cw; bx++) {
        restartCheck();
        decodeBlock(c, (by * c.bw + bx) * 64);
      }
  } else {
    for (let my = 0; my < P.mcusY; my++)
      for (let mx = 0; mx < P.mcusX; mx++) {
        restartCheck();
        for (const c of sc)
          for (let v = 0; v < c.v; v++)
            for (let h = 0; h < c.h; h++) decodeBlock(c, ((my * c.v + v) * c.bw + mx * c.h + h) * 64);
      }
  }
  // 次の印 (RSTn 以外) の位置
  while (pos + 1 < b.length && !(b[pos] === 0xff && b[pos + 1] !== 0 && !(b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7))) pos++;
  return pos;
}

// ---- 書く ----

interface EncodeTable {
  code: Uint16Array;
  size: Uint8Array;
}

/** Annex C: BITS・HUFFVAL から、値ごとの符号と符号長 (EHUFCO・EHUFSI) */
function encodeTable(spec: HuffmanSpec): EncodeTable {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < spec.bits[l - 1]; i++, c++, k++) {
      code[spec.values[k]] = c;
      size[spec.values[k]] = l;
    }
    c <<= 1;
  }
  return { code, size };
}

let ENCODE_TABLES: { dcL: EncodeTable; acL: EncodeTable; dcC: EncodeTable; acC: EncodeTable } | undefined;

class ByteWriter {
  buf = new Uint8Array(1 << 16);
  n = 0;
  byte(v: number) {
    if (this.n === this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = v;
  }
  u16(v: number) {
    this.byte(v >> 8);
    this.byte(v & 255);
  }
  bytes(a: ArrayLike<number>) {
    for (let i = 0; i < a.length; i++) this.byte(a[i]);
  }
  result() {
    return this.buf.slice(0, this.n);
  }
}

export interface JpegEncodeOptions {
  /** Table K.1・K.2 の値に掛ける係数。既定 0.5 (K.1 の注記の「2 で割る」) */
  quantScale?: number;
}

/** 画素を基本の逐次の JPEG (JFIF) にする。RGB は 4:2:0 (色差を縦横半分) に標本化する */
export function encodeJpeg(px: JpegPixels, opts: JpegEncodeOptions = {}): Uint8Array {
  const { width: W, height: H, components: n, data } = px;
  const scale = opts.quantScale ?? 0.5;
  const qOf = (K: readonly number[]) => Uint16Array.from(K, (v) => Math.max(1, Math.min(255, Math.round(v * scale))));
  const qL = qOf(QUANT_LUMA);
  const qC = qOf(QUANT_CHROMA);
  ENCODE_TABLES ??= { dcL: encodeTable(DC_LUMA), acL: encodeTable(AC_LUMA), dcC: encodeTable(DC_CHROMA), acC: encodeTable(AC_CHROMA) };
  const T = ENCODE_TABLES;

  // 色の成分の面 (JFIF: RGB から YCbCr)
  const planes: Float64Array[] = [];
  if (n === 1) planes.push(Float64Array.from(data));
  else {
    const Yp = new Float64Array(W * H);
    const Cb = new Float64Array(W * H);
    const Cr = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = data[3 * i];
      const g = data[3 * i + 1];
      const bl = data[3 * i + 2];
      Yp[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
      Cb[i] = -0.1687 * r - 0.3313 * g + 0.5 * bl + 128;
      Cr[i] = 0.5 * r - 0.4187 * g - 0.0813 * bl + 128;
    }
    planes.push(Yp, Cb, Cr);
  }
  const hs = n === 1 ? [1] : [2, 1, 1];
  const mcuW = 8 * hs[0];
  const mcusX = Math.ceil(W / mcuW);
  const mcusY = Math.ceil(H / mcuW);

  const w = new ByteWriter();
  w.u16(0xffd8);
  // APP0 JFIF 1.02: 単位なし、縦横比 1:1、縮小画像なし
  w.u16(0xffe0);
  w.u16(16);
  w.bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 0]);
  w.u16(1);
  w.u16(1);
  w.bytes([0, 0]);
  // DQT (値はジグザグ順)
  const tables = n === 1 ? [qL] : [qL, qC];
  w.u16(0xffdb);
  w.u16(2 + 65 * tables.length);
  tables.forEach((q, i) => {
    w.byte(i);
    for (let k = 0; k < 64; k++) w.byte(q[UNZIGZAG[k]]);
  });
  // SOF0
  w.u16(0xffc0);
  w.u16(8 + 3 * n);
  w.byte(8);
  w.u16(H);
  w.u16(W);
  w.byte(n);
  for (let i = 0; i < n; i++) {
    w.byte(i + 1);
    w.byte((hs[i] << 4) | hs[i]);
    w.byte(i === 0 ? 0 : 1);
  }
  // DHT
  const specs: [number, HuffmanSpec][] = n === 1 ? [[0x00, DC_LUMA], [0x10, AC_LUMA]] : [[0x00, DC_LUMA], [0x10, AC_LUMA], [0x01, DC_CHROMA], [0x11, AC_CHROMA]];
  w.u16(0xffc4);
  w.u16(2 + specs.reduce((a, [, s]) => a + 17 + s.values.length, 0));
  for (const [id, s] of specs) {
    w.byte(id);
    w.bytes(s.bits);
    w.bytes(s.values);
  }
  // SOS
  w.u16(0xffda);
  w.u16(6 + 2 * n);
  w.byte(n);
  for (let i = 0; i < n; i++) {
    w.byte(i + 1);
    w.byte(i === 0 ? 0x00 : 0x11);
  }
  w.bytes([0, 63, 0]);

  // 符号化した値を書く (F.1.2.3: 0xFF の後に 0x00 を入れる。最後は 1 で埋める)
  let bitAcc = 0;
  let bitN = 0;
  const put = (code: number, size: number) => {
    for (let i = size - 1; i >= 0; i--) {
      bitAcc = (bitAcc << 1) | ((code >> i) & 1);
      if (++bitN === 8) {
        w.byte(bitAcc);
        if (bitAcc === 0xff) w.byte(0);
        bitAcc = 0;
        bitN = 0;
      }
    }
  };
  /** SSSS: 値の大きさの区分 (Table F.1・F.2) */
  const category = (v: number) => {
    let a = v < 0 ? -v : v;
    let s = 0;
    while (a) {
      s++;
      a >>= 1;
    }
    return s;
  };
  const preds = [0, 0, 0];
  const s = new Float64Array(64);
  const S = new Float64Array(64);
  const tmp = new Float64Array(64);
  const zz = new Int32Array(64);
  /** 1 区画: 成分 ci の面 pl から、標本の (x0, y0) を左上に、step 標本ごとに平均して取り出し、符号にする */
  const block = (ci: number, x0: number, y0: number, step: number) => {
    const pl = planes[ci];
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let dy = 0; dy < step; dy++)
          for (let dx = 0; dx < step; dx++) {
            // 端からはみ出す標本は、端の標本を繰り返す
            const sx = Math.min(W - 1, x0 + x * step + dx);
            const sy = Math.min(H - 1, y0 + y * step + dy);
            sum += pl[sy * W + sx];
          }
        s[y * 8 + x] = sum / (step * step) - 128;
      }
    fdct(s, S, tmp);
    const q = ci === 0 ? qL : qC;
    for (let i = 0; i < 64; i++) zz[ZIGZAG[i]] = Math.round(S[i] / q[i]);
    const dc = ci === 0 ? T.dcL : T.dcC;
    const ac = ci === 0 ? T.acL : T.acC;
    // F.1.2.1 DC の差分
    const diff = zz[0] - preds[ci];
    preds[ci] = zz[0];
    const t = category(diff);
    put(dc.code[t], dc.size[t]);
    if (t) put(diff < 0 ? diff - 1 : diff, t);
    // F.1.2.2 AC の係数
    let r = 0;
    for (let k = 1; k < 64; k++) {
      const v = zz[k];
      if (v === 0) {
        r++;
        continue;
      }
      while (r > 15) {
        put(ac.code[0xf0], ac.size[0xf0]);
        r -= 16;
      }
      const c = category(v);
      const rs = (r << 4) | c;
      put(ac.code[rs], ac.size[rs]);
      put(v < 0 ? v - 1 : v, c);
      r = 0;
    }
    if (r > 0) put(ac.code[0], ac.size[0]);
  };
  for (let my = 0; my < mcusY; my++)
    for (let mx = 0; mx < mcusX; mx++) {
      const x0 = mx * mcuW;
      const y0 = my * mcuW;
      for (let v = 0; v < hs[0]; v++) for (let h = 0; h < hs[0]; h++) block(0, x0 + h * 8, y0 + v * 8, 1);
      for (let ci = 1; ci < n; ci++) block(ci, x0, y0, 2);
    }
  if (bitN) put(0xff, 8 - bitN);
  w.u16(0xffd9);
  return w.result();
}

// ---- 縮小 ----

/** 面積の平均で縮小する (各出力画素に重なる入力画素を、重なる面積で重みづけして平均) */
export function downscale(px: JpegPixels, tw: number, th: number): JpegPixels {
  const { width: W, height: H, components: n, data } = px;
  const weights = (src: number, dst: number) => {
    const r = src / dst;
    const out: { i0: number; w: Float64Array }[] = [];
    for (let d = 0; d < dst; d++) {
      const a = d * r;
      const b2 = Math.min(src, (d + 1) * r);
      const i0 = Math.floor(a);
      const i1 = Math.min(src - 1, Math.ceil(b2) - 1);
      const w = new Float64Array(i1 - i0 + 1);
      for (let i = i0; i <= i1; i++) w[i - i0] = (Math.min(b2, i + 1) - Math.max(a, i)) / r;
      out.push({ i0, w });
    }
    return out;
  };
  const wx = weights(W, tw);
  const wy = weights(H, th);
  // 横に縮めてから縦に縮める
  const mid = new Float64Array(tw * H * n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < tw; x++) {
      const { i0, w } = wx[x];
      for (let c = 0; c < n; c++) {
        let s = 0;
        for (let k = 0; k < w.length; k++) s += w[k] * data[(y * W + i0 + k) * n + c];
        mid[(y * tw + x) * n + c] = s;
      }
    }
  const out = new Uint8Array(tw * th * n);
  for (let y = 0; y < th; y++) {
    const { i0, w } = wy[y];
    for (let x = 0; x < tw; x++)
      for (let c = 0; c < n; c++) {
        let s = 0;
        for (let k = 0; k < w.length; k++) s += w[k] * mid[((i0 + k) * tw + x) * n + c];
        out[(y * tw + x) * n + c] = clamp(s);
      }
  }
  return { width: tw, height: th, components: n, data: out };
}

/**
 * 置かれる大きさ (pt) に対して解像度が maxDpi を超える JPEG を、maxDpi に縮めて符号化し直す。
 * 縮める必要が無い・扱えない形式・縮めても小さくならないときは undefined (元のまま使う)
 */
export function shrinkJpeg(bytes: Uint8Array, widthPt: number, heightPt: number, maxDpi: number): Uint8Array | undefined {
  const info = jpegInfo(bytes);
  if (!info || !colorTransformOf(info.adobe, info.components) || info.precision !== 8 || (info.components !== 1 && info.components !== 3) || info.process > 2) return undefined;
  if (!(widthPt > 0) || !(heightPt > 0) || !(maxDpi > 0)) return undefined;
  const scale = Math.max(((widthPt / 72) * maxDpi) / info.width, ((heightPt / 72) * maxDpi) / info.height);
  if (scale >= 1) return undefined;
  const tw = Math.max(1, Math.round(info.width * scale));
  const th = Math.max(1, Math.round(info.height * scale));
  const px = decodeJpeg(bytes);
  if (!px) return undefined;
  const out = encodeJpeg(downscale(px, tw, th));
  return out.length < bytes.length ? out : undefined;
}

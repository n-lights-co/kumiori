/**
 * psFilters — PostScript の読み出し用フィルタ (PLRM §3.13.3)。どれもデータの元から 1 バイトずつ読みながら解く。
 *
 *  持つのは読み出し用 (Decode) のフィルタ: ASCIIHexDecode・ASCII85Decode・RunLengthDecode・LZWDecode・FlateDecode (zlib の形式)・
 *  SubFileDecode・ReusableStreamDecode・DCTDecode。
 *  書き出し用 (Encode) のフィルタは、NullEncode (渡された元をそのまま返す) のほかは持たない。
 *  標準のフィルタ (表 3.5) のうち CCITTFaxDecode (ファクシミリの符号。パラメータは表 3.21) は持たない: filter 演算子は undefined のエラーにする
 *  (TIFF の CCITT の符号を解く ccitt.ts は、PostScript のフィルタにはつないでいない)。
 *  LZW と Flate の予測関数 (Predictor。TIFF の 2 と PNG の 10〜15) も解く (§3.13.3 Predictor Functions)。
 *  DCTDecode (JPEG) は、元の JPEG のバイト列をそのまま渡す (画像の演算子が JPEG として扱う)。
 *
 * Flate の展開は、zlib の形式 (RFC 1950) と deflate の形式 (RFC 1951) の説明どおりに書いた。
 */
import type { PSDict, PSObj } from './psInterp';
import { PS_FILTER_MAX_BYTES } from './imageLimits';

export interface ByteSource {
  /** 次のバイト。終わりなら -1 */
  read(): number;
  /** 初めから読み直す (ReusableStreamDecode) */
  reset?(): void;
  /** 全体の長さ (ReusableStreamDecode) */
  length?: number;
  /** DCTDecode: JPEG のバイト列 (読み終わってから使う) */
  jpeg?: () => Uint8Array;
}

/** フィルタの誤り。message は PostScript のエラーの名前 (ioerror・limitcheck) */
export class FilterError extends Error {}

/** フィルタを作るときの上限と、メモリの数え方 (filter 演算子が渡す) */
export interface FilterContext {
  /** 読みためる量 (バイト) の上限。超えれば limitcheck */
  maxBytes?: number;
  /** n バイトを確保する前に呼ぶ (VM の使用量に積む。上限を超えるなら、呼ばれた側が誤りを投げる) */
  alloc?: (n: number) => void;
}

/** 元を読みためるバイト列。倍々に伸ばし、上限を超えたら limitcheck にする (数の配列にためると、1 バイトに 8 バイトを使う) */
class ByteStore {
  private buf = new Uint8Array(4096);
  private n = 0;
  private max: number;
  constructor(private ctx: FilterContext | undefined) {
    this.max = ctx?.maxBytes ?? PS_FILTER_MAX_BYTES;
    ctx?.alloc?.(this.buf.length);
  }
  push(c: number) {
    if (this.n === this.buf.length) {
      if (this.n >= this.max) throw new FilterError('limitcheck');
      const cap = Math.max(this.n + 1, Math.min(this.max, this.n * 2));
      this.ctx?.alloc?.(cap - this.n);
      const b = new Uint8Array(cap);
      b.set(this.buf);
      this.buf = b;
    }
    this.buf[this.n++] = c;
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

const numParam = (d: PSDict | undefined, k: string, def: number): number => {
  const v = d?.get(k) as PSObj | undefined;
  return v && (v.t === 'int' || v.t === 'real') ? v.v : def;
};

const isWS = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;

/** 出力をためておき、足りなくなったら fill で作る */
function pull(fill: (out: number[]) => boolean): ByteSource {
  let buf: number[] = [];
  let i = 0;
  let done = false;
  return {
    read() {
      while (i >= buf.length) {
        if (done) return -1;
        buf = [];
        i = 0;
        done = !fill(buf);
      }
      return buf[i++];
    },
  };
}

/** フィルタを作る。name はフィルタの名前、src はデータの元 */
export function filterSource(fname: string, src: ByteSource, params?: PSDict, subfile?: { count: number; eod: Uint8Array }, ctx?: FilterContext): ByteSource {
  switch (fname) {
    case 'ASCIIHexDecode':
      return asciiHex(src);
    case 'ASCII85Decode':
      return ascii85(src);
    case 'RunLengthDecode':
      return runLength(src);
    case 'LZWDecode':
      return predict(lzw(src, numParam(params, 'EarlyChange', 1)), params, ctx);
    case 'FlateDecode':
      return predict(inflate(src), params, ctx);
    case 'SubFileDecode': {
      const count = subfile?.count ?? numParam(params, 'EODCount', 0);
      const eodObj = params?.get('EODString') as PSObj | undefined;
      const eod = subfile?.eod ?? (eodObj && eodObj.t === 'string' ? eodObj.b.subarray(eodObj.o, eodObj.o + eodObj.n) : new Uint8Array(0));
      return subFile(src, count, eod);
    }
    case 'ReusableStreamDecode':
      return reusable(src, ctx);
    case 'DCTDecode':
      return dct(src, ctx);
    case 'NullEncode':
      return src;
    default:
      throw new UnsupportedFilter(fname);
  }
}

/** 持っていないフィルタの名前 (CCITTFaxDecode と、NullEncode 以外の書き出し用のフィルタ。PostScript では undefined。PLRM §8.2 の filter のエラー) */
export class UnsupportedFilter extends Error {}

function asciiHex(src: ByteSource): ByteSource {
  let done = false;
  return pull((out) => {
    if (done) return false;
    let hi = -1;
    for (;;) {
      const c = src.read();
      if (c < 0 || c === 0x3e) {
        if (hi >= 0) out.push(hi * 16);
        done = true;
        return out.length > 0;
      }
      if (isWS(c)) continue;
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v < 0) throw new FilterError('ioerror');
      if (hi < 0) hi = v;
      else {
        out.push(hi * 16 + v);
        return true;
      }
    }
  });
}

function ascii85(src: ByteSource): ByteSource {
  let done = false;
  return pull((out) => {
    if (done) return false;
    const g: number[] = [];
    for (;;) {
      const c = src.read();
      if (c < 0 || c === 0x7e) {
        // ~> (§3.13.3 ASCII85Decode)。~ の次の字は > でなければならない (ほかの字・元の終わりは ioerror)
        if (c === 0x7e && src.read() !== 0x3e) throw new FilterError('ioerror');
        done = true;
        if (g.length === 1) throw new FilterError('ioerror');
        if (g.length > 1) {
          const n = g.length - 1;
          while (g.length < 5) g.push(84);
          let v = 0;
          for (const d of g) v = v * 85 + d;
          for (let k = 0; k < n; k++) out.push((v >>> (24 - 8 * k)) & 255);
        }
        return out.length > 0;
      }
      if (isWS(c)) continue;
      if (c === 0x7a && g.length === 0) {
        out.push(0, 0, 0, 0);
        return true;
      }
      if (c < 0x21 || c > 0x75) throw new FilterError('ioerror');
      g.push(c - 33);
      if (g.length === 5) {
        let v = 0;
        for (const d of g) v = v * 85 + d;
        if (v > 0xffffffff) throw new FilterError('ioerror');
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        return true;
      }
    }
  });
}

function runLength(src: ByteSource): ByteSource {
  return pull((out) => {
    const n = src.read();
    if (n < 0 || n === 128) return false;
    if (n < 128) {
      for (let k = 0; k <= n; k++) {
        const c = src.read();
        if (c < 0) return out.length > 0;
        out.push(c);
      }
    } else {
      const c = src.read();
      if (c < 0) return false;
      for (let k = 0; k < 257 - n; k++) out.push(c);
    }
    return true;
  });
}

/** LZW (§3.13.3 LZWEncode)。符号は上位のビットから詰める。256 は表の初期化、257 は終わり */
function lzw(src: ByteSource, early: number): ByteSource {
  let bits = 0;
  let nbits = 0;
  let width = 9;
  // 表は、符号ごとに「前の符号・最後の 1 字・最初の 1 字・長さ」で持つ (符号ごとに字の並びを持つと、同じ字の続くデータで
  // 1 つのフィルタの表が数十 MB になる)。0〜255 は 1 字、256 (表の初期化) と 257 (終わり) は空
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const len = new Uint16Array(4096);
  for (let k = 0; k < 256; k++) {
    prefix[k] = -1;
    suffix[k] = k;
    first[k] = k;
    len[k] = 1;
  }
  const tmp = new Uint8Array(4096);
  let size = 258;
  let prev = -1;
  let done = false;
  const reset = () => {
    size = 258;
    width = 9;
    prev = -1;
  };
  /** 符号 p の並びに 1 字 c を足した並びを、表に足す */
  const add = (p: number, c: number) => {
    prefix[size] = p;
    suffix[size] = c;
    first[size] = first[p];
    len[size] = len[p] + 1;
    size++;
  };
  /** 符号 code の並びを出す (前の符号をたどって、後ろから作る) */
  const emitCode = (out: number[], code: number) => {
    const n = len[code];
    for (let c = code, i = n - 1; i >= 0; i--, c = prefix[c]) tmp[i] = suffix[c];
    for (let i = 0; i < n; i++) out.push(tmp[i]);
  };
  return pull((out) => {
    if (done) return false;
    while (nbits < width) {
      const c = src.read();
      if (c < 0) {
        done = true;
        return false;
      }
      bits = ((bits << 8) | c) >>> 0;
      nbits += 8;
    }
    const code = (bits >>> (nbits - width)) & ((1 << width) - 1);
    nbits -= width;
    bits &= (1 << nbits) - 1;
    if (code === 256) {
      reset();
      return true;
    }
    if (code === 257) {
      done = true;
      return false;
    }
    if (code < size) {
      emitCode(out, code);
      if (prev >= 0 && size < 4096) add(prev, first[code]);
    } else if (prev >= 0 && code === size) {
      // まだ表に無い符号: 前の並びに、その最初の 1 字を足したもの (符号は 4095 までなので、表には必ず空きがある)
      add(prev, first[prev]);
      emitCode(out, code);
    } else throw new FilterError('ioerror');
    prev = code;
    if (size + early >= 1 << width && width < 12) width++;
    return true;
  });
}

/** 予測関数を戻す (§3.13.3 Predictor Functions) */
function predict(src: ByteSource, params: PSDict | undefined, ctx?: FilterContext): ByteSource {
  const pred = numParam(params, 'Predictor', 1);
  if (pred <= 1) return src;
  const colors = numParam(params, 'Colors', 1);
  const bpc = numParam(params, 'BitsPerComponent', 8);
  const cols = numParam(params, 'Columns', 1);
  const rowBytes = Math.ceil((colors * bpc * cols) / 8);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  // 1 行の長さ (Columns・Colors・BitsPerComponent で決まる) にも上限を置く (行ごとにこの長さを確保する)
  if (rowBytes > (ctx?.maxBytes ?? PS_FILTER_MAX_BYTES)) throw new FilterError('limitcheck');
  ctx?.alloc?.(rowBytes * 2);
  let prior = new Uint8Array(rowBytes);
  return pull((out) => {
    const png = pred >= 10;
    const kind = png ? src.read() : 2;
    if (kind < 0) return false;
    const row = new Uint8Array(rowBytes);
    for (let k = 0; k < rowBytes; k++) {
      const c = src.read();
      if (c < 0) {
        if (k === 0) return false;
        break;
      }
      row[k] = c;
    }
    if (!png) {
      // TIFF の予測関数 2: 同じ色成分の左の値を足す
      if (bpc === 8) for (let k = colors; k < rowBytes; k++) row[k] = (row[k] + row[k - colors]) & 255;
      else if (bpc === 16) {
        for (let k = colors * 2; k + 1 < rowBytes; k += 2) {
          const v = ((row[k] << 8) | row[k + 1]) + ((row[k - colors * 2] << 8) | row[k - colors * 2 + 1]);
          row[k] = (v >> 8) & 255;
          row[k + 1] = v & 255;
        }
      } else {
        // 1・2・4 ビット: 成分ごとに足す
        const n = cols * colors;
        const mask = (1 << bpc) - 1;
        const get = (i: number) => (row[(i * bpc) >> 3] >> (8 - bpc - ((i * bpc) & 7))) & mask;
        const set = (i: number, v: number) => {
          const sh = 8 - bpc - ((i * bpc) & 7);
          row[(i * bpc) >> 3] = (row[(i * bpc) >> 3] & ~(mask << sh)) | ((v & mask) << sh);
        };
        for (let i = colors; i < n; i++) set(i, get(i) + get(i - colors));
      }
    } else {
      for (let k = 0; k < rowBytes; k++) {
        const a = k >= bpp ? row[k - bpp] : 0;
        const b = prior[k];
        const c = k >= bpp ? prior[k - bpp] : 0;
        let p = 0;
        if (kind === 1) p = a;
        else if (kind === 2) p = b;
        else if (kind === 3) p = (a + b) >> 1;
        else if (kind === 4) {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[k] = (row[k] + p) & 255;
      }
    }
    prior = row;
    for (const c of row) out.push(c);
    return true;
  });
}

// ───────────────────────── Flate (RFC 1950・1951) ─────────────────────────

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** 符号の長さから、復号の表 (長さごとの数と、符号の順の記号) を作る (RFC 1951 §3.2.2) */
function huffman(lengths: ArrayLike<number>): { counts: Int32Array; symbols: Int32Array } {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Int32Array(16);
  for (let k = 1; k < 16; k++) offs[k] = offs[k - 1] + counts[k - 1];
  const symbols = new Int32Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

let FIXED: { lit: ReturnType<typeof huffman>; dist: ReturnType<typeof huffman> } | undefined;
function fixedTables() {
  if (!FIXED) {
    const l = new Array<number>(288);
    for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    FIXED = { lit: huffman(l), dist: huffman(new Array(30).fill(5)) };
  }
  return FIXED;
}

/** zlib の形式の圧縮を解く (RFC 1950: 2 バイトの頭・deflate・Adler-32)。頭が無ければ deflate として読む */
export function inflate(src: ByteSource): ByteSource {
  let bitbuf = 0;
  let bitcnt = 0;
  let eof = false;
  const need = (n: number): number => {
    while (bitcnt < n) {
      const c = src.read();
      if (c < 0) {
        eof = true;
        throw new FilterError('eof');
      }
      bitbuf |= c << bitcnt;
      bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n;
    bitcnt -= n;
    return v;
  };
  const decode = (h: ReturnType<typeof huffman>): number => {
    // 符号は上位のビットから 1 ビットずつ読む (RFC 1951 §3.1.1)
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= need(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new FilterError('ioerror');
  };
  const win = new Uint8Array(32768);
  let wpos = 0;
  let started = false;
  let final = false;
  let blockType = -1;
  let stored = 0;
  let lit: ReturnType<typeof huffman> | undefined;
  let dist: ReturnType<typeof huffman> | undefined;
  let finished = false;
  const emit = (out: number[], c: number) => {
    out.push(c);
    win[wpos] = c;
    wpos = (wpos + 1) & 32767;
  };
  return pull((out) => {
    if (finished) return false;
    try {
      if (!started) {
        started = true;
        // zlib の頭 (CMF・FLG)。CM = 8 で、(CMF*256+FLG) が 31 の倍数なら zlib の形式
        const cmf = need(8);
        const flg = need(8);
        if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31 !== 0) {
          // 頭の無い deflate: 読んだ 16 ビットを戻す
          bitbuf = cmf | (flg << 8) | (bitbuf << 16);
          bitcnt += 16;
        } else if (flg & 32) need(32);
      }
      while (out.length < 4096) {
        if (blockType < 0) {
          if (final) {
            finished = true;
            return out.length > 0;
          }
          final = need(1) === 1;
          blockType = need(2);
          if (blockType === 0) {
            bitbuf = 0;
            bitcnt = 0;
            const len = need(16);
            need(16);
            stored = len;
          } else if (blockType === 1) {
            ({ lit, dist } = fixedTables());
          } else if (blockType === 2) {
            const hlit = need(5) + 257;
            const hdist = need(5) + 1;
            const hclen = need(4) + 4;
            const cl = new Array<number>(19).fill(0);
            for (let k = 0; k < hclen; k++) cl[CL_ORDER[k]] = need(3);
            const clh = huffman(cl);
            const lens: number[] = [];
            while (lens.length < hlit + hdist) {
              const sym = decode(clh);
              if (sym < 16) lens.push(sym);
              else if (sym === 16) {
                if (!lens.length) throw new FilterError('ioerror');
                const p = lens[lens.length - 1];
                for (let r = 3 + need(2); r > 0; r--) lens.push(p);
              } else if (sym === 17) for (let r = 3 + need(3); r > 0; r--) lens.push(0);
              else for (let r = 11 + need(7); r > 0; r--) lens.push(0);
            }
            lit = huffman(lens.slice(0, hlit));
            dist = huffman(lens.slice(hlit, hlit + hdist));
          } else throw new FilterError('ioerror');
        }
        if (blockType === 0) {
          while (stored > 0 && out.length < 4096) {
            emit(out, need(8));
            stored--;
          }
          if (stored === 0) blockType = -1;
          continue;
        }
        const sym = decode(lit!);
        if (sym < 256) emit(out, sym);
        else if (sym === 256) blockType = -1;
        else {
          const li = sym - 257;
          if (li >= 29) throw new FilterError('ioerror');
          const len = LEN_BASE[li] + need(LEN_EXTRA[li]);
          const di = decode(dist!);
          if (di >= 30) throw new FilterError('ioerror');
          const d = DIST_BASE[di] + need(DIST_EXTRA[di]);
          for (let k = 0; k < len; k++) emit(out, win[(wpos - d + 32768) & 32767]);
        }
      }
      return true;
    } catch (e) {
      if (e instanceof FilterError && eof) {
        finished = true;
        return out.length > 0;
      }
      throw e;
    }
  });
}

function subFile(src: ByteSource, count: number, eod: Uint8Array): ByteSource {
  // EODCount が 0 で EODString が空: 終わりを見ない (元の終わりまで通す。§3.13.3 SubFileDecode)
  if (eod.length === 0 && count === 0) return src;
  if (eod.length === 0) {
    // EODString が空: EODCount バイトだけ通す
    let left = count;
    return { read: () => (left-- > 0 ? src.read() : -1) };
  }
  let seen = 0;
  let pending: number[] = [];
  let done = false;
  return pull((out) => {
    if (done) return false;
    // 一致しかけている字はためておき、一致しなければ先頭の 1 字を出す
    for (;;) {
      const c = src.read();
      if (c < 0) {
        out.push(...pending);
        pending = [];
        done = true;
        return out.length > 0;
      }
      pending.push(c);
      let k = 0;
      while (k < pending.length && pending[k] === eod[k]) k++;
      if (k === pending.length) {
        if (k === eod.length) {
          seen++;
          if (count === 0) {
            done = true;
            pending = [];
            return out.length > 0;
          }
          out.push(...pending);
          pending = [];
          if (seen >= count) done = true;
          return true;
        }
        continue;
      }
      // 一致しない: 一致しうる位置まで字を出す
      while (pending.length) {
        out.push(pending.shift()!);
        let j = 0;
        while (j < pending.length && pending[j] === eod[j]) j++;
        if (j === pending.length) break;
      }
      return true;
    }
  });
}

/**
 * ReusableStreamDecode (§3.13.3): 元を終わりまで読んでためる。ためる量には上限を置く (元が終わらない手続きでも、メモリを使い切らない)。
 * 上限を超えたら limitcheck (実装の限界を超えたときのエラー。§8.2 filter のエラーの一覧にある)
 */
function reusable(src: ByteSource, ctx?: FilterContext): ByteSource {
  const data = new ByteStore(ctx);
  for (let c = src.read(); c >= 0; c = src.read()) data.push(c);
  const b = data.bytes();
  let i = 0;
  return {
    read: () => (i < b.length ? b[i++] : -1),
    reset: () => void (i = 0),
    length: b.length,
  };
}

/** DCTDecode: JPEG の終わり (FFD9) まで読み、そのバイト列を渡す。読むと、JPEG のバイト列をそのまま返す */
function dct(src: ByteSource, ctx?: FilterContext): ByteSource {
  // 読みためる量の上限は ReusableStreamDecode と同じ (超えたら limitcheck)
  const data = new ByteStore(ctx);
  let prev = -1;
  // SOI から EOI まで。区切りの中の FF D9 を誤って見ないよう、区間ごとに読み飛ばす
  for (;;) {
    const c = src.read();
    if (c < 0) break;
    data.push(c);
    if (prev === 0xff && c === 0xd9) break;
    if (prev === 0xff && c !== 0 && c !== 0xff && !(c >= 0xd0 && c <= 0xd8) && c !== 0x01) {
      // 長さを持つ区間: 中身を読み飛ばす (SOS は区間の後ろに符号化されたデータが続く)
      const hi = src.read();
      const lo = src.read();
      if (hi < 0 || lo < 0) break;
      data.push(hi);
      data.push(lo);
      const len = (hi << 8) | lo;
      for (let k = 2; k < len; k++) {
        const d = src.read();
        if (d < 0) break;
        data.push(d);
      }
      prev = -1;
      continue;
    }
    prev = c;
  }
  const b = data.bytes();
  let i = 0;
  return { read: () => (i < b.length ? b[i++] : -1), jpeg: () => b };
}

/**
 * バイト列を、ByteSource の展開 (読めなくなったところまで、limit バイトまで) に通す。
 * 出力は倍々に伸ばすバイト列にためる (数の配列にためると、1 バイトに 8 バイトのヒープを使う。WOFF の表を展開するときなど)
 */
function drain(src: ByteSource, limit: number): Uint8Array {
  let out = new Uint8Array(Math.min(limit, 4096));
  let n = 0;
  try {
    for (let c = n < limit ? src.read() : -1; c >= 0; c = n < limit ? src.read() : -1) {
      if (n === out.length) {
        const grown = new Uint8Array(Math.min(limit, n * 2));
        grown.set(out);
        out = grown;
      }
      out[n++] = c;
    }
  } catch {
    /* 壊れた所までを返す */
  }
  return out.slice(0, n);
}
const arraySource = (b: Uint8Array): ByteSource => {
  let i = 0;
  return { read: () => (i < b.length ? b[i++] : -1) };
};
/** zlib (deflate) の圧縮を解いたバイト列 (CGM の TILE の PNG の圧縮など)。limit は出力の上限 */
export function inflateBytes(b: Uint8Array, limit = 1 << 28): Uint8Array {
  return drain(inflate(arraySource(b)), limit);
}
/** LZW (TIFF・PDF の形。上位のビットから詰め、early change 1) の圧縮を解いたバイト列 */
export function lzwBytes(b: Uint8Array, limit = 1 << 28): Uint8Array {
  return drain(lzw(arraySource(b), 1), limit);
}

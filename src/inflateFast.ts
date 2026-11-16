/**
 * inflateFast — zlib (RFC 1950) と deflate (RFC 1951) の、バイト列からバイト列への展開 (同期)。
 * psFilters の inflate (PostScript のフィルタの、1 バイトずつ読む形) と同じ入力を受け、同じ所まで展開する:
 *  - 頭 (CMF・FLG) が zlib の形でなければ、頭の無い deflate として読む。FDICT の辞書の番号 (4 バイト) は読み飛ばす
 *  - 壊れた所 (割り当ての無い符号・入力の尽きた所) までを返す (誤りを投げない)。Adler-32 は確かめない
 * 符号は表引きで読む (符号の長さの最大のビット数の表。RFC 1951 §3.2.2 の正準の符号を、ビットの順を逆にして引く)。
 * 1 億画素の上限いっぱいの画像 (展開して 400MB) を、1 バイトずつ読む形の数分の 1 の時間で展開する
 */

const LEN_BASE = Uint16Array.from([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LEN_EXTRA = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
const DIST_BASE = Uint16Array.from([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DIST_EXTRA = Uint8Array.from([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** 復号の表: 添字は、入力の下位 bits ビット。値は (記号 << 4) | 符号の長さ (0 は割り当ての無い符号) */
interface Table {
  t: Int32Array;
  bits: number;
}

/** 符号の長さ (RFC 1951 §3.2.2) から表を作る。符号が多すぎる (長さの組が正準の符号にならない) ときは undefined */
function table(lengths: ArrayLike<number>): Table | undefined {
  const count = new Int32Array(16);
  let bits = 0;
  for (let i = 0; i < lengths.length; i++) {
    count[lengths[i]]++;
    if (lengths[i] > bits) bits = lengths[i];
  }
  count[0] = 0;
  const next = new Int32Array(16);
  let code = 0;
  for (let len = 1; len < 16; len++) {
    code = (code + count[len - 1]) << 1;
    next[len] = code;
    if (count[len] > 1 << len) return undefined;
  }
  // 符号の数が、長さの分の枠を超える (§3.2.2 の割り当てで、枠からあふれる)
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = (left << 1) - count[len];
    if (left < 0) return undefined;
  }
  const t = new Int32Array(1 << Math.max(1, bits));
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (!len) continue;
    const c = next[len]++;
    // 符号は上位のビットから詰まっている (§3.1.1) ので、ビットの順を逆にして、下位から読む入力の添字にする
    let r = 0;
    for (let k = 0; k < len; k++) r |= ((c >> k) & 1) << (len - 1 - k);
    for (let i = r; i < t.length; i += 1 << len) t[i] = (sym << 4) | len;
  }
  return { t, bits: Math.max(1, bits) };
}

let FIXED: { lit: Table; dist: Table } | undefined;
function fixed() {
  if (!FIXED) {
    const l = new Array<number>(288);
    for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    FIXED = { lit: table(l)!, dist: table(new Array(30).fill(5))! };
  }
  return FIXED;
}

/**
 * 展開する。keep が真なら展開したバイト列 (limit バイトまで) を返し、偽なら長さだけを数える (32KB の窓だけを持つ。
 * PNG の画素のデータが終わりまで展開できるかを、400MB を確保せずに確かめる)
 */
function run(src: Uint8Array, limit: number, keep: boolean): { bytes: Uint8Array; length: number } {
  const n = src.length;
  let pos = 0;
  let bitbuf = 0;
  let bitcnt = 0;
  /** 入力の終わりを過ぎて読んだ (詰めた 0 の) ビットの数が、いまの bitcnt を超えたら、入力が尽きている */
  const endBits = n * 8;
  const fill = () => {
    while (bitcnt <= 24) {
      bitbuf |= (pos < n ? src[pos] : 0) << bitcnt;
      pos++;
      bitcnt += 8;
    }
  };
  const used = () => pos * 8 - bitcnt;
  const take = (k: number): number => {
    if (bitcnt < k) fill();
    const v = bitbuf & ((1 << k) - 1);
    bitbuf >>>= k;
    bitcnt -= k;
    return v;
  };
  // 出力: keep なら伸ばしていく配列 (窓は出力そのもの)、そうでなければ 64KB の輪 (32KB の窓より大きい)
  const MASK = keep ? -1 : 0xffff;
  let out = new Uint8Array(keep ? Math.min(limit, 1 << 16) : 1 << 16);
  let o = 0;
  const room = (k: number) => {
    if (keep && o + k > out.length) {
      let size = out.length * 2;
      while (size < o + k) size *= 2;
      const grown = new Uint8Array(Math.min(limit, size));
      grown.set(out.subarray(0, o));
      out = grown;
    }
  };
  const done = () => ({ bytes: keep ? out.slice(0, o) : new Uint8Array(0), length: o });
  if (n < 2) return done();
  // zlib の頭 (CMF・FLG)。CM = 8 で、(CMF*256+FLG) が 31 の倍数なら zlib の形式 (RFC 1950 §2.2)
  const cmf = src[0];
  const flg = src[1];
  if ((cmf & 15) === 8 && ((cmf << 8) | flg) % 31 === 0) pos = flg & 32 ? 6 : 2;
  const decode = (h: Table): number => {
    if (bitcnt < h.bits) fill();
    const e = h.t[bitbuf & ((1 << h.bits) - 1)];
    const len = e & 15;
    if (!len) return -1;
    bitbuf >>>= len;
    bitcnt -= len;
    return e >> 4;
  };
  for (let final = 0; !final && o < limit; ) {
    if (used() + 3 > endBits) break;
    final = take(1);
    const type = take(2);
    if (type === 0) {
      // 無圧縮のブロック: バイトの境界にそろえ、LEN・NLEN (§3.2.4)
      // (ビットの数は 2^31 を超えうるので、ビット演算の >> で割らない: 256MB を超える入力)
      take(bitcnt & 7);
      const at = pos - bitcnt / 8;
      if (at + 4 > n) break;
      const len = src[at] | (src[at + 1] << 8);
      pos = at + 4;
      bitbuf = 0;
      bitcnt = 0;
      const k = Math.min(len, n - pos, limit - o);
      if (keep) {
        room(k);
        out.set(src.subarray(pos, pos + k), o);
      } else for (let i = Math.max(0, k - 0x8000); i < k; i++) out[(o + i) & MASK] = src[pos + i];
      o += k;
      pos += k;
      if (k < len) break;
      continue;
    }
    let lit: Table | undefined;
    let dist: Table | undefined;
    if (type === 1) ({ lit, dist } = fixed());
    else if (type === 2) {
      const hlit = take(5) + 257;
      const hdist = take(5) + 1;
      const hclen = take(4) + 4;
      const cl = new Array<number>(19).fill(0);
      for (let k = 0; k < hclen; k++) cl[CL_ORDER[k]] = take(3);
      const clt = table(cl);
      if (!clt) break;
      const lens: number[] = [];
      while (lens.length < hlit + hdist) {
        const sym = decode(clt);
        if (sym < 0 || used() > endBits) break;
        if (sym < 16) lens.push(sym);
        else if (sym === 16) {
          if (!lens.length) break;
          const p = lens[lens.length - 1];
          for (let r = 3 + take(2); r > 0; r--) lens.push(p);
        } else if (sym === 17) for (let r = 3 + take(3); r > 0; r--) lens.push(0);
        else for (let r = 11 + take(7); r > 0; r--) lens.push(0);
      }
      if (lens.length < hlit + hdist) break;
      lit = table(lens.slice(0, hlit));
      dist = table(lens.slice(hlit, hlit + hdist));
      if (!lit || !dist) break;
    } else break;
    let ok = true;
    for (;;) {
      const sym = decode(lit!);
      if (sym < 0 || used() > endBits) {
        ok = false;
        break;
      }
      if (sym < 256) {
        if (o >= limit) break;
        room(1);
        out[o & MASK] = sym;
        o++;
        continue;
      }
      if (sym === 256) break;
      const li = sym - 257;
      if (li >= 29) {
        ok = false;
        break;
      }
      const len = LEN_BASE[li] + take(LEN_EXTRA[li]);
      const di = decode(dist!);
      if (di < 0 || di >= 30) {
        ok = false;
        break;
      }
      const d = DIST_BASE[di] + take(DIST_EXTRA[di]);
      // 出力の始まりより前を指す距離 (§3.2.3) と、入力の尽きた所は、壊れたデータ
      if (d > o || used() > endBits) {
        ok = false;
        break;
      }
      const k = Math.min(len, limit - o);
      room(k);
      for (let i = 0; i < k; i++, o++) out[o & MASK] = out[(o - d) & MASK];
      if (o >= limit) break;
    }
    if (!ok) break;
  }
  return done();
}

/** zlib (deflate) の圧縮を解いたバイト列。limit は出力の上限 (壊れた所・limit までを返す) */
export function inflateFast(src: Uint8Array, limit = 1 << 28): Uint8Array {
  return run(src, limit, true).bytes;
}

/** zlib (deflate) の圧縮を解いた長さ (limit まで)。展開したバイト列は持たない */
export function inflatedLength(src: Uint8Array, limit = 1 << 28): number {
  return run(src, limit, false).length;
}

/**
 * sha256 — SHA-256 (FIPS 180-4 §6.2)。書体・画像のバイト列の識別に使う (同期で、ブラウザと Node のどちらでも動く)。
 * 結果は 16 進の小文字 64 字。試験 (test/areaResources.test.ts) で Node の crypto と同じ値になることを確かめている。
 */

/** §4.2.2 の定数 (最初の 64 個の素数の立方根の小数部の最初の 32 ビット) */
const K = new Int32Array(64);
/** §5.3.3 の初期値 (最初の 8 個の素数の平方根の小数部の最初の 32 ビット) */
const H0 = new Uint32Array(8);
{
  // 定数は定義 (素数の平方根・立方根の小数部) から計算する
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
  const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 0x100000000) >>> 0;
  primes.forEach((p, i) => (K[i] = frac32(Math.cbrt(p))));
  for (let i = 0; i < 8; i++) H0[i] = frac32(Math.sqrt(primes[i]));
}

type NodeCrypto = { createHash(alg: 'sha256'): { update(d: Uint8Array): { digest(enc: 'hex'): string } } };
/** Node の crypto (Node でなければ undefined。process.getBuiltinModule で取るので、ブラウザ向けの束にも入らない) */
const nodeCrypto = (() => {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const c = proc?.getBuiltinModule?.('node:crypto') as NodeCrypto | undefined;
    return typeof c?.createHash === 'function' ? c : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * SHA-256 の 16 進。大きなバイト列 (書き出した PDF の全体など。文書の ID の finishDocumentId) は、Node なら crypto で計算する
 * (同じ値。数十 MB の PDF で、自前の計算は 0.5 秒ほどかかる)
 */
export function sha256(data: Uint8Array): string {
  if (nodeCrypto && data.length >= 1 << 16) return nodeCrypto.createHash('sha256').update(data).digest('hex');
  return sha256Js(data);
}

/** SHA-256 の 16 進 (自前の計算。FIPS 180-4 §6.2) */
export function sha256Js(data: Uint8Array): string {
  return new Sha256Js().update(data).digest();
}

/** SHA-256 を、バイト列を順に足して計算するもの (流して書いた PDF の文書の ID。pdfStandard.ts の DocumentIdStream) */
export interface Sha256 {
  update(data: Uint8Array): Sha256;
  /** 16 進の小文字 64 字 (この後は update を呼べない) */
  digest(): string;
}

/** 足していく SHA-256 を作る (Node なら crypto、ほかは自前の計算。どちらも同じ値) */
export function createSha256(): Sha256 {
  if (!nodeCrypto) return new Sha256Js();
  const h = (nodeCrypto as unknown as { createHash(alg: 'sha256'): { update(d: Uint8Array): unknown; digest(enc: 'hex'): string } }).createHash('sha256');
  const out: Sha256 = {
    update: (d) => (h.update(d), out),
    digest: () => h.digest('hex'),
  };
  return out;
}

/** 足していく SHA-256 の自前の計算 (FIPS 180-4 §6.2。64 バイトに満たない残りを持ち、digest で §5.1.1 の詰め物を足す) */
export class Sha256Js implements Sha256 {
  private readonly h = Int32Array.from(H0);
  private readonly w = new Int32Array(64);
  /** 64 バイトに満たない残り */
  private readonly rest = new Uint8Array(64);
  private restLen = 0;
  /** 足したバイト数 */
  private len = 0;
  private done = false;

  update(data: Uint8Array): this {
    if (this.done) throw new Error('Kumiori: Sha256.update after digest');
    this.len += data.length;
    let off = 0;
    if (this.restLen) {
      const n = Math.min(64 - this.restLen, data.length);
      this.rest.set(data.subarray(0, n), this.restLen);
      this.restLen += n;
      off = n;
      if (this.restLen < 64) return this;
      compress(this.h, this.w, this.rest, 0);
      this.restLen = 0;
    }
    for (; off + 64 <= data.length; off += 64) compress(this.h, this.w, data, off);
    if (off < data.length) {
      this.rest.set(data.subarray(off), 0);
      this.restLen = data.length - off;
    }
    return this;
  }

  digest(): string {
    if (this.done) throw new Error('Kumiori: Sha256.digest twice');
    this.done = true;
    // §5.1.1 の詰め物: 1 ビットの 1、0 の並び、長さ (ビット) を 64 ビットで
    const r = this.restLen;
    const tail = new Uint8Array(r < 56 ? 64 : 128);
    tail.set(this.rest.subarray(0, r));
    tail[r] = 0x80;
    const bits = this.len * 8;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    const n = tail.length;
    tail[n - 8] = hi >>> 24;
    tail[n - 7] = (hi >>> 16) & 0xff;
    tail[n - 6] = (hi >>> 8) & 0xff;
    tail[n - 5] = hi & 0xff;
    tail[n - 4] = lo >>> 24;
    tail[n - 3] = (lo >>> 16) & 0xff;
    tail[n - 2] = (lo >>> 8) & 0xff;
    tail[n - 1] = lo & 0xff;
    for (let off = 0; off < n; off += 64) compress(this.h, this.w, tail, off);
    return Array.from(this.h, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

/** §6.2.2 の 1 ブロック (64 バイト) の計算。h は途中の値 (8 語)、w は作業用の 64 語 */
function compress(h: Int32Array, w: Int32Array, b: Uint8Array, off: number) {
  for (let t = 0; t < 16; t++) {
    const i = off + t * 4;
    w[t] = (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  }
  for (let t = 16; t < 64; t++) {
    const x = w[t - 15];
    const y = w[t - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
  }
  let a = h[0];
  let bb = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let hh = h[7];
  for (let t = 0; t < 64; t++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & bb) ^ (a & c) ^ (bb & c);
    const t2 = (S0 + maj) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = bb;
    bb = a;
    a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0;
  h[1] = (h[1] + bb) | 0;
  h[2] = (h[2] + c) | 0;
  h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0;
  h[5] = (h[5] + f) | 0;
  h[6] = (h[6] + g) | 0;
  h[7] = (h[7] + hh) | 0;
}

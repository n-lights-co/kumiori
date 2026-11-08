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

export function sha256(data: Uint8Array): string {
  const len = data.length;
  // §5.1.1 の詰め物: 1 ビットの 1、0 の並び、長さ (ビット) を 64 ビットで。最後の 1〜2 個のブロックだけを写す
  const tailStart = len - (len % 64);
  const tail = new Uint8Array(len % 64 < 56 ? 64 : 128);
  tail.set(data.subarray(tailStart));
  tail[len - tailStart] = 0x80;
  const bits = len * 8;
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

  const h = Int32Array.from(H0);
  const w = new Int32Array(64);
  for (let off = 0; off < tailStart; off += 64) compress(h, w, data, off);
  for (let off = 0; off < tail.length; off += 64) compress(h, w, tail, off);
  return Array.from(h, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
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

/**
 * icc — CMYK の ICC プロファイルの表 (PCS → 装置の色。BToA) で、sRGB の色を CMYK にする (入稿用の PDF/X の出力)。
 *
 * 読む表の型 (ICC.1:2010 = ISO 15076-1 の §10): lut8Type ('mft1')・lut16Type ('mft2')・lutBToAType ('mBA ')。曲線は curveType ('curv')
 * と parametricCurveType ('para')。PCS は Lab と XYZ (D50)。
 * 色の流れ: sRGB (IEC 61966-2-1) → 線形 → XYZ (D50 に Bradford で順応した行列) → PCS (Lab なら CIE 1976 L*a*b*、白は D50) → 表 → CMYK。
 * 表は相対的な測色 (B2A1。PDF の既定のレンダリングインテント RelativeColorimetric) を使い、無ければ知覚的 (B2A0)・彩度 (B2A2)。
 * sRGB の白はメディアの白 (紙の白) に写る。
 * 画像の画素ごとに表を引くと遅いので、RGB の 33 × 33 × 33 の格子で CMYK を前もって求めておき、その間を 3 次元の 1 次の補間で引く
 */

export type CmykConverter = (r: number, g: number, b: number) => [number, number, number, number];

const D50: [number, number, number] = [0.9642, 1, 0.8249];

/** sRGB (0..1) → XYZ (D50) */
function srgbToXyzD50(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return [0.4360747 * R + 0.3850649 * G + 0.1430804 * B, 0.2225045 * R + 0.7168786 * G + 0.0606169 * B, 0.0139322 * R + 0.0971045 * G + 0.7141733 * B];
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f(x / D50[0]);
  const fy = f(y / D50[1]);
  const fz = f(z / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

type Curve = (v: number) => number;

/** 表の値 (0..1 の等間隔の標本) を 1 次の補間で引く */
function tableCurve(t: ArrayLike<number>, max: number): Curve {
  const n = t.length;
  if (n === 0) return (v) => v;
  if (n === 1) return (v) => v ** ((t[0] as number) / 256);
  return (v) => {
    const x = Math.min(1, Math.max(0, v)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    return ((t[i] as number) * (1 - f) + (t[i + 1] as number) * f) / max;
  };
}

class Reader {
  constructor(readonly b: Uint8Array) {}
  u8(o: number) {
    return this.b[o] ?? 0;
  }
  u16(o: number) {
    return ((this.b[o] ?? 0) << 8) | (this.b[o + 1] ?? 0);
  }
  u32(o: number) {
    return (((this.b[o] ?? 0) << 24) | ((this.b[o + 1] ?? 0) << 16) | ((this.b[o + 2] ?? 0) << 8) | (this.b[o + 3] ?? 0)) >>> 0;
  }
  s15(o: number) {
    return (this.u32(o) | 0) / 65536;
  }
  sig(o: number) {
    return String.fromCharCode(this.u8(o), this.u8(o + 1), this.u8(o + 2), this.u8(o + 3));
  }
}

/** 曲線の型 ('curv'・'para') を読む。end は読んだ後の位置 (4 バイトの境目に揃える前) */
function readCurve(r: Reader, o: number): { f: Curve; end: number } | undefined {
  const t = r.sig(o);
  if (t === 'curv') {
    const n = r.u32(o + 8);
    if (n > 65536 || o + 12 + 2 * n > r.b.length) return undefined;
    if (n === 0) return { f: (v) => v, end: o + 12 };
    if (n === 1) {
      const g = r.u16(o + 12) / 256;
      return { f: (v) => Math.max(0, v) ** g, end: o + 14 };
    }
    const tab = new Uint16Array(n);
    for (let k = 0; k < n; k++) tab[k] = r.u16(o + 12 + 2 * k);
    return { f: tableCurve(tab, 65535), end: o + 12 + 2 * n };
  }
  if (t === 'para') {
    // 関数の形 0〜4 (ICC.1:2010 の表 65)
    const kind = r.u16(o + 8);
    const np = [1, 3, 4, 5, 7][kind];
    if (np === undefined) return undefined;
    const p = Array.from({ length: np }, (_, k) => r.s15(o + 12 + 4 * k));
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
    const pow = (x: number) => (x > 0 ? x ** g : 0);
    const fn: Curve =
      kind === 0
        ? (x) => pow(x)
        : kind === 1
          ? (x) => (x >= -b / a ? pow(a * x + b) : 0)
          : kind === 2
            ? (x) => (x >= -b / a ? pow(a * x + b) + c : c)
            : kind === 3
              ? (x) => (x >= d ? pow(a * x + b) : c * x)
              : (x) => (x >= d ? pow(a * x + b) + e : c * x + f);
    return { f: fn, end: o + 12 + 4 * np };
  }
  return undefined;
}

/** 多次元の表 (格子の数 grid[i]、出力 nOut、値は get(index) / max) を、入力 (0..1) の 1 次の補間で引く */
function clut(grid: number[], nOut: number, get: (i: number) => number, max: number): (x: number[]) => number[] {
  const nIn = grid.length;
  // 最後の入力が最も速く変わる (ICC.1:2010 §10.10・§10.12.3)
  const stride: number[] = new Array(nIn);
  let s = nOut;
  for (let i = nIn - 1; i >= 0; i--) {
    stride[i] = s;
    s *= grid[i];
  }
  return (x) => {
    const base: number[] = [];
    const frac: number[] = [];
    for (let i = 0; i < nIn; i++) {
      const g = grid[i];
      const v = Math.min(1, Math.max(0, x[i] ?? 0)) * (g - 1);
      const k = Math.min(g - 2, Math.floor(v));
      base.push(Math.max(0, k));
      frac.push(g > 1 ? v - Math.max(0, k) : 0);
    }
    const out = new Array(nOut).fill(0);
    for (let corner = 0; corner < 1 << nIn; corner++) {
      let w = 1;
      let idx = 0;
      for (let i = 0; i < nIn; i++) {
        const hi = (corner >> i) & 1;
        if (hi && grid[i] < 2) {
          w = 0;
          break;
        }
        w *= hi ? frac[i] : 1 - frac[i];
        idx += (base[i] + hi) * stride[i];
      }
      if (!w) continue;
      for (let o = 0; o < nOut; o++) out[o] += w * get(idx + o);
    }
    return out.map((v) => v / max);
  };
}

/** PCS の値を、表の入力 (0..1) にする。legacy は lut16Type の Lab の 16 ビットの形 (L 100 = 0xFF00) */
function pcsInput(pcs: 'Lab' | 'XYZ', rgb: [number, number, number], legacy: boolean): number[] {
  const xyz = srgbToXyzD50(...rgb);
  if (pcs === 'XYZ') return xyz.map((v) => v / (1 + 32767 / 32768));
  const [L, a, b] = xyzToLab(...xyz);
  if (legacy) return [(L / 100) * (0xff00 / 0xffff), ((a + 128) * 256) / 0xffff, ((b + 128) * 256) / 0xffff];
  return [L / 100, (a + 128) / 255, (b + 128) / 255];
}

/** BToA の表 1 つを読んで、sRGB → CMYK (0..1) の関数にする。読めなければ undefined */
function readBToA(r: Reader, o: number, pcs: 'Lab' | 'XYZ'): ((rgb: [number, number, number]) => number[]) | undefined {
  const type = r.sig(o);
  if (type === 'mft1' || type === 'mft2') {
    const nIn = r.u8(o + 8);
    const nOut = r.u8(o + 9);
    const g = r.u8(o + 10);
    if (nIn !== 3 || nOut !== 4 || g < 2) return undefined;
    const m = Array.from({ length: 9 }, (_, k) => r.s15(o + 12 + 4 * k));
    const wide = type === 'mft2';
    const nInT = wide ? r.u16(o + 48) : 256;
    const nOutT = wide ? r.u16(o + 50) : 256;
    const at0 = o + (wide ? 52 : 48);
    const sz = wide ? 2 : 1;
    const max = wide ? 65535 : 255;
    const read = (p: number) => (wide ? r.u16(p) : r.u8(p));
    if (nInT < 2 || nOutT < 2) return undefined;
    const clutAt = at0 + nIn * nInT * sz;
    const clutLen = g ** nIn * nOut;
    const outAt = clutAt + clutLen * sz;
    if (outAt + nOut * nOutT * sz > r.b.length) return undefined;
    const curve = (start: number, n: number) => {
      const t = new Float64Array(n);
      for (let k = 0; k < n; k++) t[k] = read(start + k * sz);
      return tableCurve(t, max);
    };
    const inC = Array.from({ length: nIn }, (_, i) => curve(at0 + i * nInT * sz, nInT));
    const outC = Array.from({ length: nOut }, (_, i) => curve(outAt + i * nOutT * sz, nOutT));
    const look = clut([g, g, g], nOut, (i) => read(clutAt + i * sz), max);
    return (rgb) => {
      let x = pcsInput(pcs, rgb, wide);
      // 行列は PCS が XYZ のときだけ使う (ICC.1:2010 §10.10・§10.11)
      if (pcs === 'XYZ') x = [m[0] * x[0] + m[1] * x[1] + m[2] * x[2], m[3] * x[0] + m[4] * x[1] + m[5] * x[2], m[6] * x[0] + m[7] * x[1] + m[8] * x[2]];
      const y = look(x.map((v, i) => inC[i](v)));
      return y.map((v, i) => outC[i](v));
    };
  }
  if (type === 'mBA ') {
    // lutBToAType (ICC.1:2010 §10.12): B の曲線 → 行列 → M の曲線 → CLUT → A の曲線
    const nIn = r.u8(o + 8);
    const nOut = r.u8(o + 9);
    if (nIn !== 3 || nOut !== 4) return undefined;
    // 位置: 12 B の曲線・16 行列・20 M の曲線・24 CLUT・28 A の曲線 (0 なら無い)
    const offB = r.u32(o + 12);
    const offMat = r.u32(o + 16);
    const offM = r.u32(o + 20);
    const offC = r.u32(o + 24);
    const offA = r.u32(o + 28);
    const curves = (off: number, n: number): Curve[] | undefined => {
      if (!off) return undefined;
      const out: Curve[] = [];
      let p = o + off;
      for (let k = 0; k < n; k++) {
        const c = readCurve(r, p);
        if (!c) return undefined;
        out.push(c.f);
        // 曲線ごとに 4 バイトの境目に揃える
        p = c.end + ((4 - ((c.end - o) % 4)) % 4);
      }
      return out;
    };
    const B = curves(offB, nIn);
    if (!B || !offC) return undefined;
    const M = offM ? curves(offM, nIn) : undefined;
    const A = offA ? curves(offA, nOut) : undefined;
    // 行列: 3 × 3 と、足す値 3 つ (s15Fixed16)
    const e = offMat ? Array.from({ length: 12 }, (_, k) => r.s15(o + offMat + 4 * k)) : undefined;
    const p = o + offC;
    const grid = Array.from({ length: nIn }, (_, i) => r.u8(p + i));
    const prec = r.u8(p + 16);
    if (grid.some((v) => v < 1) || (prec !== 1 && prec !== 2)) return undefined;
    const len = grid.reduce((acc, v) => acc * v, 1) * nOut;
    if (p + 20 + len * prec > r.b.length) return undefined;
    const look = clut(grid, nOut, (i) => (prec === 2 ? r.u16(p + 20 + 2 * i) : r.u8(p + 20 + i)), prec === 2 ? 65535 : 255);
    return (rgb) => {
      let x = pcsInput(pcs, rgb, false).map((v, i) => B[i](v));
      if (e && M) {
        x = [0, 1, 2].map((i) => e[3 * i] * x[0] + e[3 * i + 1] * x[1] + e[3 * i + 2] * x[2] + e[9 + i]);
        x = x.map((v, i) => M[i](v));
      }
      const y = look(x);
      return A ? y.map((v, i) => A[i](v)) : y;
    };
  }
  return undefined;
}

/**
 * CMYK の ICC プロファイルから、sRGB (0..1) → CMYK (0..1) の変換を作る。CMYK の出力のプロファイルでない・BToA の表が読めなければ undefined
 */
export function iccRgbToCmyk(profile: Uint8Array): CmykConverter | undefined {
  if (profile.length < 132) return undefined;
  const r = new Reader(profile);
  if (r.sig(36) !== 'acsp' || r.sig(16) !== 'CMYK') return undefined;
  const pcsSig = r.sig(20);
  const pcs = pcsSig === 'Lab ' ? 'Lab' : pcsSig === 'XYZ ' ? 'XYZ' : undefined;
  if (!pcs) return undefined;
  const n = r.u32(128);
  const tags = new Map<string, number>();
  for (let k = 0; k < n && 132 + 12 * k + 12 <= profile.length; k++) tags.set(r.sig(132 + 12 * k), r.u32(132 + 12 * k + 4));
  let f: ((rgb: [number, number, number]) => number[]) | undefined;
  for (const t of ['B2A1', 'B2A0', 'B2A2']) {
    const o = tags.get(t);
    if (o === undefined || o + 32 > profile.length) continue;
    f = readBToA(r, o, pcs);
    if (f) break;
  }
  if (!f) return undefined;
  // RGB の格子で前もって求める
  const N = 33;
  const grid = new Float32Array(N * N * N * 4);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      for (let k = 0; k < N; k++) {
        const v = f([i / (N - 1), j / (N - 1), k / (N - 1)]);
        grid.set(v.map((x) => Math.min(1, Math.max(0, x))), ((i * N + j) * N + k) * 4);
      }
  const look = clut([N, N, N], 4, (i) => grid[i], 1);
  return (rr, gg, bb) => {
    const v = look([rr, gg, bb]);
    const c = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000;
    return [c(v[0]), c(v[1]), c(v[2]), c(v[3])];
  };
}

/**
 * psShading — PostScript の網かけ (shading。shfill と、PatternType 2 の模様) と、並べる模様 (PatternType 1) を、描画の並び (DisplayItem) にする。
 *
 *  根拠: PostScript LanguageLevel 3 の網かけの辞書 (ShadingType 1〜7) と関数の辞書 (FunctionType 0・2・3)、模様の辞書 (PatternType 1・2)。
 *  網かけの型と関数の型の定義は PDF と同じなので、ISO 32000-2:2020 の §7.10 (関数)・§8.7.3 (並べる模様)・§8.7.4 (網かけ) の本文で確かめた。
 *  標本の関数の Order 3 (3 次スプラインの補間) は、入力が 1 つのとき自然な 3 次スプライン、2 つ以上なら 1 次の補間で代える。
 *  模様の行列は PostScript のとおり makepattern の時の CTM を掛ける。
 *   - 網かけは、塗る範囲 (クリップか塗るパスの外接矩形) を画素に分けて、画素ごとに色を計算した画像にする (PDF・SVG に共通の形にするため)。
 *     1: 関数で決まる面 (Domain・Matrix・Function)、2: 軸 (Coords x0 y0 x1 y1・Domain・Extend)、3: 放射 (Coords x0 y0 r0 x1 y1 r1)、
 *     4・5: 三角形の網 (自由な形・格子の形。頂点の色を重心座標で補間)、6・7: Coons の面・テンソル積の面 (面を細かい三角形に分ける)
 *   - 関数: 0 標本 (多重 1 次補間)、2 指数 (C0・C1・N)、3 つなぎ (Functions・Bounds・Encode)、関数の配列 (出力を並べる)、手続き
 *   - 並べる模様: PaintProc を模様の空間で 1 度だけ描いて覚え、塗る範囲を覆うだけ XStep・YStep ずつずらして並べる。
 *     PaintType 2 (色の無い模様) は、塗るときの色で描く
 */
import { apply, applyVector, invert, mul, transformSegs, type Matrix, type Seg } from './matrix';
import { type Interp, type PSDict, type PSObj, PSError, arrItems, isProc, strBytes } from './psInterp';
import type { Clip, DisplayItem, Graphics, RGB } from './psGraphics';
import type { ColorSpace } from './psColorSpace';

type Fn = (x: number[]) => number[];
const numOf = (o: PSObj | undefined, d = 0) => (o && (o.t === 'int' || o.t === 'real') ? o.v : d);
const nums = (o: PSObj | undefined): number[] | undefined => (o && o.t === 'array' ? arrItems(o).map((v) => numOf(v)) : undefined);
const dictOf = (o: PSObj | undefined): PSDict | undefined => (o && o.t === 'dict' ? o.d : undefined);
const clampTo = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** データの元 (文字列・ファイル) のバイト。ファイルは最後まで読む (上限 16MB) */
function sourceBytes(o: PSObj | undefined): Uint8Array | undefined {
  if (!o) return undefined;
  if (o.t === 'string') return strBytes(o);
  if (o.t === 'file') {
    const out: number[] = [];
    for (let c = o.f.read(); c >= 0 && out.length < 16 << 20; c = o.f.read()) out.push(c);
    return Uint8Array.from(out);
  }
  return undefined;
}

/** 上位のビットから読む */
class Bits {
  private bit = 0;
  constructor(private b: Uint8Array) {}
  get left() {
    return this.b.length * 8 - this.bit;
  }
  read(n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) {
      const byte = this.b[this.bit >> 3] ?? 0;
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  align() {
    this.bit = Math.ceil(this.bit / 8) * 8;
  }
}

/** 関数 (辞書・その配列・手続き) を、JavaScript の関数にする。nOut は出力の数 (手続きのとき) */
export function makeFunction(G: Graphics, o: PSObj | undefined, nOut: number, depth = 0): Fn | undefined {
  if (!o || depth > 8) return undefined;
  if (o.t === 'array' && !isProc(o)) {
    // 関数の配列: それぞれ 1 出力の関数を、成分ごとに呼ぶ
    const fs = arrItems(o).map((f) => makeFunction(G, f, 1, depth + 1));
    if (fs.some((f) => !f)) return undefined;
    return (x) => fs.flatMap((f) => f!(x));
  }
  if (isProc(o)) return (x) => G.callTint(o, x, nOut);
  const d = dictOf(o);
  if (!d) return undefined;
  const type = numOf(d.get('FunctionType'), -1);
  const domain = nums(d.get('Domain')) ?? [0, 1];
  const range = nums(d.get('Range'));
  const clipIn = (x: number[]) => x.map((v, k) => clampTo(v, domain[2 * k] ?? -Infinity, domain[2 * k + 1] ?? Infinity));
  const clipOut = (y: number[]) => (range ? y.map((v, k) => clampTo(v, range[2 * k] ?? -Infinity, range[2 * k + 1] ?? Infinity)) : y);
  if (type === 2) {
    // 指数: y = C0 + x^N × (C1 − C0)
    const c0 = nums(d.get('C0')) ?? [0];
    const c1 = nums(d.get('C1')) ?? [1];
    const n = numOf(d.get('N'), 1);
    return (x) => {
      const t = clipIn(x)[0];
      const p = t ** n;
      return clipOut(c0.map((v, k) => v + p * ((c1[k] ?? 0) - v)));
    };
  }
  if (type === 3) {
    // つなぎ: Domain を Bounds で区切り、区間ごとに Encode で写して、その区間の関数を呼ぶ
    const fs = (d.get('Functions') && d.get('Functions')!.t === 'array' ? arrItems(d.get('Functions') as never) : []).map((f) => makeFunction(G, f, nOut, depth + 1));
    const bounds = nums(d.get('Bounds')) ?? [];
    const enc = nums(d.get('Encode')) ?? fs.flatMap(() => [0, 1]);
    if (!fs.length || fs.some((f) => !f)) return undefined;
    return (x) => {
      const t = clipIn(x)[0];
      // 区間は左を含み右を含まない (最後の区間は右も含む)。Domain0 = Bounds0 なら、最初の区間は [Domain0, Bounds0] の点
      // (ISO 32000-2 §7.10.4)
      let i = 0;
      while (i < bounds.length && (t > bounds[i] || (t === bounds[i] && !(i === 0 && bounds[0] === domain[0])))) i++;
      const lo = i === 0 ? domain[0] : bounds[i - 1];
      const hi = i === bounds.length ? domain[1] : bounds[i];
      const e0 = enc[2 * i] ?? 0;
      const e1 = enc[2 * i + 1] ?? 1;
      const u = hi === lo ? e0 : e0 + ((t - lo) * (e1 - e0)) / (hi - lo);
      return clipOut(fs[i]!([u]));
    };
  }
  if (type === 0) {
    // 標本: 入力を Encode で標本の番号に写し、近い標本の間を 1 次で補間して、Decode で出力に写す
    const size = nums(d.get('Size')) ?? [];
    const bps = numOf(d.get('BitsPerSample'), 8);
    const m = size.length;
    const nOutS = range ? range.length / 2 : nOut;
    const data = sourceBytes(d.get('DataSource'));
    if (!data || !m || m > 8 || ![1, 2, 4, 8, 12, 16, 24, 32].includes(bps)) return undefined;
    const total = size.reduce((a, v) => a * v, 1);
    if (!(total > 0) || total * nOutS > 1 << 24) return undefined;
    const bits = new Bits(data);
    const max = 2 ** bps - 1;
    const samples = new Float64Array(total * nOutS);
    for (let k = 0; k < samples.length && bits.left >= bps; k++) samples[k] = bits.read(bps) / max;
    const enc = nums(d.get('Encode')) ?? size.flatMap((s) => [0, s - 1]);
    const dec = nums(d.get('Decode')) ?? range ?? new Array(nOutS).fill([0, 1]).flat();
    // Order 3 (3 次スプラインの補間): 入力が 1 つで標本が 4 つ以上のとき (ISO 32000-2 §7.10.2: 4 未満なら Order 3 は無視)。
    // 出力ごとに、端の 2 次微分を 0 とする自然な 3 次スプライン (標本の間隔は 1)
    const order = numOf(d.get('Order'), 1);
    const spline =
      order === 3 && m === 1 && size[0] >= 4
        ? Array.from({ length: nOutS }, (_, j) => {
            const n = size[0];
            const y = Array.from({ length: n }, (_, i) => samples[i * nOutS + j]);
            // 2 次微分 M (三重対角の連立方程式: M[i-1] + 4 M[i] + M[i+1] = 6 (y[i+1] − 2 y[i] + y[i-1])、M[0] = M[n-1] = 0)
            const M = new Float64Array(n);
            const c = new Float64Array(n);
            const r = new Float64Array(n);
            for (let i = 1; i < n - 1; i++) {
              const rhs = 6 * (y[i + 1] - 2 * y[i] + y[i - 1]);
              const den = 4 - (i > 1 ? c[i - 1] : 0);
              c[i] = 1 / den;
              r[i] = (rhs - (i > 1 ? r[i - 1] : 0)) / den;
            }
            for (let i = n - 2; i >= 1; i--) M[i] = r[i] - c[i] * M[i + 1];
            return (e: number) => {
              const i = Math.min(Math.floor(e), n - 2);
              const t = e - i;
              return (1 - t) * y[i] + t * y[i + 1] + (((1 - t) ** 3 - (1 - t)) * M[i] + (t ** 3 - t) * M[i + 1]) / 6;
            };
          })
        : undefined;
    return (x) => {
      const xi = clipIn(x);
      // 各入力の標本の番号 (実数)
      const e = xi.map((v, k) => {
        const d0 = domain[2 * k];
        const d1 = domain[2 * k + 1];
        const u = d1 === d0 ? enc[2 * k] : enc[2 * k] + ((v - d0) * (enc[2 * k + 1] - enc[2 * k])) / (d1 - d0);
        return clampTo(u, 0, size[k] - 1);
      });
      if (spline) return clipOut(spline.map((f, j) => dec[2 * j] + f(e[0]) * (dec[2 * j + 1] - dec[2 * j])));
      const out = new Array(nOutS).fill(0);
      // 2^m の角の重み付きの和 (多重 1 次補間)
      for (let corner = 0; corner < 1 << m; corner++) {
        let w = 1;
        let idx = 0;
        let stride = 1;
        for (let k = 0; k < m; k++) {
          const f = Math.floor(e[k]);
          const fr = e[k] - f;
          const hi = (corner >> k) & 1;
          const ik = Math.min(f + hi, size[k] - 1);
          w *= hi ? fr : 1 - fr;
          idx += ik * stride;
          stride *= size[k];
        }
        if (!w) continue;
        for (let j = 0; j < nOutS; j++) out[j] += w * samples[idx * nOutS + j];
      }
      return clipOut(out.map((v, j) => dec[2 * j] + v * (dec[2 * j + 1] - dec[2 * j])));
    };
  }
  return undefined;
}

/** 網かけの色空間と、色の成分 (関数の入力、または成分そのもの) → RGB */
function shadingColour(G: Graphics, sh: PSDict): { cs: ColorSpace; fn?: Fn; rgb: (c: number[]) => RGB } | undefined {
  const cso = sh.get('ColorSpace');
  if (!cso) return undefined;
  const cs = G.parseColorSpace(cso);
  const fnO = sh.get('Function');
  const fn = fnO ? makeFunction(G, fnO, cs.ncomp) : undefined;
  if (fnO && !fn) return undefined;
  const cache = new Map<string, RGB>();
  const rgb = (c: number[]): RGB => {
    const comps = fn ? fn(c) : c;
    const key = comps.map((v) => Math.round(v * 4096)).join(',');
    let r = cache.get(key);
    if (!r) {
      r = G.toRGB(cs, comps);
      if (cache.size < 100000) cache.set(key, r);
    }
    return r;
  };
  return { cs, fn, rgb };
}

/** 外接矩形 (機器の座標) */
function segsBox(segs: Seg[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of segs) {
    if (s.op === 'Z') continue;
    if (s.op === 'C') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
    add(s.x, s.y);
  }
  return [x0, y0, x1, y1];
}
const intersect = (a: number[], b: number[]): [number, number, number, number] => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

/** 画素の数: 長い辺を 1 画素 0.5pt (上限 600 画素)。網かけの色はなめらかに変わるので、これで足りる */
function gridOf(box: number[]): { w: number; h: number } {
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const k = Math.min(2, 600 / Math.max(bw, bh, 1e-6));
  return { w: Math.max(1, Math.ceil(bw * k)), h: Math.max(1, Math.ceil(bh * k)) };
}

/**
 * 網かけを、機器の座標の範囲 box の画像にする。toDev は網かけの空間 → 機器の座標。background なら、網かけの外を Background の色で塗る (模様のとき)
 */
function rasterShading(G: Graphics, sh: PSDict, toDev: Matrix, box: [number, number, number, number], background: boolean): DisplayItem | undefined {
  if (!(box[2] > box[0] && box[3] > box[1])) return undefined;
  const type = numOf(sh.get('ShadingType'), 0);
  const sc = shadingColour(G, sh);
  if (!sc) {
    G.I.warn('網かけの色空間・関数');
    return undefined;
  }
  const inv = invert(toDev);
  if (!inv) return undefined;
  const { w, h } = gridOf(box);
  G.I.charge((w * h) / 16);
  G.imagePixels = (G.imagePixels ?? 0) + w * h;
  const rgba = new Uint8Array(w * h * 4);
  const sx = (box[2] - box[0]) / w;
  const sy = (box[3] - box[1]) / h;
  const put = (i: number, j: number, c: RGB) => {
    const o = (j * w + i) * 4;
    rgba[o] = Math.round(c[0] * 255);
    rgba[o + 1] = Math.round(c[1] * 255);
    rgba[o + 2] = Math.round(c[2] * 255);
    rgba[o + 3] = 255;
  };
  // 網かけの外 (模様の Background。shfill では塗らない)
  const bgO = background ? nums(sh.get('Background')) : undefined;
  if (bgO) {
    const c = G.toRGB(sc.cs, bgO);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(i, j, c);
  }
  // 網かけの空間の BBox (その外は描かない)
  const bb = nums(sh.get('BBox'));
  const inBBox = (p: [number, number]) => !bb || (p[0] >= Math.min(bb[0], bb[2]) && p[0] <= Math.max(bb[0], bb[2]) && p[1] >= Math.min(bb[1], bb[3]) && p[1] <= Math.max(bb[1], bb[3]));
  /** 画素の中心 (機器の座標) → 網かけの空間 */
  const at = (i: number, j: number) => apply(inv, box[0] + (i + 0.5) * sx, box[3] - (j + 0.5) * sy);
  const ext = sh.get('Extend') && sh.get('Extend')!.t === 'array' ? arrItems(sh.get('Extend') as never).map((o) => o.t === 'bool' && o.v) : [false, false];
  const dom = nums(sh.get('Domain')) ?? [0, 1];
  if (type === 1) {
    const d = nums(sh.get('Domain')) ?? [0, 1, 0, 1];
    const m = (nums(sh.get('Matrix')) ?? [1, 0, 0, 1, 0, 0]) as Matrix;
    const mi = invert(m);
    if (!mi || !sc.fn) return undefined;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const p = at(i, j);
        if (!inBBox(p)) continue;
        const [x, y] = apply(mi, p[0], p[1]);
        if (x < d[0] || x > d[1] || y < d[2] || y > d[3]) continue;
        put(i, j, sc.rgb([x, y]));
      }
  } else if (type === 2) {
    const c = nums(sh.get('Coords')) ?? [0, 0, 1, 0];
    const dx = c[2] - c[0];
    const dy = c[3] - c[1];
    const dd = dx * dx + dy * dy;
    if (!dd) return undefined;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const p = at(i, j);
        if (!inBBox(p)) continue;
        let s = ((p[0] - c[0]) * dx + (p[1] - c[1]) * dy) / dd;
        if (s < 0) {
          if (!ext[0]) continue;
          s = 0;
        } else if (s > 1) {
          if (!ext[1]) continue;
          s = 1;
        }
        put(i, j, sc.rgb([dom[0] + s * (dom[1] - dom[0])]));
      }
  } else if (type === 3) {
    // 放射: 円 c(s) = c0 + s(c1 − c0)、半径 r(s) = r0 + s(r1 − r0) のうち、点を通り r(s) ≥ 0 の最大の s
    const [x0, y0, r0, x1, y1, r1] = nums(sh.get('Coords')) ?? [0, 0, 0, 0, 0, 1];
    // 半径が 2 つとも 0 なら何も描かない (ISO 32000-2 §8.7.4.5.4)
    if (r0 === 0 && r1 === 0) return undefined;
    const cdx = x1 - x0;
    const cdy = y1 - y0;
    const dr = r1 - r0;
    const a = cdx * cdx + cdy * cdy - dr * dr;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const p = at(i, j);
        if (!inBBox(p)) continue;
        const px = p[0] - x0;
        const py = p[1] - y0;
        const b = px * cdx + py * cdy + r0 * dr;
        const cc = px * px + py * py - r0 * r0;
        const roots: number[] = [];
        if (Math.abs(a) < 1e-12) {
          if (b) roots.push(cc / (2 * b));
        } else {
          const disc = b * b - a * cc;
          if (disc < 0) continue;
          const q = Math.sqrt(disc);
          roots.push((b + q) / a, (b - q) / a);
        }
        let s: number | undefined;
        for (const r of roots.sort((u, v) => v - u)) {
          if (r0 + r * dr < 0) continue;
          if (r >= 0 && r <= 1) s = r;
          else if (r > 1 && ext[1]) s = 1;
          else if (r < 0 && ext[0]) s = 0;
          else continue;
          break;
        }
        if (s === undefined) continue;
        put(i, j, sc.rgb([dom[0] + s * (dom[1] - dom[0])]));
      }
  } else if (type >= 4 && type <= 7) {
    const tris = meshTriangles(sh, type, sc.fn ? 1 : sc.cs.ncomp, !!sc.fn);
    if (!tris) {
      G.I.warn(`ShadingType ${type} のデータ`);
      return undefined;
    }
    for (const t of tris) {
      const P = t.p.map((q) => apply(toDev, q[0], q[1]));
      // 三角形の外接矩形の画素だけを見る (画素の中心が三角形の中なら、重心座標で色を補間する)
      const det = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(det) < 1e-12) continue;
      const i0 = Math.max(0, Math.floor((Math.min(P[0][0], P[1][0], P[2][0]) - box[0]) / sx));
      const i1 = Math.min(w - 1, Math.ceil((Math.max(P[0][0], P[1][0], P[2][0]) - box[0]) / sx));
      const j0 = Math.max(0, Math.floor((box[3] - Math.max(P[0][1], P[1][1], P[2][1])) / sy));
      const j1 = Math.min(h - 1, Math.ceil((box[3] - Math.min(P[0][1], P[1][1], P[2][1])) / sy));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = box[0] + (i + 0.5) * sx;
          const y = box[3] - (j + 0.5) * sy;
          const l1 = ((x - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (y - P[0][1])) / det;
          const l2 = ((P[1][0] - P[0][0]) * (y - P[0][1]) - (x - P[0][0]) * (P[1][1] - P[0][1])) / det;
          const l0 = 1 - l1 - l2;
          if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
          put(i, j, sc.rgb(t.c[0].map((v, k) => l0 * v + l1 * t.c[1][k] + l2 * t.c[2][k])));
        }
    }
  } else {
    G.I.warn(`ShadingType ${type}`);
    return undefined;
  }
  return { k: 'image', width: w, height: h, rgba, mat: [sx, 0, 0, -sy, box[0], box[3]], interpolate: true, clip: G.g.clip };
}

type Tri = { p: [number, number][]; c: number[][] };

/**
 * 網の網かけ (4 三角形・5 格子・6 Coons の面・7 テンソル積の面) の三角形 (網かけの空間の点と、色の成分)。
 * DataSource は数の配列か、ビットに詰めた文字列・ファイル (BitsPerCoordinate・BitsPerComponent・BitsPerFlag・Decode。頂点・面ごとにバイトの境目へ)
 */
function meshTriangles(sh: PSDict, type: number, nc: number, fnT = false): Tri[] | undefined {
  const ds = sh.get('DataSource');
  let next: (kind: 'flag' | 'x' | 'y' | number) => number | undefined;
  let align = () => {};
  if (ds && ds.t === 'array') {
    const v = arrItems(ds).map((o) => numOf(o));
    let k = 0;
    next = (kind) => (k < v.length ? (kind === 'flag' ? v[k++] & 3 : v[k++]) : undefined);
  } else {
    const bytes = sourceBytes(ds);
    if (!bytes) return undefined;
    const bits = new Bits(bytes);
    const bpc = numOf(sh.get('BitsPerCoordinate'), 0);
    const bpk = numOf(sh.get('BitsPerComponent'), 0);
    const bpf = numOf(sh.get('BitsPerFlag'), 0);
    const dec = nums(sh.get('Decode')) ?? [];
    if (!bpc || !bpk || bpc > 32 || bpk > 16 || bpf > 8) return undefined;
    const map = (raw: number, n: number, lo: number, hi: number) => lo + (raw * (hi - lo)) / (2 ** n - 1);
    next = (kind) => {
      // 辺の印は下位 2 ビットだけを使う (ISO 32000-2 §8.7.4.5.5・§8.7.4.5.7)
      if (kind === 'flag') return bits.left >= bpf ? bits.read(bpf) & 3 : undefined;
      const n = kind === 'x' || kind === 'y' ? bpc : bpk;
      if (bits.left < n) return undefined;
      const raw = bits.read(n);
      const di = kind === 'x' ? 0 : kind === 'y' ? 2 : 4 + 2 * kind;
      return map(raw, n, dec[di] ?? 0, dec[di + 1] ?? 1);
    };
    align = () => bits.align();
  }
  const point = (): [number, number] | undefined => {
    const x = next('x');
    const y = next('y');
    return x === undefined || y === undefined ? undefined : [x, y];
  };
  // 関数があるとき、頂点の値 t は Decode の色の範囲に収める (ISO 32000-2 §8.7.4.5.5)
  const decC = nums(sh.get('Decode'))?.slice(4, 6);
  const colour = (): number[] | undefined => {
    const c: number[] = [];
    for (let k = 0; k < nc; k++) {
      let v = next(k);
      if (v === undefined) return undefined;
      if (fnT && decC?.length === 2) v = clampTo(v, Math.min(decC[0], decC[1]), Math.max(decC[0], decC[1]));
      c.push(v);
    }
    return c;
  };
  const tris: Tri[] = [];
  const LIMIT = 200000;
  if (type === 4) {
    // 自由な形: 印 0 は新しい三角形の 1 つ目の頂点 (続く 2 つも読む)、1 は前の三角形の (b, c) と、2 は (a, c) とつなぐ
    let a: { p: [number, number]; c: number[] } | undefined;
    let b: typeof a;
    let c: typeof a;
    const vertex = (withFlag: boolean) => {
      const f = withFlag ? next('flag') : 0;
      const p = point();
      const col = p ? colour() : undefined;
      align();
      return f === undefined || !p || !col ? undefined : { f, v: { p, c: col } };
    };
    for (let guard = 0; guard < LIMIT; guard++) {
      const v = vertex(true);
      if (!v) break;
      if (v.f === 0 || !a || !b || !c) {
        const v2 = vertex(true);
        const v3 = vertex(true);
        if (!v2 || !v3) break;
        [a, b, c] = [v.v, v2.v, v3.v];
      } else if (v.f === 1) [a, b, c] = [b, c, v.v];
      else [a, b, c] = [a, c, v.v];
      tris.push({ p: [a.p, b.p, c.p], c: [a.c, b.c, c.c] });
    }
  } else if (type === 5) {
    // 格子: VerticesPerRow 個ずつの行。隣り合う 2 行の 4 点で 2 つの三角形
    const per = numOf(sh.get('VerticesPerRow'), 0);
    if (per < 2) return undefined;
    let prev: Array<{ p: [number, number]; c: number[] }> | undefined;
    for (let guard = 0; guard < LIMIT; guard++) {
      const row: Array<{ p: [number, number]; c: number[] }> = [];
      for (let k = 0; k < per; k++) {
        const p = point();
        const col = p ? colour() : undefined;
        align();
        if (!p || !col) break;
        row.push({ p, c: col });
      }
      if (row.length < per) break;
      if (prev)
        for (let k = 0; k + 1 < per; k++) {
          tris.push({ p: [prev[k].p, prev[k + 1].p, row[k].p], c: [prev[k].c, prev[k + 1].c, row[k].c] });
          tris.push({ p: [prev[k + 1].p, row[k + 1].p, row[k].p], c: [prev[k + 1].c, row[k + 1].c, row[k].c] });
        }
      prev = row;
    }
  } else {
    // 面: 12 点 (Coons) か 16 点 (テンソル積) と、4 つの角の色。印 1〜3 は前の面の辺 (4 点と 2 色) を受け継ぐ
    // 点の順: p00 p01 p02 p03 p13 p23 p33 p32 p31 p30 p20 p10 (テンソル積はさらに p11 p12 p22 p21)。色の順: c00 c03 c33 c30
    const nPts = type === 6 ? 12 : 16;
    let prev: { P: Array<[number, number]>; C: number[][] } | undefined;
    for (let guard = 0; guard < LIMIT / 64; guard++) {
      const f = next('flag');
      if (f === undefined) break;
      const P: Array<[number, number]> = [];
      const C: number[][] = [];
      if (f !== 0 && prev) {
        // 受け継ぐ辺 (前の面の境界の順の番号): 1 → p03 p13 p23 p33、2 → p33 p32 p31 p30、3 → p30 p20 p10 p00
        const edge = f === 1 ? [3, 4, 5, 6] : f === 2 ? [6, 7, 8, 9] : [9, 10, 11, 0];
        const ce = f === 1 ? [1, 2] : f === 2 ? [2, 3] : [3, 0];
        for (const k of edge) P.push(prev.P[k]);
        for (const k of ce) C.push(prev.C[k]);
      } else if (f !== 0) break;
      let ok = true;
      while (P.length < nPts) {
        const p = point();
        if (!p) {
          ok = false;
          break;
        }
        P.push(p);
      }
      while (ok && C.length < 4) {
        const c = colour();
        if (!c) {
          ok = false;
          break;
        }
        C.push(c);
      }
      align();
      if (!ok) break;
      prev = { P, C };
      tris.push(...patchTriangles(P, C, type === 7));
    }
  }
  return tris;
}

/** 面 (Coons・テンソル積) を u・v で 12 × 12 に分けた三角形。色は 4 つの角の色を u・v で 2 次元の 1 次補間 */
function patchTriangles(P: Array<[number, number]>, C: number[][], tensor: boolean): Tri[] {
  // 境界の順の番号 → 格子の (i, j) (i は u、j は v)
  const order: Array<[number, number]> = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [1, 1], [1, 2], [2, 2], [2, 1]];
  const g: Array<Array<[number, number]>> = [[], [], [], []];
  order.slice(0, P.length).forEach(([i, j], k) => (g[i][j] = P[k]));
  const B = (t: number) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  const S = (u: number, v: number): [number, number] => {
    const bu = B(u);
    const bv = B(v);
    if (tensor) {
      let x = 0;
      let y = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        x += g[i][j][0] * bu[i] * bv[j];
        y += g[i][j][1] * bu[i] * bv[j];
      }
      return [x, y];
    }
    // Coons: 2 組の向かい合う境界の曲線の線形の和から、角の 2 次元の 1 次補間を引く
    const curve = (pts: Array<[number, number]>, b: number[]) => [0, 1].map((k) => pts.reduce((a, p, n) => a + p[k] * b[n], 0));
    const c1 = curve([g[0][0], g[1][0], g[2][0], g[3][0]], bu); // v = 0
    const c2 = curve([g[0][3], g[1][3], g[2][3], g[3][3]], bu); // v = 1
    const d1 = curve([g[0][0], g[0][1], g[0][2], g[0][3]], bv); // u = 0
    const d2 = curve([g[3][0], g[3][1], g[3][2], g[3][3]], bv); // u = 1
    return [0, 1].map(
      (k) =>
        (1 - v) * c1[k] + v * c2[k] + (1 - u) * d1[k] + u * d2[k] -
        ((1 - v) * ((1 - u) * g[0][0][k] + u * g[3][0][k]) + v * ((1 - u) * g[0][3][k] + u * g[3][3][k])),
    ) as [number, number];
  };
  const col = (u: number, v: number) => C[0].map((_, k) => (1 - u) * (1 - v) * C[0][k] + (1 - u) * v * C[1][k] + u * v * C[2][k] + u * (1 - v) * C[3][k]);
  const N = 12;
  const out: Tri[] = [];
  // 面が折り返して重なるときは、v の大きい点、v が同じなら u の大きい点を優先する (ISO 32000-2 §8.7.4.5.7) ので、
  // v を外、u を内に回して、後に塗る
  for (let b = 0; b < N; b++)
    for (let a = 0; a < N; a++) {
      const u0 = a / N;
      const u1 = (a + 1) / N;
      const v0 = b / N;
      const v1 = (b + 1) / N;
      const q = [S(u0, v0), S(u1, v0), S(u1, v1), S(u0, v1)];
      const c = [col(u0, v0), col(u1, v0), col(u1, v1), col(u0, v1)];
      out.push({ p: [q[0], q[1], q[2]], c: [c[0], c[1], c[2]] }, { p: [q[0], q[2], q[3]], c: [c[0], c[2], c[3]] });
    }
  return out;
}

/** shfill: 網かけを、いまのクリップの中に描く */
export function shfill(G: Graphics, o: PSObj) {
  const sh = dictOf(o);
  if (!sh) throw new PSError('typecheck');
  const clip = G.clipPathSegs();
  const box = intersect(segsBox(clip), G.opts.bbox);
  const it = rasterShading(G, sh, G.g.ctm, box, false);
  if (it) G.items.push(it);
}

/** 模様の辞書の、模様の空間 → 機器の座標の行列 (makepattern の時の CTM を掛けたもの) */
function patternMatrix(p: PSDict): Matrix | undefined {
  const impl = p.get('Implementation');
  const v = impl && impl.t === 'array' ? arrItems(impl).slice(1).map((o) => numOf(o)) : undefined;
  return v && v.length === 6 ? (v as Matrix) : undefined;
}

const tileCache = new WeakMap<PSDict, { items: DisplayItem[]; bboxClip: Clip; inside: boolean }>();

/** Pattern の色空間で塗る (fill・eofill)。PatternType 2 は網かけ、1 は PaintProc の絵を並べる */
export function patternFill(G: Graphics, segs: Seg[], evenOdd: boolean) {
  const p = dictOf(G.g.pattern);
  const pm = p ? patternMatrix(p) : undefined;
  if (!p || !pm) {
    G.I.warn('模様の塗り');
    return;
  }
  const fillClip: Clip = { segs: segs.slice(), evenOdd, parent: G.g.clip };
  const region = intersect(intersect(segsBox(segs), segsBox(G.clipPathSegs())), G.opts.bbox);
  if (!(region[2] > region[0] && region[3] > region[1])) return;
  const type = numOf(p.get('PatternType'), 1);
  if (type === 2) {
    const sh = dictOf(p.get('Shading'));
    if (!sh) return;
    const saved = G.g.clip;
    G.g.clip = fillClip;
    try {
      const it = rasterShading(G, sh, pm, region, true);
      if (it) G.items.push(it);
    } finally {
      G.g.clip = saved;
    }
    return;
  }
  tilingFill(G, p, pm, fillClip, region);
}

/**
 * 並べる模様 (PatternType 1): PaintProc を模様の空間 (CTM = 模様の行列、クリップ = BBox) で 1 度描いて覚え、
 * 塗る範囲を覆うだけ (XStep, YStep) ずつずらした写しを、塗るパスのクリップの中に並べる
 */
function tilingFill(G: Graphics, p: PSDict, pm: Matrix, fillClip: Clip, region: [number, number, number, number]) {
  const I: Interp = G.I;
  const bbox = nums(p.get('BBox')) ?? [0, 0, 1, 1];
  const xs = numOf(p.get('XStep'), bbox[2] - bbox[0]);
  const ys = numOf(p.get('YStep'), bbox[3] - bbox[1]);
  if (!xs || !ys) return;
  let tile = tileCache.get(p);
  if (!tile) {
    const rect: Seg[] = transformSegs(
      [
        { op: 'M', x: bbox[0], y: bbox[1] },
        { op: 'L', x: bbox[2], y: bbox[1] },
        { op: 'L', x: bbox[2], y: bbox[3] },
        { op: 'L', x: bbox[0], y: bbox[3] },
        { op: 'Z' },
      ],
      pm,
    );
    const bboxClip: Clip = { segs: rect, evenOdd: false };
    const savedItems = G.items;
    const savedG = G.g;
    const savedStack = G.stack;
    G.items = [];
    G.g = { ...G.initial(), ctm: [...pm] as Matrix, clip: bboxClip };
    G.stack = [];
    const depth = I.ostack.length;
    try {
      const proc = p.get('PaintProc');
      if (proc) {
        I.push({ t: 'dict', d: p });
        I.call(proc);
      }
    } catch (e) {
      if (!(e instanceof PSError)) throw e;
      I.warn('模様の PaintProc');
    } finally {
      I.ostack.length = Math.min(I.ostack.length, depth);
      tile = { items: G.items, bboxClip, inside: false };
      G.items = savedItems;
      G.g = savedG;
      G.stack = savedStack;
    }
    // 描いたものが BBox の中に収まっていれば、写しごとの BBox のクリップは要らない
    const bb = segsBox(rect);
    tile.inside = tile.items.every((it) => {
      if (it.k === 'fill' || it.k === 'stroke') {
        const b = segsBox(it.segs);
        const pad = it.k === 'stroke' ? it.lineWidth * Math.hypot(it.ctm[0], it.ctm[1]) : 0;
        return b[0] - pad >= bb[0] - 0.01 && b[1] - pad >= bb[1] - 0.01 && b[2] + pad <= bb[2] + 0.01 && b[3] + pad <= bb[3] + 0.01;
      }
      return false;
    });
    tileCache.set(p, tile);
  }
  if (!tile.items.length) return;
  // 色の無い模様 (PaintType 2): 塗るときの色 (Pattern の下の色空間の成分) で描く
  const uncolored = numOf(p.get('PaintType'), 1) === 2;
  const base = G.g.cs.base;
  const color: RGB | undefined = uncolored && base ? G.toRGB(base, G.g.color) : undefined;
  // 塗る範囲を覆う写しの番号 (模様の空間の格子)
  const inv = invert(pm);
  if (!inv) return;
  const corners = [
    [region[0], region[1]],
    [region[2], region[1]],
    [region[2], region[3]],
    [region[0], region[3]],
  ].map(([x, y]) => apply(inv, x, y));
  const lo = (k: 0 | 1, step: number, b0: number, b1: number) => Math.floor((Math.min(...corners.map((c) => c[k])) - Math.max(b0, b1)) / step);
  const hi = (k: 0 | 1, step: number, b0: number, b1: number) => Math.ceil((Math.max(...corners.map((c) => c[k])) - Math.min(b0, b1)) / step);
  const [ia, ib] = [lo(0, Math.abs(xs), bbox[0], bbox[2]), hi(0, Math.abs(xs), bbox[0], bbox[2])];
  const [ja, jb] = [lo(1, Math.abs(ys), bbox[1], bbox[3]), hi(1, Math.abs(ys), bbox[1], bbox[3])];
  const count = (ib - ia + 1) * (jb - ja + 1);
  // 写しの数の上限 (描く要素の数で 10 万まで)
  if (count * tile.items.length > 100000) {
    I.warn('模様の写しが多すぎるので、途中まで描きます');
  }
  let budget = 100000;
  for (let j = ja; j <= jb && budget > 0; j++)
    for (let i = ia; i <= ib && budget > 0; i++) {
      const [dx, dy] = applyVector(pm, i * Math.abs(xs), j * Math.abs(ys));
      const tileClip: Clip = tile.inside ? fillClip : { segs: tile.bboxClip.segs.map((s) => moveSeg(s, dx, dy)), evenOdd: false, parent: fillClip };
      const memo = new Map<Clip, Clip>();
      const clipOf = (c: Clip | undefined): Clip => {
        if (!c || c === tile!.bboxClip) return tileClip;
        let m = memo.get(c);
        if (!m) {
          m = { segs: c.segs.map((s) => moveSeg(s, dx, dy)), evenOdd: c.evenOdd, parent: clipOf(c.parent) };
          memo.set(c, m);
        }
        return m;
      };
      for (const it of tile.items) {
        budget--;
        G.items.push(moveItem(it, dx, dy, clipOf(it.clip), color));
      }
    }
  I.charge(count);
}

const moveSeg = (s: Seg, dx: number, dy: number): Seg =>
  s.op === 'Z' ? s : s.op === 'C' ? { op: 'C', x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy } : { op: s.op, x: s.x + dx, y: s.y + dy };
const moveMat = (m: Matrix, dx: number, dy: number): Matrix => [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy];

/** 描画の要素を (dx, dy) ずらした写し。color があれば、その色で描く (色の無い模様) */
function moveItem(it: DisplayItem, dx: number, dy: number, clip: Clip, color: RGB | undefined): DisplayItem {
  const col = color ? { color, cmyk: undefined } : {};
  switch (it.k) {
    case 'fill':
      return { ...it, ...col, segs: it.segs.map((s) => moveSeg(s, dx, dy)), clip };
    case 'stroke':
      return { ...it, ...col, segs: it.segs.map((s) => moveSeg(s, dx, dy)), ctm: moveMat(it.ctm, dx, dy), clip };
    case 'text':
      return { ...it, ...col, mat: moveMat(it.mat, dx, dy), clip };
    case 'image':
      return { ...it, mat: moveMat(it.mat, dx, dy), clip };
  }
}

/** makepattern: 模様の空間 → 機器の座標の行列 (渡された行列に、いまの CTM を掛けたもの) */
export function patternToDevice(G: Graphics, m: Matrix): Matrix {
  return mul(G.g.ctm, m);
}

/**
 * 線の輪郭 (機器の座標の閉じた形の並び。すべて同じ向きなので、非ゼロ規則で塗れば線の形になる)。
 * 線はユーザ空間 (CTM の逆で戻した座標) で、太さ w の、線分ごとの長方形と、つなぎ目・端の形で表す:
 * つなぎ目は丸 (join 1)・面取り (2)・とがり (0。とがりの長さの比が miter の上限を超えれば面取り)、
 * 端は突き出し (cap 2: 太さの半分だけ延ばす)・丸 (1)・切り落とし (0)。破線は先に切り分ける。曲線は細かい線分にする
 */
export function strokeOutline(segs: Seg[], ctm: Matrix, w: number, cap: number, join: number, dash: { array: number[]; offset: number }, miter = 10): Seg[] {
  const inv = invert(ctm);
  if (!inv || !(w > 0)) return [];
  const user = transformSegs(segs, inv);
  // 線分の並び (部分パスごと。閉じた部分パスは最初の点に戻る)
  const subs: Array<{ pts: Array<[number, number]>; closed: boolean }> = [];
  let cur: Array<[number, number]> = [];
  let start: [number, number] | undefined;
  const flush = (closed: boolean) => {
    if (cur.length >= 2) subs.push({ pts: cur, closed });
    cur = [];
  };
  for (const s of user) {
    if (s.op === 'M') {
      flush(false);
      cur = [[s.x, s.y]];
      start = [s.x, s.y];
    } else if (s.op === 'L') cur.push([s.x, s.y]);
    else if (s.op === 'C') {
      const p0 = cur[cur.length - 1] ?? [s.x1, s.y1];
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3;
        cur.push([a * p0[0] + b * s.x1 + c * s.x2 + d * s.x, a * p0[1] + b * s.y1 + c * s.y2 + d * s.y]);
      }
    } else if (s.op === 'Z' && start) {
      cur.push([start[0], start[1]]);
      flush(true);
      cur = [[start[0], start[1]]];
    }
  }
  flush(false);
  // 破線: 部分パスを、線・隙間の並びで切り分ける (開いた線になる)
  const pieces: Array<{ pts: Array<[number, number]>; closed: boolean }> = [];
  const total = dash.array.reduce((a, v) => a + v, 0);
  for (const sp of subs) {
    if (!(total > 0) || dash.array.some((v) => v < 0)) {
      pieces.push(sp);
      continue;
    }
    let idx = 0;
    let left = dash.array[0];
    let off = ((dash.offset % total) + total) % total;
    while (off > 0) {
      if (off >= left) {
        off -= left;
        idx = (idx + 1) % dash.array.length;
        left = dash.array[idx];
      } else {
        left -= off;
        off = 0;
      }
    }
    let on = idx % 2 === 0;
    let piece: Array<[number, number]> = on ? [sp.pts[0]] : [];
    for (let k = 1; k < sp.pts.length; k++) {
      let [x0, y0] = sp.pts[k - 1];
      const [x1, y1] = sp.pts[k];
      let len = Math.hypot(x1 - x0, y1 - y0);
      while (len > 1e-9) {
        const step = Math.min(left, len);
        const t = step / len;
        const nx = x0 + (x1 - x0) * t;
        const ny = y0 + (y1 - y0) * t;
        if (on) piece.push([nx, ny]);
        len -= step;
        left -= step;
        [x0, y0] = [nx, ny];
        if (left <= 1e-9) {
          if (on && piece.length >= 2) pieces.push({ pts: piece, closed: false });
          idx = (idx + 1) % dash.array.length;
          left = dash.array[idx];
          on = !on;
          piece = on ? [[x0, y0]] : [];
          if (pieces.length > 20000) break;
        }
      }
    }
    if (on && piece.length >= 2) pieces.push({ pts: piece, closed: false });
  }
  const h = w / 2;
  const out: Seg[] = [];
  /** 反時計回りの多角形を足す */
  const poly = (ps: Array<[number, number]>) => {
    if (ps.length < 3) return;
    let area = 0;
    for (let k = 0; k < ps.length; k++) {
      const [ax, ay] = ps[k];
      const [bx, by] = ps[(k + 1) % ps.length];
      area += ax * by - bx * ay;
    }
    const pts = area < 0 ? ps.slice().reverse() : ps;
    pts.forEach(([x, y], k) => out.push({ op: k ? 'L' : 'M', x, y }));
    out.push({ op: 'Z' });
  };
  const circle = (c: [number, number]) => poly(Array.from({ length: 24 }, (_, k): [number, number] => [c[0] + h * Math.cos((k * Math.PI) / 12), c[1] + h * Math.sin((k * Math.PI) / 12)]));
  for (const pc of pieces) {
    const pts = pc.pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pc.pts[k - 1][0], p[1] - pc.pts[k - 1][1]) > 1e-9);
    if (pts.length < 2) {
      // 長さ 0 の線: 丸い端なら点を描く
      if (cap === 1 && pts.length) circle(pts[0]);
      continue;
    }
    const dirs = pts.slice(1).map((p, k) => {
      const dx = p[0] - pts[k][0];
      const dy = p[1] - pts[k][1];
      const l = Math.hypot(dx, dy);
      return [dx / l, dy / l] as [number, number];
    });
    dirs.forEach(([ux, uy], k) => {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      // 端の突き出し (cap 2)。閉じていない線の最初と最後の線分だけ
      const e0 = !pc.closed && k === 0 && cap === 2 ? h : 0;
      const e1 = !pc.closed && k === dirs.length - 1 && cap === 2 ? h : 0;
      const nx = -uy * h;
      const ny = ux * h;
      poly([
        [ax - ux * e0 + nx, ay - uy * e0 + ny],
        [ax - ux * e0 - nx, ay - uy * e0 - ny],
        [bx + ux * e1 - nx, by + uy * e1 - ny],
        [bx + ux * e1 + nx, by + uy * e1 + ny],
      ]);
    });
    // つなぎ目 (閉じた線は最後と最初の線分のつなぎ目も)
    const joins: Array<[number, [number, number], [number, number]]> = [];
    for (let k = 1; k < pts.length - 1; k++) joins.push([k, dirs[k - 1], dirs[k]]);
    if (pc.closed && dirs.length >= 2) joins.push([0, dirs[dirs.length - 1], dirs[0]]);
    for (const [k, [ux0, uy0], [ux1, uy1]] of joins) {
      const p = pts[k];
      const cross = ux0 * uy1 - uy0 * ux1;
      if (Math.abs(cross) < 1e-9 && ux0 * ux1 + uy0 * uy1 > 0) continue;
      if (join === 1) {
        circle(p);
        continue;
      }
      // 外側の角: 曲がる向きの反対側
      const sgn = cross > 0 ? -1 : 1;
      const o0: [number, number] = [p[0] + sgn * -uy0 * h, p[1] + sgn * ux0 * h];
      const o1: [number, number] = [p[0] + sgn * -uy1 * h, p[1] + sgn * ux1 * h];
      const tri: Array<[number, number]> = [p, o0, o1];
      if (join === 0) {
        // とがり: 2 つの外側の辺の交点。とがりの長さ ÷ 太さ = 1 / sin(φ/2) (φ は 2 本の線のなす角 = π − 曲がる角 θ) が
        // miter の上限以下のときだけ (上限を超えれば面取り)
        const cos = ux0 * ux1 + uy0 * uy1;
        const ratio = 1 / Math.sqrt(Math.max((1 + cos) / 2, 1e-12));
        if (ratio <= miter) {
          const mx = o0[0] + ux0 * h * Math.tan(Math.acos(Math.min(1, Math.max(-1, cos))) / 2);
          const my = o0[1] + uy0 * h * Math.tan(Math.acos(Math.min(1, Math.max(-1, cos))) / 2);
          tri.splice(2, 0, [mx, my]);
        }
      }
      poly(tri);
    }
    // 丸い端
    if (!pc.closed && cap === 1) {
      circle(pts[0]);
      circle(pts[pts.length - 1]);
    }
  }
  return transformSegs(out, ctm);
}


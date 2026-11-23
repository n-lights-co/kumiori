/**
 * svgFilterRaster — SVG の filter を、画素で計算する (Filter Effects 1)。画像にできない環境 (Node) で、図形による近似
 * (svg.ts の filterOf) で描けない filter (feTurbulence・feMorphology・光の効果・feDisplacementMap・feConvolveMatrix・feImage・feTile・
 * feComposite の arithmetic など) のときに使う。
 *
 * 手順: filter を付けた要素の図形 (SourceGraphic) を、filter の領域 (要素の座標) の画素の格子に描き (塗りの規則・線・グラデーション・
 * 模様・画像・切り抜き・マスク・透明のグループ・描画モード。縁は 4 × 4 の部分の画素で数える)、filter の要素を順に計算する。
 * 画素は、乗算済み (premultiplied) の RGBA の浮動小数で持ち、要素ごとの color-interpolation-filters (§10) の色空間に直して計算する。
 * 結果は sRGB の 8 ビットの RGBA の画像にし、呼ぶ側が filter の領域に置く。
 *
 * feTurbulence のノイズ (turbulenceInit・noise2・turbulence) は、Filter Effects 1 §9.21 の参照の実装 (C のコード) を移したもの:
 * This software or document includes material copied from or derived from Filter Effects Module Level 1
 * (https://www.w3.org/TR/2018/WD-filter-effects-1-20181218/). Copyright © 2018 W3C® (MIT, ERCIM, Keio, Beihang).
 * W3C liability, trademark and permissive document license rules apply.
 * 許諾 (W3C Software and Document license - 2015 version) の本文は THIRD_PARTY_NOTICES.md の 12 節
 */
import { stopSpan } from './gradientStops';
import { limits } from './limits';
import { apply, invert, mul, type Matrix, type Seg } from './matrix';
import { strokeOutline } from './strokeOutline';
import { decodePng } from './colorGlyphCanvas';
import { decodeJpeg } from './jpeg';
import { parseColor } from './color';
import { defaultSubregion, subregionAttrs, subregionRefs } from './svgFilterSubregion';
import type { FilterRasterRequest, FilterRasterResult, SvgClip, SvgGradient, SvgShape, SvgBlend } from './svg';

type Box = { x: number; y: number; w: number; h: number };
/** 画素の並び (乗算済みの RGBA。0〜1)。linear は線形の RGB か */
interface Img {
  w: number;
  h: number;
  d: Float32Array;
  linear: boolean;
}
/** 計算の結果と、その部分領域 (画素の座標) */
interface Res {
  img: Img;
  sub: Box;
}

/** 計算する画素の数の上限 (filter の領域が大きいときは、解像度を下げる) */
const MAX_PIXELS = 4_000_000;

/**
 * 1 つの SVG で、画素の計算に使ってよい手間 (画素の数 × 要素ごとの手間の段の合計。1 単位は、およそ 10〜25ns (2026 年の x86 の Node 22) の計算)。
 * filter を付けた要素が多い・模様やマスクや feImage の入れ子で同じ図形を何度も描く SVG で、止まらなくなっていた
 * (filter を付けた要素 20 個で 28 秒、400 個で 1 分超、模様の入れ子 6 段 × 4 個に filter で 90 秒超)。
 * 値は、領域の上限 (MAX_PIXELS) の filter 1 つを、1 画素あたり 100 単位 (光の効果・ぼかし・ノイズを数段) まで計算できる量 (数秒)。
 * 実在の大きさの filter では、16cm の幅に置いた 800 × 600 の絵の、ノイズでずらす filter を付けた要素 12 個で、この 3 分の 2 ほど。
 * 残りが足りない filter は解像度を下げて計算し (rasterFilter0)、それでも尽きたら null を返す (呼ぶ側は、計算できない filter として、
 * SVG を読めないもの (仮の枠と警告) にする)
 */
export const BUDGET = 400_000_000;
/**
 * 同時に持つ、名前を付けた結果 (result) の画素の合計の上限。1 画素は 16 バイト (RGBA の Float32) なので 24M 画素で 384MB。
 * result を付けた要素 200 個で 7GB を使っていた。後で参照する結果だけを持つ (参照の無いものは捨てる) うえで、
 * 同時に参照を待つ結果が多いときは、超えないように解像度を下げる (MAX_PIXELS と同じ扱い)
 */
const MAX_LIVE_PIXELS = 24_000_000;
/** 予算を超えた (rasterFilter は null を返す) */
class OverBudget extends Error {}
/** 予算の使った量 (1 つの SVG で共有する。FilterRasterRequest の budget) */
type Meter = { used?: number; /** 予算の上限 (無ければ BUDGET) */ limit?: number };
function charge(meter: Meter, n: number) {
  meter.used = (meter.used ?? 0) + n;
  if (!(meter.used <= (meter.limit ?? limits().svgFilterWork))) throw new OverBudget();
}

const newImg = (w: number, h: number, linear = false): Img => ({ w, h, d: new Float32Array(w * h * 4), linear });
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** 色空間を直した写し (同じなら、そのもの) */
function inSpace(img: Img, linear: boolean): Img {
  if (img.linear === linear) return img;
  const out = newImg(img.w, img.h, linear);
  const f = linear ? toLin : toSrgb;
  const s = img.d;
  const d = out.d;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    d[i + 3] = a;
    if (a <= 0) continue;
    d[i] = f(clamp01(s[i] / a)) * a;
    d[i + 1] = f(clamp01(s[i + 1] / a)) * a;
    d[i + 2] = f(clamp01(s[i + 2] / a)) * a;
  }
  return out;
}

// ───────────── 図形を画素にする ─────────────

/** 曲線を折れ線にした輪郭 (画素の座標) */
function flatten(segs: Seg[], m: Matrix): number[][] {
  const polys: number[][] = [];
  let cur: number[] | undefined;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const g of segs) {
    if (g.op === 'M') {
      if (cur && cur.length >= 4) polys.push(cur);
      [cx, cy] = apply(m, g.x, g.y);
      [sx, sy] = [cx, cy];
      cur = [cx, cy];
    } else if (g.op === 'L') {
      [cx, cy] = apply(m, g.x, g.y);
      cur?.push(cx, cy);
    } else if (g.op === 'C') {
      const [x1, y1] = apply(m, g.x1, g.y1);
      const [x2, y2] = apply(m, g.x2, g.y2);
      const [x3, y3] = apply(m, g.x, g.y);
      const n = Math.min(64, Math.max(4, Math.ceil(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) / 2));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        cur?.push(u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
      [cx, cy] = [x3, y3];
    } else {
      cur?.push(sx, sy);
      [cx, cy] = [sx, sy];
    }
  }
  if (cur && cur.length >= 4) polys.push(cur);
  return polys;
}

/** coverage の結果の、覆う所のある画素の範囲 (行 y0〜y1、列 x0〜x1。終わりは含まない)。塗る繰り返しを、この範囲に限る */
const coverageBounds = new WeakMap<Float32Array, { x0: number; x1: number; y0: number; y1: number }>();

/** 輪郭の覆う割合 (画素ごと 0〜1)。縦は 4 本の走査線、横は端の画素の割合で数える */
function coverage(polys: number[][], evenOdd: boolean, w: number, h: number, meter: Meter): Float32Array {
  charge(meter, w * h * 2);
  const cov = new Float32Array(w * h);
  const edges: Array<[number, number, number, number, number]> = [];
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2];
      const ay = p[i * 2 + 1];
      const bx = p[((i + 1) % n) * 2];
      const by = p[((i + 1) % n) * 2 + 1];
      if (ay === by) continue;
      edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]);
      y0 = Math.min(y0, ay, by);
      y1 = Math.max(y1, ay, by);
    }
  }
  if (!edges.length) {
    coverageBounds.set(cov, { x0: 0, x1: 0, y0: 0, y1: 0 });
    return cov;
  }
  const rowStart = Math.max(0, Math.floor(y0));
  const rowEnd = Math.min(h, Math.ceil(y1));
  let ex0 = Infinity;
  let ex1 = -Infinity;
  for (const e of edges) {
    ex0 = Math.min(ex0, e[0], e[2]);
    ex1 = Math.max(ex1, e[0], e[2]);
  }
  coverageBounds.set(cov, { x0: Math.max(0, Math.floor(ex0)), x1: Math.min(w, Math.ceil(ex1) + 1), y0: rowStart, y1: Math.max(rowStart, rowEnd) });
  // 走査線 (1 行に 4 本) ごとに、掛かる辺を見る。辺を始まりの高さの順に並べ、走査線を下へ進めながら、始まった辺を足し、
  // 終わった辺を除く (走査線ごとに全部の辺を見ると、点の多い輪郭 (字) で、行の数 × 辺の数の手間になる)
  if (rowEnd > rowStart) charge(meter, (rowEnd - rowStart) * edges.length);
  edges.sort((a, b) => a[1] - b[1]);
  const active: typeof edges = [];
  let next = 0;
  const xs: Array<[number, number]> = [];
  for (let row = rowStart; row < rowEnd; row++) {
    for (let k = 0; k < 4; k++) {
      const y = row + (k + 0.5) / 4;
      while (next < edges.length && edges[next][1] <= y) active.push(edges[next++]);
      let n = 0;
      for (const e of active) if (e[3] > y) active[n++] = e;
      active.length = n;
      xs.length = 0;
      for (const e of active) xs.push([e[0] + ((y - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1];
        const inside = evenOdd ? (Math.abs(wind) & 1) === 1 : wind !== 0;
        if (!inside) continue;
        const xa = Math.max(0, xs[i][0]);
        const xb = Math.min(w, xs[i + 1][0]);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        const base = row * w;
        if (ia === ib) cov[base + ia] += (xb - xa) / 4;
        else {
          cov[base + ia] += (ia + 1 - xa) / 4;
          for (let c = ia + 1; c < ib && c < w; c++) cov[base + c] += 0.25;
          if (ib < w) cov[base + ib] += (xb - ib) / 4;
        }
      }
    }
  }
  for (let i = 0; i < cov.length; i++) if (cov[i] > 1) cov[i] = 1;
  return cov;
}

function rgbOf(css: string): [number, number, number] {
  const c = parseColor(css);
  return c.mode === 'rgb' ? [c.r, c.g, c.b] : [(1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k)];
}

/** グラデーションの色 (乗算していない RGBA)。p は SVG の根の座標 */
export function gradientAt(g: SvgGradient, inv: Matrix, px: number, py: number, rgb: (css: string) => number[] = rgbOf, stopRgb?: number[][]): [number, number, number, number] {
  const [x, y] = apply(inv, px, py);
  const c = g.coords;
  let t: number;
  if (g.kind === 'linear') {
    const dx = c[2] - c[0];
    const dy = c[3] - c[1];
    const l2 = dx * dx + dy * dy;
    t = l2 > 0 ? ((x - c[0]) * dx + (y - c[1]) * dy) / l2 : 1;
  } else {
    // 焦点の円 (fx, fy, fr) から外の円 (cx, cy, r) へ: 円 C(t) は、中心 f + t (c − f)・半径 r(t) = fr + t (r − fr)。
    // 点の色は、点を通る円のうち、r(t) ≥ 0 で t の最も大きいものの t で決まる (SVG 2 §14.2.3.2 (radialGradient の注) の焦点の円と、
    // 同じ定め方の Canvas の createRadialGradient (HTML Living Standard の「fill and stroke styles」): r(ω) > 0 の ω のうち最大のもの)。
    // PDF の放射の網かけ (ISO 32000-1 §8.7.4.5.4 の Type 3。Extend [true true]) も、t の大きい円を後から塗るので同じ)。
    // |p − f − t (c − f)|² = r(t)² を整理した a t² − 2 b t + cc = 0 の 2 つの根 (b ± √disc) / a のうち、a > 0 なら + の根、
    // a < 0 (焦点の円が外の円の中: fr = 0・焦点が中心なら a = −r²) なら − の根が大きい。大きい根の半径が負なら、小さい根を見る。
    // 点を通る円が無い所 (焦点の円が外の円の外にあるときの、2 つの円に接する円錐の外) は、塗らない (透明の黒。SVG 2 §14.2.3.2)
    const [fx, fy, fr, cx, cy, r] = c;
    const cdx = cx - fx;
    const cdy = cy - fy;
    const dr = r - fr;
    const pdx = x - fx;
    const pdy = y - fy;
    const a = cdx * cdx + cdy * cdy - dr * dr;
    const b = pdx * cdx + pdy * cdy + fr * dr;
    const cc = pdx * pdx + pdy * pdy - fr * fr;
    const ok = (v: number) => Number.isFinite(v) && fr + v * dr >= -1e-9;
    let found: number | undefined;
    if (Math.abs(a) < 1e-9) {
      // 1 次の式 (焦点の円が外の円に内側から接する): t = cc / (2 b)
      const v = b !== 0 ? cc / (2 * b) : NaN;
      if (ok(v)) found = v;
    } else {
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const q = Math.sqrt(disc);
        const hi = Math.max((b + q) / a, (b - q) / a);
        const lo = Math.min((b + q) / a, (b - q) / a);
        found = ok(hi) ? hi : ok(lo) ? lo : undefined;
      }
    }
    if (found === undefined) return [0, 0, 0, 0];
    t = found;
  }
  t = clamp01(t);
  const s = g.stops;
  // t を含む区間 (止まり点は位置の昇順。二分で探す)
  const i = stopSpan(s.length - 1, (j) => s[j].offset, t);
  const a0 = s[i];
  const a1 = s[Math.min(i + 1, s.length - 1)];
  const k = a1.offset > a0.offset ? clamp01((t - a0.offset) / (a1.offset - a0.offset)) : 0;
  // 止まり点の色 (stopRgb は、前もって計算したもの。画素ごとに色の文字列を読まない)
  const c0 = stopRgb ? stopRgb[i] : rgb(a0.color);
  const c1 = stopRgb ? stopRgb[Math.min(i + 1, s.length - 1)] : rgb(a1.color);
  const o0 = a0.opacity ?? 1;
  const o1 = a1.opacity ?? 1;
  return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k, o0 + (o1 - o0) * k];
}

/** 描画モード (Compositing and Blending 1 §10) の B(Cb, Cs) (乗算していない値) */
function blendChannels(mode: SvgBlend | 'normal', cb: number[], cs: number[]): number[] {
  const sep = (f: (b: number, s: number) => number) => [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
  const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const clipColor = (c: number[]) => {
    const l = lum(c);
    const n = Math.min(...c);
    const x = Math.max(...c);
    let r = c;
    if (n < 0) r = r.map((v) => l + ((v - l) * l) / (l - n));
    if (x > 1) r = r.map((v) => l + ((v - l) * (1 - l)) / (x - l));
    return r;
  };
  const setLum = (c: number[], l: number) => {
    const d = l - lum(c);
    return clipColor(c.map((v) => v + d));
  };
  const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
  const setSat = (c: number[], s: number) => {
    const mx = Math.max(...c);
    const mn = Math.min(...c);
    if (mx === mn) return [0, 0, 0];
    return c.map((v) => ((v - mn) * s) / (mx - mn));
  };
  switch (mode) {
    case 'multiply':
      return sep((b, s) => b * s);
    case 'screen':
      return sep((b, s) => b + s - b * s);
    case 'overlay':
      return sep((b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)));
    case 'darken':
      return sep((b, s) => Math.min(b, s));
    case 'lighten':
      return sep((b, s) => Math.max(b, s));
    case 'color-dodge':
      return sep((b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))));
    case 'color-burn':
      return sep((b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)));
    case 'hard-light':
      return sep((b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)));
    case 'soft-light':
      return sep((b, s) => {
        if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
        const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        return b + (2 * s - 1) * (d - b);
      });
    case 'difference':
      return sep((b, s) => Math.abs(b - s));
    case 'exclusion':
      return sep((b, s) => b + s - 2 * b * s);
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':
      return setLum(cs, lum(cb));
    case 'luminosity':
      return setLum(cb, lum(cs));
    default:
      return cs;
  }
}

/** 乗算済みの色 src を dst の上に、描画モードで重ねる (Compositing and Blending 1 §5・§10) */
export function compositeOver(dst: Float32Array, i: number, sr: number, sg: number, sb: number, sa: number, mode: SvgBlend | 'normal' = 'normal') {
  if (sa <= 0) return;
  const da = dst[i + 3];
  if (mode === 'normal' || da <= 0) {
    dst[i] = sr + dst[i] * (1 - sa);
    dst[i + 1] = sg + dst[i + 1] * (1 - sa);
    dst[i + 2] = sb + dst[i + 2] * (1 - sa);
    dst[i + 3] = sa + da * (1 - sa);
    return;
  }
  const cs = [sr / sa, sg / sa, sb / sa];
  const cb = [dst[i] / da, dst[i + 1] / da, dst[i + 2] / da];
  const B = blendChannels(mode, cb, cs);
  for (let k = 0; k < 3; k++) dst[i + k] = (1 - da) * sa * cs[k] + (1 - sa) * dst[i + k] + sa * da * clamp01(B[k]);
  dst[i + 3] = sa + da * (1 - sa);
}

interface Painter {
  /** 根の座標 → 画素の座標 */
  m: Matrix;
  w: number;
  h: number;
  /** 予算 */
  meter: Meter;
  /**
   * 塗り・線・グラデーションの色 (CSS の色 → 0〜1 の 3 つの値)。無ければ sRGB (rgbOf)。透明を平らにする処理 (pdfFlatten.ts) が、
   * CMYK の版を 3 つの値にして描くのに使う。マスクの中身は、この色ではなく sRGB で描く (輝度のマスクは sRGB の値で決まる)
   */
  color?: (css: string) => number[];
  /** 画像の画素 (RGBA 8 ビット)。無ければ decodeImage。色を置き換えるときに、画素の色も同じに置き換えて渡す */
  decode?: (img: NonNullable<SvgShape['image']>) => { w: number; h: number; rgba: Uint8Array } | undefined;
  /**
   * 覆う割合 (coverage) の覚え (図形の塗り・線・切り抜きごと)。同じ m・w・h で、同じ図形を色を変えて何度か描くとき (CMYK の版ごと) に、
   * 呼ぶ側が同じものを渡すと、割合を計算し直さない
   */
  cache?: Map<object, Float32Array>;
  /**
   * 読めない画像 (decode・decodeImage が undefined を返すもの: CMYK の JPEG・インターレースの PNG・壊れた画像など) の画素。
   * 渡せば、例外にせず、返した画素で描く (undefined を返せば、その画像だけを描かない)。渡さなければ、例外 (Error('image')) にする
   * (透明を平らにする処理は、例外を受けて、別の道で描く)。マスク・模様・グループの中の画像にも当てる
   */
  missingImage?: (img: NonNullable<SvgShape['image']>) => { w: number; h: number; rgba: Uint8Array } | undefined;
}

/** 画像 (PNG・JPEG) の画素 (RGBA 8 ビット)。読めなければ undefined */
function decodeImage(img: NonNullable<SvgShape['image']>): { w: number; h: number; rgba: Uint8Array } | undefined {
  if (img.kind === 'png') {
    const p = decodePng(img.bytes);
    return p ? { w: p.width, h: p.height, rgba: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) } : undefined;
  }
  const j = decodeJpeg(img.bytes);
  if (!j) return undefined;
  const rgba = new Uint8Array(j.width * j.height * 4);
  for (let i = 0; i < j.width * j.height; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = j.components === 1 ? j.data[i] : j.data[i * 3 + k];
    rgba[i * 4 + 3] = 255;
  }
  return { w: j.width, h: j.height, rgba };
}

/** 図形の並びを、画素の並び (sRGB・乗算済み) に描く */
function paintShapes(shapes: SvgShape[], P: Painter, out: Img = newImg(P.w, P.h)): Img {
  const inv = invert(P.m);
  if (!inv) return out;
  const W = P.w;
  const H = P.h;
  const meter = P.meter;
  charge(meter, W * H);
  /** 前の図形の切り抜きの割合 (続く図形に同じ切り抜きが付いていれば、点の多い切り抜きを図形ごとに塗り直さない。svg.ts の clipRuns) */
  let covered = new Map<SvgClip, Float32Array>();
  /**
   * 前の図形のマスクの画素 (切り抜きと同じく、続く図形に同じマスクが付いていれば描き直さない。グループに付けたマスクは、子の図形が
   * みな同じものを持つので、子の数だけ描き直していた)。持つのは前の図形の分だけ (覚えすぎて画素を使い切らない)
   */
  let maskImgs = new Map<object, Img>();
  /** 前に描いた模様のタイル (同じ模様・同じ大きさなら使い回す) */
  let lastTile: { pattern: object; tw: number; th: number; img: Img } | undefined;
  for (const sh of shapes) {
    // 切り抜き・マスクの割合 (画素ごと)
    let mask: Float32Array | undefined;
    const now = new Map<SvgClip, Float32Array>();
    for (const c of sh.clips ?? []) {
      let cv = covered.get(c) ?? now.get(c);
      if (!cv) cv = P.cache?.get(c) ?? coverage(flatten(c.segs, P.m), c.evenOdd, W, H, meter);
      P.cache?.set(c, cv);
      now.set(c, cv);
      charge(meter, W * H);
      if (!mask) mask = Float32Array.from(cv);
      else for (let i = 0; i < mask.length; i++) mask[i] *= cv[i];
    }
    covered = now;
    const nowMasks = new Map<object, Img>();
    for (const mk of sh.masks ?? []) {
      const mi = maskImgs.get(mk) ?? nowMasks.get(mk) ?? paintShapes(mk.shapes, { m: P.m, w: P.w, h: P.h, meter: P.meter, ...(P.missingImage ? { missingImage: P.missingImage } : {}) });
      nowMasks.set(mk, mi);
      charge(meter, W * H * 2);
      if (!mask) mask = new Float32Array(W * H).fill(1);
      for (let i = 0; i < W * H; i++) {
        const a = mi.d[i * 4 + 3];
        // 輝度 (sRGB の値に、線形の係数を掛ける。CSS Masking 1 §7.1 の luminance) か、不透明度
        mask[i] *= mk.alpha ? a : 0.2125 * mi.d[i * 4] + 0.7154 * mi.d[i * 4 + 1] + 0.0721 * mi.d[i * 4 + 2];
      }
    }
    maskImgs = nowMasks;
    const blend = sh.blend ?? 'normal';
    if (sh.group) {
      const g = paintShapes(sh.group.shapes, P);
      charge(meter, W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const k = sh.fillOpacity * (mask ? mask[i] : 1);
        const j = i * 4;
        compositeOver(out.d, j, g.d[j] * k, g.d[j + 1] * k, g.d[j + 2] * k, g.d[j + 3] * k, blend);
      }
      continue;
    }
    if (sh.image) {
      const px = (P.decode ? P.decode(sh.image) : decodeImage(sh.image)) ?? P.missingImage?.(sh.image);
      if (!px) {
        if (P.missingImage) continue;
        throw new Error('image');
      }
      // 画素の中心 → 画像の単位正方形 (左下が原点、上の辺が 1 行目) → 画像の画素
      const toUnit = invert(mul(P.m, sh.image.matrix));
      if (!toUnit) continue;
      charge(meter, W * H * 6);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const [u, v] = apply(toUnit, x + 0.5, y + 0.5);
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const ix = Math.min(px.w - 1, Math.floor(u * px.w));
          const iy = Math.min(px.h - 1, Math.floor((1 - v) * px.h));
          const s = (iy * px.w + ix) * 4;
          const a = (px.rgba[s + 3] / 255) * sh.fillOpacity * (mask ? mask[y * W + x] : 1);
          compositeOver(out.d, (y * W + x) * 4, (px.rgba[s] / 255) * a, (px.rgba[s + 1] / 255) * a, (px.rgba[s + 2] / 255) * a, a, blend);
        }
      continue;
    }
    const paint = (cov: Float32Array, color: string | undefined, grad: SvgGradient | undefined, pattern: SvgShape['fillPattern'], opacity: number) => {
      let tile: { img: Img; inv: Matrix; tw: number; th: number } | undefined;
      if (pattern) {
        // 模様のタイルを画素にして、タイルの座標で繰り返して引く
        const scale = Math.sqrt(Math.abs(P.m[0] * P.m[3] - P.m[1] * P.m[2])) * Math.sqrt(Math.abs(pattern.matrix[0] * pattern.matrix[3] - pattern.matrix[1] * pattern.matrix[2]));
        const tw = Math.max(1, Math.min(2048, Math.ceil(pattern.width * scale)));
        const th = Math.max(1, Math.min(2048, Math.ceil(pattern.height * scale)));
        const pinv = invert(pattern.matrix);
        if (pinv) {
          if (!(lastTile && lastTile.pattern === pattern && lastTile.tw === tw && lastTile.th === th))
            lastTile = { pattern, tw, th, img: paintShapes(pattern.shapes, { m: [tw / pattern.width, 0, 0, th / pattern.height, 0, 0], w: tw, h: th, meter, color: P.color, decode: P.decode, missingImage: P.missingImage }) };
          tile = { img: lastTile.img, inv: pinv, tw, th };
        }
      }
      const ginv = grad ? invert(grad.matrix) : undefined;
      const rgb = color ? (P.color ?? rgbOf)(color) : [0, 0, 0];
      const stopRgb = grad?.stops.map((s) => (P.color ?? rgbOf)(s.color));
      charge(meter, W * H * (ginv ? 60 : tile ? 8 : 4));
      // 覆う所のある範囲だけを回す (外は cov が 0)
      const cb = coverageBounds.get(cov);
      for (let y = cb?.y0 ?? 0; y < (cb?.y1 ?? H); y++)
        for (let x = cb?.x0 ?? 0; x < (cb?.x1 ?? W); x++) {
          const i = y * W + x;
          let a = cov[i] * opacity * (mask ? mask[i] : 1);
          if (a <= 0) continue;
          let r = rgb[0];
          let g = rgb[1];
          let b = rgb[2];
          if (ginv && grad) {
            const [rx, ry] = apply(inv, x + 0.5, y + 0.5);
            const c = gradientAt(grad, ginv, rx, ry, P.color, stopRgb);
            [r, g, b] = c;
            a *= c[3];
          } else if (tile) {
            const [rx, ry] = apply(inv, x + 0.5, y + 0.5);
            const [tx, ty] = apply(tile.inv, rx, ry);
            const u = ((((tx / pattern!.width) % 1) + 1) % 1) * tile.tw;
            const v = ((((ty / pattern!.height) % 1) + 1) % 1) * tile.th;
            const s = (Math.min(tile.th - 1, Math.floor(v)) * tile.tw + Math.min(tile.tw - 1, Math.floor(u))) * 4;
            const ta = tile.img.d[s + 3];
            if (ta <= 0) continue;
            r = tile.img.d[s] / ta;
            g = tile.img.d[s + 1] / ta;
            b = tile.img.d[s + 2] / ta;
            a *= ta;
          }
          compositeOver(out.d, i * 4, r * a, g * a, b * a, a, blend);
        }
    };
    /** 覆う割合 (P.cache があれば覚える。key は塗りなら図形、線なら図形の輪郭の配列) */
    const covOf = (key: object, make: () => Float32Array): Float32Array => {
      const hit = P.cache?.get(key);
      if (hit) return hit;
      const c = make();
      P.cache?.set(key, c);
      return c;
    };
    if (sh.fill !== undefined || sh.fillPaint || sh.fillPattern) paint(covOf(sh, () => coverage(flatten(sh.segs, P.m), sh.evenOdd, W, H, meter)), sh.fill, sh.fillPaint, sh.fillPattern, sh.fillOpacity);
    if ((sh.stroke !== undefined || sh.strokePaint) && sh.strokeWidth > 0) {
      const cov = covOf(sh.segs, () => {
        const outline = strokeOutline(sh.segs, [1, 0, 0, 1, 0, 0], sh.strokeWidth, sh.lineCap, sh.lineJoin, { array: sh.dash ?? [], offset: sh.dashOffset ?? 0 }, sh.miterLimit ?? 4);
        return coverage(flatten(outline, P.m), false, W, H, meter);
      });
      paint(cov, sh.stroke, sh.strokePaint, undefined, sh.strokeOpacity);
    }
  }
  return out;
}

/**
 * 図形の並びを、w × h の画素 (乗算済みの RGBA。0〜1 の浮動小数) に描く。m は図形の座標 → 画素の座標。
 * color・decode は Painter の同じ名前のもの (色を置き換えて描く)。予算の上限は無い (呼ぶ側が、描く範囲を小さく分けて呼ぶ)。
 * 透明を平らにする処理 (pdfFlatten.ts) が、透明な物とその下の物を画素にするのに使う
 */
export function paintShapesToPixels(
  shapes: SvgShape[],
  m: Matrix,
  w: number,
  h: number,
  hooks: Pick<Painter, 'color' | 'decode' | 'cache' | 'missingImage'> = {},
): Float32Array {
  return paintShapes(shapes, { m, w, h, meter: { limit: Infinity }, ...hooks }).d;
}

/**
 * paintShapesToPixels の、手間に上限のあるもの。描く手間 (charge の単位) が limit を超えたら、描くのをやめて undefined を返す
 * (Web Worker の中の renderPage の SVG の画像: canvasRenderer.ts の drawSvgShapes)
 */
export function paintShapesToPixelsWithin(
  shapes: SvgShape[],
  m: Matrix,
  w: number,
  h: number,
  limit: number,
  hooks: Pick<Painter, 'color' | 'decode' | 'cache' | 'missingImage'> = {},
): { pixels: Float32Array; used: number } | undefined {
  const meter: Meter = { limit };
  try {
    return { pixels: paintShapes(shapes, { m, w, h, meter, ...hooks }).d, used: meter.used ?? 0 };
  } catch (e) {
    if (e instanceof OverBudget) return undefined;
    throw e;
  }
}

/**
 * 図形の並びを画素にする手間の見積もり (1 画素あたり。charge の単位)。paintShapes は、図形ごとに画像の全体を回す
 * (覆う割合を 2、塗りを 4、ほかに 1) ので、図形の数 (グループ・マスク・模様の中も数える) × 7。模様は、タイル (画像より小さい) も
 * 画像の大きさで数える (多めの見積もり)
 */
export function shapesCostPerPixel(shapes: readonly SvgShape[], seen = new Set<object>()): number {
  let n = 1;
  for (const sh of shapes) {
    n += 7 * (1 + (sh.clips?.length ?? 0));
    if (sh.group) n += shapesCostPerPixel(sh.group.shapes, seen);
    for (const mk of sh.masks ?? []) if (!seen.has(mk)) (seen.add(mk), (n += shapesCostPerPixel(mk.shapes, seen)));
    if (sh.fillPattern && !seen.has(sh.fillPattern)) (seen.add(sh.fillPattern), (n += shapesCostPerPixel(sh.fillPattern.shapes, seen)));
  }
  return n;
}

/** 画像 (PNG・JPEG) の画素 (RGBA 8 ビット)。読めなければ undefined */
export const decodeShapeImage = decodeImage;

// ───────────── filter の要素 ─────────────

/** 色の変換を、乗算していない値に当てる (色空間は img のまま) */
function mapColors(img: Img, fn: (c: number[]) => number[]): Img {
  const out = newImg(img.w, img.h, img.linear);
  const s = img.d;
  const d = out.d;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    const c = fn(a > 0 ? [s[i] / a, s[i + 1] / a, s[i + 2] / a, a] : [0, 0, 0, 0]).map(clamp01);
    d[i] = c[0] * c[3];
    d[i + 1] = c[1] * c[3];
    d[i + 2] = c[2] * c[3];
    d[i + 3] = c[3];
  }
  return out;
}

/** 箱のぼかし (横か縦、幅 size、中心からのずれ off)。export はテストのため */
export function boxBlur(src: Float32Array, w: number, h: number, size: number, off: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const sum = new Float64Array(4);
  for (let l = 0; l < lines; l++) {
    const at = (p: number) => (horizontal ? (l * w + p) * 4 : (p * w + l) * 4);
    sum.fill(0);
    // 窓は [p - off, p - off + size)。初めの窓は、画像の中の部分だけを足す (外は 0。窓が画像より広くても、手間は画像の幅まで。
    // stdDeviation が 1e6 で、行ごとに窓の幅の回数を回していた。足す順は同じなので、結果は変わらない)
    const p1 = Math.min(n, -off + size);
    for (let p = Math.max(0, -off); p < p1; p++) for (let k = 0; k < 4; k++) sum[k] += src[at(p) + k];
    for (let p = 0; p < n; p++) {
      const o = at(p);
      for (let k = 0; k < 4; k++) out[o + k] = sum[k] / size;
      const add = p - off + size;
      const rem = p - off;
      if (add >= 0 && add < n) for (let k = 0; k < 4; k++) sum[k] += src[at(add) + k];
      if (rem >= 0 && rem < n) for (let k = 0; k < 4; k++) sum[k] -= src[at(rem) + k];
    }
  }
  return out;
}

/**
 * ガウスぼかし (§9.14)。標準偏差が 2.0 以上なら、§9.14 の 3 回の箱のぼかし (幅 d = floor(s·3·√(2π)/4 + 0.5)。d が奇数なら中心で 3 回、
 * 偶数なら左右にずらした 2 回と、幅 d + 1 の中心の 1 回)、それより小さければ、ガウスの重みで畳み込む
 */
function gaussian(img: Img, sx: number, sy: number, meter: Meter): Img {
  let d = img.d;
  const pass = (s: number, horizontal: boolean) => {
    if (!(s > 0)) return;
    if (s >= 2) {
      const D = Math.floor((s * 3 * Math.sqrt(2 * Math.PI)) / 4 + 0.5);
      // 幅が限りない (filter の領域が非常に小さく、画素への倍率が Infinity) なら、広がりきって 0 (透明) になる
      if (!Number.isFinite(D)) {
        d = new Float32Array(d.length);
        return;
      }
      charge(meter, img.w * img.h * 6);
      if (D % 2 === 1) for (let k = 0; k < 3; k++) d = boxBlur(d, img.w, img.h, D, (D - 1) / 2, horizontal);
      else {
        d = boxBlur(d, img.w, img.h, D, D / 2, horizontal);
        d = boxBlur(d, img.w, img.h, D, D / 2 - 1, horizontal);
        d = boxBlur(d, img.w, img.h, D + 1, D / 2, horizontal);
      }
      return;
    }
    const r = Math.ceil(s * 3);
    charge(meter, img.w * img.h * (2 * r + 1));
    const wts = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * s * s)));
    const tot = wts.reduce((a, b) => a + b, 0);
    const out = new Float32Array(d.length);
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const o = (y * img.w + x) * 4;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
          const q = (yy * img.w + xx) * 4;
          const wt = wts[k + r] / tot;
          for (let c = 0; c < 4; c++) out[o + c] += d[q + c] * wt;
        }
      }
    d = out;
  };
  pass(sx, true);
  pass(sy, false);
  return { ...img, d };
}

/**
 * feMorphology の 1 方向: 各画素の、窓 [i − r, i + r] (外の画素は 0) の中の最大 (dil)・最小。成分ごと (乗算済み)。
 * 窓ごとに数えると手間が W × H × 4 × (2r + 1) になり、半径 200 で 2 分、1e308 で止まらなかった (r が Infinity だと数が増えない) ので、
 * van Herk / Gil-Werman の方法 (窓の幅の区切りごとの、前からと後からの累積の最大・最小を 2 つ合わせる) で、1 画素あたり定数の手間にする。
 * 最大・最小は値の選び方なので、結果は窓ごとに数えたものと同じ (初めの値 (最大は 0、最小は 1) も合わせる)。export はテストのため
 */
export function morphPass(d: Float32Array, W: number, H: number, r0: number, horizontal: boolean, dil: boolean): Float32Array {
  const o = new Float32Array(d.length);
  const n = horizontal ? W : H;
  const lines = horizontal ? H : W;
  // 半径が画像の幅以上なら、窓は画像の全体と外を含むので、幅で抑えても同じ
  const r = Math.min(r0, n);
  const w = 2 * r + 1;
  const L = n + 2 * r;
  const p = new Float32Array(L);
  const g = new Float32Array(L);
  const hh = new Float32Array(L);
  const init = dil ? 0 : 1;
  const pick = dil ? Math.max : Math.min;
  for (let l = 0; l < lines; l++)
    for (let c = 0; c < 4; c++) {
      const at = (q: number) => (horizontal ? (l * W + q) * 4 + c : (q * W + l) * 4 + c);
      // 前後に r 個の 0 を足した行
      p.fill(0);
      for (let q = 0; q < n; q++) p[q + r] = d[at(q)];
      for (let k = 0; k < L; k++) g[k] = k % w === 0 ? p[k] : pick(g[k - 1], p[k]);
      for (let k = L - 1; k >= 0; k--) hh[k] = k % w === w - 1 || k === L - 1 ? p[k] : pick(hh[k + 1], p[k]);
      for (let q = 0; q < n; q++) o[at(q)] = pick(init, pick(hh[q], g[q + w - 1]));
    }
  return o;
}

function offsetImg(img: Img, dx: number, dy: number): Img {
  const out = newImg(img.w, img.h, img.linear);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < img.h; y++) {
    const sy = y - oy;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < img.w; x++) {
      const sx = x - ox;
      if (sx < 0 || sx >= img.w) continue;
      const o = (y * img.w + x) * 4;
      const s = (sy * img.w + sx) * 4;
      for (let k = 0; k < 4; k++) out.d[o + k] = img.d[s + k];
    }
  }
  return out;
}

/** 部分領域の外を透明にする */
function clipTo(img: Img, sub: Box): Img {
  const x0 = Math.max(0, Math.floor(sub.x));
  const y0 = Math.max(0, Math.floor(sub.y));
  const x1 = Math.min(img.w, Math.ceil(sub.x + sub.w));
  const y1 = Math.min(img.h, Math.ceil(sub.y + sub.h));
  if (x0 === 0 && y0 === 0 && x1 === img.w && y1 === img.h) return img;
  const out = newImg(img.w, img.h, img.linear);
  for (let y = y0; y < y1; y++) out.d.set(img.d.subarray((y * img.w + x0) * 4, (y * img.w + x1) * 4), (y * img.w + x0) * 4);
  return out;
}

// feTurbulence (§9.21): 仕様の参照の実装 (Perlin のノイズ) のとおり
const BSize = 0x100;
const BM = 0xff;
const PerlinN = 0x1000;
/** export はテストのため */
export function turbulenceInit(seed0: number) {
  const lattice = new Int32Array(BSize + BSize + 2);
  const grad = Array.from({ length: 4 }, () => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
  const m = 2147483647;
  const a = 16807;
  const q = 127773;
  const r = 2836;
  let seed = seed0;
  if (seed <= 0) seed = -(seed % (m - 1)) + 1;
  if (seed > m - 1) seed = m - 1;
  const random = (s: number) => {
    let res = a * (s % q) - r * Math.trunc(s / q);
    if (res <= 0) res += m;
    return res;
  };
  let i = 0;
  for (let k = 0; k < 4; k++)
    for (i = 0; i < BSize; i++) {
      lattice[i] = i;
      for (let j = 0; j < 2; j++) grad[k][i][j] = (((seed = random(seed)) % (BSize + BSize)) - BSize) / BSize;
      const s = Math.sqrt(grad[k][i][0] * grad[k][i][0] + grad[k][i][1] * grad[k][i][1]);
      grad[k][i][0] /= s;
      grad[k][i][1] /= s;
    }
  while (--i) {
    const k = lattice[i];
    const j = (seed = random(seed)) % BSize;
    lattice[i] = lattice[j];
    lattice[j] = k;
  }
  for (i = 0; i < BSize + 2; i++) {
    lattice[BSize + i] = lattice[i];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) grad[k][BSize + i][j] = grad[k][i][j];
  }
  return { lattice, grad };
}
type Stitch = { w: number; h: number; wx: number; wy: number };
function noise2(T: ReturnType<typeof turbulenceInit>, ch: number, vx: number, vy: number, st: Stitch | undefined): number {
  // 参照の実装の noise2 のとおり、格子の番号は、つなぎ目の比較 (bx0 >= nWrapX など。nWrapX は PerlinN より大きい) の後に BM で切る
  // (先に切ると番号は BM 以下になり、比較が決して成り立たないので、stitchTiles="stitch" が効かない)
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t);
  let bx1 = bx0 + 1;
  const rx0 = t - Math.trunc(t);
  const rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t);
  let by1 = by0 + 1;
  const ry0 = t - Math.trunc(t);
  const ry1 = ry0 - 1;
  if (st) {
    if (bx0 >= st.wx) bx0 -= st.w;
    if (bx1 >= st.wx) bx1 -= st.w;
    if (by0 >= st.wy) by0 -= st.h;
    if (by1 >= st.wy) by1 -= st.h;
  }
  bx0 &= BM;
  bx1 &= BM;
  by0 &= BM;
  by1 &= BM;
  const L = T.lattice;
  const i = L[bx0];
  const j = L[bx1];
  const b00 = L[i + by0];
  const b10 = L[j + by0];
  const b01 = L[i + by1];
  const b11 = L[j + by1];
  const sx = rx0 * rx0 * (3 - 2 * rx0);
  const sy = ry0 * ry0 * (3 - 2 * ry0);
  const G = T.grad[ch];
  let q = G[b00];
  let u = rx0 * q[0] + ry0 * q[1];
  q = G[b10];
  let v = rx1 * q[0] + ry0 * q[1];
  const a = u + sx * (v - u);
  q = G[b01];
  u = rx0 * q[0] + ry1 * q[1];
  q = G[b11];
  v = rx1 * q[0] + ry1 * q[1];
  const b = u + sx * (v - u);
  return a + sy * (b - a);
}
/** 1 点のノイズ (参照の実装の turbulence)。stitchTile は stitchTiles="stitch" のタイル (要素の座標)。export はテストのため */
export function turbulence(T: ReturnType<typeof turbulenceInit>, ch: number, px: number, py: number, fx0: number, fy0: number, octaves: number, fractal: boolean, stitchTile?: Box): number {
  let fx = fx0;
  let fy = fy0;
  let st: Stitch | undefined;
  if (stitchTile) {
    if (fx !== 0) {
      const lo = Math.floor(stitchTile.w * fx) / stitchTile.w;
      const hi = Math.ceil(stitchTile.w * fx) / stitchTile.w;
      fx = fx / lo < hi / fx ? lo : hi;
    }
    if (fy !== 0) {
      const lo = Math.floor(stitchTile.h * fy) / stitchTile.h;
      const hi = Math.ceil(stitchTile.h * fy) / stitchTile.h;
      fy = fy / lo < hi / fy ? lo : hi;
    }
    const w = Math.trunc(stitchTile.w * fx + 0.5);
    const h = Math.trunc(stitchTile.h * fy + 0.5);
    st = { w, h, wx: Math.trunc(stitchTile.x * fx + PerlinN + w), wy: Math.trunc(stitchTile.y * fy + PerlinN + h) };
  }
  let sum = 0;
  let vx = px * fx;
  let vy = py * fy;
  let ratio = 1;
  for (let o = 0; o < octaves; o++) {
    const n = noise2(T, ch, vx, vy, st);
    sum += fractal ? n / ratio : Math.abs(n) / ratio;
    vx *= 2;
    vy *= 2;
    ratio *= 2;
    if (st) {
      st.w *= 2;
      st.wx = 2 * st.wx - PerlinN;
      st.h *= 2;
      st.wy = 2 * st.wy - PerlinN;
    }
  }
  return sum;
}

/**
 * filter を画素で計算する。結果は filter の領域の画素 (sRGB・8 ビットの RGBA。乗算していない)。計算できない filter (読めない画像など) は null
 */
export function rasterFilter(req: FilterRasterRequest): FilterRasterResult | null {
  try {
    return rasterFilter0(req);
  } catch {
    return null;
  }
}

/**
 * filter を計算する手間の、1 画素あたりの見積もり (charge の単位。下の rasterFilter0 で要素ごとに足す量と同じ数え方)。
 * 図形を描く手間は、図形の数で見積もる (模様・マスク・feImage の中身は数えない。外れた分は charge が止める)
 */
function perPixelCost(req: FilterRasterRequest): number {
  let c = 12;
  for (const sh of req.source) c += sh.fillPaint || sh.strokePaint ? 64 : 8;
  for (const e of req.prims) {
    const a = e.attr;
    const ord = (a('order') ?? '3').split(/[\s,]+/).map(Number);
    const ox = Math.max(1, Math.trunc(ord[0]) || 3);
    const oy = Math.max(1, Math.trunc(ord[1] ?? ord[0]) || 3);
    const cost: Record<string, number> = {
      fegaussianblur: 12,
      fedropshadow: 42,
      fecolormatrix: 12,
      fecomponenttransfer: 15,
      fecomposite: 15,
      feblend: 30,
      femerge: 3 * e.children.length,
      femorphology: 20,
      feturbulence: 8 + 20 * Math.min(24, Math.max(0, Math.trunc(parseFloat(a('numOctaves') ?? '1')) || 0)),
      fedisplacementmap: 10,
      feconvolvematrix: 2 * ox * oy,
      fediffuselighting: 30,
      fespecularlighting: 80,
      fetile: 12,
      feimage: 16,
    };
    c += 12 + (cost[e.name] ?? 0);
  }
  return c;
}

/** 標準の入力の名前 (§9.2。result の名前ではない) */
const STANDARD_INPUTS = /^(SourceGraphic|SourceAlpha|BackgroundImage|BackgroundAlpha|FillPaint|StrokePaint)$/;

/**
 * 名前を付けた結果を、いつ捨ててよいか: drop[i] は、要素 i の結果を最後に参照する要素の番号 (後で参照されなければ -1)。
 * 参照 (in・in2・feMergeNode の in) は、その要素より前の、同じ名前の最も後の結果を指す (§9.2)。maxLive は、同時に持つ結果の数の最大
 */
function resultLifetimes(prims: FilterRasterRequest['prims']): { drop: number[]; maxLive: number } {
  const refsOf = (e: FilterRasterRequest['prims'][number]) =>
    (e.name === 'femerge' ? e.children.map((c) => c.attr('in')) : [e.attr('in'), e.attr('in2')]).map((v) => (v ?? '').trim()).filter((v) => v && !STANDARD_INPUTS.test(v));
  const drop = new Array<number>(prims.length).fill(-1);
  const lastRef = new Map<string, number>();
  for (let i = prims.length - 1; i >= 0; i--) {
    const name = (prims[i].attr('result') ?? '').trim();
    if (name) {
      drop[i] = lastRef.get(name) ?? -1;
      lastRef.delete(name);
    }
    for (const r of refsOf(prims[i])) if (!lastRef.has(r)) lastRef.set(r, i);
  }
  let live = 0;
  let maxLive = 0;
  const ends = new Map<number, number>();
  for (let i = 0; i < prims.length; i++) {
    if (drop[i] > i) {
      live++;
      ends.set(drop[i], (ends.get(drop[i]) ?? 0) + 1);
    }
    maxLive = Math.max(maxLive, live);
    live -= ends.get(i) ?? 0;
  }
  return { drop, maxLive };
}

function rasterFilter0(req: FilterRasterRequest): FilterRasterResult | null {
  const meter: Meter = req.budget ?? {};
  // 予算が尽きた SVG の、続く filter は計算しない
  charge(meter, 0);
  const R = req.region;
  const { drop, maxLive } = resultLifetimes(req.prims);
  // 同時に持つ画像 (名前を付けた結果、SourceGraphic、前の結果、計算の途中の写し) の画素の合計を MAX_LIVE_PIXELS に抑える
  // 予算の残りが、この filter を今の解像度で計算するのに足りなければ、足りるように解像度を下げる (前の filter で予算を使った SVG の、
  // 続く filter はぼやける。見積もり (perPixelCost) を外れて使い過ぎたときは、charge が止める)
  const left = limits().svgFilterWork - (meter.used ?? 0);
  const maxPixels = Math.min(MAX_PIXELS, MAX_LIVE_PIXELS / (maxLive + 4), left / (2 * perPixelCost(req)));
  if (!(maxPixels >= 1)) return null;
  let res = req.pxPerUnit;
  if (R.w * res * R.h * res > maxPixels) res = Math.sqrt(maxPixels / (R.w * R.h));
  const W = Math.max(1, Math.ceil(R.w * res));
  const H = Math.max(1, Math.ceil(R.h * res));
  // 片方の辺が 1 画素に満たない細長い領域 (幅 1e7・高さ 1e-7 など) は、切り上げで画素が上限を大きく超える
  if (!(W * H <= 2 * MAX_PIXELS)) return null;
  const kx = W / R.w;
  const ky = H / R.h;
  // 要素の座標 → 画素
  const U: Matrix = [kx, 0, 0, ky, -R.x * kx, -R.y * ky];
  const fromRoot = invert(req.toRoot);
  if (!fromRoot) return null;
  const P: Painter = { m: mul(U, fromRoot), w: W, h: H, meter };
  const full: Box = { x: 0, y: 0, w: W, h: H };
  let source: Img | undefined;
  const sourceGraphic = () => (source ??= paintShapes(req.source, P));
  /** 名前を付けた結果 (at は、その結果を出した要素の番号) */
  const results = new Map<string, { r: Res; at: number }>();
  /** 要素の番号 → その要素の後に捨てる結果の名前 */
  const drops = new Map<number, string[]>();
  let prev: Res | undefined;
  // 長さ (primitiveUnits が objectBoundingBox なら外接矩形の割合) → 画素
  const bb = req.bbox;
  const obb = req.primitiveUnits === 'objectBoundingBox' && !!bb;
  const lenX = (v: number) => (obb ? v * bb!.w : v) * kx;
  const lenY = (v: number) => (obb ? v * bb!.h : v) * ky;
  const nums = (v: string | undefined) => (v ?? '').split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const num = (v: string | undefined, d: number) => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? n : d;
  };
  const input = (name: string | undefined): Res => {
    const v = (name ?? '').trim();
    if (v === 'SourceGraphic') return { img: sourceGraphic(), sub: full };
    if (v === 'SourceAlpha') {
      const s = sourceGraphic();
      const out = newImg(W, H, s.linear);
      for (let i = 3; i < s.d.length; i += 4) out.d[i] = s.d[i];
      return { img: out, sub: full };
    }
    if (v === 'BackgroundImage' || v === 'BackgroundAlpha') return { img: newImg(W, H), sub: full };
    if (v === 'FillPaint' || v === 'StrokePaint') {
      const c = v === 'FillPaint' ? req.fillPaint : req.strokePaint;
      const out = newImg(W, H);
      if (c) for (let i = 0; i < W * H; i++) out.d.set([c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], i * 4);
      return { img: out, sub: full };
    }
    const r = v ? results.get(v)?.r : undefined;
    return r ?? prev ?? { img: sourceGraphic(), sub: full };
  };
  for (let pi = 0; pi < req.prims.length; pi++) {
    const e = req.prims[pi];
    const a = e.attr;
    // 要素ごとの、画像を作って部分領域で切る手間 (要素の中の重い計算は、それぞれ足す)
    charge(meter, W * H * 12);
    const linear = e.linear;
    // 部分領域 (§9.4): 既定は、参照する結果の部分領域の和 (svgFilterSubregion.ts)。x・y・width・height を書いたものは、その値
    const refs = subregionRefs(e.name, a, () => e.children.map((c) => c.attr('in')));
    let sub: Box = defaultSubregion(refs, (r) => results.get(r)?.r.sub, prev?.sub, full);
    const own = subregionAttrs(a, { obb, ...(bb ? { bbox: bb } : {}), viewport: req.viewport ?? { w: 0, h: 0 } });
    // 要素の座標 → 画素
    if (own.x !== undefined) sub = { ...sub, x: (own.x - R.x) * kx };
    if (own.y !== undefined) sub = { ...sub, y: (own.y - R.y) * ky };
    if (own.w !== undefined) sub = { ...sub, w: own.w * kx };
    if (own.h !== undefined) sub = { ...sub, h: own.h * ky };
    const get = (k: 'in' | 'in2') => inSpace(input(a(k)).img, linear);
    let out: Img;
    switch (e.name) {
      case 'feflood': {
        const c = e.color('flood-color', 'flood-opacity');
        out = newImg(W, H, false);
        for (let i = 0; i < W * H; i++) out.d.set([c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], i * 4);
        out = inSpace(out, linear);
        break;
      }
      case 'feoffset':
        out = offsetImg(get('in'), lenX(num(a('dx'), 0)), lenY(num(a('dy'), 0)));
        break;
      case 'fegaussianblur': {
        const sd = nums(a('stdDeviation'));
        out = gaussian(get('in'), lenX(sd[0] ?? 0), lenY(sd[1] ?? sd[0] ?? 0), meter);
        break;
      }
      case 'fedropshadow': {
        const src = get('in');
        const sd = nums(a('stdDeviation'));
        const c = e.color('flood-color', 'flood-opacity');
        const cl = inSpace({ ...newImg(1, 1), d: new Float32Array([c[0], c[1], c[2], 1]) }, linear).d;
        let sh = newImg(W, H, linear);
        for (let i = 0; i < W * H; i++) {
          const al = src.d[i * 4 + 3] * c[3];
          sh.d.set([cl[0] * al, cl[1] * al, cl[2] * al, al], i * 4);
        }
        charge(meter, W * H * 30);
        sh = offsetImg(gaussian(sh, lenX(sd[0] ?? 2), lenY(sd[1] ?? sd[0] ?? 2), meter), lenX(num(a('dx'), 2)), lenY(num(a('dy'), 2)));
        for (let i = 0; i < W * H * 4; i += 4) compositeOver(sh.d, i, src.d[i], src.d[i + 1], src.d[i + 2], src.d[i + 3]);
        out = sh;
        break;
      }
      case 'fecolormatrix': {
        const m = e.colorMatrix();
        charge(meter, W * H * 12);
        out = mapColors(get('in'), (c) => [0, 1, 2, 3].map((r) => m[r * 5] * c[0] + m[r * 5 + 1] * c[1] + m[r * 5 + 2] * c[2] + m[r * 5 + 3] * c[3] + m[r * 5 + 4]));
        break;
      }
      case 'fecomponenttransfer': {
        const f = e.componentTransfer();
        charge(meter, W * H * 15);
        out = mapColors(get('in'), f);
        break;
      }
      case 'fecomposite': {
        const A = get('in');
        const B = get('in2');
        const op = a('operator') ?? 'over';
        const k = [num(a('k1'), 0), num(a('k2'), 0), num(a('k3'), 0), num(a('k4'), 0)];
        charge(meter, W * H * 15);
        out = newImg(W, H, linear);
        for (let i = 0; i < W * H * 4; i += 4) {
          const aa = A.d[i + 3];
          const ab = B.d[i + 3];
          // §9.8 (Porter-Duff と arithmetic。乗算済みの値)
          const [fa, fb] = op === 'in' ? [ab, 0] : op === 'out' ? [1 - ab, 0] : op === 'atop' ? [ab, 1 - aa] : op === 'xor' ? [1 - ab, 1 - aa] : op === 'lighter' ? [1, 1] : [1, 1 - aa];
          for (let c = 0; c < 4; c++) {
            out.d[i + c] =
              op === 'arithmetic'
                ? clamp01(k[0] * A.d[i + c] * B.d[i + c] + k[1] * A.d[i + c] + k[2] * B.d[i + c] + k[3])
                : Math.min(1, A.d[i + c] * fa + B.d[i + c] * fb);
          }
          if (op === 'arithmetic') for (let c = 0; c < 3; c++) out.d[i + c] = Math.min(out.d[i + c], out.d[i + 3]);
        }
        break;
      }
      case 'feblend': {
        const A = get('in');
        const B = get('in2');
        const mode = (a('mode') ?? 'normal').trim() as SvgBlend | 'normal';
        charge(meter, W * H * (mode === 'normal' ? 3 : 30));
        out = { ...B, d: new Float32Array(B.d) };
        for (let i = 0; i < W * H * 4; i += 4) compositeOver(out.d, i, A.d[i], A.d[i + 1], A.d[i + 2], A.d[i + 3], mode);
        break;
      }
      case 'femerge': {
        out = newImg(W, H, linear);
        for (const c of e.children) {
          const s = inSpace(input(c.attr('in')).img, linear);
          charge(meter, W * H * 3);
          for (let i = 0; i < W * H * 4; i += 4) compositeOver(out.d, i, s.d[i], s.d[i + 1], s.d[i + 2], s.d[i + 3]);
        }
        break;
      }
      case 'femorphology': {
        // §9.17: 半径 (rx, ry) の矩形の中の最小 (erode)・最大 (dilate)。成分ごと (乗算済み)
        const src = get('in');
        const rr = nums(a('radius'));
        // NaN (倍率が Infinity で半径が 0 など) は 0 とする (§15.17: 0 は効果を無くす)。Infinity は morphPass が画像の幅で抑える
        const fin = (v: number) => (Number.isNaN(v) ? 0 : v);
        const rx = fin(Math.round(lenX(rr[0] ?? 0)));
        const ry = fin(Math.round(lenY(rr[1] ?? rr[0] ?? 0)));
        if (rx <= 0 && ry <= 0) {
          out = src;
          break;
        }
        if (rx < 0 || ry < 0) {
          out = newImg(W, H, linear);
          break;
        }
        const dil = (a('operator') ?? 'erode') === 'dilate';
        charge(meter, W * H * 20);
        out = { ...src, d: morphPass(morphPass(src.d, W, H, rx, true, dil), W, H, ry, false, dil) };
        break;
      }
      case 'feturbulence': {
        // §9.21: 点は要素の座標 (画素の中心を戻す)。結果の色は、fractalNoise は (n + 1) / 2、turbulence は n
        const bf = nums(a('baseFrequency'));
        const fx = bf[0] ?? 0;
        const fy = bf[1] ?? bf[0] ?? 0;
        // オクターブ o の寄与は、ノイズ (絶対値は 1 より小さい) の 1/2^o なので、24 段より後の和は 2^-23 より小さく、8 ビットの色
        // (1/255) を変えない。numOctaves="100000" で 1 分を超えていたので、24 段で止める (仕様 (§9.21) に上限は無い。
        // Chrome (Skia の SkPerlinNoiseShader) も 255 段で抑える)
        const oct = Math.min(24, Math.max(0, Math.trunc(num(a('numOctaves'), 1))));
        charge(meter, W * H * (8 + oct * 20));
        const fractal = a('type') === 'fractalNoise';
        const T = turbulenceInit(Math.round(num(a('seed'), 0)));
        const stitch = a('stitchTiles') === 'stitch' ? { x: sub.x / kx + R.x, y: sub.y / ky + R.y, w: sub.w / kx, h: sub.h / ky } : undefined;
        out = newImg(W, H, linear);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const ux = (x + 0.5) / kx + R.x;
            const uy = (y + 0.5) / ky + R.y;
            const c = [0, 1, 2, 3].map((ch) => {
              const n = turbulence(T, ch, ux, uy, fx, fy, oct, fractal, stitch ? { ...stitch } : undefined);
              return clamp01(fractal ? (n + 1) / 2 : n);
            });
            out.d.set([c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], (y * W + x) * 4);
          }
        break;
      }
      case 'fedisplacementmap': {
        // §9.11: in2 の成分 (乗算していない値) で、in の画素をずらす: P'(x,y) = P(x + scale·(C(x,y) − 0.5), y + …)。
        // color-interpolation-filters は in2 にだけ掛かり (in2 の成分を、その色空間の値で読む)、in は元の色空間のまま (§9.11)
        const src = input(a('in')).img;
        const map = inSpace(input(a('in2')).img, linear);
        const scale = num(a('scale'), 0);
        charge(meter, W * H * 10);
        const ch = (k: string | undefined) => ({ R: 0, G: 1, B: 2, A: 3 })[(k ?? 'A') as 'R' | 'G' | 'B' | 'A'] ?? 3;
        const xc = ch(a('xChannelSelector'));
        const yc = ch(a('yChannelSelector'));
        out = newImg(W, H, src.linear);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const ma = map.d[i + 3];
            const val = (c: number) => (c === 3 ? ma : ma > 0 ? map.d[i + c] / ma : 0);
            const xx = Math.round(x + lenX(scale) * (val(xc) - 0.5));
            const yy = Math.round(y + lenY(scale) * (val(yc) - 0.5));
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            out.d.set(src.d.subarray((yy * W + xx) * 4, (yy * W + xx) * 4 + 4), i);
          }
        break;
      }
      case 'feconvolvematrix': {
        // §9.9: order・kernelMatrix・divisor・bias・targetX/Y・edgeMode (既定 duplicate)・preserveAlpha
        const src = get('in');
        const ord = nums(a('order'));
        const ox = Math.max(1, Math.trunc(ord[0] ?? 3));
        const oy = Math.max(1, Math.trunc(ord[1] ?? ord[0] ?? 3));
        const km = nums(a('kernelMatrix'));
        if (km.length !== ox * oy) throw new Error('kernel');
        // 手間は W × H × order² (仕様 (§9.9) に order の上限は無い。order="40" で 1 分ほどかかっていた)。予算で抑える
        charge(meter, W * H * ox * oy * 2);
        const sum = km.reduce((p, q) => p + q, 0);
        const div = num(a('divisor'), sum === 0 ? 1 : sum) || 1;
        const bias = num(a('bias'), 0);
        const tx = Math.trunc(num(a('targetX'), Math.floor(ox / 2)));
        const ty = Math.trunc(num(a('targetY'), Math.floor(oy / 2)));
        const edge = a('edgeMode') ?? 'duplicate';
        const keepA = a('preserveAlpha') === 'true';
        out = newImg(W, H, linear);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const acc = [0, 0, 0, 0];
            for (let j = 0; j < oy; j++)
              for (let i = 0; i < ox; i++) {
                let xx = x - tx + i;
                let yy = y - ty + j;
                if (edge === 'duplicate') {
                  xx = Math.min(W - 1, Math.max(0, xx));
                  yy = Math.min(H - 1, Math.max(0, yy));
                } else if (edge === 'wrap') {
                  xx = ((xx % W) + W) % W;
                  yy = ((yy % H) + H) % H;
                } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const wgt = km[(oy - 1 - j) * ox + (ox - 1 - i)];
                const q = (yy * W + xx) * 4;
                const sa = src.d[q + 3];
                for (let c = 0; c < 4; c++) acc[c] += (keepA && c < 3 ? (sa > 0 ? src.d[q + c] / sa : 0) : src.d[q + c]) * wgt;
              }
            const o = (y * W + x) * 4;
            if (keepA) {
              const al = src.d[o + 3];
              for (let c = 0; c < 3; c++) out.d[o + c] = clamp01(acc[c] / div + bias) * al;
              out.d[o + 3] = al;
            } else {
              const al = clamp01(acc[3] / div + bias);
              for (let c = 0; c < 3; c++) out.d[o + c] = Math.min(al, clamp01(acc[c] / div + bias * al));
              out.d[o + 3] = al;
            }
          }
        break;
      }
      case 'fediffuselighting':
      case 'fespecularlighting': {
        charge(meter, W * H * (e.name === 'fespecularlighting' ? 80 : 30));
        out = lighting(e, get('in'), W, H, kx, ky, R, linear, lenX, num);
        break;
      }
      case 'fetile': {
        // §9.20: 入力の部分領域を、タイルとして並べる
        const r0 = input(a('in'));
        const src = inSpace(r0.img, linear);
        const t = r0.sub;
        const tw = Math.max(1, Math.round(t.w));
        const th = Math.max(1, Math.round(t.h));
        const tx0 = Math.round(t.x);
        charge(meter, W * H * 12);
        const ty0 = Math.round(t.y);
        out = newImg(W, H, linear);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const sx2 = tx0 + ((((x - tx0) % tw) + tw) % tw);
            const sy2 = ty0 + ((((y - ty0) % th) + th) % th);
            if (sx2 < 0 || sy2 < 0 || sx2 >= W || sy2 >= H) continue;
            out.d.set(src.d.subarray((sy2 * W + sx2) * 4, (sy2 * W + sx2) * 4 + 4), (y * W + x) * 4);
          }
        break;
      }
      case 'feimage': {
        // §9.15: 画像か要素を、部分領域に描く (要素は要素の座標、画像は部分領域に preserveAspectRatio で合わせる)
        const subUser: Box = { x: sub.x / kx + R.x, y: sub.y / ky + R.y, w: sub.w / kx, h: sub.h / ky };
        const shapes = e.image(subUser);
        out = shapes ? inSpace(paintShapes(shapes, P), linear) : newImg(W, H, linear);
        break;
      }
      default:
        throw new Error(e.name);
    }
    if (out.w !== W) throw new Error('size');
    const r: Res = { img: clipTo(out, sub), sub };
    prev = r;
    // 後で参照される結果だけを持つ (参照の無い結果も持ち続けて、result を付けた要素 200 個で 7GB を使っていた)
    for (const nm of drops.get(pi) ?? []) if (results.get(nm)?.at !== undefined && results.get(nm)!.at < pi && drop[results.get(nm)!.at] === pi) results.delete(nm);
    const name = (a('result') ?? '').trim();
    if (name) {
      if (drop[pi] > pi) {
        results.set(name, { r, at: pi });
        drops.set(drop[pi], [...(drops.get(drop[pi]) ?? []), name]);
      } else results.delete(name);
    }
  }
  charge(meter, W * H * 10);
  const fin = inSpace((prev ?? { img: sourceGraphic() }).img, false);
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i += 4) {
    const al = fin.d[i + 3];
    rgba[i + 3] = Math.round(clamp01(al) * 255);
    if (al > 0) for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(clamp01(fin.d[i + c] / al) * 255);
  }
  return { width: W, height: H, rgba };
}

/** 光の効果 (§9.10 feDiffuseLighting・§9.19 feSpecularLighting)。面の高さは入力の不透明度 × surfaceScale、法線は Sobel の式 (端の画素は、端を延ばして求める) */
function lighting(
  e: FilterRasterRequest['prims'][number],
  src: Img,
  W: number,
  H: number,
  kx: number,
  ky: number,
  R: Box,
  linear: boolean,
  lenX: (v: number) => number,
  num: (v: string | undefined, d: number) => number,
): Img {
  const a = e.attr;
  const spec = e.name === 'fespecularlighting';
  const ss = num(a('surfaceScale'), 1);
  const kd = num(a('diffuseConstant'), 1);
  const ks = num(a('specularConstant'), 1);
  const se = num(a('specularExponent'), 1);
  const lc0 = e.color('lighting-color');
  const lc = linear ? [toLin(lc0[0]), toLin(lc0[1]), toLin(lc0[2])] : lc0.slice(0, 3);
  const light = e.children.find((c) => /^fe(distant|point|spot)light$/.test(c.name));
  const out = newImg(W, H, linear);
  if (!light) return out;
  const la = light.attr;
  const A = (x: number, y: number) => src.d[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + 3];
  // 光の位置は要素の座標 → 画素 (z は x の倍率で)
  const lx = (num(la('x'), 0) - R.x) * kx;
  const ly = (num(la('y'), 0) - R.y) * ky;
  const lz = lenX(num(la('z'), 0));
  const px = (num(la('pointsAtX'), 0) - R.x) * kx;
  const py = (num(la('pointsAtY'), 0) - R.y) * ky;
  const pz = lenX(num(la('pointsAtZ'), 0));
  const az = (num(la('azimuth'), 0) * Math.PI) / 180;
  const el = (num(la('elevation'), 0) * Math.PI) / 180;
  const spotExp = num(la('specularExponent'), 1);
  const cone = la('limitingConeAngle');
  const cosCone = cone !== undefined ? Math.cos((Math.abs(parseFloat(cone)) * Math.PI) / 180) : -2;
  let S = [px - lx, py - ly, pz - lz];
  const sl = Math.hypot(S[0], S[1], S[2]) || 1;
  S = S.map((v) => v / sl);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const nx = -ss * 0.25 * (A(x + 1, y - 1) + 2 * A(x + 1, y) + A(x + 1, y + 1) - A(x - 1, y - 1) - 2 * A(x - 1, y) - A(x - 1, y + 1));
      const ny = -ss * 0.25 * (A(x - 1, y + 1) + 2 * A(x, y + 1) + A(x + 1, y + 1) - A(x - 1, y - 1) - 2 * A(x, y - 1) - A(x + 1, y - 1));
      const nl = Math.hypot(nx, ny, 1);
      const N = [nx / nl, ny / nl, 1 / nl];
      let L: number[];
      let col = lc;
      if (light.name === 'fedistantlight') L = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
      else {
        const z = ss * A(x, y);
        L = [lx - x, ly - y, lz - z];
        const ll = Math.hypot(L[0], L[1], L[2]) || 1;
        L = L.map((v) => v / ll);
        if (light.name === 'fespotlight') {
          const d = -(L[0] * S[0] + L[1] * S[1] + L[2] * S[2]);
          const f = d < 0 || d < cosCone ? 0 : d ** spotExp;
          col = lc.map((c) => c * f);
        }
      }
      const o = (y * W + x) * 4;
      if (!spec) {
        const nd = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
        const c = col.map((v) => clamp01(kd * nd * v));
        out.d.set([c[0], c[1], c[2], 1], o);
      } else {
        let Hh = [L[0], L[1], L[2] + 1];
        const hl = Math.hypot(Hh[0], Hh[1], Hh[2]) || 1;
        Hh = Hh.map((v) => v / hl);
        const nh = Math.max(0, N[0] * Hh[0] + N[1] * Hh[1] + N[2] * Hh[2]);
        const c = col.map((v) => clamp01(ks * nh ** se * v));
        const al = Math.max(c[0], c[1], c[2]);
        out.d.set([Math.min(c[0], al), Math.min(c[1], al), Math.min(c[2], al), al], o);
      }
    }
  return out;
}


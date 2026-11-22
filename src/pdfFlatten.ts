/**
 * pdfFlatten — 透明を平らにする (transparency flattening)。PDF/X-1a のように透明を使えない規格の出力 (PdfStandard.transparency が
 * 'flatten') で、透明な物 (不透明度・透明度つきの色・透明のグループ・透明度つきの画像・SVG の半透明・マスク・描画モード) を、
 * 見た目をできるだけ変えずに、透明の無い物に置き換える。描く処理 (pdfRenderer.ts の PdfPainter) が、ページに描いた物の並び
 * (FlatPage.items) をここに覚えておき、透明な物を描くたびに、次の 2 段で置き換える。
 *
 * 1. ベクタのまま平らにする (正確): 透明な物の下が、1 色の塗り (矩形の箱の背景・ページの白) だけのとき。描画モード Normal の合成の式
 *    (ISO 32000-2 §11.3.3 の基本の合成の式。Normal の描画の関数は B(Cb, Cs) = Cs。§11.3.5) で、合成した色を計算し、不透明な色で描く。
 *    下も上も不透明 (下の αb = 1) なので、結果は Cr = (1 − αs)·Cb + αs·Cs (αs は上の物の不透明度)。
 *    CMYK (減法の色空間) では、描画モードの関数を、成分の補数 (1 − C) に当てて、結果を補数に戻す (§11.3.5)。
 *    この式は成分ごとの線形の補間なので、補数にしても同じ値になり、CMYK の成分にじかに当ててよい
 *    (1 − [(1 − αs)(1 − Cb) + αs(1 − Cs)] = (1 − αs)·Cb + αs·Cs)。特色 (Separation) は、ページの白か同じ特色の上だけを、
 *    濃度の補間 (白は濃度 0) で平らにする (特色の濃度も減法の成分。§8.6.6.4)。
 * 2. 画素にする (それ以外): 透明な物の外接矩形の範囲を、その下の物と合わせて CMYK の画像に描き (svgFilterRaster.ts の図形の
 *    画素の描き方。切り抜き・マスク・透明のグループ・描画モード・グラデーション・模様・画像)、不透明な画像として置く。
 *    CMYK の版は、成分の補数 (1 − C・1 − M・1 − Y と 1 − K) を RGB の 3 つの値にして 2 度描く (描画モードの関数は、減法の色空間では
 *    補数の値に当てる (§11.3.5) ので、加法の RGB の計算のまま正しい。分けられない描画モード (hue・saturation・color・luminosity) の
 *    K は、灰色 (3 つの値が同じ) として計算するので、hue・saturation・color では下の K、luminosity では上の K になる (§11.3.5.3 の決まりと同じ))。
 *
 * 透明のグループ (CSS の opacity) は、グループの中を不透明に重ねてから全体に不透明度が掛かる (§11.4・§11.6.6)。中の物が 1 色の
 * 不透明な塗り・線・字だけで、透明な子が前の子と重ならず、どの子の下も 1 色の塗りなら、子ごとに不透明度を掛けて平らにしたものと同じ
 * (重なった所は後の子が覆う) なので、ベクタにする。そうでなければ、グループの全体を画素にする。
 */
import { parseColor, spotColor, type SpotColor } from './color';
import { apply, type Matrix } from './matrix';
import { decodeShapeImage, paintShapesToPixels } from './svgFilterRaster';
import type { SvgClip, SvgShape } from './svg';

/** ページの座標 (pt。y は下向き) の矩形 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 平らにした色: プロセスの CMYK (0〜1) か、特色とその濃度 */
export type FlatColor = { cmyk: [number, number, number, number] } | { spot: SpotColor; tint: number };

/** RGB → CMYK の変換 (PDF/X の出力の変換。pdfRenderer.ts の pdfxConverter) */
export type ToCmyk = (r: number, g: number, b: number) => number[];

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v === Infinity ? 1 : 0);

/**
 * CSS の色を、PDF に書くときと同じ CMYK (か特色) にする (pdfRenderer.ts の toPdfColor の PDF/X の場合と同じ: 灰色 (R = G = B) は
 * K だけ、ほかの RGB は toCmyk、CMYK はそのまま)。透明度は見ない
 */
export function flatColorOf(css: string, toCmyk: ToCmyk): FlatColor {
  const c = parseColor(css);
  if (c.mode === 'rgb') {
    const r = clamp01(c.r);
    const g = clamp01(c.g);
    const b = clamp01(c.b);
    if (r === g && g === b) return { cmyk: [0, 0, 0, 1 - r] };
    const v = toCmyk(r, g, b);
    return { cmyk: [clamp01(v[0]), clamp01(v[1]), clamp01(v[2]), clamp01(v[3])] };
  }
  if (c.spot) return { spot: c.spot, tint: clamp01(c.spot.tint) };
  return { cmyk: [clamp01(c.c), clamp01(c.m), clamp01(c.y), clamp01(c.k)] };
}

/** 平らにした色の、プロセスの CMYK での値 (特色は代わりの CMYK に濃度を掛けたもの。画素にするときに使う) */
export function processCmyk(c: FlatColor): [number, number, number, number] {
  if ('cmyk' in c) return c.cmyk;
  const [cc, m, y, k] = c.spot.cmyk;
  return [cc * c.tint, m * c.tint, y * c.tint, k * c.tint];
}

/** 平らにした色を、描く処理に渡す CSS の色にする (cmyk(…) か spot(…)) */
export function flatCss(c: FlatColor): string {
  if ('cmyk' in c) return `cmyk(${c.cmyk.map((v) => +clamp01(v).toFixed(6)).join(',')})`;
  const rgb = c.spot.rgb?.map((v) => Math.round(v * 255)) as [number, number, number] | undefined;
  return spotColor(c.spot.name, clamp01(c.tint), c.spot.cmyk, rgb);
}

const sameSpot = (a: SpotColor, b: SpotColor) => a.name === b.name && a.cmyk.every((v, i) => v === b.cmyk[i]);

/**
 * 不透明度 alpha の色 src を、不透明な下の色 backdrop ('white' はページの白) の上に、描画モード Normal で重ねた色
 * (ISO 32000-2 §11.3.3。ファイルの冒頭の説明)。1 つの色で表せない (特色とプロセスの色、違う特色) ときは undefined
 */
export function blendNormal(src: FlatColor, alpha: number, backdrop: FlatColor | 'white'): FlatColor | undefined {
  const a = clamp01(alpha);
  if ('spot' in src) {
    if (backdrop === 'white') return { spot: src.spot, tint: src.tint * a };
    if ('spot' in backdrop && sameSpot(backdrop.spot, src.spot)) return { spot: src.spot, tint: (1 - a) * backdrop.tint + a * src.tint };
    return undefined;
  }
  if (backdrop === 'white') return { cmyk: src.cmyk.map((v) => v * a) as [number, number, number, number] };
  if ('spot' in backdrop) return undefined;
  return { cmyk: src.cmyk.map((v, i) => (1 - a) * backdrop.cmyk[i] + a * v) as [number, number, number, number] };
}

// ───────────── 矩形 ─────────────

export const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const contains = (outer: Box, inner: Box, eps = 1e-3) => outer.x0 <= inner.x0 + eps && outer.y0 <= inner.y0 + eps && outer.x1 >= inner.x1 - eps && outer.y1 >= inner.y1 - eps;
export function intersect(a: Box, b: Box): Box | undefined {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : undefined;
}
export function union(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
/** 点の並び ([x, y, x, y, …]) の外接矩形 */
export function boxOfPoints(pts: readonly number[]): Box | undefined {
  if (pts.length < 2) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : undefined;
}
/** 輪郭の制御点の外接矩形 (曲線は、制御点の凸包の中にある) */
export function segsBox(segs: SvgShape['segs']): Box | undefined {
  const pts: number[] = [];
  for (const g of segs) {
    if (g.op === 'Z') continue;
    if (g.op === 'C') pts.push(g.x1, g.y1, g.x2, g.y2);
    pts.push(g.x, g.y);
  }
  return boxOfPoints(pts);
}
/** 変換 m で写した矩形の外接矩形 */
export function transformBox(m: Matrix, b: Box): Box {
  const pts = [apply(m, b.x0, b.y0), apply(m, b.x1, b.y0), apply(m, b.x0, b.y1), apply(m, b.x1, b.y1)].flat();
  return boxOfPoints(pts)!;
}

/**
 * 輪郭が凸の形 (1 つの閉じた輪郭で、曲線の制御点も含めた点の並びが凸の多角形。回した矩形・角丸の矩形・楕円など) なら、
 * 輪郭が必ず覆う凸の多角形 (曲線の端の点を結んだもの。点の並び [x, y, x, y, …])。ほかは undefined。
 * 曲線は、端を結ぶ線と制御点の折れ線の間にある (ベジェ曲線は制御点の凸包の中にある) ので、制御点を含めて凸なら、
 * 曲線は端を結んだ多角形の外側にふくらみ、その多角形は輪郭の中にある (1 色の塗りを、平らにする下の色として使うため)
 */
export function coveredPolygon(segs: SvgShape['segs']): number[] | undefined {
  const all: Array<[number, number]> = [];
  const on: Array<[number, number]> = [];
  for (const [i, g] of segs.entries()) {
    if (g.op === 'M') {
      if (i > 0) return undefined;
    } else if (g.op === 'Z') {
      if (i !== segs.length - 1) return undefined;
      continue;
    }
    if (i === 0 && g.op !== 'M') return undefined;
    if (g.op === 'C') all.push([g.x1, g.y1], [g.x2, g.y2]);
    all.push([g.x, g.y]);
    on.push([g.x, g.y]);
  }
  const b = boxOfPoints(all.flat());
  if (!b) return undefined;
  const eps = 1e-9 * Math.max(1, b.x1 - b.x0, b.y1 - b.y0) ** 2;
  /** 続く同じ点と、閉じる点 (始めの点と同じ) を除いた並び */
  const clean = (pts: Array<[number, number]>) => {
    const out: Array<[number, number]> = [];
    for (const q of pts) {
      const last = out[out.length - 1];
      if (!last || (q[0] - last[0]) ** 2 + (q[1] - last[1]) ** 2 > eps) out.push(q);
    }
    while (out.length > 1 && (out[0][0] - out[out.length - 1][0]) ** 2 + (out[0][1] - out[out.length - 1][1]) ** 2 <= eps) out.pop();
    return out;
  };
  const cross = (a: [number, number], o: [number, number], c: [number, number]) => (o[0] - a[0]) * (c[1] - o[1]) - (o[1] - a[1]) * (c[0] - o[0]);
  /** 凸の多角形か: 曲がる向きがどこも同じで (まっすぐは許す)、1 周で 1 回だけ回る */
  const convex = (pts: Array<[number, number]>) => {
    const n = pts.length;
    if (n < 3) return 0;
    let sign = 0;
    let turn = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[k];
      const o = pts[(k + 1) % n];
      const c = pts[(k + 2) % n];
      const z = cross(a, o, c);
      if (Math.abs(z) > eps) {
        if (sign && Math.sign(z) !== sign) return 0;
        sign = Math.sign(z);
      }
      turn += Math.atan2(z, (o[0] - a[0]) * (c[0] - o[0]) + (o[1] - a[1]) * (c[1] - o[1]));
    }
    return sign && Math.abs(Math.abs(turn) - 2 * Math.PI) < 1e-6 ? sign : 0;
  };
  if (!convex(clean(all))) return undefined;
  const poly = clean(on);
  if (!convex(poly)) return undefined;
  return poly.flat();
}

/** 矩形 box が、凸の多角形 poly (coveredPolygon の結果) の中にあるか (4 つの角がどれも中にあれば、凸なので全体が中にある) */
export function polygonContains(poly: readonly number[], box: Box, eps = 1e-3): boolean {
  return polygonContainsPoints(poly, [box.x0, box.y0, box.x1, box.y0, box.x0, box.y1, box.x1, box.y1], eps);
}

/** 点の並び pts ([x, y, x, y, …]) が、どれも凸の多角形 poly の中にあるか (凸なので、点の凸包の全体が中にある) */
export function polygonContainsPoints(poly: readonly number[], pts: readonly number[], eps = 1e-3): boolean {
  const n = poly.length / 2;
  let area = 0;
  for (let k = 0; k < n; k++) area += poly[k * 2] * poly[((k + 1) % n) * 2 + 1] - poly[((k + 1) % n) * 2] * poly[k * 2 + 1];
  const sign = Math.sign(area);
  if (!sign) return false;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    for (let k = 0; k < n; k++) {
      const ax = poly[k * 2];
      const ay = poly[k * 2 + 1];
      const bx = poly[((k + 1) % n) * 2];
      const by = poly[((k + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      // 辺の内側 (向きの符号の側) からの距離が -eps 以上
      if ((sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax))) / len < -eps) return false;
    }
  }
  return true;
}

/**
 * 図形の描く範囲を含む凸包を作る点の並び ([x, y, x, y, …]): 輪郭の端と制御点 (線は、太さの分だけ広げた正方形の角)、画像の 4 つの角、
 * グループは子の点。凸の形の中にあるかを、外接矩形より細かく見るため (回した物の外接矩形は、回した下の塗りからはみ出す)
 */
export function shapesPoints(shapes: readonly SvgShape[]): number[] {
  const out: number[] = [];
  const walk = (sh: SvgShape) => {
    if (sh.group) return sh.group.shapes.forEach(walk);
    if (sh.image) {
      const m = sh.image.matrix;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push(...apply(m, u, v));
      return;
    }
    const stroke = (sh.stroke !== undefined || !!sh.strokePaint) && sh.strokeWidth > 0;
    const e = stroke ? (sh.strokeWidth / 2) * Math.max(Math.SQRT2, sh.lineJoin === 0 ? (sh.miterLimit ?? 4) : 1) : 0;
    const put = (x: number, y: number) => (e ? out.push(x - e, y - e, x + e, y - e, x - e, y + e, x + e, y + e) : out.push(x, y));
    for (const g of sh.segs) {
      if (g.op === 'Z') continue;
      if (g.op === 'C') {
        put(g.x1, g.y1);
        put(g.x2, g.y2);
      }
      put(g.x, g.y);
    }
  };
  shapes.forEach(walk);
  return out;
}

const boxMemo = new WeakMap<SvgShape, Box | null>();
/**
 * 図形の描く範囲の外接矩形 (切り抜きの範囲を掛ける。線は太さの分を広げる。グループは子の和)。描かない図形は undefined。
 * 外接矩形は、描く範囲を必ず含む (小さくはしない)
 */
export function shapeBox(sh: SvgShape): Box | undefined {
  const hit = boxMemo.get(sh);
  if (hit !== undefined) return hit ?? undefined;
  let b: Box | undefined;
  if (sh.group) for (const c of sh.group.shapes) b = union(b, shapeBox(c));
  else if (sh.image) {
    const m = sh.image.matrix;
    b = boxOfPoints([apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)].flat());
  } else {
    const fill = sh.fill !== undefined || !!sh.fillPaint || !!sh.fillPattern;
    const stroke = (sh.stroke !== undefined || !!sh.strokePaint) && sh.strokeWidth > 0;
    const s = segsBox(sh.segs);
    if (s && (fill || stroke)) {
      // 線の張り出し: 太さの半分に、尖ったつなぎ (miter) の上限と、角の端 (square) の √2 を見込む
      const e = stroke ? (sh.strokeWidth / 2) * Math.max(Math.SQRT2, sh.lineJoin === 0 ? (sh.miterLimit ?? 4) : 1) : 0;
      b = { x0: s.x0 - e, y0: s.y0 - e, x1: s.x1 + e, y1: s.y1 + e };
    }
  }
  for (const c of sh.clips ?? []) {
    if (!b) break;
    const cb = segsBox(c.segs);
    b = cb ? intersect(b, cb) : undefined;
  }
  boxMemo.set(sh, b ?? null);
  return b;
}

/** 図形の並びの外接矩形 */
export function shapesBox(shapes: readonly SvgShape[]): Box | undefined {
  let b: Box | undefined;
  for (const sh of shapes) b = union(b, shapeBox(sh));
  return b;
}

// ───────────── ページに描いた物 ─────────────

/** ページに描いた物 (平らにするときの、下の物) */
export interface FlatItem {
  /** 描く範囲を含む外接矩形 (大きめでよい) */
  box: Box;
  /** もっと狭い外接矩形 (字の輪郭など。求めるのに手間が掛かるので、要るときに求める)。無ければ box */
  exact?: () => Box | undefined;
  /** 画素にするときの図形 (ページの座標)。要るときに作る */
  shapes: () => SvgShape[];
  /** 1 色の不透明な塗りで、凸の多角形の並び regions の重なり (輪郭の覆う所と切り抜きの覆う所) の全体を覆う (平らにする下の色に使える) */
  solid?: { regions: number[][]; color: FlatColor };
  /** 字を含む (画素にすると字の質が落ちる)。値は字の大きさ (pt) の最小 */
  text?: number;
  /** 図形で描き直せない物 (色つきの字形など)。重なる所は画素にできない */
  opaqueOnly?: string;
  /** 画像の解像度 (ppi)。画素にするときの解像度の目安 */
  ppi?: number;
  /** 本文の字 1 つ (画像にするとき、同じ行の字の範囲をまとめる) */
  glyph?: boolean;
}

export function exactBox(it: FlatItem): Box | undefined {
  if (!it.exact) return it.box;
  const b = it.exact();
  it.exact = () => b;
  return b;
}

/** 格子の枠の大きさ (pt)・1 行の枠の数の目安 (番号を 1 つの数にする)・1 つの物を枠に入れる数と、1 度に引く枠の数の上限 (超えれば全部を見る) */
const GRID_CELL = 64;
const GRID_ROW = 1 << 20;
const GRID_ITEM_CELLS = 64;
const GRID_QUERY_CELLS = 256;

/** box の掛かる格子の枠の範囲 (端も含む)。有限でない・広すぎる box は undefined */
function cellRange(b: Box): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const x0 = Math.floor(b.x0 / GRID_CELL);
  const y0 = Math.floor(b.y0 / GRID_CELL);
  const x1 = Math.floor(b.x1 / GRID_CELL);
  const y1 = Math.floor(b.y1 / GRID_CELL);
  const lim = GRID_ROW / 2;
  if (![x0, y0, x1, y1].every((v) => Number.isFinite(v) && Math.abs(v) < lim) || x1 < x0 || y1 < y0) return undefined;
  return { x0, y0, x1, y1 };
}

/** ページごとの、描いた物の並び */
export class FlatPage {
  items: FlatItem[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /**
   * 格子の索引: box に掛かるかもしれない物の番号を、格子の枠ごとに覚える (描いた物の数 × 透明な物の数の手間にしないため)。
   * items は後ろに足すだけなので、足した分を、要るときに索引に足す (items を置き換えたら作り直す)
   */
  private grid?: { of: FlatItem[]; done: number; cells: Map<number, number[]>; wide: number[] };

  /** box に掛かるかもしれない物の番号 (end より前を、小さい順に)。meets の掛かる物は必ず含む */
  private near(box: Box, end: number): Iterable<number> {
    const n = Math.min(end, this.items.length);
    const r = cellRange(box);
    if (!r || (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > GRID_QUERY_CELLS) return Array.from({ length: n }, (_, i) => i);
    let g = this.grid;
    if (!g || g.of !== this.items) g = this.grid = { of: this.items, done: 0, cells: new Map(), wide: [] };
    for (; g.done < this.items.length; g.done++) {
      const c = cellRange(this.items[g.done].box);
      if (!c || (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) > GRID_ITEM_CELLS) {
        g.wide.push(g.done);
        continue;
      }
      for (let y = c.y0; y <= c.y1; y++)
        for (let x = c.x0; x <= c.x1; x++) {
          const k = y * GRID_ROW + x;
          const l = g.cells.get(k);
          if (l) l.push(g.done);
          else g.cells.set(k, [g.done]);
        }
    }
    const hit = new Set<number>();
    for (const i of g.wide) if (i < n) hit.add(i);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) for (const i of g.cells.get(y * GRID_ROW + x) ?? []) if (i < n) hit.add(i);
    return [...hit].sort((a, b) => a - b);
  }

  /**
   * 矩形 box の下の色: box に掛かる物のうち、いちばん上 (後に描いた物) が、box の全体を覆う 1 色の塗りならその色、
   * 何も掛からなければページの白 ('white')。ほかは undefined (ベクタでは平らにできない)。end より後の物は見ない。
   * shapes (box の中の物の図形) を渡すと、外接矩形が掛かるだけで実際には重ならない物 (字詰めで外接矩形の重なる隣の字など) は飛ばす
   */
  backdrop(box: Box, end = this.items.length, shapes?: () => SvgShape[]): FlatColor | 'white' | undefined {
    let points: number[] | undefined;
    const near = [...this.near(box, end)];
    for (let k = near.length - 1; k >= 0; k--) {
      const it = this.items[near[k]];
      if (!meets(it.box, box)) continue;
      const ex = exactBox(it);
      if (!ex || !meets(ex, box)) continue;
      if (it.solid) {
        const regions = it.solid.regions;
        if (regions.every((poly) => polygonContains(poly, box))) return it.solid.color;
        // 外接矩形がはみ出しても、図形の点 (凸包) がどれも中にあれば、図形は中にある
        if (shapes) {
          const pts = (points ??= shapesPoints(shapes()));
          if (pts.length && regions.every((poly) => polygonContainsPoints(poly, pts))) return it.solid.color;
        }
      }
      if (shapes && !it.opaqueOnly && !shapesOverlap(it.shapes(), shapes())) continue;
      return undefined;
    }
    return 'white';
  }

  /** 矩形 box に掛かる物 (描いた順)。図形で描き直せない物が掛かれば、その理由の文 */
  under(box: Box, end = this.items.length): FlatItem[] | string {
    const out: FlatItem[] = [];
    for (const i of this.near(box, end)) {
      const it = this.items[i];
      if (!meets(it.box, box)) continue;
      const ex = exactBox(it);
      if (!ex || !meets(ex, box)) continue;
      if (it.opaqueOnly) return it.opaqueOnly;
      out.push(it);
    }
    return out;
  }
}

/**
 * 2 つの図形の並びが実際に重なるか: 外接矩形の重なる所を、細かい画素 (1pt に 8 画素まで。長い辺 256 画素まで) に描いて、
 * 両方が描く画素があるかを見る。描けない図形 (読めない画像) があれば、重なるものとする
 */
export function shapesOverlap(a: SvgShape[], b: SvgShape[]): boolean {
  const ab = shapesBox(a);
  const bb = shapesBox(b);
  const r = ab && bb && intersect(ab, bb);
  if (!r) return false;
  const s = Math.min(8, 256 / Math.max(r.x1 - r.x0, r.y1 - r.y0));
  const W = Math.max(1, Math.ceil((r.x1 - r.x0) * s));
  const H = Math.max(1, Math.ceil((r.y1 - r.y0) * s));
  const m: Matrix = [s, 0, 0, s, -r.x0 * s, -r.y0 * s];
  try {
    const pa = paintShapesToPixels(a, m, W, H);
    const pb = paintShapesToPixels(b, m, W, H);
    for (let i = 3; i < pa.length; i += 4) if (pa[i] > 0.004 && pb[i] > 0.004) return true;
    return false;
  } catch {
    return true;
  }
}

// ───────────── 画素にする ─────────────

/** 画素にした CMYK の画像 (8 ビット、成分の順 C・M・Y・K) と、置く矩形 (ページの座標) */
export interface CmykRaster {
  width: number;
  height: number;
  data: Uint8Array;
  box: Box;
}

/** 1 度に描く画素の枠の大きさ (図形を、掛かる枠でだけ描く。大きな範囲でも、図形ごとの手間が範囲の全体に及ばない) */
const TILE = 128;

/** 図形の並びから、矩形 b に掛かるものだけを残す (グループの中も) */
function cull(shapes: readonly SvgShape[], b: Box): SvgShape[] {
  const out: SvgShape[] = [];
  for (const sh of shapes) {
    const sb = shapeBox(sh);
    if (!sb || !meets(sb, b)) continue;
    if (sh.group) {
      const inner = cull(sh.group.shapes, b);
      if (inner.length) out.push(inner.length === sh.group.shapes.length ? sh : { ...sh, group: { shapes: inner } });
    } else out.push(sh);
  }
  return out;
}

/**
 * 図形の並び (ページの座標) の、矩形 box の範囲を、解像度 ppi の CMYK の画像にする。色は colorOf (CSS の色 → CMYK)、
 * 画像の画素は pixelOf (RGB → CMYK) で CMYK にする。何も描かれない所はページの白 (CMYK 0)
 */
export function rasterCmyk(shapes: SvgShape[], box: Box, ppi: number, colorOf: (css: string) => [number, number, number, number], pixelOf: (r: number, g: number, b: number) => [number, number, number, number]): CmykRaster {
  const s = ppi / 72;
  const W = Math.max(1, Math.ceil((box.x1 - box.x0) * s - 1e-6));
  const H = Math.max(1, Math.ceil((box.y1 - box.y0) * s - 1e-6));
  const data = new Uint8Array(W * H * 4);
  // 色を CMYK の補数にしたもの (版ごと): 0 は C・M・Y、1 は K
  const cmykMemo = new Map<string, [number, number, number, number]>();
  const cmykOfCss = (css: string) => {
    let v = cmykMemo.get(css);
    if (!v) cmykMemo.set(css, (v = colorOf(css)));
    return v;
  };
  const hooks = [0, 1].map((pass) => {
    const imgs = new Map<object, { w: number; h: number; rgba: Uint8Array } | undefined>();
    const pxMemo = new Map<number, [number, number, number, number]>();
    return {
      color: (css: string) => {
        const v = cmykOfCss(css);
        return pass === 0 ? [1 - v[0], 1 - v[1], 1 - v[2]] : [1 - v[3], 1 - v[3], 1 - v[3]];
      },
      decode: (img: NonNullable<SvgShape['image']>) => {
        if (imgs.has(img)) return imgs.get(img);
        const px = decodeShapeImage(img);
        let out: { w: number; h: number; rgba: Uint8Array } | undefined;
        if (px) {
          const rgba = new Uint8Array(px.rgba.length);
          for (let i = 0; i < px.rgba.length; i += 4) {
            const key = (px.rgba[i] << 16) | (px.rgba[i + 1] << 8) | px.rgba[i + 2];
            let v = pxMemo.get(key);
            if (!v) {
              v = pixelOf(px.rgba[i] / 255, px.rgba[i + 1] / 255, px.rgba[i + 2] / 255);
              if (pxMemo.size < 1 << 16) pxMemo.set(key, v);
            }
            if (pass === 0) {
              rgba[i] = Math.round((1 - v[0]) * 255);
              rgba[i + 1] = Math.round((1 - v[1]) * 255);
              rgba[i + 2] = Math.round((1 - v[2]) * 255);
            } else rgba[i] = rgba[i + 1] = rgba[i + 2] = Math.round((1 - v[3]) * 255);
            rgba[i + 3] = px.rgba[i + 3];
          }
          out = { w: px.w, h: px.h, rgba };
        }
        imgs.set(img, out);
        return out;
      },
    };
  });
  for (let ty = 0; ty < H; ty += TILE)
    for (let tx = 0; tx < W; tx += TILE) {
      const tw = Math.min(TILE, W - tx);
      const th = Math.min(TILE, H - ty);
      // 枠の範囲 (ページの座標)。縁の画素の割合のために、少し広めに図形を選ぶ
      const tb: Box = { x0: box.x0 + (tx - 1) / s, y0: box.y0 + (ty - 1) / s, x1: box.x0 + (tx + tw + 1) / s, y1: box.y0 + (ty + th + 1) / s };
      const sel = cull(shapes, tb);
      if (!sel.length) continue;
      const m: Matrix = [s, 0, 0, s, -box.x0 * s - tx, -box.y0 * s - ty];
      // 2 つの版で、覆う割合は同じなので覚えて使い回す
      const cache = new Map<object, Float32Array>();
      const p0 = paintShapesToPixels(sel, m, tw, th, { ...hooks[0], cache });
      const p1 = paintShapesToPixels(sel, m, tw, th, { ...hooks[1], cache });
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const i = (y * tw + x) * 4;
          const o = ((ty + y) * W + tx + x) * 4;
          // 乗算済みの補数の値 r を、白 (補数 1) の上に重ねて (r + (1 − a))、補数を戻す: C = a − r
          const a0 = p0[i + 3];
          const a1 = p1[i + 3];
          data[o] = Math.round(clamp01(a0 - p0[i]) * 255);
          data[o + 1] = Math.round(clamp01(a0 - p0[i + 1]) * 255);
          data[o + 2] = Math.round(clamp01(a0 - p0[i + 2]) * 255);
          data[o + 3] = Math.round(clamp01(a1 - p1[i]) * 255);
        }
    }
  return { width: W, height: H, data, box: { x0: box.x0, y0: box.y0, x1: box.x0 + W / s, y1: box.y0 + H / s } };
}

/** 画素にする解像度の既定 (ppi) と、字が掛かるときの解像度 (小さい字ほど細かく)、上限 */
export const FLATTEN_PPI = 300;
export const FLATTEN_TEXT_PPI = 600;
/** 1 つの画像の画素の数の上限 (超えるときは解像度を下げる。下げても超える範囲は画像にしない) */
export const FLATTEN_MAX_PIXELS = 36_000_000;

/** 画素にする範囲の解像度: 既定 300ppi。12pt 未満の字が掛かれば 600ppi。画像が掛かれば、その解像度 (600ppi まで) も下回らない */
export function flattenPpi(items: readonly FlatItem[], box: Box): number {
  let ppi = FLATTEN_PPI;
  for (const it of items) {
    if (it.text !== undefined && it.text < 12) ppi = Math.max(ppi, FLATTEN_TEXT_PPI);
    if (it.ppi) ppi = Math.max(ppi, Math.min(FLATTEN_TEXT_PPI, it.ppi));
  }
  const area = ((box.x1 - box.x0) / 72) * ((box.y1 - box.y0) / 72);
  // 上限は必ず守る (72ppi などの下限で止めると、広い範囲 (大きなページ) で上限を何倍も超えて、時間とメモリを使い果たす)。
  // 1ppi でも上限を超える範囲は 0 を返す (呼ぶ側は画像にできないとする)。下げた解像度は、呼ぶ側の警告に出る
  if (!(area * ppi * ppi <= FLATTEN_MAX_PIXELS)) ppi = area > 0 ? Math.floor(Math.sqrt(FLATTEN_MAX_PIXELS / area)) : 0;
  return ppi;
}

/** 図形が透明を使うか (不透明度・マスク・描画モード・透明のグループ・グラデーションの止まり点の不透明度・模様の中身)。alphaImage は透明度つきの画像か */
export function shapeUsesAlpha(sh: SvgShape, alphaImage: (img: NonNullable<SvgShape['image']>) => boolean): boolean {
  if (sh.masks?.length || sh.blend || sh.group) return true;
  if (sh.image) return sh.fillOpacity < 1 || alphaImage(sh.image);
  const fill = sh.fill !== undefined || !!sh.fillPaint || !!sh.fillPattern;
  const stroke = (sh.stroke !== undefined || !!sh.strokePaint) && sh.strokeWidth > 0;
  if (fill && sh.fillOpacity < 1) return true;
  if (stroke && sh.strokeOpacity < 1) return true;
  if (fill && sh.fillPaint?.stops.some((s) => (s.opacity ?? 1) < 1)) return true;
  if (stroke && sh.strokePaint?.stops.some((s) => (s.opacity ?? 1) < 1)) return true;
  if (fill && sh.fillPattern?.shapes.some((c) => shapeUsesAlpha(c, alphaImage))) return true;
  return false;
}

/**
 * 不透明度 1・描画モードもマスクも無いグループ (中を重ねる意味の無いもの) を開いて、子を並べる (グループの切り抜きは子に付ける)。
 * PDF に書くと透明のグループ (Group の S が Transparency) になるので、平らにするときは開く。
 * ただし、描画モードの付いた子 (開いた後の子) のあるグループは開かない。グループ (isolation: isolate の要素など) は孤立した
 * グループ (Compositing and Blending 1 §3.3・§5.3。PDF では Group の I が true。ISO 32000-2 §11.4.7.2) で、子はグループの中の
 * 物とだけ混ぜる (グループの下の物とは混ぜない)。開くと、子がグループの下の物とも混ざって、色が変わる。描画モードの無い子だけなら、
 * 孤立していてもいなくても、不透明度 1 で置けば、子をじかに描いたのと同じ (§5.3 の合成の式で、背景の分が消える)
 */
export function openPlainGroups(shapes: readonly SvgShape[]): SvgShape[] {
  const out: SvgShape[] = [];
  for (const sh of shapes) {
    if (sh.group && sh.fillOpacity >= 1 && !sh.blend && !sh.masks?.length) {
      const inner = openPlainGroups(sh.group.shapes);
      if (inner.some((c) => c.blend)) {
        out.push(inner.length === sh.group.shapes.length && inner.every((c, i) => c === sh.group!.shapes[i]) ? sh : { ...sh, group: { ...sh.group, shapes: inner } });
        continue;
      }
      for (const c of inner) {
        const clips: SvgClip[] = [...(sh.clips ?? []), ...(c.clips ?? [])];
        out.push({ ...c, ...(clips.length ? { clips } : {}), ...(sh.link && !c.link ? { link: sh.link } : {}) });
      }
    } else out.push(sh);
  }
  return out;
}

/**
 * pageRaster — SheetArea (組んだページ) を画素にして、PNG にする。ブラウザでも Node でも動き、依存を足さない
 * (PNG の圧縮は、pixels.ts の encodePng (CompressionStream の deflate))。
 *
 * 描き方は、画面の canvasRenderer.ts・PDF の pdfRenderer.ts・SVG の svgRenderer.ts と同じ Painter (paint.ts) を実装するので、
 * 座標の計算はどれも同じ。画素の計算は、図形ごとに、その外接矩形 (と、いまの切り抜きの外接矩形の重なり) の中だけを行う
 * (svgFilterRaster.ts の図形の塗りは、filter の領域の全体を図形ごとに回すので、ページ全体には遅すぎる)。
 *  - 縁の塗り (アンチエイリアス): 1 画素の行を SS 本の走査線で数え、横は線の端の画素の割合で数える (svgFilterRaster.ts の coverage と同じ方式)
 *  - 塗りの規則: 非ゼロ・偶奇 (SVG 1.1 §11.3 fill-rule)。線は strokeOutline.ts で輪郭にしてから、非ゼロで塗る
 *  - 字: 書体の輪郭 (fontkit の字形)。字形と位置は、PDF と同じく領域の木の字形の番号と位置 (colorGlyph.ts の areaGlyphs)。
 *    色つきの字形 (COLR・SVG・CBDT・sbix) は、描画の命令 (ColorOp) を描く (合成は Porter-Duff と描画モード)
 *  - 画像: PNG・JPEG・GIF・BMP・WebP を画素に戻し、縮めるときは画素の平均で縮めてから、2 次の補間 (bilinear) で引く。
 *    SVG の画像は、PDF と同じく図形の並び (svg.ts の parseSvg) にしてから描く (グラデーション・模様・切り抜き・マスク・透明のグループ・描画モード)
 *  - 不透明度の付いた箱 (CSS の opacity) は、別の板に描いてから不透明度を掛けて重ねる (Color 4 §3.3)
 *  - 色は sRGB。CMYK・特色は、画面の Canvas と同じ式 (color.ts の toCss) で RGB にする
 * 描かないもの: リンク・注釈・フォームの欄 (PDF の注釈)、CMYK の JPEG・インターレースの PNG (画素に戻せない。警告に出す)。
 * 上限: 1 ページを画素にする手間 (PNG_RASTER_WORK_PER_PIXEL)・1 ページで画素に戻す画像 (PNG_PAGE_DECODE_PIXELS)・覚える画像 (PNG_IMAGE_CACHE_PIXELS)
 */
import type { FontManager } from './fontManager';
import { parseColor } from './color';
import { FAKE_BOLD, ITALIC_SLANT, paintPlaceholder, paintSheet, type Line, type Painter, type PathSeg } from './paint';
import type { AssetStore } from './assets';
import { areaGlyphs, colorFontOf, COMPOSITE, plainStops, sweepSampler, type ColorFill, type ColorOp, type Rgb } from './colorGlyph';
import { ensureSvgGlyphReader } from './colorGlyphSvg';
import { decodePng } from './colorGlyphCanvas';
import { decodeJpeg } from './jpeg';
import { apply, invert, mul, IDENTITY, type Matrix } from './matrix';
import type { GlyphArea, ImageArea, Rect, SheetArea } from './types';
import { resolveNonScaling, type SvgBlend, type SvgDoc, type SvgGradient, type SvgPattern, type SvgShape, type XmlNode } from './svg';
import { compositeOver, decodeShapeImage, gradientAt } from './svgFilterRaster';
import { strokeOutline } from './strokeOutline';
import { registerSvgFonts } from './pdfRenderer';
import { decodeBmp, decodeGif, encodePng, type Pixels } from './pixels';
import { decodeWebp } from './webp';
import { imageKey, pageImages, svgImageDoc } from './svgRenderer';
import { msg } from './messages';
import { diag, type Diagnostic } from './diagnostics';
import { MAX_PIXELS as IMAGE_MAX_PIXELS } from './imageLimits';

export interface PngRenderOptions {
  /** 解像度 (1 インチ = 72pt あたりの画素の数)。既定 96 */
  dpi?: number;
  /** 画像 (fo:external-graphic・img) の登録所 */
  assets?: AssetStore;
  /** SVG の画像を図形にするときの XML のパーサ (無ければ、SVG の画像は描かない) */
  parseXml?: (xml: string) => XmlNode;
  /** 仕上がり・塗り足しのガイド線 (画面確認用) */
  guides?: boolean;
  /** 描けない画像などの警告を足す先 */
  warn?: (d: Diagnostic) => void;
}

/** 1 枚の PNG の画素の数の上限 (1 画素あたり 16 バイトの板を持つので、4,000 万画素で 640MB。A4 を 600dpi で描ける大きさ) */
export const PNG_MAX_PIXELS = 40_000_000;

/** 1 画素の行を数える走査線の数 (縦の縁の塗りの細かさ) */
const SS = 5;

/**
 * 画素の板 (乗算済みの RGBA。0〜1)。(x0, y0) はページの画素の座標の左上、w × h の大きさ。
 * limit のある板 (広がる板) は、空から始め、描いた所を覆うように limit の中で広げる (不透明度のグループ・マスクの中身を描く板。
 * 中身の外接矩形の大きさだけを持つ: 小さな字の不透明度のグループごとに、ページ全体の板を作って重ねていた)
 */
class Layer {
  d: Float32Array;
  constructor(
    public x0: number,
    public y0: number,
    public w: number,
    public h: number,
    readonly limit?: IBox,
  ) {
    this.d = new Float32Array(Math.max(0, w * h * 4));
  }

  /** 描ける範囲 (広がる板は limit、ほかは今の大きさ) */
  get extent(): IBox {
    return this.limit ?? layerBox(this);
  }

  /**
   * 広がる板を、box (extent の中) を覆う大きさにした後の矩形 (広げなくてよければ undefined)。広げる向きには、半分の余りを付ける
   * (少しずつ広がる描き方 (字を並べる) で、広げ直しの写しが何度も起きないように)
   */
  grownBox(box: IBox): IBox | undefined {
    if (!this.limit || empty(box)) return undefined;
    const cur = layerBox(this);
    const has = this.w > 0 && this.h > 0;
    if (has && box.x0 >= cur.x0 && box.y0 >= cur.y0 && box.x1 <= cur.x1 && box.y1 <= cur.y1) return undefined;
    if (!has) return box;
    const u = { x0: Math.min(cur.x0, box.x0), y0: Math.min(cur.y0, box.y0), x1: Math.max(cur.x1, box.x1), y1: Math.max(cur.y1, box.y1) };
    const mw = (u.x1 - u.x0) >> 1;
    const mh = (u.y1 - u.y0) >> 1;
    return meet({ x0: u.x0 - (u.x0 < cur.x0 ? mw : 0), y0: u.y0 - (u.y0 < cur.y0 ? mh : 0), x1: u.x1 + (u.x1 > cur.x1 ? mw : 0), y1: u.y1 + (u.y1 > cur.y1 ? mh : 0) }, this.limit);
  }

  /** 板を矩形 nb にする (今の中身は写す) */
  resize(nb: IBox) {
    const w = nb.x1 - nb.x0;
    const h = nb.y1 - nb.y0;
    const d = new Float32Array(w * h * 4);
    for (let y = 0; y < this.h; y++) d.set(this.d.subarray(y * this.w * 4, (y + 1) * this.w * 4), ((y + this.y0 - nb.y0) * w + this.x0 - nb.x0) * 4);
    this.d = d;
    this.x0 = nb.x0;
    this.y0 = nb.y0;
    this.w = w;
    this.h = h;
  }
}

/** 覆う割合 (0〜1)。ページの画素の座標の矩形 (x0, y0)〜(x0 + w, y0 + h) の中の値 (外は 0) */
interface Cov {
  x0: number;
  y0: number;
  w: number;
  h: number;
  a: Float32Array;
  /** 切り抜きの並びに積んだとき、この切り抜きが持つ配列の大きさ (板の画素の数に直したもの。RasterShared.layerPixels に数える)。外側と配列を分け合うなら 0 */
  held?: number;
}

/** 整数の矩形 (終わりは含まない) */
interface IBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const covBox = (c: Cov): IBox => ({ x0: c.x0, y0: c.y0, x1: c.x0 + c.w, y1: c.y0 + c.h });
const layerBox = (l: { x0: number; y0: number; w: number; h: number }): IBox => ({ x0: l.x0, y0: l.y0, x1: l.x0 + l.w, y1: l.y0 + l.h });
const area = (b: IBox) => (empty(b) ? 0 : (b.x1 - b.x0) * (b.y1 - b.y0));
const meet = (a: IBox, b: IBox): IBox => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const empty = (b: IBox) => b.x1 <= b.x0 || b.y1 <= b.y0;
const sameBox = (a: IBox, b: IBox) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
/** a が b を囲む */
const contains = (a: IBox, b: IBox) => a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1;
/** 覆う割合 c が、矩形 b (c の範囲の中) で全部 1 か */
function allOnes(c: Cov, b: IBox): boolean {
  for (let y = b.y0; y < b.y1; y++) {
    const row = (y - c.y0) * c.w - c.x0;
    for (let x = b.x0; x < b.x1; x++) if (c.a[row + x] !== 1) return false;
  }
  return true;
}

/** 図形の輪郭 (3 次ベジェまで) を、行列 m で画素の座標にして折れ線にする */
function flattenSegs(segs: readonly PathSeg[], m: Matrix, out: number[][] = []): number[][] {
  let cur: number[] | undefined;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const g of segs) {
    if (g.op === 'M') {
      if (cur && cur.length >= 4) out.push(cur);
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
      cubicTo(cur, cx, cy, x1, y1, x2, y2, x3, y3);
      [cx, cy] = [x3, y3];
    } else {
      cur?.push(sx, sy);
      [cx, cy] = [sx, sy];
    }
  }
  if (cur && cur.length >= 4) out.push(cur);
  return out;
}

/** 3 次ベジェを折れ線にして足す (分ける数は、制御点の折れ線の長さ (画素) から。1 画素の 1/4 ほどの誤差に収まる数) */
function cubicTo(cur: number[] | undefined, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  if (!cur) return;
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const n = Math.min(100, Math.max(1, Math.ceil(Math.sqrt(len) * 1.5)));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    cur.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
}

/** 2 次ベジェを折れ線にして足す */
function quadTo(cur: number[] | undefined, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  if (!cur) return;
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
  const n = Math.min(100, Math.max(1, Math.ceil(Math.sqrt(len) * 1.2)));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    cur.push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

/** 辺の並び (下向きに並べた [x0, y0, x1, y1, 向き]) を、使い回す配列に入れる */
type Edge = [number, number, number, number, number];

/**
 * 折れ線の輪郭の覆う割合を、範囲 bounds の中で求める (外接矩形の中だけ)。縦は 1 画素を SS 本の走査線で、横は線の端の画素の割合で数える。
 * 覆う所が無ければ undefined。spend を渡せば、求める前に手間 (外接矩形の画素の数と、走査線ごとの掛かる辺の数 n と並べ替えの n log2 n) を払い、払えなければ undefined
 */
function coverageOf(polys: number[][], evenOdd: boolean, bounds: IBox, spend?: (n: number) => boolean): Cov | undefined {
  const edges: Edge[] = [];
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2];
      const ay = p[i * 2 + 1];
      const j = (i + 1) % n;
      const qx = p[j * 2];
      const qy = p[j * 2 + 1];
      if (!(Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(qx) && Number.isFinite(qy))) continue;
      if (ax < bx0) bx0 = ax;
      if (ax > bx1) bx1 = ax;
      if (ay < by0) by0 = ay;
      if (ay > by1) by1 = ay;
      if (ay === qy) continue;
      edges.push(ay < qy ? [ax, ay, qx, qy, 1] : [qx, qy, ax, ay, -1]);
    }
  }
  if (!edges.length) return undefined;
  const box = meet({ x0: Math.floor(bx0), y0: Math.floor(by0), x1: Math.ceil(bx1) + 1, y1: Math.ceil(by1) }, bounds);
  if (empty(box)) return undefined;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (spend) {
    // 走査線 (1 行に SS 本) ごとに、掛かる辺を見る手間 (掛かる辺の数 n) と、その辺の交わる位置を並べ替える手間 (n log2 n)。
    // 並べ替えを数えないと、縦の辺の多い道 (細かい破線の太い線など) で、走査線ごとの並べ替えが、勘定の何倍もの時間になる。
    // 走査線ごとの n は、辺の掛かる走査線の範囲の始めと終わりの差の並び (lines + 1 個) を足し上げて求める (下の走査の y と同じ位置で数える)
    const lines = h * SS;
    const starts = new Int32Array(lines + 1);
    let rows = 0;
    for (const e of edges) {
      rows += Math.max(0, Math.min(e[3], box.y1) - Math.max(e[1], box.y0));
      const j0 = Math.max(0, Math.ceil((e[1] - box.y0) * SS - 0.5));
      const j1 = Math.min(lines, Math.ceil((e[3] - box.y0) * SS - 0.5));
      if (j1 > j0) {
        starts[j0]++;
        starts[j1]--;
      }
    }
    let sorts = 0;
    for (let j = 0, n = 0; j < lines; j++) {
      n += starts[j];
      if (n > 1) sorts += n * Math.log2(n);
    }
    if (!spend(w * h + rows * SS + Math.ceil(sorts))) return undefined;
  }
  const a = new Float32Array(w * h);
  edges.sort((p, q) => p[1] - q[1]);
  const active: Edge[] = [];
  let next = 0;
  const xs: number[] = [];
  const ws: number[] = [];
  const order: number[] = [];
  const unit = 1 / SS;
  for (let row = box.y0; row < box.y1; row++) {
    const base = (row - box.y0) * w;
    for (let k = 0; k < SS; k++) {
      const y = row + (k + 0.5) / SS;
      while (next < edges.length && edges[next][1] <= y) active.push(edges[next++]);
      let n = 0;
      for (const e of active) if (e[3] > y) active[n++] = e;
      active.length = n;
      if (n < 2) continue;
      xs.length = 0;
      ws.length = 0;
      order.length = 0;
      for (let i = 0; i < n; i++) {
        const e = active[i];
        if (e[1] > y) continue;
        xs.push(e[0] + ((y - e[1]) * (e[2] - e[0])) / (e[3] - e[1]));
        ws.push(e[4]);
        order.push(order.length);
      }
      order.sort((p, q) => xs[p] - xs[q]);
      let wind = 0;
      for (let i = 0; i < order.length - 1; i++) {
        wind += ws[order[i]];
        if (evenOdd ? (wind & 1) === 0 : wind === 0) continue;
        const xa = Math.max(box.x0, xs[order[i]]) - box.x0;
        const xb = Math.min(box.x1, xs[order[i + 1]]) - box.x0;
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) a[base + ia] += (xb - xa) * unit;
        else {
          a[base + ia] += (ia + 1 - xa) * unit;
          for (let c = ia + 1; c < ib; c++) a[base + c] += unit;
          if (ib < w) a[base + ib] += (xb - ib) * unit;
        }
      }
    }
  }
  for (let i = 0; i < a.length; i++) if (a[i] > 1) a[i] = 1;
  return { x0: box.x0, y0: box.y0, w, h, a };
}

/** 2 つの覆う割合を掛けたもの (切り抜きの重なり)。重ならなければ、空の割合 */
function intersectCov(p: Cov, q: Cov): Cov {
  const b = meet(covBox(p), covBox(q));
  const w = Math.max(0, b.x1 - b.x0);
  const h = Math.max(0, b.y1 - b.y0);
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + b.x0;
      const py = y + b.y0;
      a[y * w + x] = p.a[(py - p.y0) * p.w + px - p.x0] * q.a[(py - q.y0) * q.w + px - q.x0];
    }
  return { x0: b.x0, y0: b.y0, w, h, a };
}

/** 塗りの色 (乗算していない RGBA。0〜1)。画素の中心のページの画素の座標で引く。塗らない画素は undefined */
type Sampler = (x: number, y: number) => readonly number[] | undefined;
type Paint = { solid: readonly number[] } | { at: Sampler };

/** 画像の画素 (RGBA 8 ビット。乗算していない) と、縮めたものの覚え */
interface Img {
  w: number;
  h: number;
  rgba: Uint8Array;
  /** 縦横を 1/f に縮めたもの (f ごと) */
  reduced?: Map<number, Img>;
}

/** 画像を縦横 1/f に縮める (f × f の画素の平均。乗算済みで平均して、乗算しない値に戻す) */
function reduce(img: Img, f: number): Img {
  let hit = img.reduced?.get(f);
  if (hit) return hit;
  const w = Math.max(1, Math.floor(img.w / f));
  const h = Math.max(1, Math.floor(img.h / f));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy;
        if (sy >= img.h) break;
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          if (sx >= img.w) break;
          const s = (sy * img.w + sx) * 4;
          const al = img.rgba[s + 3];
          r += img.rgba[s] * al;
          g += img.rgba[s + 1] * al;
          b += img.rgba[s + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / Math.max(1, n));
    }
  hit = { w, h, rgba: out };
  (img.reduced ??= new Map()).set(f, hit);
  return hit;
}

/**
 * 画像を、単位正方形 (左上が原点、y 下向き。(0, 0)〜(1, 1) が画像の全体) → ページの画素の座標の行列 m で引く Sampler。
 * 縮めて置くときは、先に画素の平均で縮めておき (1 画素に 2 画素以上が入らないように)、2 次の補間で引く。tile なら、単位正方形の外も繰り返す
 */
function imageSampler(img0: Img, m: Matrix, tile = false): Sampler | undefined {
  const f = reductionOf(img0.w, img0.h, m);
  return pixelSampler(f > 1 ? reduce(img0, f) : img0, m, tile);
}

/**
 * w × h の画像を行列 m (単位正方形 → ページの画素の座標) で置くときに、先に縮める割合 (縦横 1/f。1 は縮めない)。
 * 1 画素に 2 画素以上が入るなら、入る数 (の小さい方の向き) で縮める (64 まで)
 */
function reductionOf(w: number, h: number, m: Matrix): number {
  const sx = Math.hypot(m[0], m[1]) / w;
  const sy = Math.hypot(m[2], m[3]) / h;
  const f = Math.floor(Math.min(1 / Math.max(sx, 1e-9), 1 / Math.max(sy, 1e-9)));
  return f >= 2 ? Math.min(f, 64) : 1;
}

/** 画像 img (縮めてあれば縮めたもの) を、単位正方形 → ページの画素の座標の行列 m で、そのまま 2 次の補間で引く Sampler (imageSampler) */
function pixelSampler(img: Img, m: Matrix, tile: boolean): Sampler | undefined {
  const inv = invert(m);
  if (!inv) return undefined;
  const { w, h, rgba } = img;
  const out = [0, 0, 0, 0];
  return (x, y) => {
    let [u, v] = apply(inv, x, y);
    if (tile) {
      u -= Math.floor(u);
      v -= Math.floor(v);
    } else if (u < 0 || u > 1 || v < 0 || v > 1) return undefined;
    // 画素の中心の座標にして、隣の 4 画素を混ぜる (端は、端の画素を延ばす。tile なら反対の端の画素と混ぜる)
    const fx = u * w - 0.5;
    const fy = v * h - 0.5;
    let x0 = Math.floor(fx);
    let y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    if (tile) {
      x0 = (x0 + w) % w;
      x1 = x1 % w;
      y0 = (y0 + h) % h;
      y1 = y1 % h;
    } else {
      x0 = Math.min(w - 1, Math.max(0, x0));
      x1 = Math.min(w - 1, Math.max(0, x1));
      y0 = Math.min(h - 1, Math.max(0, y0));
      y1 = Math.min(h - 1, Math.max(0, y1));
    }
    const p00 = (y0 * w + x0) * 4;
    const p10 = (y0 * w + x1) * 4;
    const p01 = (y1 * w + x0) * 4;
    const p11 = (y1 * w + x1) * 4;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    // 乗算済みの値で混ぜる (透明の画素の色が、隣ににじまないように)
    const a00 = rgba[p00 + 3] * w00;
    const a10 = rgba[p10 + 3] * w10;
    const a01 = rgba[p01 + 3] * w01;
    const a11 = rgba[p11 + 3] * w11;
    const a = a00 + a10 + a01 + a11;
    if (a <= 0) return undefined;
    for (let k = 0; k < 3; k++) out[k] = (rgba[p00 + k] * a00 + rgba[p10 + k] * a10 + rgba[p01 + k] * a01 + rgba[p11 + k] * a11) / a / 255;
    out[3] = a / 255;
    return out;
  };
}

/** 色 (CSS の色・cmyk()・spot()) を、sRGB の RGBA (0〜1) にする (画面の Canvas と同じ式。color.ts の toCss) */
function rgbaOf(css: string, opacity = 1): number[] {
  const c = parseColor(css);
  if (c.mode === 'rgb') return [c.r, c.g, c.b, (c.a ?? 1) * opacity];
  return [(1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k), opacity];
}
const rgbOfCss = (css: string): number[] => rgbaOf(css).slice(0, 3);

/** 2 つの円のグラデーション (Canvas の createRadialGradient・COLR の PaintRadialGradient) の、点 (x, y) の位置 t (svgFilterRaster.ts の gradientAt と同じ解き方)。無ければ undefined */
function radialT(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, x: number, y: number): number | undefined {
  const cdx = x1 - x0;
  const cdy = y1 - y0;
  const dr = r1 - r0;
  const pdx = x - x0;
  const pdy = y - y0;
  const a = cdx * cdx + cdy * cdy - dr * dr;
  const b = pdx * cdx + pdy * cdy + r0 * dr;
  const cc = pdx * pdx + pdy * pdy - r0 * r0;
  const ok = (v: number) => Number.isFinite(v) && r0 + v * dr >= -1e-9;
  if (Math.abs(a) < 1e-9) {
    const v = b !== 0 ? cc / (2 * b) : NaN;
    return ok(v) ? v : undefined;
  }
  const disc = b * b - a * cc;
  if (disc < 0) return undefined;
  const q = Math.sqrt(disc);
  const hi = Math.max((b + q) / a, (b - q) / a);
  const lo = Math.min((b + q) / a, (b - q) / a);
  return ok(hi) ? hi : ok(lo) ? lo : undefined;
}

/** COLR の Porter-Duff の合成 (Compositing and Blending 1 §9.1 の Fa・Fb)。描画モードの合成は compositeOver */
const PORTER_DUFF: Record<number, (as: number, ab: number) => [number, number]> = {
  [COMPOSITE.CLEAR]: () => [0, 0],
  [COMPOSITE.SRC]: () => [1, 0],
  [COMPOSITE.DEST]: () => [0, 1],
  [COMPOSITE.SRC_OVER]: (as) => [1, 1 - as],
  [COMPOSITE.DEST_OVER]: (_as, ab) => [1 - ab, 1],
  [COMPOSITE.SRC_IN]: (_as, ab) => [ab, 0],
  [COMPOSITE.DEST_IN]: (as) => [0, as],
  [COMPOSITE.SRC_OUT]: (_as, ab) => [1 - ab, 0],
  [COMPOSITE.DEST_OUT]: (as) => [0, 1 - as],
  [COMPOSITE.SRC_ATOP]: (as, ab) => [ab, 1 - as],
  [COMPOSITE.DEST_ATOP]: (as, ab) => [1 - ab, as],
  [COMPOSITE.XOR]: (as, ab) => [1 - ab, 1 - as],
  [COMPOSITE.PLUS]: () => [1, 1],
};
/** COLR の描画モードの合成の種類 → mix-blend-mode の名前 */
const BLEND_OF: Record<number, SvgBlend> = {
  [COMPOSITE.SCREEN]: 'screen',
  [COMPOSITE.OVERLAY]: 'overlay',
  [COMPOSITE.DARKEN]: 'darken',
  [COMPOSITE.LIGHTEN]: 'lighten',
  [COMPOSITE.COLOR_DODGE]: 'color-dodge',
  [COMPOSITE.COLOR_BURN]: 'color-burn',
  [COMPOSITE.HARD_LIGHT]: 'hard-light',
  [COMPOSITE.SOFT_LIGHT]: 'soft-light',
  [COMPOSITE.DIFFERENCE]: 'difference',
  [COMPOSITE.EXCLUSION]: 'exclusion',
  [COMPOSITE.MULTIPLY]: 'multiply',
  [COMPOSITE.HSL_HUE]: 'hue',
  [COMPOSITE.HSL_SATURATION]: 'saturation',
  [COMPOSITE.HSL_COLOR]: 'color',
  [COMPOSITE.HSL_LUMINOSITY]: 'luminosity',
};

/** fontkit の字形の道の命令 */
type GlyphCommand = { command: string; args: number[] };

/** 描く前に用意した画像: 画素の画像 (PNG・JPEG など。画素に戻すのは描くとき: RasterImages) か、SVG の図形 */
type Prepared = { kind: 'raster'; src: string; mime: string; bytes: Uint8Array } | { kind: 'svg'; doc: SvgDoc };

/**
 * 画素に戻した画像の覚えの、画素の数の合計の上限 (RGBA 8 ビットで 400MB)。ページをまたいで覚える (同じ画像を背景にしたページごとに、
 * 戻し直さない。1 億画素の JPEG を背景にした 10 ページで、ページごとに戻して 100 秒かかっていた)。
 * 1 枚の画像の上限 (imageLimits.ts の MAX_PIXELS) と同じ: いちばん大きな画像も、元の大きさのまま次のページへ持ち越せる。
 * 合わせてこれを超える大きな画像 (元の大きさで置く 1 億画素近くの画像 2 枚など) をページごとに替えて置くと、ページごとに戻し直す
 * (1 ページで戻す上限 PNG_PAGE_DECODE_PIXELS は効く。覚えを大きくするとページをまたいで持つメモリが増えるので、この形にした)
 */
export const PNG_IMAGE_CACHE_PIXELS = IMAGE_MAX_PIXELS;
/**
 * 1 ページを描く間に、画素に戻してよい画像の画素の数の合計 (覚えから手放した画像を戻し直す分と、覚えた元の大きさから別の大きさに縮め直す分
 * (元の画素の数) も数える)。1 枚の上限 (1 億画素) の 4 枚分。
 * 超えた後の画像は描かず、警告に出す (小さな文書で、大きな画像を何枚も・何度も戻させて、時間を使い切らせない)
 */
export const PNG_PAGE_DECODE_PIXELS = 400_000_000;

/**
 * 画素に戻した画像 (と、縮めたもの) の覚え。中身 (バイト列) ごと、縮める割合ごとに持ち、使った順の古いものから手放す
 * (元の大きさのものを先に手放す。縮めたものは小さく、同じ大きさで置く限り元に戻らずに済む)
 */
export class RasterImages {
  /**
   * @param cacheLimit 覚える画素の数の合計の上限 (既定 PNG_IMAGE_CACHE_PIXELS)
   * @param decodeLimit 1 ページで戻す画素の数の上限 (既定 PNG_PAGE_DECODE_PIXELS)
   */
  constructor(
    private cacheLimit = PNG_IMAGE_CACHE_PIXELS,
    private decodeLimit = PNG_PAGE_DECODE_PIXELS,
  ) {}
  /**
   * 中身の鍵 (長さと散らし値) → 中身・元の大きさ・割合ごとの画素。中身で引くので、ページごとに作り直されるバイト列 (SVG の中の data: の画像は、
   * ページごとに SVG を読み直すたびに新しい配列になる) も、同じ中身なら当たる。覚えた画素が無くなった項目は消す (バイト列を溜めない)
   */
  private entries = new Map<string, { bytes: Uint8Array; same: WeakSet<Uint8Array>; w: number; h: number; imgs: Map<number, Img> }>();
  /**
   * 戻せなかった中身 (鍵 → 中身。数は FAILED_MAX まで。超えたら忘れる)。鍵 (散らし値) だけで覚えると、鍵のぶつかる別の中身の画像も
   * 描かれなくなるので、覚えた画像 (entries) と同じく、中身を比べて引く
   */
  private failed = new Map<string, Array<{ bytes: Uint8Array; same: WeakSet<Uint8Array> }>>();
  private failedCount = 0;
  /** バイト列 → 中身の鍵 (散らし値を計算し直さない) */
  private keys = new WeakMap<Uint8Array, string>();
  /** 使った順 (古い順)。鍵は「中身の鍵|割合」 */
  private lru = new Map<string, { key: string; f: number; px: number }>();
  /** 覚えている画素の数の合計 */
  total = 0;
  /** このページで戻した画素の数 (覚えた元の大きさから縮め直した、元の画素の数も数える) */
  decoded = 0;

  /** 中身の鍵: 長さと FNV-1a (32 ビット) の散らし値。同じ鍵の別の中身は、バイトを比べて見分ける */
  private keyOf(bytes: Uint8Array): string {
    let k = this.keys.get(bytes);
    if (k === undefined) {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
      this.keys.set(bytes, (k = `${bytes.length}:${(h >>> 0).toString(16)}`));
    }
    return k;
  }

  /** 中身 bytes を、戻せなかった中身として覚えているか (鍵の同じものと、中身を比べる) */
  private hasFailed(bytes: Uint8Array, key: string): boolean {
    for (const f of this.failed.get(key) ?? []) {
      if (f.bytes === bytes || f.same.has(bytes)) return true;
      if (f.bytes.length === bytes.length && f.bytes.every((v, i) => v === bytes[i])) {
        f.same.add(bytes);
        return true;
      }
    }
    return false;
  }

  /** 中身 bytes の項目 (無いか、散らし値が同じで中身の違うものなら undefined) */
  private entryOf(bytes: Uint8Array, key: string) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.bytes === bytes || e.same.has(bytes)) return e;
    if (e.bytes.length === bytes.length && e.bytes.every((v, i) => v === bytes[i])) {
      e.same.add(bytes);
      return e;
    }
    return undefined;
  }

  /**
   * 中身 bytes の画像を、置く行列から割合を決める fOf で縮めたもの。戻せなければ null、このページの戻す上限を超えるなら 'limit'。
   * decode は、元の大きさに戻す関数
   */
  get(bytes: Uint8Array, decode: () => Img | undefined, fOf: (w: number, h: number) => number): Img | null | 'limit' {
    const key = this.keyOf(bytes);
    if (this.failed.has(key) && this.hasFailed(bytes, key)) return null;
    let e = this.entryOf(bytes, key);
    // 散らし値が同じで中身の違う画像 (まず起きない) は、覚えずに戻す
    const collide = !e && this.entries.has(key);
    if (e) {
      const f = fOf(e.w, e.h);
      const hit = e.imgs.get(f);
      if (hit) {
        this.touch(key, f);
        return hit;
      }
    }
    let orig = e?.imgs.get(1);
    /** 元の大きさを、この呼び出しで戻した */
    let fresh = false;
    if (orig) this.touch(key, 1);
    else {
      if (this.decoded >= this.decodeLimit) return 'limit';
      // 縮めたものを覚えるために上限を超えて残した元の大きさ (store の keep2) は、別の画像を戻す前に手放す
      // (元の大きさの画像が、覚えの中と戻す途中とで 2 枚そろわないように)
      if (this.total > this.cacheLimit) {
        this.trim();
        // 手放して項目が消えたら、作り直す
        if (e && this.entries.get(key) !== e) e = undefined;
      }
      const d = decode();
      if (!d) {
        if (this.failedCount >= FAILED_MAX) {
          this.failed.clear();
          this.failedCount = 0;
        }
        this.failed.set(key, [...(this.failed.get(key) ?? []), { bytes, same: new WeakSet() }]);
        this.failedCount++;
        return null;
      }
      this.decoded += d.w * d.h;
      orig = d;
      fresh = true;
      if (collide) {
        const f = fOf(d.w, d.h);
        return f <= 1 ? d : reduce(d, f);
      }
      if (!e) this.entries.set(key, (e = { bytes, same: new WeakSet(), w: d.w, h: d.h, imgs: new Map() }));
      this.store(key, e, 1, d);
    }
    const f = fOf(e!.w, e!.h);
    if (f <= 1) return orig;
    // 覚えた元の大きさから縮め直す手間 (元の画素の数) も、このページで戻す画素の数に数える (戻したばかりの元の大きさを縮めるのは、戻した分に含める)。
    // 数えないと、大きな画像を多くの大きさで置くページで、縮める手間 (1 億画素で約 0.5 秒) が大きさの数だけ掛かる
    // (覚えた元の大きさを使わずに、大きさごとに戻し直していたときは、戻した分として数えていた)
    if (!fresh && !orig.reduced?.has(f)) {
      if (this.decoded >= this.decodeLimit) return 'limit';
      this.decoded += orig.w * orig.h;
    }
    const red = reduce(orig, f);
    // 縮めたものを覚えるときは、元の大きさのものも残す (同じ画像を、このページで別の大きさにも置くとき、戻し直さない)
    this.store(key, e!, f, red, `${key}|1`);
    return red;
  }

  private touch(key: string, f: number) {
    const k = `${key}|${f}`;
    const it = this.lru.get(k);
    if (it) {
      this.lru.delete(k);
      this.lru.set(k, it);
    }
  }

  private store(key: string, e: { imgs: Map<number, Img> }, f: number, img: Img, keep2?: string) {
    const k = `${key}|${f}`;
    e.imgs.set(f, img);
    this.lru.set(k, { key, f, px: img.w * img.h });
    this.total += img.w * img.h;
    // 上限を超えたら、使った順の古いものから手放す (いま覚えたもの (と、それを縮めた元) は残す)
    this.trim(this.cacheLimit, k, keep2);
  }

  /**
   * 覚えている画素の数を limit (既定は覚える上限) 以下にする (keep・keep2 の鍵は残す)。元の大きさのものを先に、使った順の古いものから手放す。
   * 覚えた画素の無くなった項目は消す
   */
  trim(limit = this.cacheLimit, keep?: string, keep2?: string) {
    for (const origFirst of [true, false])
      for (const [k, it] of this.lru) {
        if (this.total <= limit) return;
        if (k === keep || k === keep2 || (origFirst && it.f !== 1)) continue;
        this.lru.delete(k);
        this.total -= it.px;
        const e = this.entries.get(it.key);
        // 縮めたものは、元の大きさの画像の覚え (Img.reduced) からも外す (元の大きさが覚えに残る間、数えない画素を持ち続けない)
        if (it.f !== 1) e?.imgs.get(1)?.reduced?.delete(it.f);
        e?.imgs.delete(it.f);
        if (e && !e.imgs.size) this.entries.delete(it.key);
      }
  }
}

/** 戻せなかった中身の鍵を覚える数の上限 */
const FAILED_MAX = 1024;

/** 画像の置き場ごとの、画素に戻した画像の覚え (組んだ結果と一緒に消える) */
const rasterImagesOf = new WeakMap<AssetStore, RasterImages>();

/**
 * 1 ページを画素にする手間の上限の、ページの画素の数あたりの量 (と、ページの大きさによらない分 PNG_RASTER_BASE_WORK)。
 * 手間の 1 単位は、1 画素の覆う割合を求めるか、塗るか、板を重ねるか、走査線に掛かる辺の 1 つを見るか、走査線ごとの辺の並べ替えの n log2 n の 1 つ
 * (2026 年の x86 の Node 22 で測って、ページ全体の塗りを重ねると 1 単位 16ns ほど、細かい破線の太い線 (走査線ごとに数千の辺を並べ替える) は 3ns ほど。
 * 並べ替えを数えなかったときは、細かい破線で 1 単位 80ns ほどになり、600dpi で 1 ページに数分かかっていた)。
 * 図形ごとの手間は、図形の外接矩形 (といまの切り抜きの重なり) の画素の数に比例するので、ページ全体を覆う図形を何千と重ねる小さな SVG
 * (use の入れ子で 1KB 足らず) で、数分〜数十分かかっていた。ページ全体を 128 回塗る量 (と PNG_RASTER_BASE_WORK。A4・96dpi で 1 億 7,800 万単位、
 * 数秒。600dpi で 45 億 2,000 万単位、80 秒ほど): 字・罫線・背景・不透明度のグループ・図形の多い SVG のグラフを置いたページも、ふつうはこの 1/10 に収まる
 * (重いが正当なページを切りにくくする方を選んだ。64 倍なら 600dpi の最悪は 40 秒ほど)。
 * 超えたら、残りの図形・字・画像を描かずに警告を出す (png/raster-budget。描き切れなかった SVG の画像は、仮の枠)
 */
export const PNG_RASTER_WORK_PER_PIXEL = 128;
/** 1 ページを画素にする手間の上限の、ページの大きさによらない分 (小さなページに、字や図形を詰めたとき) */
export const PNG_RASTER_BASE_WORK = 64_000_000;
/**
 * 手間を使い切った後に描く仮の枠 (図形を描き切れなかった SVG の画像) の手間の上限 (ページの画素の数あたり)。
 * 仮の枠も多ければ、描かない
 */
const PNG_PLACEHOLDER_WORK_PER_PIXEL = 4;

/**
 * 1 ページで覚える模様のタイルの画素の数の合計の上限 (RGBA 8 ビットで 64MB。いちばん大きなタイル (2048 × 2048) の 4 枚分)。
 * 覚えに上限が無いと、違う模様の多い SVG で、手間の勘定 (タイルの 1 画素で 1 単位) の範囲で数 GB を持っていた
 */
export const PNG_TILE_CACHE_PIXELS = 16_000_000;

/**
 * 1 ページを画素にする間に、同時に持つ板 (不透明度のグループ・マスク・色つきの字形の合成の板。ページそのものは数えない) の画素の数の合計の上限:
 * ページの画素の数の 8 倍 (ただし 1,600 万画素より少なくはしない)、かつ 6,400 万画素 (板は 1 画素 16 バイトなので 1GB) まで。板は、作るときに、描ける範囲 (いまの板と切り抜きの重なり) の
 * 画素の数で数える (描くうちに広がっても、その範囲を超えない)。上限が無いと、不透明度の箱を 60 段入れ子にした 4KB ほどの HTML で、150dpi で 2GB、
 * 300dpi で 6GB ほどの板を同時に持っていた。超える不透明度のグループは、板を作らずに中の図形ごとに不透明度を掛けて描き (中の重なりは濃くなる)、
 * 超えるマスク・合成は描かない (png/layer-limit の警告。ページに 1 度)
 */
export const PNG_LAYER_PIXELS_PER_PAGE = 8;
export const PNG_LAYER_MAX_PIXELS = 64_000_000;
/**
 * 板の上限の下駄 (小さなページ・低い解像度でも、この画素の数までは持てる。1,600 万画素 = 256MB)。広がる板は、作るときに描ける範囲
 * (ページ全体のことが多い) で数えるので、ページの 8 倍だけだと、小さなページでは不透明度の入れ子 8 段で上限に当たっていた
 */
export const PNG_LAYER_MIN_PIXELS = 16_000_000;

/** 1 ページを画素にする手間の勘定 (模様のタイルを描く板とも共有する) */
interface RasterWork {
  used: number;
  limit: number;
  /** 上限を超えた (以後は描かない) */
  over: boolean;
  /** 仮の枠を描いている間 (手間は reserve から払う) */
  inReserve: boolean;
  reserveUsed: number;
  reserve: number;
}

/**
 * 模様の中身の鍵。svg.ts は、模様を参照する図形ごとに中身を作り直す (中身の図形は、参照ごとに別のもの) ので、中身の形 (図形の並びを JSON にした
 * 文字列。中の模様は、その鍵に置き換える。画像の画素は、配列ごとの番号に置き換える) で見分け、同じ形には同じ番号を付ける。
 * 1 つのものは 1 度だけ数える (入れ子の模様を参照ごとに数え直さない) ので、手間は図形の数に比例する
 */
class PatternKeys {
  private byObject = new WeakMap<object, string>();
  private byForm = new Map<string, string>();
  private ids = new WeakMap<object, number>();
  private nextId = 0;

  key(p: SvgPattern): string {
    let k = this.byObject.get(p) ?? this.byObject.get(p.shapes);
    if (k !== undefined) return k;
    const form = `${p.width},${p.height}|${JSON.stringify(p.shapes, (name, v) => this.replace(name, v))}`;
    k = this.byForm.get(form);
    if (k === undefined) this.byForm.set(form, (k = `p${this.byForm.size}`));
    this.byObject.set(p, k);
    this.byObject.set(p.shapes, k);
    return k;
  }

  private replace(name: string, v: unknown): unknown {
    // 中の模様は、その鍵 (同じ中身の別の参照も、同じ鍵になる)
    if ((name === 'fillPattern' || name === 'strokePattern') && v && typeof v === 'object' && 'shapes' in v) {
      const p = v as SvgPattern;
      return { key: this.key(p), matrix: p.matrix };
    }
    // 画素・バイト列は、配列ごとの番号 (中身を文字にしない)
    if (ArrayBuffer.isView(v)) {
      let id = this.ids.get(v);
      if (id === undefined) this.ids.set(v, (id = this.nextId++));
      return `#${id}`;
    }
    return v;
  }
}

/** 1 ページの描き手どうし (ページの板と、模様のタイルの板) で共有するもの */
interface RasterShared {
  work: RasterWork;
  /**
   * 模様のタイル (模様の中身の鍵と、タイルの画素の大きさごと)。同じ模様で塗る図形ごとに、描き直さない。
   * 画素の数の合計は PNG_TILE_CACHE_PIXELS まで (使った順の古いものから手放す)
   */
  tiles: Map<string, Img>;
  /** tiles の画素の数の合計 */
  tilePixels: number;
  /** 模様の中身の鍵 (patternKey) */
  keys: PatternKeys;
  /** 手間の上限を超えたときの警告を出したか */
  warned: boolean;
  /** XML のパーサ (PngRenderOptions.parseXml。書体の SVG の表の字を読む) */
  parseXml?: (xml: string) => XmlNode;
  /** 同時に持つ板の画素の数 (作るときの描ける範囲で数える) と、その上限 (PNG_LAYER_MAX_PIXELS) */
  layerPixels: number;
  layerLimit: number;
  /** 板の上限を超えたときの警告を出したか */
  layerWarned: boolean;
  /** 切り抜きの上限 (板と同じ勘定) を超えたときの警告を出したか */
  clipWarned: boolean;
}

class RasterPainter implements Painter {
  /** いま描く板 (透明のグループ・色つきの字形の合成の間は、別の板) */
  private layer: Layer;
  /** 局所の座標 → ページの画素の座標 */
  private m: Matrix;
  /** 切り抜きの積み重ね (いまの切り抜きは最後のもの。無ければ切り抜かない) */
  private clips: Cov[] = [];
  private glyphPaths = new Map<string, GlyphCommand[]>();
  /** 画素で計算した filter の画像 (SvgShape の image.pixels) の画素 */
  private decoded = new WeakMap<object, Img>();
  /** 警告を出した画像 (同じ画像の同じ警告は、ページに 1 度) */
  private warned = new Set<string>();
  /** 板を作らずに描く不透明度のグループ (板の上限を超えたもの) の不透明度の積。塗るとき・板を重ねるときに掛ける */
  private alpha = 1;

  constructor(
    readonly page: Layer,
    /** ページの pt → 画素 (dpi / 72) */
    private pageScale: number,
    private fonts: FontManager,
    private images: Map<string, Prepared>,
    private warn: (d: Diagnostic) => void,
    private raster: RasterImages,
    private shared: RasterShared,
  ) {
    this.layer = page;
    this.m = [pageScale, 0, 0, pageScale, 0, 0];
  }

  // ───────── 手間の勘定 ─────────

  /** 手間 n を払う。上限を超えたら、ページに 1 度警告を出して false (以後の描画はしない) */
  private spend = (n: number): boolean => {
    const w = this.shared.work;
    if (w.inReserve) {
      if (w.reserveUsed + n > w.reserve) return false;
      w.reserveUsed += n;
      return true;
    }
    if (w.over) return false;
    w.used += n;
    if (w.used <= w.limit) return true;
    w.over = true;
    if (!this.shared.warned) {
      this.shared.warned = true;
      this.warn(
        diag(
          'png/raster-budget',
          msg(
            `ページを画素にする手間が上限 (${w.limit.toLocaleString('en')} 単位) を超えたので、残りの図形・字・画像を PNG に描きません (描き切れない SVG の画像は仮の枠)`,
            `rasterizing the page took more than the limit (${w.limit.toLocaleString('en')} units), so the remaining shapes, glyphs and images are not drawn in the PNG (SVG images that could not be finished are drawn as placeholder boxes)`,
          ),
        ),
      );
    }
    return false;
  };

  /** 手間を使い切った (仮の枠を描いている間は別) */
  private get over(): boolean {
    return this.shared.work.over && !this.shared.work.inReserve;
  }

  /** 折れ線の輪郭の覆う割合 (coverageOf。範囲の既定は、描く範囲)。手間を払えなければ undefined */
  private cov(polys: number[][], evenOdd: boolean, bounds: IBox = this.bounds()): Cov | undefined {
    if (this.over) return undefined;
    return coverageOf(polys, evenOdd, bounds, this.spend);
  }

  /** 広がる板 l を、矩形 b を覆う大きさにする (広げた分の手間を払えなければ false) */
  private grow(l: Layer, b: IBox): boolean {
    const nb = l.grownBox(b);
    if (!nb) return true;
    if (!this.spend(area(nb))) return false;
    l.resize(nb);
    return true;
  }

  // ───────── 塗りの基本 ─────────

  /** いまの切り抜き (無ければ undefined) */
  private get clip(): Cov | undefined {
    return this.clips[this.clips.length - 1];
  }

  /** 覆う割合 cov の所を、塗り paint で、不透明度 opacity・描画モード blend で塗る (いまの切り抜きの中だけ) */
  private fillCov(cov: Cov | undefined, paint: Paint, opacity = 1, blend: SvgBlend | 'normal' = 'normal') {
    opacity *= this.alpha;
    if (!cov || opacity <= 0) return;
    const L = this.layer;
    const clip = this.clip;
    let b = meet(covBox(cov), L.extent);
    if (clip) b = meet(b, covBox(clip));
    if (empty(b)) return;
    // 手間: 画素ごとに、色の決まった塗りは 1、色を引く塗り (画像・グラデーション・模様) は 4
    if (!this.spend(area(b) * ('solid' in paint ? 1 : 4)) || !this.grow(L, b)) return;
    const d = L.d;
    const solid = 'solid' in paint ? paint.solid : undefined;
    const at = 'at' in paint ? paint.at : undefined;
    for (let y = b.y0; y < b.y1; y++) {
      const ci = (y - cov.y0) * cov.w - cov.x0;
      const ki = clip ? (y - clip.y0) * clip.w - clip.x0 : 0;
      const li = (y - L.y0) * L.w - L.x0;
      for (let x = b.x0; x < b.x1; x++) {
        let a = cov.a[ci + x];
        if (a <= 0) continue;
        if (clip) {
          a *= clip.a[ki + x];
          if (a <= 0) continue;
        }
        const c = solid ?? at!(x + 0.5, y + 0.5);
        if (!c) continue;
        a *= c[3] * opacity;
        if (a <= 0) continue;
        const i = (li + x) * 4;
        if (blend === 'normal') {
          const k = 1 - a;
          d[i] = c[0] * a + d[i] * k;
          d[i + 1] = c[1] * a + d[i + 1] * k;
          d[i + 2] = c[2] * a + d[i + 2] * k;
          d[i + 3] = a + d[i + 3] * k;
        } else compositeOver(d, i, c[0] * a, c[1] * a, c[2] * a, a, blend);
      }
    }
  }

  /**
   * 板 src (乗算済み) を、いまの板に不透明度 opacity・描画モード blend で重ねる。clip を渡せば、重ねるときにその覆う割合を掛ける
   * (渡さなければ、切り抜きは src を描くときに済ませてある)
   */
  private compositeLayer(src: Layer, opacity: number, blend: SvgBlend | 'normal' = 'normal', clip?: Cov) {
    opacity *= this.alpha;
    const L = this.layer;
    let b = meet(layerBox(src), L.extent);
    if (clip) b = meet(b, covBox(clip));
    if (empty(b) || opacity <= 0) return;
    if (!this.spend(area(b)) || !this.grow(L, b)) return;
    for (let y = b.y0; y < b.y1; y++)
      for (let x = b.x0; x < b.x1; x++) {
        const s = ((y - src.y0) * src.w + x - src.x0) * 4;
        const k = clip ? opacity * clip.a[(y - clip.y0) * clip.w + x - clip.x0] : opacity;
        const sa = src.d[s + 3] * k;
        if (sa <= 0) continue;
        compositeOver(L.d, ((y - L.y0) * L.w + x - L.x0) * 4, src.d[s] * k, src.d[s + 1] * k, src.d[s + 2] * k, sa, blend);
      }
  }

  /**
   * draw を新しい板に描き、use にその板を渡す。描く間、いまの板はその板になる。bounds を渡せば、いまの切り抜き (無ければ板) と bounds の重なりの大きさの板。
   * 渡さなければ、その範囲の中で、描いた所の外接矩形だけを持つ広がる板 (空のまま渡すこともある)。
   * 板は、use が終わるまで、描ける範囲の画素の数を同時に持つ板の数に数える。上限 (PNG_LAYER_MAX_PIXELS) を超えるなら、板を作らず、
   * draw も use も呼ばずに false を返す (呼ぶ側が、板を使わずに描くか、描かないかを決める)
   */
  private withLayer(draw: () => void, use: (l: Layer) => void, bounds?: IBox): boolean {
    let b = this.layer.extent;
    if (this.clip) b = meet(b, covBox(this.clip));
    if (bounds) b = meet(b, bounds);
    const px = empty(b) ? 0 : area(b);
    const sh = this.shared;
    if (sh.layerPixels + px > sh.layerLimit) {
      if (!sh.layerWarned) {
        sh.layerWarned = true;
        this.warn(
          diag(
            'png/layer-limit',
            msg(
              `入れ子の不透明度のグループ・マスクが多く、同時に持つ板の画素の数 (切り抜きを含めて) が上限 (${sh.layerLimit.toLocaleString('en')} 画素) を超えるので、深い所の不透明度のグループは中の図形ごとに不透明度を掛けて描き (中の重なりは濃くなる)、マスク・合成は描きません`,
              `nested opacity groups and masks would hold more layer pixels at once (clips included) than the limit (${sh.layerLimit.toLocaleString('en')} pixels), so deeper opacity groups are drawn with the opacity applied to each shape inside (overlaps inside get darker) and masks and compositing are not drawn`,
            ),
          ),
        );
      }
      return false;
    }
    if (bounds && px && !this.spend(px)) b = { x0: 0, y0: 0, x1: 0, y1: 0 };
    sh.layerPixels += px;
    const savedAlpha = this.alpha;
    try {
      const l = bounds ? new Layer(b.x0, b.y0, Math.max(0, b.x1 - b.x0), Math.max(0, b.y1 - b.y0)) : new Layer(0, 0, 0, 0, b);
      const saved = this.layer;
      this.layer = l;
      // 板の中は不透明度を掛けずに描き、板を重ねるときに掛ける
      this.alpha = 1;
      try {
        if (!empty(b)) draw();
      } finally {
        this.layer = saved;
        this.alpha = savedAlpha;
      }
      use(l);
    } finally {
      sh.layerPixels -= px;
    }
    return true;
  }

  /** draw の間だけ、切り抜きを外す (描く板の範囲は、呼ぶ側の withLayer が、いまの切り抜きの範囲にしてある) */
  private unclipped(draw: () => void) {
    const saved = this.clips;
    this.clips = [];
    try {
      draw();
    } finally {
      this.clips = saved;
    }
  }

  /** 不透明度のグループを、板を作らずに描く (中の図形ごとに不透明度 opacity を掛ける) */
  private flat(opacity: number, draw: () => void) {
    const saved = this.alpha;
    this.alpha *= opacity;
    try {
      draw();
    } finally {
      this.alpha = saved;
    }
  }

  /** 描く範囲 (いまの板の描ける範囲と切り抜きの重なり) */
  private bounds(): IBox {
    const b = this.layer.extent;
    return this.clip ? meet(b, covBox(this.clip)) : b;
  }

  /**
   * 切り抜きを積む。積んだ切り抜きの配列は、閉じるまで持つので、板と同じ勘定 (RasterShared.layerPixels。板の 1 画素 16 バイトに対して、
   * 切り抜きの 1 画素は 4 バイトなので 1/4 で数える) に入れる。上限を超えるなら、配列を作らずに、外側の切り抜きのまま (新しい切り抜きが外側を
   * 囲むとき。新しい切り抜きの縁は描き分けない) か、何も描かない切り抜きにして、ページに 1 度警告を出す (png/clip-limit)
   */
  private pushClip(cov: Cov | undefined) {
    const empty0: Cov = { x0: 0, y0: 0, w: 0, h: 0, a: new Float32Array(0), held: 0 };
    let c: Cov = cov ?? empty0;
    const cur = this.clip;
    if (!cur) {
      // いちばん外の切り抜き: coverageOf の作った配列を、そのまま持つ
      const units = Math.ceil(c.a.length / 4);
      c = this.holdClip(units) ? { ...c, held: units } : empty0;
    } else {
      const b = meet(covBox(cur), covBox(c));
      // 切り抜きの重なり: 重なりの画素の数の手間 (払えなければ、何も描かない切り抜き)
      if (empty(b) || !this.spend(area(b))) c = empty0;
      else if (sameBox(b, covBox(cur)) && allOnes(c, b)) {
        // 新しい切り抜きが、いまの切り抜きの範囲で全部 1 (全面の矩形の切り抜きなど): いまの切り抜きの配列を分け合う (配列を作らない)
        c = { ...cur, held: 0 };
      } else {
        const units = Math.ceil(area(b) / 4);
        if (this.holdClip(units)) c = { ...intersectCov(cur, c), held: units };
        else c = contains(covBox(c), covBox(cur)) ? { ...cur, held: 0 } : empty0;
      }
    }
    this.clips.push(c);
  }

  /** 切り抜きの配列 units (板の画素の数に直したもの) を持てるなら数えて true。上限を超えるなら、ページに 1 度警告を出して false */
  private holdClip(units: number): boolean {
    const sh = this.shared;
    if (sh.layerPixels + units <= sh.layerLimit) {
      sh.layerPixels += units;
      return true;
    }
    if (!sh.clipWarned) {
      sh.clipWarned = true;
      this.warn(
        diag(
          'png/clip-limit',
          msg(
            `入れ子の切り抜きが多く、同時に持つ切り抜きと板の大きさが上限 (板の ${sh.layerLimit.toLocaleString('en')} 画素分) を超えるので、深い所の切り抜きは、外側の切り抜きを囲むなら外側の切り抜きのまま描き (縁を描き分けない)、囲まないなら中を描きません`,
            `nested clips would hold more clip and layer memory at once than the limit (${sh.layerLimit.toLocaleString('en')} layer pixels), so a deeper clip that encloses the outer clip is drawn with the outer clip only (its own edge is not applied), and the contents of other deeper clips are not drawn`,
          ),
        ),
      );
    }
    return false;
  }

  /** 切り抜きの並びを、長さ n まで閉じる (閉じた切り抜きの配列を、板と同じ勘定から外す) */
  private closeClips(n: number) {
    for (let i = n; i < this.clips.length; i++) this.shared.layerPixels -= this.clips[i].held ?? 0;
    this.clips.length = n;
  }

  /** draw の間だけ、行列を m · t にする。中で開いた切り抜きは、終わりで閉じる (Canvas の save・restore と同じ) */
  private scoped(t: Matrix | undefined, draw: () => void) {
    const savedM = this.m;
    const n = this.clips.length;
    if (t) this.m = mul(this.m, t);
    try {
      draw();
    } finally {
      this.m = savedM;
      this.closeClips(n);
    }
  }

  // ───────── Painter ─────────

  transform(t: Matrix, draw: () => void) {
    this.scoped(t, draw);
  }

  /** 不透明度の付いた箱: 別の板に描いてから、不透明度を掛けて重ねる (Color 4 §3.3。中の重なりは濃くならない) */
  group(opacity: number, draw: () => void) {
    const inner = () => this.scoped(undefined, draw);
    if (!this.withLayer(inner, (l) => this.compositeLayer(l, opacity))) this.flat(opacity, inner);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.fillPath([{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }], color);
  }

  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity = 1) {
    this.fillCov(this.cov(flattenSegs(path, this.m), !!evenOdd), { solid: rgbaOf(color) }, opacity);
  }

  /**
   * 線 (道 segs を行列 m で画素にし、画素の太さ widthPx) が、描く範囲に掛からないか。道の点 (曲線は制御点。曲線は制御点の凸包の中にある) の
   * 外接矩形を、線の届く長さ (太さの半分に、とがったつなぎの比の上限か、四角の端の √2 の大きい方を掛けたもの) だけ広げて比べる。
   * 掛からない線は、輪郭を作らない (ページの外の細かい破線の輪郭を作る手間は、塗る画素の勘定に入らないので)
   */
  private strokeOutside(segs: readonly PathSeg[], m: Matrix, widthPx: number, cap: number, join: number, miter: number): boolean {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (x: number, y: number) => {
      const [px, py] = apply(m, x, y);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    };
    for (const g of segs) {
      if (g.op === 'Z') continue;
      if (g.op === 'C') {
        add(g.x1, g.y1);
        add(g.x2, g.y2);
      }
      add(g.x, g.y);
    }
    if (!(x1 >= x0 && y1 >= y0)) return true;
    const reach = (widthPx / 2) * Math.max(join === 0 ? miter : 1, cap === 2 ? Math.SQRT2 : 1, 1) + 1;
    return empty(meet({ x0: Math.floor(x0 - reach), y0: Math.floor(y0 - reach), x1: Math.ceil(x1 + reach), y1: Math.ceil(y1 + reach) }, this.bounds()));
  }

  /** 線を、太さ width の輪郭にして塗る (端は切り落とし・つなぎはとがり: Canvas の既定と同じ) */
  private stroke(path: PathSeg[], width: number, color: string, dash?: number[], cap = 0, join = 0) {
    if (!(width > 0) || this.over || this.strokeOutside(path, this.m, width * scaleOf(this.m), cap, join, 10)) return;
    const outline = strokeOutline(path, IDENTITY, width, cap, join, { array: dash ?? [], offset: 0 }, 10);
    this.fillCov(this.cov(flattenSegs(outline, this.m), false), { solid: rgbaOf(color) });
  }

  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]) {
    this.stroke(path, width, color, dash);
  }

  strokeLine(l: Line, width: number, color = '#000') {
    this.stroke([{ op: 'M', x: l.x1, y: l.y1 }, { op: 'L', x: l.x2, y: l.y2 }], width, color);
  }

  clipRect(r: Rect) {
    this.clipPath([{ op: 'M', x: r.x, y: r.y }, { op: 'L', x: r.x + r.width, y: r.y }, { op: 'L', x: r.x + r.width, y: r.y + r.height }, { op: 'L', x: r.x, y: r.y + r.height }, { op: 'Z' }]);
  }

  clipPath(path: PathSeg[], evenOdd?: boolean) {
    this.pushClip(this.cov(flattenSegs(path, this.m), !!evenOdd, layerBox(this.page)));
  }

  restore() {
    this.closeClips(Math.max(0, this.clips.length - 1));
  }

  // ───────── 字 ─────────

  private glyphCommands(f: ReturnType<FontManager['get']>, id: number): GlyphCommand[] {
    const key = `${f.key}\u0000${id}`;
    let cmds = this.glyphPaths.get(key);
    if (!cmds) {
      try {
        cmds = (f.fk as unknown as { getGlyph(id: number): { path: { commands: GlyphCommand[] } } }).getGlyph(id).path.commands;
      } catch {
        // 字形のデータが壊れている書体 (fontkit が読めない字) は、その字を描かずに続ける (PDF・Canvas と同じ)
        cmds = [];
      }
      this.glyphPaths.set(key, cmds);
    }
    return cmds;
  }

  /** 字形の道の命令を、行列 m で画素の座標の折れ線にして polys に足す。segs が渡されたら、3 次ベジェの輪郭 (書体の単位) も足す */
  private glyphPolys(cmds: GlyphCommand[], m: Matrix, polys: number[][], segs?: PathSeg[]) {
    let cur: number[] | undefined;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let ux = 0;
    let uy = 0;
    for (const c of cmds) {
      const a = c.args;
      if (c.command === 'moveTo') {
        if (cur && cur.length >= 4) polys.push(cur);
        [cx, cy] = apply(m, a[0], a[1]);
        [sx, sy] = [cx, cy];
        cur = [cx, cy];
        segs?.push({ op: 'M', x: a[0], y: a[1] });
        [ux, uy] = [a[0], a[1]];
      } else if (c.command === 'lineTo') {
        [cx, cy] = apply(m, a[0], a[1]);
        cur?.push(cx, cy);
        segs?.push({ op: 'L', x: a[0], y: a[1] });
        [ux, uy] = [a[0], a[1]];
      } else if (c.command === 'quadraticCurveTo') {
        const [x1, y1] = apply(m, a[0], a[1]);
        const [x2, y2] = apply(m, a[2], a[3]);
        quadTo(cur, cx, cy, x1, y1, x2, y2);
        [cx, cy] = [x2, y2];
        // 2 次ベジェ → 3 次ベジェ (制御点を 2/3 の所に)
        segs?.push({ op: 'C', x1: ux + ((a[0] - ux) * 2) / 3, y1: uy + ((a[1] - uy) * 2) / 3, x2: a[2] + ((a[0] - a[2]) * 2) / 3, y2: a[3] + ((a[1] - a[3]) * 2) / 3, x: a[2], y: a[3] });
        [ux, uy] = [a[2], a[3]];
      } else if (c.command === 'bezierCurveTo') {
        const [x1, y1] = apply(m, a[0], a[1]);
        const [x2, y2] = apply(m, a[2], a[3]);
        const [x3, y3] = apply(m, a[4], a[5]);
        cubicTo(cur, cx, cy, x1, y1, x2, y2, x3, y3);
        [cx, cy] = [x3, y3];
        segs?.push({ op: 'C', x1: a[0], y1: a[1], x2: a[2], y2: a[3], x: a[4], y: a[5] });
        [ux, uy] = [a[4], a[5]];
      } else if (c.command === 'closePath') {
        cur?.push(sx, sy);
        [cx, cy] = [sx, sy];
        segs?.push({ op: 'Z' });
      }
    }
    if (cur && cur.length >= 4) polys.push(cur);
  }

  drawGlyph(g: GlyphArea, x: number, y: number) {
    if (this.over) return;
    const f = this.fonts.get(g.fontFamily, g.fontWeight);
    // 字の描く原点 (基線の左端) への変換: 位置 → 回転 → 横の伸縮 → 疑似斜体 (Canvas の drawGlyph と同じ順)
    let m = mul(this.m, [1, 0, 0, 1, x + g.baselineX, y + g.baselineY]);
    if (g.rotation) {
      const r = (g.rotation * Math.PI) / 180;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    }
    if (g.scaleX !== 1) m = mul(m, [g.scaleX, 0, 0, 1, 0, 0]);
    if (g.italic) m = mul(m, [1, 0, -ITALIC_SLANT, 1, 0, 0]);
    const cf = colorFontOf(f);
    if (cf) return this.drawColorGlyph(g, f, cf, m);
    const k = g.fontSize / f.unitsPerEm;
    const polys: number[][] = [];
    const bold: number[][] = [];
    for (const gl of areaGlyphs(g, f)) {
      const gm = mul(m, [k, 0, 0, -k, gl.u * k, -gl.v * k]);
      const segs: PathSeg[] | undefined = g.fakeBold ? [] : undefined;
      this.glyphPolys(this.glyphCommands(f, gl.id), gm, polys, segs);
      // 疑似太字: 輪郭を、字の大きさの FAKE_BOLD 倍の太さでなぞる (Canvas・PDF と同じ)
      if (segs?.length) flattenSegs(strokeOutline(segs, IDENTITY, FAKE_BOLD * f.unitsPerEm, 0, 0, { array: [], offset: 0 }, 10), gm, bold);
    }
    const paint = { solid: rgbaOf(g.color) };
    this.fillCov(this.cov(polys, false), paint);
    if (bold.length) this.fillCov(this.cov(bold, false), paint);
  }

  /** 色つきの字形 (colorGlyphCanvas.ts の drawColorGlyphArea と同じ命令の並び)。m は字の描く原点の座標 → 画素の座標 */
  private drawColorGlyph(g: GlyphArea, f: ReturnType<FontManager['get']>, cf: NonNullable<ReturnType<typeof colorFontOf>>, m: Matrix) {
    ensureSvgGlyphReader(cf, this.shared.parseXml);
    const k = g.fontSize / cf.unitsPerEm;
    const fgc = rgbaOf(g.color);
    const fg: Rgb = [fgc[0], fgc[1], fgc[2]];
    for (const gl of areaGlyphs(g, f)) {
      const gm = mul(m, [k, 0, 0, -k, gl.u * k, -gl.v * k]);
      const glyph = cf.glyph(gl.id, g.fontPalette);
      if (!glyph) {
        const outline = cf.outline(gl.id);
        if (outline.length) this.fillCov(this.cov(flattenSegs(outline, gm), false), { solid: fgc });
        continue;
      }
      const b = glyph.bbox;
      const n = this.clips.length;
      try {
        if (glyph.clip) this.pushClip(this.cov(flattenSegs(boxSegs(b[0], b[1], b[2], b[3]), gm), false));
        const e = Math.max(b[2] - b[0], b[3] - b[1], 1) * 0.01 + 1;
        this.colorOps(glyph.ops, gm, fg, fgc[3], [b[0] - e, b[1] - e, b[2] + e, b[3] + e]);
      } finally {
        this.closeClips(n);
      }
    }
  }

  /** 色つきの字形の塗り → Sampler (m は書体の単位 → 画素の座標) */
  private colorPaint(fill: ColorFill, m: Matrix, fg: Rgb, fgAlpha: number): Paint | undefined {
    if (fill.kind === 'solid') {
      const rgb = fill.color.rgb ?? fg;
      return { solid: [rgb[0], rgb[1], rgb[2], fill.color.a * (fill.color.rgb ? 1 : fgAlpha)] };
    }
    const inv = invert(m);
    if (!inv) return undefined;
    if (fill.kind === 'sweep') {
      const s = sweepSampler(fill, fg);
      if (!s) return undefined;
      return {
        at: (x, y) => {
          const [u, v] = apply(inv, x, y);
          let deg = (Math.atan2(v - fill.cy, u - fill.cx) * 180) / Math.PI;
          if (deg < 0) deg += 360;
          const c = s.sample(deg, 1);
          return [c.rgb[0], c.rgb[1], c.rgb[2], c.a];
        },
      };
    }
    const stops = plainStops(fill.stops, fg);
    if (!stops.length) return undefined;
    const out = [0, 0, 0, 0];
    // 止まり点の外の延ばし方 (COLR の Extend: pad・repeat・reflect。SVG 1.1 §13.2.2 の spreadMethod と同じ)
    const extend = (t: number) => (fill.extend === 1 ? t - Math.floor(t) : fill.extend === 2 ? 1 - Math.abs((((t % 2) + 2) % 2) - 1) : Math.min(1, Math.max(0, t)));
    return {
      at: (x, y) => {
        const [u, v] = apply(inv, x, y);
        let t: number | undefined;
        if (fill.kind === 'linear') {
          const dx = fill.x1 - fill.x0;
          const dy = fill.y1 - fill.y0;
          const l2 = dx * dx + dy * dy;
          t = l2 > 0 ? ((u - fill.x0) * dx + (v - fill.y0) * dy) / l2 : 1;
        } else t = radialT(fill.x0, fill.y0, fill.r0, fill.x1, fill.y1, fill.r1, u, v);
        if (t === undefined) return undefined;
        t = extend(t);
        let i = 0;
        while (i < stops.length - 1 && stops[i + 1].offset < t) i++;
        const p = stops[i];
        const q = stops[Math.min(i + 1, stops.length - 1)];
        const r = q.offset > p.offset ? Math.min(1, Math.max(0, (t - p.offset) / (q.offset - p.offset))) : 0;
        for (let c = 0; c < 3; c++) out[c] = p.rgb[c] + (q.rgb[c] - p.rgb[c]) * r;
        out[3] = p.a + (q.a - p.a) * r;
        return out;
      },
    };
  }

  /** 色つきの字形の描画の命令を描く (m は書体の単位 → 画素の座標)。box は、いまの切り抜きの中の全体を塗るときの範囲 */
  private colorOps(ops: readonly ColorOp[], m: Matrix, fg: Rgb, fgAlpha: number, box: [number, number, number, number]) {
    for (const o of ops) {
      if (o.op === 'fill' || o.op === 'paint') {
        const p = this.colorPaint(o.fill, m, fg, fgAlpha);
        const segs = o.op === 'fill' ? o.path : boxSegs(box[0], box[1], box[2], box[3]);
        if (p) this.fillCov(this.cov(flattenSegs(segs, m), o.op === 'fill' && !!o.evenOdd), p);
      } else if (o.op === 'stroke') {
        const p = this.colorPaint(o.fill, m, fg, fgAlpha);
        const outline = strokeOutline(o.path, IDENTITY, o.width, o.cap, o.join, { array: o.dash ?? [], offset: o.dashOffset ?? 0 }, o.miter);
        if (p) this.fillCov(this.cov(flattenSegs(outline, m), false), p);
      } else if (o.op === 'clip') {
        const n = this.clips.length;
        this.pushClip(this.cov(flattenSegs(o.path, m), !!o.evenOdd));
        try {
          this.colorOps(o.ops, m, fg, fgAlpha, box);
        } finally {
          this.closeClips(n);
        }
      } else if (o.op === 'transform') {
        this.colorOps(o.ops, mul(m, o.m), fg, fgAlpha, box);
      } else if (o.op === 'composite') {
        // 下 (backdrop) と上 (source) を別の板に描いて、合成の種類で重ねてから、いまの板に置く
        const area = boxOf(flattenSegs(boxSegs(box[0], box[1], box[2], box[3]), m));
        // 板の上限を超えるなら、合成を描かない (withLayer が警告を出す)
        this.withLayer(
          () => this.colorOps(o.backdrop, m, fg, fgAlpha, box),
          (back) =>
            this.withLayer(
              () => this.colorOps(o.source, m, fg, fgAlpha, box),
              (src) => {
                // 手間を払えずに、片方の板を作れなかった (同じ大きさでない) ときは、重ねない
                if (src.w !== back.w || src.h !== back.h) return;
                const pd = PORTER_DUFF[o.mode];
                const blend = BLEND_OF[o.mode];
                for (let i = 0; i < back.d.length; i += 4) {
                  const sa = src.d[i + 3];
                  const ba = back.d[i + 3];
                  if (pd) {
                    const [fa, fb] = pd(sa, ba);
                    for (let c = 0; c < 4; c++) back.d[i + c] = Math.min(1, src.d[i + c] * fa + back.d[i + c] * fb);
                  } else compositeOver(back.d, i, src.d[i], src.d[i + 1], src.d[i + 2], sa, blend ?? 'normal');
                }
                this.compositeLayer(back, 1);
              },
              area,
            ),
          area,
        );
      } else if (o.op === 'image') {
        // 左下 (x, y)・幅 w・高さ h (y 上向き) の矩形。画像の 1 行目が上
        const im = mul(m, [o.w, 0, 0, -o.h, o.x, o.y + o.h]);
        const s = this.cachedSampler(o.data, () => (o.kind === 'png' ? pngImg(o.data) : jpegImg(o.data)), im, false, () => undefined);
        if (s) this.fillCov(this.cov(flattenSegs(boxSegs(0, 0, 1, 1), im), false), { at: s });
      }
    }
  }

  // ───────── 画像 ─────────

  /**
   * 中身 bytes の画像を、置く行列 m で引く Sampler (画素に戻した画像と縮めたものは、ページをまたいで覚える: RasterImages)。
   * 戻せなければ onFail を呼んで undefined。このページで戻す画素の上限を超えたら、警告を出して undefined
   */
  private cachedSampler(bytes: Uint8Array, decode: () => Img | undefined, m: Matrix, tile: boolean, onFail: () => void, src?: string): Sampler | undefined {
    const img = this.raster.get(bytes, decode, (w, h) => reductionOf(w, h, m));
    if (img === null) {
      onFail();
      return undefined;
    }
    if (img === 'limit') {
      const name = src ? (src.startsWith('data:') ? src.slice(0, 40) + '…' : src) : '';
      if (!this.warned.has(`limit\u0000${name}`)) {
        this.warned.add(`limit\u0000${name}`);
        this.warn(
          diag(
            'png/image-limit',
            msg(
              `1 ページで画素に戻す画像が多すぎるので (合わせて ${PNG_PAGE_DECODE_PIXELS.toLocaleString('en')} 画素まで)、画像${name ? ` ${name}` : ''}を PNG に描きません`,
              `too many image pixels to decode on one page (up to ${PNG_PAGE_DECODE_PIXELS.toLocaleString('en')} pixels in total), so image${name ? ` ${name}` : ''} is not drawn in the PNG`,
            ),
            name ? { src: name } : {},
          ),
        );
      }
      return undefined;
    }
    return pixelSampler(img, m, tile);
  }

  /** ページの画素の画像 (prepareImages の 'raster') の Sampler。戻せなければ、ページに 1 度、警告を出す */
  private assetSampler(p: Extract<Prepared, { kind: 'raster' }>, m: Matrix, tile = false): Sampler | undefined {
    return this.cachedSampler(
      p.bytes,
      () => decodeAsset(p.mime, p.bytes),
      m,
      tile,
      () => {
        if (this.warned.has(p.src)) return;
        this.warned.add(p.src);
        const name = p.src.startsWith('data:') ? p.src.slice(0, 40) + '…' : p.src;
        this.warn(diag('png/image-not-drawn', msg(`画像 ${name} を画素に戻せないので、PNG に描きません (CMYK の JPEG・インターレースの PNG など)`, `image ${name} cannot be decoded to pixels and is not drawn in the PNG (CMYK JPEG, interlaced PNG, etc.)`), { src: name }));
      },
      p.src,
    );
  }

  /** 背景画像の繰り返し: タイルを繰り返して region を塗る (1 枚ずつ並べると、継ぎ目に縁の塗りの筋が出る) */
  drawImageTiled(a: ImageArea, x: number, y: number, region: Rect): boolean {
    const p = this.images.get(imageKey(a.src, ''));
    if (!p || p.kind !== 'raster' || !(a.width > 0 && a.height > 0)) return false;
    if (this.over) return true;
    const s = this.assetSampler(p, mul(this.m, [a.width, 0, 0, a.height, x, y]), true);
    if (s) this.fillCov(this.cov(flattenSegs(boxSegs(region.x, region.y, region.x + region.width, region.y + region.height), this.m), false), { at: s });
    return true;
  }

  drawImage(a: ImageArea, x: number, y: number) {
    const p = this.images.get(imageKey(a.src, a.language ?? '')) ?? this.images.get(imageKey(a.src, ''));
    if (!p) return;
    if (p.kind === 'raster') {
      if (this.over) return;
      // 領域の大きさに引き伸ばす (組版が、置く大きさを決めてある。Canvas の drawImage と同じ)
      const im = mul(this.m, [a.width, 0, 0, a.height, x, y]);
      const s = this.assetSampler(p, im);
      if (s) this.fillCov(this.cov(flattenSegs(boxSegs(0, 0, 1, 1), im), false), { at: s });
      return;
    }
    // SVG の画像: viewBox と preserveAspectRatio で置き (SVG 2 §8.2。svgRenderer.ts・canvasRenderer.ts と同じ)、画像の領域で切り抜く
    const doc = p.doc;
    const [vx, vy, vw, vh] = doc.viewBox;
    let sx = a.width / vw;
    let sy = a.height / vh;
    let ox = 0;
    let oy = 0;
    const align = a.stretch ? 'none' : (doc.aspect?.align ?? 'xMidYMid');
    if (align !== 'none' && Math.abs(sx - sy) > 1e-9) {
      const s = doc.aspect?.slice ? Math.max(sx, sy) : Math.min(sx, sy);
      ox = (a.width - vw * s) * (/xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0);
      oy = (a.height - vh * s) * (/YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0);
      sx = sy = s;
    }
    const n = this.clips.length;
    this.clipRect({ x, y, width: a.width, height: a.height });
    try {
      // 線の太さの単位 (ページの CSS px) → 画素: 1px = 0.75pt。ページの倍率だけで、CSS の transform の倍率は掛けない (PDF・SVG の書き出しと同じ)
      this.shapes(doc.shapes, mul(this.m, [sx, 0, 0, sy, x + ox - sx * vx, y + oy - sy * vy]), this.pageScale * 0.75);
    } finally {
      this.closeClips(n);
    }
    // 手間を使い切って描き切れなかった (か、描けなかった) SVG の画像は、仮の枠で描く (手間は、仮の枠の分の別の上限から払う)
    if (this.shared.work.over) {
      this.shared.work.inReserve = true;
      try {
        paintPlaceholder(a, x, y, this);
      } finally {
        this.shared.work.inReserve = false;
      }
    }
  }

  // ───────── SVG の図形 (svg.ts の SvgShape) ─────────

  /** 図形の並びを描く。m は SVG の根の座標 → 画素の座標、pxScale はページの CSS px → 画素 (vector-effect="non-scaling-stroke" の線の太さ) */
  private shapes(shapes: readonly SvgShape[], m: Matrix, pxScale: number) {
    const inv = invert(m);
    if (!inv) return;
    // ページの上の 1 CSS px にあたる SVG の根の座標の長さ (拡大しない大きさ。vector-effect="non-scaling-size")
    const perPx = pxScale / (Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1);
    for (let sh of shapes) {
      // 拡大しない大きさの図形は、PDF と同じく、原点の周りに縮めた、ふつうの図形にする (svg.ts の resolveNonScaling。拡大しない線も一緒に)
      if (sh.nonScalingAnchor) sh = resolveNonScaling(sh, perPx);
      // 手間を使い切ったら、残りの図形は描かない (輪郭を折れ線にする手間も掛けない)
      if (this.over) return;
      const n = this.clips.length;
      try {
        for (const c of sh.clips ?? []) this.pushClip(this.cov(flattenSegs(c.segs, m), c.evenOdd));
        let masked = true;
        for (const mk of sh.masks ?? []) {
          // マスク: 中身を別の板に描き、輝度 (sRGB の値に線形の係数を掛ける。CSS Masking 1 §7.1) か不透明度 (mask-type: alpha) を、覆う割合にする。
          // 板の上限を超えるなら、マスクを掛けた図形を描かない (withLayer が警告を出す)。マスクの中身は、いまの切り抜き (外側のマスクを含む) を
          // 掛けずに描く (掛けると、覆う割合を重ねる pushClip で、外側のマスクが 2 度掛かる)
          masked &&= this.withLayer(
            () => this.unclipped(() => this.shapes(mk.shapes, m, pxScale)),
            (l) => {
              const a = new Float32Array(l.w * l.h);
              for (let i = 0; i < a.length; i++) a[i] = mk.alpha ? l.d[i * 4 + 3] : 0.2125 * l.d[i * 4] + 0.7154 * l.d[i * 4 + 1] + 0.0721 * l.d[i * 4 + 2];
              this.pushClip({ x0: l.x0, y0: l.y0, w: l.w, h: l.h, a });
            },
          );
        }
        if (!masked) continue;
        const blend = sh.blend ?? 'normal';
        if (sh.group) {
          // 透明のグループ (Compositing and Blending 1 §3.3): 中を重ねてから、不透明度と描画モードで置く
          // グループの切り抜き・マスク (いまの切り抜き) は、中を重ねた板に、重ねるときに 1 度だけ掛ける (中の図形ごとに掛けると、
          // マスクの薄い所で、重なった図形の下の色が透ける)。板の大きさは、いまの切り抜きの範囲まで (withLayer)。
          // 板の上限を超えるなら、板を作らずに中の図形ごとに不透明度・切り抜きを掛けて描く (描画モードは中の図形のもの)
          const group = sh.group;
          const clip = this.clip;
          const inner = () => this.shapes(group.shapes, m, pxScale);
          if (!this.withLayer(() => this.unclipped(inner), (l) => this.compositeLayer(l, sh.fillOpacity, blend, clip))) this.flat(sh.fillOpacity, inner);
          continue;
        }
        if (sh.image) {
          // matrix は、画像の単位正方形 (左下が原点、上の辺が 1 行目) → 根の座標。左上が原点の単位正方形に直す
          const [a, b, c, d, e, f] = sh.image.matrix;
          const im = mul(m, [a, b, -c, -d, c + e, d + f]);
          const s = this.shapeSampler(sh.image, im);
          if (s) this.fillCov(this.cov(flattenSegs(boxSegs(0, 0, 1, 1), im), false), { at: s }, sh.fillOpacity, blend);
          continue;
        }
        if (sh.fill !== undefined || sh.fillPaint || sh.fillPattern) {
          const p = this.shapePaint(sh.fill, sh.fillPaint, sh.fillPattern, inv, m);
          if (p) this.fillCov(this.cov(flattenSegs(sh.segs, m), sh.evenOdd), p, sh.fillOpacity, blend);
        }
        if ((sh.stroke !== undefined || sh.strokePaint) && sh.strokeWidth > 0 && !this.strokeOutside(sh.segs, m, sh.nonScalingStroke ? sh.strokeWidth * pxScale : sh.strokeWidth * scaleOf(m), sh.lineCap, sh.lineJoin, sh.miterLimit ?? 4)) {
          const p = this.shapePaint(sh.stroke, sh.strokePaint, undefined, inv, m);
          const dash = { array: sh.dash ?? [], offset: sh.dashOffset ?? 0 };
          // 線の太さがページの上の太さの線は、画素の座標で輪郭にする
          const polys = sh.nonScalingStroke
            ? flattenSegs(strokeOutline(transformSegsTo(sh.segs, m), IDENTITY, sh.strokeWidth * pxScale, sh.lineCap, sh.lineJoin, { array: dash.array.map((v) => v * pxScale), offset: dash.offset * pxScale }, sh.miterLimit ?? 4), IDENTITY)
            : flattenSegs(strokeOutline(sh.segs, IDENTITY, sh.strokeWidth, sh.lineCap, sh.lineJoin, dash, sh.miterLimit ?? 4), m);
          if (p) this.fillCov(this.cov(polys, false), p, sh.strokeOpacity, blend);
        }
      } finally {
        this.closeClips(n);
      }
    }
  }

  /** 図形の塗り (色・グラデーション・模様)。inv は画素の座標 → 根の座標 */
  private shapePaint(color: string | undefined, grad: SvgGradient | undefined, pattern: SvgPattern | undefined, inv: Matrix, m: Matrix): Paint | undefined {
    if (grad) {
      const ginv = invert(grad.matrix);
      if (!ginv) return undefined;
      const stopRgb = grad.stops.map((s) => rgbOfCss(s.color));
      return {
        at: (x, y) => {
          const [rx, ry] = apply(inv, x, y);
          return gradientAt(grad, ginv, rx, ry, rgbOfCss, stopRgb);
        },
      };
    }
    if (pattern) {
      // 模様のタイルを、画素の大きさに合わせて画素にし、タイルの座標で繰り返して引く
      const pm = mul(m, pattern.matrix);
      const scale = Math.sqrt(Math.abs(pm[0] * pm[3] - pm[1] * pm[2]));
      const tw = Math.max(1, Math.min(2048, Math.ceil(pattern.width * scale)));
      const th = Math.max(1, Math.min(2048, Math.ceil(pattern.height * scale)));
      // 同じ模様・同じ大きさのタイルは、1 ページの中で 1 度だけ描く (模様の中の模様も。前は、模様で塗る図形ごとに描き直していた)
      const key = `${this.shared.keys.key(pattern)}:${tw}x${th}`;
      let img = this.shared.tiles.get(key);
      if (!img) {
        if (!this.spend(tw * th)) return undefined;
        const tile = new RasterPainter(new Layer(0, 0, tw, th), 1, this.fonts, this.images, this.warn, this.raster, this.shared);
        tile.shapes(pattern.shapes, [tw / pattern.width, 0, 0, th / pattern.height, 0, 0], 1);
        img = { w: tw, h: th, rgba: toRgba8(tile.page) };
        // 手間を使い切って描き切れなかったタイルは、覚えない
        if (!this.shared.work.over) {
          const sh = this.shared;
          sh.tiles.set(key, img);
          sh.tilePixels += tw * th;
          // 覚えの上限: 使った順の古いものから手放す (違う模様の多い SVG で、タイルを溜め続けない)
          for (const [k, t] of sh.tiles) {
            if (sh.tilePixels <= PNG_TILE_CACHE_PIXELS || k === key) break;
            sh.tiles.delete(k);
            sh.tilePixels -= t.w * t.h;
          }
        }
      } else {
        // 使った順にする
        this.shared.tiles.delete(key);
        this.shared.tiles.set(key, img);
      }
      const s = imageSampler(img, mul(pm, [pattern.width, 0, 0, pattern.height, 0, 0]), true);
      return s ? { at: s } : undefined;
    }
    return color !== undefined ? { solid: rgbaOf(color) } : undefined;
  }

  /** SVG の中の画像の Sampler (画素で計算した filter の画像は、その画素。ほかは、覚えを通して戻す: cachedSampler) */
  private shapeSampler(image: NonNullable<SvgShape['image']>, m: Matrix): Sampler | undefined {
    if (image.pixels) {
      let img = this.decoded.get(image.pixels);
      if (!img) this.decoded.set(image.pixels, (img = { w: image.pixels.width, h: image.pixels.height, rgba: image.pixels.rgba }));
      return imageSampler(img, m);
    }
    return this.cachedSampler(
      image.bytes,
      () => {
        const px = decodeShapeImage(image);
        return px ? { w: px.w, h: px.h, rgba: px.rgba } : undefined;
      },
      m,
      false,
      () => {
        if (this.warned.has('\u0000svg')) return;
        this.warned.add('\u0000svg');
        this.warn(diag('png/image-not-drawn', msg('SVG の中の画像のうち、画素に戻せないもの (CMYK の JPEG・インターレースの PNG など) は描きません', 'images inside SVG that cannot be decoded to pixels (CMYK JPEG, interlaced PNG, etc.) are not drawn')));
      },
    );
  }
}

const boxSegs = (x0: number, y0: number, x1: number, y1: number): PathSeg[] => [
  { op: 'M', x: x0, y: y0 },
  { op: 'L', x: x1, y: y0 },
  { op: 'L', x: x1, y: y1 },
  { op: 'L', x: x0, y: y1 },
  { op: 'Z' },
];

/** 行列 m で長さが伸びる比の上限 (2 つの列の長さの和。線の太さの見積もり。小さく見積もらない) */
function scaleOf(m: Matrix): number {
  return Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3]);
}

/** 折れ線の外接矩形 (整数) */
function boxOf(polys: number[][]): IBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]);
      y1 = Math.max(y1, p[i + 1]);
    }
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1) + 1, y1: Math.ceil(y1) + 1 };
}

/** 図形の輪郭を行列 m で写す */
function transformSegsTo(segs: readonly PathSeg[], m: Matrix): PathSeg[] {
  return segs.map((g) => {
    if (g.op === 'M' || g.op === 'L') {
      const [x, y] = apply(m, g.x, g.y);
      return { op: g.op, x, y };
    }
    if (g.op === 'C') {
      const [x1, y1] = apply(m, g.x1, g.y1);
      const [x2, y2] = apply(m, g.x2, g.y2);
      const [x, y] = apply(m, g.x, g.y);
      return { op: 'C', x1, y1, x2, y2, x, y };
    }
    return g;
  });
}

/** 板 (乗算済みの浮動小数) → RGBA 8 ビット (乗算しない) */
function toRgba8(l: Layer): Uint8Array {
  const out = new Uint8Array(l.w * l.h * 4);
  const d = l.d;
  for (let i = 0; i < out.length; i += 4) {
    const a = d[i + 3];
    if (a <= 0) continue;
    out[i] = Math.round(Math.min(1, d[i] / a) * 255);
    out[i + 1] = Math.round(Math.min(1, d[i + 1] / a) * 255);
    out[i + 2] = Math.round(Math.min(1, d[i + 2] / a) * 255);
    out[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  return out;
}

function pngImg(bytes: Uint8Array): Img | undefined {
  const p = decodePng(bytes);
  return p ? { w: p.width, h: p.height, rgba: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) } : undefined;
}

function jpegImg(bytes: Uint8Array): Img | undefined {
  const j = decodeJpeg(bytes);
  if (!j) return undefined;
  const rgba = new Uint8Array(j.width * j.height * 4);
  for (let i = 0; i < j.width * j.height; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = j.components === 1 ? j.data[i] : j.data[i * 3 + k];
    rgba[i * 4 + 3] = 255;
  }
  return { w: j.width, h: j.height, rgba };
}

const pixelsImg = (p: Pixels | undefined): Img | undefined => (p ? { w: p.width, h: p.height, rgba: p.rgba } : undefined);

/** 画素の画像 (mime の種類) を、画素に戻す。戻せなければ undefined */
function decodeAsset(mime: string, bytes: Uint8Array): Img | undefined {
  return mime === 'image/png'
    ? pngImg(bytes)
    : mime === 'image/jpeg'
      ? jpegImg(bytes)
      : mime === 'image/gif'
        ? pixelsImg(decodeGif(bytes))
        : mime === 'image/bmp'
          ? pixelsImg(decodeBmp(bytes))
          : mime === 'image/webp'
            ? pixelsImg(decodeWebp(bytes))
            : undefined;
}

/**
 * ページの画像を表にしておく (SVG の画像は図形にする。非同期: SVG の @font-face の書体の読み込み)。画素の画像は、描くときに画素に戻す
 * (RasterImages。戻せない画像は、そのときに警告に出す)
 */
async function prepareImages(sheet: SheetArea, fonts: FontManager, opts: PngRenderOptions): Promise<Map<string, Prepared>> {
  const images = new Map<string, Prepared>();
  const assets = opts.assets;
  for (const [src, langs] of pageImages(sheet)) {
    const asset = assets?.get(src);
    if (!asset?.bytes || asset.drawable === false) continue;
    const bytes = asset.bytes;
    if (asset.mime === 'image/svg+xml') {
      if (!opts.parseXml) continue;
      const text = new TextDecoder().decode(bytes);
      await registerSvgFonts(fonts, text);
      for (const lang of langs) {
        const doc = svgImageDoc(src, text, lang, fonts, assets, opts.parseXml);
        if (doc) images.set(imageKey(src, lang), { kind: 'svg', doc });
      }
      continue;
    }
    images.set(imageKey(src, ''), { kind: 'raster', src, mime: asset.mime, bytes });
  }
  return images;
}

/** ページを画素にした大きさ (画素)。dpi は 1 インチ (72pt) あたりの画素の数 */
export function pngSize(sheet: SheetArea, dpi: number): { width: number; height: number } {
  return { width: Math.max(1, Math.ceil((sheet.width * dpi) / 72 - 1e-6)), height: Math.max(1, Math.ceil((sheet.height * dpi) / 72 - 1e-6)) };
}

/** ページ (SheetArea) を画素 (RGBA 8 ビット。紙は白) にする */
export async function renderSheetToPixels(sheet: SheetArea, fonts: FontManager, opts: PngRenderOptions = {}): Promise<Pixels> {
  const dpi = opts.dpi ?? 96;
  if (!(dpi > 0) || !Number.isFinite(dpi)) throw new RangeError(msg(`解像度 (dpi) は正の数にしてください: ${dpi}`, `the resolution (dpi) must be a positive number: ${dpi}`));
  const { width, height } = pngSize(sheet, dpi);
  if (width * height > PNG_MAX_PIXELS)
    throw new RangeError(msg(`画像が大きすぎます (${width} × ${height} 画素。${PNG_MAX_PIXELS.toLocaleString('en')} 画素まで)。dpi を下げてください`, `the image is too large (${width} × ${height} pixels; up to ${PNG_MAX_PIXELS.toLocaleString('en')} pixels). Lower the dpi`));
  const warn = opts.warn ?? (() => {});
  const images = await prepareImages(sheet, fonts, opts);
  const page = new Layer(0, 0, width, height);
  // 用紙 (Canvas と同じく白)
  page.d.fill(1);
  // 画素に戻した画像は、画像の置き場ごとに覚える (同じ結果の別のページでも使う)
  let raster = opts.assets ? rasterImagesOf.get(opts.assets) : undefined;
  if (!raster) {
    raster = new RasterImages();
    if (opts.assets) rasterImagesOf.set(opts.assets, raster);
  }
  raster.decoded = 0;
  const pixels = width * height;
  const shared: RasterShared = {
    work: { used: 0, limit: PNG_RASTER_BASE_WORK + PNG_RASTER_WORK_PER_PIXEL * pixels, over: false, inReserve: false, reserveUsed: 0, reserve: PNG_PLACEHOLDER_WORK_PER_PIXEL * pixels },
    tiles: new Map(),
    tilePixels: 0,
    keys: new PatternKeys(),
    warned: false,
    parseXml: opts.parseXml,
    layerPixels: 0,
    layerLimit: Math.min(PNG_LAYER_MAX_PIXELS, Math.max(PNG_LAYER_PIXELS_PER_PAGE * pixels, PNG_LAYER_MIN_PIXELS)),
    layerWarned: false,
    clipWarned: false,
  };
  const painter = new RasterPainter(page, dpi / 72, fonts, images, warn, raster, shared);
  try {
    paintSheet(sheet, painter, { guides: opts.guides });
  } finally {
    // 描き終えたら、覚えを上限まで手放す (1 枚の上限より大きな画像は、ページの間だけ持つ)
    raster.trim();
  }
  return { width, height, rgba: toRgba8(page) };
}

/** ページ (SheetArea) を PNG にする (8 ビットの RGB。紙は白) */
export async function renderSheetToPng(sheet: SheetArea, fonts: FontManager, opts: PngRenderOptions = {}): Promise<Uint8Array> {
  return encodePng(await renderSheetToPixels(sheet, fonts, opts));
}

/**
 * colorGlyphCanvas — 色つきの字形を持つ書体 (colorGlyph.ts) の字を、Canvas 2D に描く。
 *
 * PDF (colorGlyphPdf.ts) と同じ描画の命令の並び (層の塗り・グラデーション・合成・画像) を描くので、画面と PDF で同じ絵になる。
 * 使うのは、ブラウザが自分では色つきに描けないとき:
 *  - 書体をブラウザに登録していない (字を輪郭から描く。公開 API の renderPage)、OpenType の機能を当てた字形
 *  - パレットの指定 (font-palette) がある (Canvas の fillText には、パレットの指定が無い)
 *  - ブラウザが読まない表だけの書体 (SVG の表だけの書体。Chromium は OpenType-SVG を描かない)
 * ほか (書体をブラウザに登録していて、既定のパレットで描く) は、これまでどおり fillText で、ブラウザが色つきに描く。
 * どちらの道でも、字の送りは書体の hmtx (組版が測った値) なので、測った幅と描いた幅は同じ。
 */
import type { FontManager } from './fontManager';
import { toCss, parseColor } from './color';
import { decodeJpeg } from './jpeg';
import { invert } from './matrix';
import { inflateBytes } from './psFilters';
import { areaGlyphs, boxThrough, colorFontOf, COMPOSITE, plainStops, segsBox, sweepSampler, unrollStops, type Box, type ColorFill, type ColorOp, type Rgb } from './colorGlyph';
import { svgGlyphReader } from './colorGlyphSvg';
import type { Seg } from './matrix';
import type { GlyphArea } from './types';

type Ctx = CanvasRenderingContext2D;

/** 合成の種類 → Canvas の globalCompositeOperation (Compositing and Blending Level 1 の名前) */
const OPERATION: Record<number, GlobalCompositeOperation> = {
  [COMPOSITE.SRC_IN]: 'source-in',
  [COMPOSITE.DEST_IN]: 'destination-in',
  [COMPOSITE.SRC_OUT]: 'source-out',
  [COMPOSITE.DEST_OUT]: 'destination-out',
  [COMPOSITE.SRC_ATOP]: 'source-atop',
  [COMPOSITE.DEST_ATOP]: 'destination-atop',
  [COMPOSITE.XOR]: 'xor',
  [COMPOSITE.PLUS]: 'lighter',
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

const rgba = (rgb: Rgb, a: number) => `rgba(${rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255)).join(',')},${Math.min(Math.max(a, 0), 1)})`;

function trace(ctx: Ctx, path: readonly Seg[]) {
  ctx.beginPath();
  for (const g of path) {
    if (g.op === 'M') ctx.moveTo(g.x, g.y);
    else if (g.op === 'L') ctx.lineTo(g.x, g.y);
    else if (g.op === 'C') ctx.bezierCurveTo(g.x1, g.y1, g.x2, g.y2, g.x, g.y);
    else ctx.closePath();
  }
}

/**
 * PNG を画素 (RGBA。8 ビット) にする (同期。Canvas の描画は同期なので、ブラウザの非同期の画像の読み込みを使えない)。
 * PNG (ISO/IEC 15948 = W3C の PNG の仕様) の、インターレースの無い画像だけ (絵文字の書体のビットマップは、どれもインターレース無し)。
 * 読めなければ undefined
 */
export function decodePng(b: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } | undefined {
  try {
    if (b.length < 33 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return undefined;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let width = 0;
    let height = 0;
    let depth = 0;
    let type = 0;
    let palette: Uint8Array | undefined;
    let trns: Uint8Array | undefined;
    const idat: Uint8Array[] = [];
    for (let at = 8; at + 12 <= b.length; ) {
      const len = dv.getUint32(at);
      const tag = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
      const body = b.subarray(at + 8, at + 8 + len);
      if (tag === 'IHDR') {
        width = dv.getUint32(at + 8);
        height = dv.getUint32(at + 12);
        depth = body[8];
        type = body[9];
        if (body[12] !== 0) return undefined;
      } else if (tag === 'PLTE') palette = body;
      else if (tag === 'tRNS') trns = body;
      else if (tag === 'IDAT') idat.push(body);
      else if (tag === 'IEND') break;
      at += 12 + len;
    }
    // 字形の画像は小さい (数百画素角)。大きすぎる画像は読まない
    if (!width || !height || width * height > 1 << 24) return undefined;
    const channels = type === 0 || type === 3 ? 1 : type === 2 ? 3 : type === 4 ? 2 : type === 6 ? 4 : 0;
    if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return undefined;
    const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    idat.reduce((o, c) => (joined.set(c, o), o + c.length), 0);
    const bpp = Math.max(1, (channels * depth) >> 3);
    const stride = Math.ceil((width * channels * depth) / 8);
    const raw = inflateBytes(joined, (stride + 1) * height);
    if (raw.length < (stride + 1) * height) return undefined;
    // 行ごとのフィルタ (0 = なし、1 = 左、2 = 上、3 = 平均、4 = Paeth) を戻す
    const px = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? px[dst + x - bpp] : 0;
        const up = y > 0 ? px[dst + x - stride] : 0;
        const c = x >= bpp && y > 0 ? px[dst + x - stride - bpp] : 0;
        let v = raw[src + x];
        if (f === 1) v += a;
        else if (f === 2) v += up;
        else if (f === 3) v += (a + up) >> 1;
        else if (f === 4) {
          const p = a + up - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        }
        px[dst + x] = v & 255;
      }
    }
    const data = new Uint8ClampedArray(width * height * 4);
    /** 行 y の、x 番目の標本 (画素の成分) の値を 8 ビットにしたもの (パレットの番号は、そのまま) */
    const sampleAt = (y: number, i: number): number => {
      const row = y * stride;
      if (depth === 8) return px[row + i];
      if (depth === 16) return px[row + i * 2];
      const bit = i * depth;
      const v = (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (type === 3) {
          const i = sampleAt(y, x);
          data[o] = palette?.[i * 3] ?? 0;
          data[o + 1] = palette?.[i * 3 + 1] ?? 0;
          data[o + 2] = palette?.[i * 3 + 2] ?? 0;
          data[o + 3] = trns && i < trns.length ? trns[i] : 255;
        } else if (type === 0 || type === 4) {
          const v = sampleAt(y, x * channels);
          data[o] = data[o + 1] = data[o + 2] = v;
          data[o + 3] = type === 4 ? sampleAt(y, x * 2 + 1) : 255;
        } else {
          data[o] = sampleAt(y, x * channels);
          data[o + 1] = sampleAt(y, x * channels + 1);
          data[o + 2] = sampleAt(y, x * channels + 2);
          data[o + 3] = type === 6 ? sampleAt(y, x * 4 + 3) : 255;
        }
      }
    }
    return { width, height, data };
  } catch {
    return undefined;
  }
}

function newCanvas(width: number, height: number): { canvas: CanvasImageSource; ctx: Ctx } | undefined {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d') as unknown as Ctx | null;
    return ctx ? { canvas, ctx } : undefined;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : undefined;
  }
  return undefined;
}

/** 字形の画像 (画像の命令ごとに 1 度だけ画素に戻して、描ける形で覚える)。読めなければ null */
const imageMemo = new WeakMap<object, CanvasImageSource | null>();
function imageOf(o: Extract<ColorOp, { op: 'image' }>): CanvasImageSource | undefined {
  let img = imageMemo.get(o);
  if (img === undefined) {
    img = null;
    let px: { width: number; height: number; data: Uint8ClampedArray } | undefined;
    if (o.kind === 'png') px = decodePng(o.data);
    else {
      const j = decodeJpeg(o.data);
      if (j) {
        const data = new Uint8ClampedArray(j.width * j.height * 4);
        for (let i = 0, n = j.width * j.height; i < n; i++) {
          const k = i * j.components;
          data[i * 4] = j.data[k];
          data[i * 4 + 1] = j.data[j.components >= 3 ? k + 1 : k];
          data[i * 4 + 2] = j.data[j.components >= 3 ? k + 2 : k];
          data[i * 4 + 3] = 255;
        }
        px = { width: j.width, height: j.height, data };
      }
    }
    const c = px && newCanvas(px.width, px.height);
    if (px && c) {
      c.ctx.putImageData(new ImageData(px.data as never, px.width, px.height), 0, 0);
      img = c.canvas;
    }
    imageMemo.set(o, img);
  }
  return img ?? undefined;
}

interface State {
  fg: Rgb;
  fgAlpha: number;
  /** いまの切り抜きの範囲 (いまの座標) */
  box: Box;
}

/** 塗り (べた塗り・グラデーション) を、Canvas の fillStyle にする。描かない塗りは undefined */
function styleOf(ctx: Ctx, fill: ColorFill, st: State): string | CanvasGradient | undefined {
  if (fill.kind === 'solid') {
    const c = fill.color;
    const a = c.rgb ? c.a : c.a * st.fgAlpha;
    return a > 0 ? rgba(c.rgb ?? st.fg, a) : undefined;
  }
  const b = st.box;
  const corners: Array<[number, number]> = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]];
  const add = (g: CanvasGradient, stops: ReturnType<typeof plainStops>) => {
    for (const s of stops) g.addColorStop(Math.min(Math.max(s.offset, 0), 1), rgba(s.rgb, s.a));
    return g;
  };
  if (fill.kind === 'linear') {
    const vx = fill.x1 - fill.x0;
    const vy = fill.y1 - fill.y0;
    const len2 = vx * vx + vy * vy;
    if (!(len2 > 0)) return undefined;
    // 繰り返し・折り返し: 切り抜きの範囲を覆うだけ、色の線を並べる (Canvas のグラデーションには、繰り返しが無い)
    const ts = corners.map(([px, py]) => ((px - fill.x0) * vx + (py - fill.y0) * vy) / len2);
    const { stops, lo, hi } = unrollStops(fill.stops, fill.extend, Math.min(...ts), Math.max(...ts));
    return add(ctx.createLinearGradient(fill.x0 + vx * lo, fill.y0 + vy * lo, fill.x0 + vx * hi, fill.y0 + vy * hi), plainStops(stops, st.fg));
  }
  if (fill.kind === 'radial') {
    const dx = fill.x1 - fill.x0;
    const dy = fill.y1 - fill.y0;
    const dr = fill.r1 - fill.r0;
    let lo = 0;
    let hi = 1;
    let stops = fill.stops;
    if (fill.extend !== 0) {
      const far = Math.max(...corners.map(([px, py]) => Math.hypot(px - fill.x0, py - fill.y0)));
      const step = Math.max(Math.abs(dr), Math.hypot(dx, dy));
      const reach = step > 0 ? (far + fill.r0) / step + 2 : 1;
      // 半径が負になる位置は描かれないので、範囲は、半径が 0 になる位置から
      const tip = dr !== 0 ? -fill.r0 / dr : undefined;
      ({ stops, lo, hi } = unrollStops(fill.stops, fill.extend, tip !== undefined && dr > 0 ? Math.max(-reach, Math.ceil(tip)) : -reach, tip !== undefined && dr < 0 ? Math.min(reach, Math.floor(tip)) : reach));
      if (fill.r0 + dr * lo < 0 || fill.r0 + dr * hi < 0) ({ stops, lo, hi } = { stops: fill.stops, lo: 0, hi: 1 });
    }
    const at = (t: number): [number, number, number] => [fill.x0 + dx * t, fill.y0 + dy * t, Math.max(fill.r0 + dr * t, 0)];
    return add(ctx.createRadialGradient(...at(lo), ...at(hi)), plainStops(stops, st.fg));
  }
  // 掃引: createConicGradient(始まりの角度, 中心)。止まり点の位置 0〜1 が 1 回り。色の段差は、同じ位置の 2 つの止まり点にする
  const sweep = sweepSampler(fill, st.fg);
  if (!sweep || typeof ctx.createConicGradient !== 'function') return undefined;
  const g = ctx.createConicGradient(0, fill.cx, fill.cy);
  for (const deg of sweep.angles) {
    if (deg > 0) {
      const c = sweep.sample(deg, -1);
      g.addColorStop(deg / 360, rgba(c.rgb, c.a));
    }
    if (deg < 360) {
      const c = sweep.sample(deg, 1);
      g.addColorStop(deg / 360, rgba(c.rgb, c.a));
    }
  }
  return g;
}

/** 命令の並びを描く。ctx は字形の座標 (書体の単位・y 上向き) になっていること */
function drawOps(ctx: Ctx, ops: readonly ColorOp[], st: State) {
  for (const o of ops) {
    if (o.op === 'fill') {
      const pb = o.fill.kind === 'solid' ? st.box : segsBox(o.path);
      const style = pb && styleOf(ctx, o.fill, { ...st, box: pb });
      if (!style) continue;
      ctx.fillStyle = style;
      trace(ctx, o.path);
      ctx.fill(o.evenOdd ? 'evenodd' : 'nonzero');
    } else if (o.op === 'clip') {
      const pb = segsBox(o.path);
      if (!pb) continue;
      ctx.save();
      trace(ctx, o.path);
      ctx.clip(o.evenOdd ? 'evenodd' : 'nonzero');
      drawOps(ctx, o.ops, { ...st, box: pb });
      ctx.restore();
    } else if (o.op === 'paint') {
      const style = styleOf(ctx, o.fill, st);
      if (!style) continue;
      const b = st.box;
      ctx.fillStyle = style;
      ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    } else if (o.op === 'transform') {
      const inv = invert(o.m, 1e-12);
      if (!inv) continue;
      ctx.save();
      ctx.transform(...o.m);
      drawOps(ctx, o.ops, { ...st, box: boxThrough(st.box, inv) });
      ctx.restore();
    } else if (o.op === 'composite') drawComposite(ctx, o, st);
    else if (o.op === 'image') {
      const img = imageOf(o);
      if (!img) continue;
      // 画像は上の行が先なので、y 上向きの座標では、上下を返して置く
      ctx.save();
      ctx.transform(1, 0, 0, -1, o.x, o.y + o.h);
      ctx.drawImage(img, 0, 0, o.w, o.h);
      ctx.restore();
    } else if (o.op === 'stroke') {
      const style = styleOf(ctx, o.fill, st);
      if (!style || o.width <= 0) continue;
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = o.width;
      ctx.lineCap = (['butt', 'round', 'square'] as const)[o.cap];
      ctx.lineJoin = (['miter', 'round', 'bevel'] as const)[o.join];
      ctx.miterLimit = o.miter;
      if (o.dash?.length) {
        ctx.setLineDash(o.dash);
        ctx.lineDashOffset = o.dashOffset ?? 0;
      }
      trace(ctx, o.path);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * 合成 (COLR の PaintComposite): backdrop と source を別々の画面に描き、source を backdrop の上に、その種類の
 * globalCompositeOperation で重ねてから、元の画面に描く (COLR の「Format 32: PaintComposite」: conceptually, they are rendered into
 * bitmaps, and the source is composited or blended into the backdrop)
 */
function drawComposite(ctx: Ctx, o: Extract<ColorOp, { op: 'composite' }>, st: State) {
  const m = ctx.getTransform();
  const dev = boxThrough(st.box, [m.a, m.b, m.c, m.d, m.e, m.f]);
  // 画面の外まで広がる範囲は、画面の大きさに収める
  const x0 = Math.max(Math.floor(dev[0]), 0);
  const y0 = Math.max(Math.floor(dev[1]), 0);
  const x1 = Math.min(Math.ceil(dev[2]), ctx.canvas.width);
  const y1 = Math.min(Math.ceil(dev[3]), ctx.canvas.height);
  if (x1 <= x0 || y1 <= y0) return;
  const layer = (ops: readonly ColorOp[]) => {
    const c = newCanvas(x1 - x0, y1 - y0);
    if (!c) return undefined;
    c.ctx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    drawOps(c.ctx, ops, st);
    return c;
  };
  const back = layer(o.backdrop);
  const src = layer(o.source);
  if (!back || !src) {
    // 別の画面を作れない所では、ふつうの重ねで描く
    drawOps(ctx, o.backdrop, st);
    drawOps(ctx, o.source, st);
    return;
  }
  back.ctx.setTransform(1, 0, 0, 1, 0, 0);
  back.ctx.globalCompositeOperation = OPERATION[o.mode] ?? 'source-over';
  back.ctx.drawImage(src.canvas, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(back.canvas, x0, y0);
  ctx.restore();
}

/**
 * 字の領域 g を、色つきの字形として描く。ctx は、字の描く原点 (基線の左端) を原点とし、回転・拡縮・傾きを済ませた座標 (pt。y 下向き)。
 * 描いたら true。この関数が描かない字 (色つきの表の無い書体、ブラウザの fillText に任せる字) は false。
 * outlines は、字を輪郭から描く指定 (書体をブラウザに登録していない・OpenType の機能を当てた字形)
 */
export function drawColorGlyphArea(ctx: Ctx, fonts: FontManager, g: GlyphArea, outlines: boolean): boolean {
  const font = fonts.get(g.fontFamily, g.fontWeight);
  const cf = colorFontOf(font);
  if (!cf) return false;
  // ブラウザが色つきに描ける表 (COLR・CBDT・sbix) を持つ書体を、既定のパレットで描くときは、ブラウザに任せる
  const browser = cf.tables.colr !== undefined || cf.tables.cbdt || cf.tables.sbix;
  if (!outlines && !g.fontPalette && browser) return false;
  if (!cf.svgReader && typeof DOMParser !== 'undefined') cf.svgReader = svgGlyphReader((t) => new DOMParser().parseFromString(t, 'image/svg+xml') as never);
  const glyphs = areaGlyphs(g, font);
  // 色つきの絵の無い字形だけの並びは、ブラウザの fillText に任せる (書体をブラウザに登録しているとき。PDF の側と同じ分け方)
  if (!outlines && glyphs.every((gl) => cf.isPlain(gl.id, g.fontPalette))) return false;
  const k = g.fontSize / cf.unitsPerEm;
  const pc = parseColor(g.color);
  const fg: Rgb = pc.mode === 'rgb' ? [pc.r, pc.g, pc.b] : [(1 - pc.c) * (1 - pc.k), (1 - pc.m) * (1 - pc.k), (1 - pc.y) * (1 - pc.k)];
  for (const gl of glyphs) {
    const glyph = cf.glyph(gl.id, g.fontPalette);
    ctx.save();
    ctx.translate(gl.u * k, -gl.v * k);
    ctx.scale(k, -k);
    if (glyph) {
      const b = glyph.bbox;
      if (glyph.clip) {
        ctx.beginPath();
        ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        ctx.clip();
      }
      const e = Math.max(b[2] - b[0], b[3] - b[1], 1) * 0.01 + 1;
      drawOps(ctx, glyph.ops, { fg, fgAlpha: 1, box: [b[0] - e, b[1] - e, b[2] + e, b[3] + e] });
    } else {
      // 色つきでない字形: 輪郭を文字の色で塗る
      const outline = cf.outline(gl.id);
      if (outline.length) {
        ctx.fillStyle = toCss(g.color);
        trace(ctx, outline);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  return true;
}

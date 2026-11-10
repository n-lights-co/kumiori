/**
 * colorGlyphSvg — OpenType の SVG の表 (https://learn.microsoft.com/typography/opentype/spec/svg) の字形を、色つきの字形の
 * 描画の命令 (colorGlyph.ts の ColorOp) にする。SVG を図形にするのは svg.ts (画像の SVG と同じ読み手)。
 *
 * SVG の表の決まり (同じ章の「Coordinate systems and glyph metrics」・「Glyph Identifiers」・「Color and color palettes」):
 *  - 文書は、そのままの文字列か、gzip で圧縮したもの (先頭が 0x1F 0x8B 0x08)
 *  - 字形 N の絵は、id が「glyphN」の要素。1 つの文書に、複数の字形の要素が入ることがある (ほかの字形の要素は描かない)
 *  - 座標: 利用者座標の 1 単位は書体の 1 単位、原点は字形の原点 (基線の左端)、y は下向き。初めの viewport は全角の枠
 *    (unitsPerEm 角) で、根の viewBox は、その枠に合わせる変換になる。viewport では切り抜かない
 *  - currentColor は文字の色 (前景色)。var(--colorN, 代わりの色) は、CPAL のパレットの N 番の色
 * 図形にできない文書 (svg.ts が扱えない機能: フィルタ・文字など) は undefined (呼び出し側が、輪郭を文字の色で描く)。
 * マスク・模様 (どちらも、SVG の表では対応が任意) を使う図形は描かない。
 */
import type { Matrix } from './matrix';
import { parseColor } from './color';
import { inflateBytes } from './psFilters';
import { parseSvg, type SvgGradient, type SvgShape, type XmlNode } from './svg';
import type { ColorFill, ColorOp, ColorRef, ColorStop, SvgGlyphReader } from './colorGlyph';

/** currentColor (前景色) の目印にする色。根の要素の color に入れておき、図形の色がこれなら前景色とする */
const FOREGROUND = '#fe01fd';

/** gzip (RFC 1952) の中身を取り出す。gzip でなければ、そのまま */
function gunzip(b: Uint8Array): Uint8Array {
  if (b.length < 18 || b[0] !== 0x1f || b[1] !== 0x8b || b[2] !== 8) return b;
  const flags = b[3];
  let at = 10;
  // FEXTRA (長さ 2 バイト + 中身)・FNAME・FCOMMENT (0 で終わる文字列)・FHCRC (2 バイト) を飛ばす
  if (flags & 4) at += 2 + (b[at] | (b[at + 1] << 8));
  if (flags & 8) while (at < b.length && b[at++] !== 0);
  if (flags & 16) while (at < b.length && b[at++] !== 0);
  if (flags & 2) at += 2;
  // 字形の文書は小さい (大きくても数百 KB)。展開の上限を置く
  return inflateBytes(b.subarray(at, b.length - 8), 1 << 24);
}

const hex2 = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0');

function colorRef(css: string | undefined, opacity: number): ColorRef | undefined {
  if (!css) return undefined;
  if (css.toLowerCase() === FOREGROUND) return { rgb: null, a: opacity };
  try {
    const c = parseColor(css);
    const rgb: [number, number, number] = c.mode === 'rgb' ? [c.r, c.g, c.b] : [(1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k)];
    return { rgb, a: opacity };
  } catch {
    return undefined;
  }
}

/** svg.ts のグラデーション → 塗り (グラデーションの座標のまま。呼び出し側が、グラデーションの行列の変換で包む) */
function gradientFill(g: SvgGradient, opacity: number): ColorFill | undefined {
  const stops: ColorStop[] = [];
  for (const s of g.stops) {
    const color = colorRef(s.color, (s.opacity ?? 1) * opacity);
    if (color) stops.push({ offset: Math.min(Math.max(s.offset, 0), 1), color });
  }
  if (!stops.length) return undefined;
  if (stops.length === 1) return { kind: 'solid', color: stops[0].color };
  const c = g.coords;
  if (g.kind === 'linear') return c[0] === c[2] && c[1] === c[3] ? { kind: 'solid', color: stops[stops.length - 1].color } : { kind: 'linear', stops, extend: 0, x0: c[0], y0: c[1], x1: c[2], y1: c[3] };
  return { kind: 'radial', stops, extend: 0, x0: c[0], y0: c[1], r0: c[2], x1: c[3], y1: c[4], r1: c[5] };
}

/** svg.ts の図形 1 つ → 命令の並び (図形にできないものは空) */
function shapeOps(sh: SvgShape): ColorOp[] {
  // マスク・模様は描かない。文字 (text) は、輪郭 (segs) を塗る
  if (sh.masks?.length || sh.fillPattern) return [];
  let ops: ColorOp[] = [];
  if (sh.image) {
    // 画像: 単位正方形 (左下が原点) → ルートの座標の行列で置く
    ops.push({ op: 'transform', m: sh.image.matrix as Matrix, ops: [{ op: 'image', kind: sh.image.kind === 'png' ? 'png' : 'jpg', data: sh.image.bytes, x: 0, y: 0, w: 1, h: 1 }] });
  } else {
    if (sh.fillPaint) {
      const fill = gradientFill(sh.fillPaint, sh.fillOpacity);
      if (fill) ops.push({ op: 'clip', path: sh.segs, evenOdd: sh.evenOdd, ops: [{ op: 'transform', m: sh.fillPaint.matrix as Matrix, ops: [{ op: 'paint', fill }] }] });
    } else {
      const color = colorRef(sh.fill, sh.fillOpacity);
      if (color && color.a > 0) ops.push({ op: 'fill', path: sh.segs, fill: { kind: 'solid', color }, evenOdd: sh.evenOdd });
    }
    if (sh.strokeWidth > 0 && (sh.stroke || sh.strokePaint)) {
      // 線のグラデーションは、最後の止まり点の色で描く
      const last = sh.strokePaint?.stops[sh.strokePaint.stops.length - 1];
      const color = last ? colorRef(last.color, (last.opacity ?? 1) * sh.strokeOpacity) : colorRef(sh.stroke, sh.strokeOpacity);
      if (color && color.a > 0) ops.push({ op: 'stroke', path: sh.segs, fill: { kind: 'solid', color }, width: sh.strokeWidth, cap: sh.lineCap, join: sh.lineJoin, miter: sh.miterLimit ?? 4, ...(sh.dash ? { dash: sh.dash, dashOffset: sh.dashOffset ?? 0 } : {}) });
    }
  }
  // 切り抜き (clip-path)。複数あれば、すべての共通部分
  for (const c of sh.clips ?? []) if (ops.length) ops = [{ op: 'clip', path: c.segs, evenOdd: c.evenOdd, ops }];
  return ops;
}

/**
 * SVG の表の字形の読み手を作る。parseXml は XML を読む関数 (ブラウザの DOMParser、Node では @xmldom/xmldom)。
 * 文書ごとに 1 度だけ読み (複数の字形の入った文書は、字形ごとに読み直す)、結果は ColorFont が字形ごとに覚える
 */
export function svgGlyphReader(parseXml: (xml: string) => XmlNode): SvgGlyphReader {
  return (doc, gid, unitsPerEm, palette) => {
    let text: string;
    try {
      text = new TextDecoder().decode(gunzip(doc));
    } catch {
      return undefined;
    }
    // CPAL のパレットの色: var(--colorN, 代わりの色) を、パレットの N 番の色 (無ければ代わりの色) に置き換える
    text = text.replace(/var\(\s*--color(\d+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, n: string, fallback?: string) => {
      const c = palette[Number(n)];
      return c ? `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}` : (fallback?.trim() ?? 'black');
    });
    const rootTag = /<svg\b[^>]*>/.exec(text);
    if (!rootTag) return undefined;
    // ほかの字形の要素 (id が glyphM で、M がこの字形でないもの) は描かない。根の要素が字形そのもののときは、何もしない
    const own = `glyph${gid}`;
    text = text.replace(/<([A-Za-z][\w:.-]*)\b([^>]*?\bid\s*=\s*["']glyph(\d+)["'][^>]*?)(\/?)>/g, (all, name: string, attrs: string, n: string, close: string) => (`glyph${n}` === own || name === 'svg' ? all : `<${name}${attrs} display="none"${close}>`));
    // 根の要素: viewBox を読んでおき、svg.ts には、利用者座標のまま (viewBox の変換を掛けない) の図形を作らせる。
    // currentColor の目印に、根の color を入れる
    const tag = rootTag[0];
    const vb = /\bviewBox\s*=\s*["']([^"']*)["']/.exec(tag)?.[1].split(/[\s,]+/).filter(Boolean).map(Number);
    const cleaned = tag.replace(/\s(?:viewBox|width|height|color|overflow|clip|preserveAspectRatio)\s*=\s*(?:"[^"]*"|'[^']*')/g, '').replace(/^<svg\b/, `<svg width="${unitsPerEm}" height="${unitsPerEm}" color="${FOREGROUND}"`);
    text = text.replace(tag, cleaned);
    let parsed: ReturnType<typeof parseSvg>;
    try {
      parsed = parseSvg(text, parseXml, { rootOverflowVisible: true });
    } catch {
      return undefined;
    }
    if (!parsed) return undefined;
    const ops = parsed.shapes.flatMap(shapeOps);
    // 利用者座標 → 字形の座標 (y 上向き): viewBox があれば、全角の枠 (unitsPerEm 角) に、縦横比を保って中央に収める変換
    // (preserveAspectRatio の既定 xMidYMid meet)。その後で、y の向きを返す
    let m: Matrix = [1, 0, 0, -1, 0, 0];
    if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      const s = Math.min(unitsPerEm / vb[2], unitsPerEm / vb[3]);
      const tx = -vb[0] * s + (unitsPerEm - vb[2] * s) / 2;
      const ty = -vb[1] * s + (unitsPerEm - vb[3] * s) / 2;
      m = [s, 0, 0, -s, tx, -ty];
    }
    return { ops: ops.length ? [{ op: 'transform', m, ops }] : [] };
  };
}

/**
 * colorGlyph — 色つきの字形 (カラーの絵文字など) を、書体の表から読んで、描画の命令の並びにする。
 *
 * 読む表 (OpenType。https://learn.microsoft.com/typography/opentype/spec/ の各章):
 *  - COLR (version 0: 色ごとの層の重ね。version 1: 描画の木 = Paint の表) と CPAL (色のパレット)
 *  - CBDT/CBLC (PNG のビットマップ。画像の形式 17・18・19、索引の形式 1〜5)
 *  - sbix (PNG・JPEG のビットマップ)
 *  - SVG (字形ごとの SVG の文書。図形にするのは colorGlyphSvg.ts)
 * @pdf-lib/fontkit は COLR の version 0 と sbix しか読めず、version 1 の書体では字形の layers・bbox が例外になり、輪郭の表を持たない
 * 書体 (CBDT だけの Noto Color Emoji) では字形そのものが null になるので、表は自前で読む (字形の輪郭と送りだけを fontkit から取る)。
 *
 * 描画の命令 (ColorOp) は、書体の単位 (unitsPerEm で 1 em)・y 上向き・原点は字形の原点 (基線の左端)。
 * PDF (colorGlyphPdf.ts) と Canvas (colorGlyphCanvas.ts) が、同じ命令の並びを描く (PDF と画面で同じ絵になる)。
 *
 * 色つきの表を持たない書体では、何もしない: 書体ごとに 1 度だけ表の一覧を見て覚える (colorFontOf)。
 */
import type { Matrix, Seg } from './matrix';
import { apply, mul } from './matrix';

/** 色 (0〜1 の RGB) */
export type Rgb = [number, number, number];
/** 色の指定。rgb が null なら前景色 (文字の色。COLR の色の番号 0xFFFF)。a は不透明度 (前景色では、文字の色の不透明度に掛ける) */
export interface ColorRef {
  rgb: Rgb | null;
  a: number;
}
/** グラデーションの止まり点 (offset は 0〜1 に正規化してある) */
export interface ColorStop {
  offset: number;
  color: ColorRef;
}
/** 色の線の、止まり点の外の延ばし方 (COLR の Extend: 0 = pad、1 = repeat、2 = reflect) */
export type Extend = 0 | 1 | 2;
/**
 * 塗り。グラデーションの位置は、止まり点の最小・最大の位置 (正規化した 0 と 1) に合わせ直してある (COLR の「Color lines」の注)。
 *  - linear: 0 の点 (x0, y0) と 1 の点 (x1, y1)。色は、この線に直交する向きに延びる (COLR の p₂ は、p₃ に直してある)
 *  - radial: 0 の円 (x0, y0, r0) と 1 の円 (x1, y1, r1) (2 つの円の間の円錐。HTML の createRadialGradient と同じ)
 *  - sweep: 中心 (cx, cy) のまわりの、角度 start (0 の位置)〜end (1 の位置)。度。x の正の向きから反時計回り
 */
export type ColorFill =
  | { kind: 'solid'; color: ColorRef }
  | { kind: 'linear'; stops: ColorStop[]; extend: Extend; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'radial'; stops: ColorStop[]; extend: Extend; x0: number; y0: number; r0: number; x1: number; y1: number; r1: number }
  | { kind: 'sweep'; stops: ColorStop[]; extend: Extend; cx: number; cy: number; start: number; end: number };

/**
 * 描画の命令。
 *  - fill: 輪郭 path を fill で塗る (COLR v0 の層、v1 の PaintGlyph + 塗り)
 *  - clip: 輪郭 path で切り抜いて ops を描く (PaintGlyph の子が塗りでないとき。evenOdd は SVG の clip-rule)
 *  - paint: いまの切り抜きの中の全体を fill で塗る (PaintSolid・グラデーションを、PaintGlyph の外で使ったとき)
 *  - transform: 変換 m の中で ops を描く
 *  - composite: backdrop を描き、その上に source を mode (COLR の CompositeMode の値) で重ねる
 *  - image: 画像 (PNG・JPEG) を、左下 (x, y)・幅 w・高さ h の矩形に描く
 *  - stroke: 輪郭を線で描く (SVG の表の字形だけ)
 */
export type ColorOp =
  | { op: 'fill'; path: Seg[]; fill: ColorFill; evenOdd?: boolean }
  | { op: 'clip'; path: Seg[]; ops: ColorOp[]; evenOdd?: boolean }
  | { op: 'paint'; fill: ColorFill }
  | { op: 'transform'; m: Matrix; ops: ColorOp[] }
  | { op: 'composite'; mode: number; source: ColorOp[]; backdrop: ColorOp[] }
  | { op: 'image'; kind: 'png' | 'jpg'; data: Uint8Array; x: number; y: number; w: number; h: number }
  | { op: 'stroke'; path: Seg[]; fill: ColorFill; width: number; cap: 0 | 1 | 2; join: 0 | 1 | 2; miter: number; dash?: number[]; dashOffset?: number };

export type Box = [number, number, number, number];

/** 色つきの字形 1 つ */
export interface ColorGlyph {
  ops: ColorOp[];
  /** 描く範囲 [xMin, yMin, xMax, yMax]。COLR の ClipBox があればそれ、無ければ中身の外接枠 */
  bbox: Box;
  /** bbox の外を描かない (COLR の ClipBox: 「Any content drawn outside the clip box must not render」) */
  clip: boolean;
  /** 前景色 (文字の色) を使う */
  usesForeground: boolean;
  /** 前景色を、グラデーションの止まり点に使う (PDF では、文字の色ごとに字形の手続きを分ける) */
  foregroundInGradient: boolean;
  /** 字形の出どころ */
  source: 'colr0' | 'colr1' | 'svg' | 'cbdt' | 'sbix';
}

/**
 * パレットの選び方 (CSS Fonts 4 §9.1 font-palette・§9.2 @font-palette-values の結果)。
 *  - base: パレットの番号、または 'light'・'dark' (CPAL の、明るい・暗い背景向けの印の付いた最初のパレット)。無ければ 0 番
 *  - colors: 色の差し替え (override-colors)。[色の番号, CSS の色 (#rrggbb か #rrggbbaa)]
 */
export interface FontPalette {
  base?: number | 'light' | 'dark';
  colors?: Array<[number, string]>;
}

/** @font-palette-values の規則 1 つ (CSS Fonts 4 §9.2)。families は font-family の記述子の名前 */
export interface FontPaletteRule {
  name: string;
  families: string[];
  base?: number | 'light' | 'dark';
  colors?: Array<[number, string]>;
}

/**
 * 書式の font-palette の値 (CSS Fonts 4 §9.1)。normal・light・dark か、名前 (--名前) に当たる @font-palette-values の規則の並び
 * (書いた順。同じ名前の規則が、書体のファミリーごとにあってよい)
 */
export type FontPaletteStyle = 'normal' | 'light' | 'dark' | FontPaletteRule[];

/** font-family の名前の照合用の形 (大文字小文字と前後の空白・引用符の違いを無視する) */
const familyKey = (n: string) => n.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

/**
 * 書式の font-palette を、書体 font に当てたときのパレットの選び方。既定のパレットのまま (normal、パレットを持たない書体、
 * その書体に当たる規則が無い、light・dark の印の付いたパレットが無い) なら undefined。
 * 書体のファミリーの照合: @font-face の書体は「css:名前」(範囲つきは「css:名前#範囲」) で登録してあるので、その名前の部分で比べる
 */
export function paletteForFont(style: FontPaletteStyle | undefined, font: { family: string; fk: unknown; buffer: ArrayBuffer; instanceOf?: { master: { family: string } } }): FontPalette | undefined {
  if (!style || style === 'normal') return undefined;
  const cf = colorFontOf(font);
  if (!cf || !cf.paletteCount) return undefined;
  let sel: FontPalette | undefined;
  if (style === 'light' || style === 'dark') sel = { base: style };
  else {
    // 可変フォントの実体 (軸の値を決めた書体。名前の後ろに軸の印が付く) は、元の書体のファミリーで比べる
    const own = familyKey((font.instanceOf?.master.family ?? font.family).replace(/^css:/, '').replace(/#.*$/, ''));
    // 同じ名前の規則が複数あれば、書いた順の最後のものが勝つ (§9.2)
    const rule = [...style].reverse().find((r) => r.families.some((f) => familyKey(f) === own));
    if (rule) sel = { ...(rule.base !== undefined ? { base: rule.base } : {}), ...(rule.colors?.length ? { colors: rule.colors } : {}) };
  }
  if (!sel) return undefined;
  // 番号に直す (light・dark は、印の付いた最初のパレット。無い番号は 0。§9.2.2)。既定 (0 番で、差し替え無し) なら undefined
  const index = cf.paletteIndex(sel.base);
  const colors = sel.colors?.filter(([i]) => i >= 0 && i < cf.paletteEntries);
  if (index === 0 && !colors?.length) return undefined;
  return { ...(index ? { base: index } : {}), ...(colors?.length ? { colors } : {}) };
}

/** パレットの鍵 (覚えるときの名前)。既定のパレットは '' */
export function paletteKey(p: FontPalette | undefined): string {
  if (!p || (p.base === undefined && !p.colors?.length)) return '';
  return `${p.base ?? 0}${(p.colors ?? []).map(([i, c]) => `;${i}=${c.toLowerCase()}`).join('')}`;
}

/** COLR の CompositeMode (Format 32: PaintComposite の表) */
export const COMPOSITE = {
  CLEAR: 0,
  SRC: 1,
  DEST: 2,
  SRC_OVER: 3,
  DEST_OVER: 4,
  SRC_IN: 5,
  DEST_IN: 6,
  SRC_OUT: 7,
  DEST_OUT: 8,
  SRC_ATOP: 9,
  DEST_ATOP: 10,
  XOR: 11,
  PLUS: 12,
  SCREEN: 13,
  OVERLAY: 14,
  DARKEN: 15,
  LIGHTEN: 16,
  COLOR_DODGE: 17,
  COLOR_BURN: 18,
  HARD_LIGHT: 19,
  SOFT_LIGHT: 20,
  DIFFERENCE: 21,
  EXCLUSION: 22,
  MULTIPLY: 23,
  HSL_HUE: 24,
  HSL_SATURATION: 25,
  HSL_COLOR: 26,
  HSL_LUMINOSITY: 27,
} as const;

/** 描画の木の入れ子の上限 (これより深い木は、その先を描かない。実物の Noto Color Emoji は 7 段) */
const MAX_PAINT_DEPTH = 64;
/** 1 つの字形の Paint の表の数の上限 (壊れた書体・悪意のある書体で、共有の部分木が指数的に増えるのを止める) */
const MAX_PAINTS = 20000;

/** fontkit の書体のうち、ここで使う所 */
interface FkFont {
  unitsPerEm: number;
  numGlyphs: number;
  directory?: { tables: Record<string, { offset: number; length: number } | undefined> };
  _glyphs?: Record<number, unknown>;
  _getBaseGlyph?(id: number, codePoints?: number[]): { path: { commands: Array<{ command: string; args: number[] }> } } | null;
  getGlyph(id: number, codePoints?: number[]): unknown;
}

/** fontkit の輪郭を、Seg (3 次ベジェ) にする */
function toSegs(commands: Array<{ command: string; args: number[] }>): Seg[] {
  const out: Seg[] = [];
  let cx = 0;
  let cy = 0;
  for (const c of commands) {
    const a = c.args;
    if (c.command === 'moveTo') out.push({ op: 'M', x: (cx = a[0]), y: (cy = a[1]) });
    else if (c.command === 'lineTo') out.push({ op: 'L', x: (cx = a[0]), y: (cy = a[1]) });
    else if (c.command === 'quadraticCurveTo') {
      // 2 次ベジェ (制御点 q) → 3 次ベジェ (制御点 = 端点 + 2/3·(q − 端点))
      out.push({ op: 'C', x1: cx + ((a[0] - cx) * 2) / 3, y1: cy + ((a[1] - cy) * 2) / 3, x2: a[2] + ((a[0] - a[2]) * 2) / 3, y2: a[3] + ((a[1] - a[3]) * 2) / 3, x: a[2], y: a[3] });
      cx = a[2];
      cy = a[3];
    } else if (c.command === 'bezierCurveTo') {
      out.push({ op: 'C', x1: a[0], y1: a[1], x2: a[2], y2: a[3], x: a[4], y: a[5] });
      cx = a[4];
      cy = a[5];
    } else if (c.command === 'closePath') out.push({ op: 'Z' });
  }
  return out;
}

/** 輪郭の点 (制御点を含む) の外接枠。点が無ければ undefined */
export function segsBox(segs: readonly Seg[], m?: Matrix): Box | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (m) [x, y] = apply(m, x, y);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const s of segs) {
    if (s.op === 'Z') continue;
    if (s.op === 'C') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
    add(s.x, s.y);
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : undefined;
}

/** 矩形を、変換 m で写した外接枠 */
export function boxThrough(b: Box, m: Matrix): Box {
  const ps = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[0], b[3]), apply(m, b[2], b[3])];
  return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
}

const unionBox = (a: Box | undefined, b: Box | undefined): Box | undefined => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const intersectBox = (a: Box, b: Box): Box | undefined => {
  const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : undefined;
};

/** 矩形の輪郭 */
export const boxPath = (b: Box): Seg[] => [{ op: 'M', x: b[0], y: b[1] }, { op: 'L', x: b[2], y: b[1] }, { op: 'L', x: b[2], y: b[3] }, { op: 'L', x: b[0], y: b[3] }, { op: 'Z' }];

/**
 * 命令の並びが描く範囲 (変換 m の後の座標)。切り抜きの中の全体を塗る命令 (paint) は、外側の切り抜き clip の範囲。
 * 切り抜きが無い所の paint は範囲が決まらない (COLR の「unbounded」) ので、undefined のまま (呼び出し側が、その字形を描かない)
 */
function opsBox(ops: readonly ColorOp[], m: Matrix | undefined, clip: Box | undefined, state: { unbounded: boolean }): Box | undefined {
  let box: Box | undefined;
  for (const o of ops) {
    let b: Box | undefined;
    if (o.op === 'fill') b = segsBox(o.path, m);
    else if (o.op === 'stroke') {
      b = segsBox(o.path, m);
      // 線の太さの半分 (尖ったつなぎは、その miter 倍まで) だけ外に出る
      const k = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1;
      const e = (o.width / 2) * Math.max(1, o.join === 0 ? o.miter : 1) * k;
      if (b) b = [b[0] - e, b[1] - e, b[2] + e, b[3] + e];
    } else if (o.op === 'clip') {
      const pb = segsBox(o.path, m);
      const inner = pb && clip ? intersectBox(pb, clip) : pb;
      if (inner) {
        const cb = opsBox(o.ops, m, inner, state);
        b = cb && intersectBox(cb, inner);
      }
    } else if (o.op === 'paint') {
      if (clip) b = clip;
      else state.unbounded = true;
    } else if (o.op === 'transform') b = opsBox(o.ops, m ? mul(m, o.m) : o.m, clip, state);
    else if (o.op === 'composite') b = unionBox(opsBox(o.backdrop, m, clip, state), opsBox(o.source, m, clip, state));
    else if (o.op === 'image') b = boxThrough([o.x, o.y, o.x + o.w, o.y + o.h], m ?? [1, 0, 0, 1, 0, 0]);
    box = unionBox(box, b);
  }
  return box;
}

/** 命令の並びが前景色を使うか (gradient: グラデーションの止まり点に使うか) */
function usesForeground(ops: readonly ColorOp[], gradientOnly: boolean): boolean {
  const inFill = (f: ColorFill) => (f.kind === 'solid' ? !gradientOnly && f.color.rgb === null : f.stops.some((s) => s.color.rgb === null));
  return ops.some((o) =>
    o.op === 'fill' || o.op === 'paint' || o.op === 'stroke'
      ? inFill(o.fill)
      : o.op === 'clip' || o.op === 'transform'
        ? usesForeground(o.ops, gradientOnly)
        : o.op === 'composite'
          ? usesForeground(o.source, gradientOnly) || usesForeground(o.backdrop, gradientOnly)
          : false,
  );
}

/** 色の線の位置 t (0〜1) の色 (前後の止まり点の間を、不透明度を掛けた値で補間する。CPAL の「Interpolation of colors」) */
function colorAt(stops: readonly ColorStop[], t: number, fg: Rgb): { rgb: Rgb; a: number } {
  const res = (s: ColorStop) => ({ rgb: s.color.rgb ?? fg, a: s.color.a });
  if (t <= stops[0].offset) return res(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    const p = stops[i - 1];
    const q = stops[i];
    if (t > q.offset) continue;
    const span = q.offset - p.offset;
    if (span <= 0) return res(q);
    const u = (t - p.offset) / span;
    const a = p.color.a + (q.color.a - p.color.a) * u;
    const pr = p.color.rgb ?? fg;
    const qr = q.color.rgb ?? fg;
    // 不透明度を掛けた値で補間し、補間した不透明度で割り戻す。不透明度が 0 なら、色は見えないので、そのままの補間
    const mixed = pr.map((c, k) => (a > 0 ? (c * p.color.a * (1 - u) + qr[k] * q.color.a * u) / a : c + (qr[k] - c) * u)) as Rgb;
    return { rgb: mixed, a };
  }
  return res(stops[stops.length - 1]);
}

/**
 * グラデーションの止まり点を、描く側 (PDF の関数・Canvas の addColorStop。どちらも、止まり点の間を RGB と不透明度それぞれの
 * 一次補間にする) がそのまま使える形にする:
 *  - 前景色の止まり点を fg に置き換える
 *  - 隣り合う止まり点の不透明度が違う区間は、不透明度を掛けた値での補間 (CPAL の「Interpolation of colors」: interpolation must be
 *    done with alpha pre-multiplied) になるように、区間を分けて途中の色を足す (透明な黒へ向かう影が、途中で黒ずまない)
 * 色の補間は、sRGB の値のまま行う (PDF の DeviceRGB の関数・Canvas のグラデーションと同じ。CPAL の章は光の強さに直した値での
 * 補間を求めるが、Chromium などの実装も sRGB の値のまま補間する)
 */
export function plainStops(stops: readonly ColorStop[], fg: Rgb): Array<{ offset: number; rgb: Rgb; a: number }> {
  const out: Array<{ offset: number; rgb: Rgb; a: number }> = [];
  const STEPS = 8;
  stops.forEach((s, i) => {
    const prev = stops[i - 1];
    if (prev && prev.color.a !== s.color.a && s.offset > prev.offset && (prev.color.rgb ?? fg).some((c, k) => c !== (s.color.rgb ?? fg)[k])) {
      for (let k = 1; k < STEPS; k++) {
        const t = prev.offset + ((s.offset - prev.offset) * k) / STEPS;
        out.push({ offset: t, ...colorAt(stops, t, fg) });
      }
    }
    out.push({ offset: s.offset, rgb: s.color.rgb ?? fg, a: s.color.a });
  });
  return out;
}

/**
 * 繰り返し (repeat)・折り返し (reflect) の色の線を、位置 [t0, t1] (元の 0〜1 の座標) を覆う、延ばし方が pad の色の線に展開する
 * (PDF の網かけ・Canvas のグラデーションには、繰り返しが無い)。返す stops の offset は 0〜1 で、lo・hi は、その 0 と 1 が元の座標のどこか。
 * 繰り返しの数が多すぎるとき (止まり点の合計が MAX_UNROLLED を超える) は、覆える所までにする
 */
export function unrollStops(stops: readonly ColorStop[], extend: Extend, t0: number, t1: number): { stops: ColorStop[]; lo: number; hi: number } {
  if (extend === 0 || stops.length < 2) return { stops: [...stops], lo: 0, hi: 1 };
  const MAX_UNROLLED = 2048;
  let k0 = Math.floor(Math.min(t0, t1));
  let k1 = Math.ceil(Math.max(t0, t1));
  if (!Number.isFinite(k0) || !Number.isFinite(k1)) return { stops: [...stops], lo: 0, hi: 1 };
  k0 = Math.min(k0, 0);
  k1 = Math.max(k1, 1);
  const maxCycles = Math.max(1, Math.floor(MAX_UNROLLED / stops.length));
  if (k1 - k0 > maxCycles) {
    k0 = Math.max(k0, -Math.floor(maxCycles / 2));
    k1 = Math.min(k1, k0 + maxCycles);
  }
  const n = k1 - k0;
  const out: ColorStop[] = [];
  for (let k = k0; k < k1; k++) {
    // 折り返し: 奇数番目の周期は、止まり点の順を逆にする (「…ABC CBA ABC…」)
    const flip = extend === 2 && ((k % 2) + 2) % 2 === 1;
    const cycle = flip ? [...stops].reverse().map((s) => ({ ...s, offset: 1 - s.offset })) : stops;
    for (const s of cycle) out.push({ offset: (k - k0 + s.offset) / n, color: s.color });
  }
  return { stops: out, lo: k0, hi: k1 };
}

/**
 * 掃引 (sweep) のグラデーションの、角度ごとの色 (PDF の三角形の網・Canvas の createConicGradient の止まり点を作るのに使う)。
 * 描くのは 0°〜360° (COLR の「Sweep gradients」: 0° から 360° の手前までを描く。色の線の、その外に当たる所は描かない)。
 *  - angles: 色の変わり目の角度 (0 と 360、その間にある止まり点の角度。昇順)
 *  - sample(deg, side): 角度 deg の色。side は、その角度のすぐ手前 (−1)・すぐ後 (+1) (色の段差の位置で、どちら側の色かを決める)
 * 描かないグラデーション (止まり点が無い・角度の幅が 0) は undefined
 */
export function sweepSampler(fill: Extract<ColorFill, { kind: 'sweep' }>, fg: Rgb): { angles: number[]; sample(deg: number, side: number): { rgb: Rgb; a: number } } | undefined {
  const span = fill.end - fill.start;
  if (span === 0) return undefined;
  const tAt = (deg: number) => (deg - fill.start) / span;
  const { stops, lo, hi } = unrollStops(fill.stops, fill.extend, Math.min(tAt(0), tAt(360)), Math.max(tAt(0), tAt(360)));
  const plain = plainStops(stops, fg);
  if (!plain.length) return undefined;
  const sample = (deg: number, side: number): { rgb: Rgb; a: number } => {
    const t = Math.min(Math.max((tAt(deg) - lo) / (hi - lo), 0), 1);
    // 角度が増える向きと、色の線の位置が増える向きが逆のとき (始まりの角度 > 終わりの角度) は、手前・後が入れ替わる
    const dir = span > 0 ? side : -side;
    let i = 0;
    // t を含む区間 [i, i + 1] を探す。段差 (同じ位置の止まり点) では、dir の側の区間
    while (i < plain.length - 2 && (dir > 0 ? plain[i + 1].offset <= t : plain[i + 1].offset < t)) i++;
    const p = plain[i];
    const q = plain[Math.min(i + 1, plain.length - 1)];
    const u = q.offset > p.offset ? Math.min(Math.max((t - p.offset) / (q.offset - p.offset), 0), 1) : dir > 0 ? 1 : 0;
    return { rgb: p.rgb.map((c, k) => c + (q.rgb[k] - c) * u) as Rgb, a: p.a + (q.a - p.a) * u };
  };
  const angles = new Set<number>([0, 360]);
  for (const s of plain) {
    const deg = fill.start + span * (lo + (hi - lo) * s.offset);
    if (deg > 0 && deg < 360) angles.add(deg);
  }
  return { angles: [...angles].sort((p, q) => p - q), sample };
}

/**
 * 字の領域の字形と位置 (書体の単位。u・v は、領域の描く原点からの字形の原点。v は上向き)。木に字形の番号があれば、それを使う
 * (組版で測った字形と同じ)。無ければ、字を書体で組み直す (pdfRenderer.ts の drawGlyph と同じ決まり)。組めなければ空
 */
export function areaGlyphs(
  g: { text: string; glyphIds?: number[]; glyphPositions?: Array<[number, number, number]>; features?: string[] },
  font: { fk: unknown },
): Array<{ id: number; adv: number; u: number; v: number }> {
  const fk = font.fk as {
    getGlyph(id: number): { advanceWidth: number };
    layout(text: string, features?: object): { glyphs: Array<{ id: number }>; positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }> };
  };
  const out: Array<{ id: number; adv: number; u: number; v: number }> = [];
  let pen = 0;
  try {
    if (g.glyphIds?.length) {
      const pos = g.glyphPositions && g.glyphPositions.length === g.glyphIds.length ? g.glyphPositions : undefined;
      g.glyphIds.forEach((id, i) => {
        const [adv, dx, dy] = pos ? pos[i] : [fk.getGlyph(id).advanceWidth, 0, 0];
        out.push({ id, adv, u: pen + dx, v: dy });
        pen += adv;
      });
    } else {
      // 改行しない空白 (U+00A0) は、通常の空白の字形で描く。'-' で始まる印 (組版が足す印) は、書体の機能ではない
      const text = g.text.replace(/\u00A0/g, ' ');
      const run = fk.layout(text, Object.fromEntries((g.features ?? []).filter((f) => !f.startsWith('-')).map((f) => [f, true])));
      run.glyphs.forEach((gl, i) => {
        const p = run.positions[i];
        out.push({ id: gl.id, adv: p.xAdvance, u: pen + p.xOffset, v: p.yOffset });
        pen += p.xAdvance;
      });
    }
  } catch {
    return [];
  }
  return out;
}

/** 書体のファイル (sfnt) の表の一覧 */
function tableDirectory(buf: ArrayBuffer): Map<string, { offset: number; length: number }> {
  const out = new Map<string, { offset: number; length: number }>();
  if (buf.byteLength < 12) return out;
  const dv = new DataView(buf);
  const n = dv.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= buf.byteLength; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    const offset = dv.getUint32(o + 8);
    const length = dv.getUint32(o + 12);
    if (offset + length <= buf.byteLength) out.set(tag, { offset, length });
  }
  return out;
}

/** 表の中を、範囲を確かめながら読む (範囲の外は RangeError。呼び出し側が、その字形を「色つきでない」とする) */
class Reader {
  private dv: DataView;
  constructor(buf: ArrayBuffer, offset: number, readonly length: number) {
    this.dv = new DataView(buf, offset, length);
  }
  u8 = (o: number) => this.dv.getUint8(o);
  i8 = (o: number) => this.dv.getInt8(o);
  u16 = (o: number) => this.dv.getUint16(o);
  i16 = (o: number) => this.dv.getInt16(o);
  u24 = (o: number) => (this.dv.getUint8(o) << 16) | this.dv.getUint16(o + 1);
  u32 = (o: number) => this.dv.getUint32(o);
  /** F2DOT14 (符号つきの 2.14 の固定小数) */
  f2 = (o: number) => this.dv.getInt16(o) / 16384;
  /** Fixed (符号つきの 16.16 の固定小数) */
  fixed = (o: number) => this.dv.getInt32(o) / 65536;
  bytes = (o: number, n: number) => {
    if (o < 0 || n < 0 || o + n > this.length) throw new RangeError('table data out of range');
    return new Uint8Array(this.dv.buffer, this.dv.byteOffset + o, n);
  };
}

/** PNG・JPEG の画像の大きさ (画素)。読めなければ undefined */
function bitmapSize(b: Uint8Array): { kind: 'png' | 'jpg'; width: number; height: number } | undefined {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { kind: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: 枠の区切り (SOF0〜SOF15。DHT・JPG・DAC を除く) の高さ・幅
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p] !== 0xff) return undefined;
      const marker = b[p + 1];
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { kind: 'jpg', width: (b[p + 7] << 8) | b[p + 8], height: (b[p + 5] << 8) | b[p + 6] };
      p += 2 + len;
    }
  }
  return undefined;
}

/** CSS の色 (#rgb・#rrggbb・#rrggbbaa) → [r, g, b, a] (0〜1)。読めなければ undefined */
export function hexColor(css: string): [number, number, number, number] | undefined {
  const m = /^#([0-9a-f]{3,8})$/i.exec(css.trim());
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}

/** SVG の表の字形を、描画の命令にする関数 (colorGlyphSvg.ts。XML を読む関数が要るので、描く側が渡す) */
export type SvgGlyphReader = (doc: Uint8Array, gid: number, unitsPerEm: number, palette: ReadonlyArray<readonly [number, number, number, number]>) => { ops: ColorOp[] } | undefined;

/**
 * 色つきの字形を持つ書体。colorFontOf で作る (書体ごとに 1 つ)
 */
export class ColorFont {
  readonly unitsPerEm: number;
  /** 持っている色つきの表 */
  readonly tables: { colr?: 0 | 1; svg?: boolean; cbdt?: boolean; sbix?: boolean };
  private colr?: Reader;
  private cpal?: Reader;
  private cblc?: Reader;
  private cbdt?: Reader;
  private sbix?: Reader;
  private svg?: Reader;
  private pathMemo = new Map<number, Seg[]>();
  private glyphMemo = new Map<string, ColorGlyph | null>();
  private paletteMemo = new Map<string, Array<[number, number, number, number]>>();
  private bitmapMemo = new Map<number, Extract<ColorOp, { op: 'image' }> | null>();
  /** SVG の表の字形の読み方 (描く側が入れる。無ければ、SVG だけの字形は色つきにしない) */
  svgReader?: SvgGlyphReader;

  constructor(
    private fk: FkFont,
    buf: ArrayBuffer,
    dir: Map<string, { offset: number; length: number }>,
  ) {
    this.unitsPerEm = fk.unitsPerEm || 1000;
    const plain = Object.create(fk) as FkFont;
    plain._glyphs = {};
    plain.getGlyph = function (this: FkFont, id: number, codePoints?: number[]) {
      return this._getBaseGlyph?.(id, codePoints) ?? null;
    };
    this.plain = plain;
    const reader = (tag: string) => {
      const t = dir.get(tag);
      return t ? new Reader(buf, t.offset, t.length) : undefined;
    };
    this.tables = {};
    const colr = reader('COLR');
    const cpal = reader('CPAL');
    // CPAL (色のパレット) は、COLR の色の番号と、SVG の表の var(--colorN) が引く
    if (cpal && cpal.length >= 12) this.cpal = cpal;
    // COLR は CPAL と組で使う (色の番号は CPAL のパレットの中の番号)
    if (colr && this.cpal && colr.length >= 14) {
      this.colr = colr;
      this.tables.colr = colr.u16(0) >= 1 && colr.length >= 34 ? 1 : 0;
    }
    const cblc = reader('CBLC');
    const cbdt = reader('CBDT');
    if (cblc && cbdt && cblc.length >= 8) {
      this.cblc = cblc;
      this.cbdt = cbdt;
      this.tables.cbdt = true;
    }
    const sbix = reader('sbix');
    if (sbix && sbix.length >= 8) {
      this.sbix = sbix;
      this.tables.sbix = true;
    }
    const svg = reader('SVG ');
    if (svg && svg.length >= 10) {
      this.svg = svg;
      this.tables.svg = true;
    }
  }

  /**
   * 輪郭を読むための、書体の写し。fontkit は、COLR・sbix の書体の getGlyph で、輪郭を持たない型の字形 (COLRGlyph) を返し、
   * それを字形の控え (_glyphs) に入れる。輪郭の字形を作る _getBaseGlyph も同じ控えを見るので、先に getGlyph で作られた字形は
   * 輪郭が空になり、合成の字形 (部品を getGlyph で引く) は例外になる。控えを別に持ち、getGlyph が輪郭の字形を返す写しを通して読む
   */
  private plain: FkFont;

  /** 字形の輪郭 (glyf・CFF の表のもの。COLR の層・PaintGlyph の形、色つきでない字形) */
  outline(gid: number): Seg[] {
    let p = this.pathMemo.get(gid);
    if (!p) {
      try {
        p = toSegs(this.plain._getBaseGlyph?.(gid)?.path.commands ?? []);
      } catch {
        // 字形のデータが壊れている (fontkit が読めない) ときは、空の形
        p = [];
      }
      if (this.pathMemo.size > 50000) this.pathMemo.clear();
      this.pathMemo.set(gid, p);
    }
    return p;
  }

  // ---- CPAL ----

  /** パレットの数 */
  get paletteCount(): number {
    return this.cpal ? this.cpal.u16(4) : 0;
  }

  /** 1 つのパレットの色の数 */
  get paletteEntries(): number {
    return this.cpal ? this.cpal.u16(2) : 0;
  }

  /**
   * パレットの番号。'light'・'dark' は、CPAL version 1 のパレットの種類 (USABLE_WITH_LIGHT_BACKGROUND = 0x0001・
   * USABLE_WITH_DARK_BACKGROUND = 0x0002) の付いた最初のパレット。無い番号・印の付いたパレットが無いときは 0
   * (CSS Fonts 4 §9.2.2: 「it behaves as if 0 were specified」)
   */
  paletteIndex(base: FontPalette['base']): number {
    const cpal = this.cpal;
    if (!cpal || base === undefined) return 0;
    try {
      const palettes = cpal.u16(4);
      if (typeof base === 'number') return Number.isInteger(base) && base >= 0 && base < palettes ? base : 0;
      const typesAt = cpal.u16(0) >= 1 ? cpal.u32(12 + palettes * 2) : 0;
      const bit = base === 'light' ? 1 : 2;
      if (typesAt) for (let i = 0; i < palettes; i++) if (cpal.u32(typesAt + i * 4) & bit) return i;
    } catch {
      return 0;
    }
    return 0;
  }

  /** パレット (色の番号 → [r, g, b, a])。sel が無ければ 0 番 (既定) のパレット */
  palette(sel?: FontPalette): Array<[number, number, number, number]> {
    const key = paletteKey(sel);
    let p = this.paletteMemo.get(key);
    if (p) return p;
    p = [];
    const cpal = this.cpal;
    if (cpal) {
      try {
        const entries = cpal.u16(2);
        const records = cpal.u16(6);
        const recordsAt = cpal.u32(8);
        const index = this.paletteIndex(sel?.base);
        const first = cpal.u16(12 + index * 2);
        for (let i = 0; i < entries && first + i < records; i++) {
          const o = recordsAt + (first + i) * 4;
          // ColorRecord は 青・緑・赤・不透明度の順
          p.push([cpal.u8(o + 2) / 255, cpal.u8(o + 1) / 255, cpal.u8(o) / 255, cpal.u8(o + 3) / 255]);
        }
        for (const [i, css] of sel?.colors ?? []) {
          const c = hexColor(css);
          // 範囲の外の番号の差し替えは無視する (CSS Fonts 4 §9.2.2)
          if (c && i >= 0 && i < p.length) p[i] = c;
        }
      } catch {
        p = [];
      }
    }
    this.paletteMemo.set(key, p);
    return p;
  }

  // ---- 字形 ----

  /**
   * 字形 gid の色つきの描き方 (パレット sel で)。色つきの字形でなければ undefined (ふつうの輪郭を、文字の色で描く)。
   * 同じ字形に複数の表があるときは、COLR (version 1 → version 0) → SVG → CBDT → sbix の順に、最初に見つかったもの
   */
  glyph(gid: number, sel?: FontPalette): ColorGlyph | undefined {
    const key = `${gid}|${paletteKey(sel)}`;
    const hit = this.glyphMemo.get(key);
    if (hit !== undefined) return hit ?? undefined;
    let g: ColorGlyph | undefined;
    for (const read of [() => this.colrGlyph(gid, sel), () => this.svgGlyph(gid, sel), () => this.cbdtGlyph(gid), () => this.sbixGlyph(gid)]) {
      try {
        g = read();
      } catch {
        // 表が壊れている (範囲の外を指す) 字形は、その表では色つきにしない
        g = undefined;
      }
      if (g) break;
    }
    if (this.glyphMemo.size > 20000) this.glyphMemo.clear();
    this.glyphMemo.set(key, g ?? null);
    return g;
  }

  private finish(ops: ColorOp[], source: ColorGlyph['source'], clipBox?: Box): ColorGlyph | undefined {
    const state = { unbounded: false };
    const content = opsBox(ops, undefined, clipBox, state);
    // ClipBox の無い、範囲の決まらない字形は描かない (COLR の「Glyph metrics and boundedness」: must not render the color glyph if the
    // defining graph is not bounded)
    if (!clipBox && state.unbounded) return undefined;
    const bbox = clipBox ?? content;
    if (!bbox) return { ops: [], bbox: [0, 0, 0, 0], clip: false, usesForeground: false, foregroundInGradient: false, source };
    return { ops, bbox, clip: !!clipBox, usesForeground: usesForeground(ops, false), foregroundInGradient: usesForeground(ops, true), source };
  }

  // ---- COLR ----

  private colorRef(pal: Array<[number, number, number, number]>, index: number, alpha: number): ColorRef | undefined {
    const a = Math.min(Math.max(alpha, 0), 1);
    // 0xFFFF は前景色 (COLR の「Colors and solid color fills」)
    if (index === 0xffff) return { rgb: null, a };
    const c = pal[index];
    if (!c) return undefined;
    return { rgb: [c[0], c[1], c[2]], a: c[3] * a };
  }

  private colrGlyph(gid: number, sel?: FontPalette): ColorGlyph | undefined {
    const colr = this.colr;
    if (!colr) return undefined;
    const pal = this.palette(sel);
    // version 1 の BaseGlyphList を先に探し、無ければ version 0 の BaseGlyph の記録 (COLR の「Mixing version 0 and version 1 formats」)
    if (this.tables.colr === 1) {
      const root = this.baseGlyphPaint(gid);
      if (root !== undefined) {
        const budget = { left: MAX_PAINTS };
        const ops = this.paint(root, pal, [], budget);
        return this.finish(ops, 'colr1', this.clipBox(gid));
      }
    }
    const n = colr.u16(2);
    const baseAt = colr.u32(4);
    const layersAt = colr.u32(8);
    const numLayers = colr.u16(12);
    if (!n || !baseAt) return undefined;
    // BaseGlyph の記録 (字形の番号の昇順) を 2 分探索する
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = colr.u16(baseAt + mid * 6);
      if (g < gid) lo = mid + 1;
      else if (g > gid) hi = mid - 1;
      else {
        const first = colr.u16(baseAt + mid * 6 + 2);
        const count = colr.u16(baseAt + mid * 6 + 4);
        const ops: ColorOp[] = [];
        // 層は下から上の順 (最初の記録がいちばん下)
        for (let i = first; i < first + count && i < numLayers; i++) {
          const layerGid = colr.u16(layersAt + i * 4);
          const color = this.colorRef(pal, colr.u16(layersAt + i * 4 + 2), 1);
          const path = this.outline(layerGid);
          if (color && path.length) ops.push({ op: 'fill', path, fill: { kind: 'solid', color } });
        }
        return this.finish(ops, 'colr0');
      }
    }
    return undefined;
  }

  /** BaseGlyphList の、字形 gid の Paint の表の位置 (COLR の表の先頭から)。無ければ undefined */
  private baseGlyphPaint(gid: number): number | undefined {
    const colr = this.colr!;
    const listAt = colr.u32(14);
    if (!listAt) return undefined;
    let lo = 0;
    let hi = colr.u32(listAt) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = colr.u16(listAt + 4 + mid * 6);
      if (g < gid) lo = mid + 1;
      else if (g > gid) hi = mid - 1;
      else return listAt + colr.u32(listAt + 4 + mid * 6 + 2);
    }
    return undefined;
  }

  /** ClipList の、字形 gid の ClipBox (無ければ undefined) */
  private clipBox(gid: number): Box | undefined {
    const colr = this.colr!;
    const listAt = colr.u32(22);
    if (!listAt) return undefined;
    let lo = 0;
    let hi = colr.u32(listAt + 1) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rec = listAt + 5 + mid * 7;
      if (colr.u16(rec + 2) < gid) lo = mid + 1;
      else if (colr.u16(rec) > gid) hi = mid - 1;
      else {
        // ClipBox の形式 1 (と、変化の付く形式 2 の既定の値): xMin・yMin・xMax・yMax
        const box = listAt + colr.u24(rec + 4);
        const format = colr.u8(box);
        if (format !== 1 && format !== 2) return undefined;
        return [colr.i16(box + 1), colr.i16(box + 3), colr.i16(box + 5), colr.i16(box + 7)];
      }
    }
    return undefined;
  }

  /** 色の線 (ColorLine・VarColorLine) を読む。止まり点は位置の昇順 (同じ位置は、書体の順) */
  private colorLine(at: number, variable: boolean, pal: Array<[number, number, number, number]>): { extend: Extend; stops: ColorStop[] } {
    const colr = this.colr!;
    const e = colr.u8(at);
    const n = colr.u16(at + 1);
    const size = variable ? 10 : 6;
    const stops: ColorStop[] = [];
    for (let i = 0; i < n; i++) {
      const o = at + 3 + i * size;
      const color = this.colorRef(pal, colr.u16(o + 2), colr.f2(o + 4));
      if (color) stops.push({ offset: colr.f2(o), color });
    }
    // 位置の昇順に並べる (Array.prototype.sort は安定なので、同じ位置の止まり点は書体の順のまま)
    stops.sort((a, b) => a.offset - b.offset);
    // 知らない延ばし方は pad (COLR の「ColorLine」: applications should use EXTEND_PAD by default)
    return { extend: e === 1 || e === 2 ? e : 0, stops };
  }

  /**
   * グラデーションの塗りを作る。止まり点の位置を 0〜1 に正規化し、形 (点・円・角度) を、その 0 と 1 に合わせ直す。
   * at(t) は、元の色の線の位置 t の形。描かないグラデーション (止まり点が無い・形が崩れている) は undefined
   */
  private gradient(line: { extend: Extend; stops: ColorStop[] }, make: (lo: number, hi: number, stops: ColorStop[], extend: Extend) => ColorFill | undefined): ColorFill | undefined {
    const { stops, extend } = line;
    // 止まり点が無ければ、透明 (何も描かない)。1 つなら、その色のべた塗り (COLR の「Color lines」)
    if (!stops.length) return undefined;
    if (stops.length === 1) return { kind: 'solid', color: stops[0].color };
    const min = stops[0].offset;
    const max = stops[stops.length - 1].offset;
    if (max === min) {
      // 止まり点がすべて同じ位置: pad なら、その位置より前が最初の色、その位置から後が最後の色。repeat・reflect は描かない
      if (extend !== 0) return undefined;
      const eps = 1e-4;
      const first = stops[0].color;
      const last = stops[stops.length - 1].color;
      return make(min - eps, min + eps, [{ offset: 0, color: first }, { offset: 0.5, color: first }, { offset: 0.5, color: last }, { offset: 1, color: last }], 0);
    }
    return make(min, max, stops.map((s) => ({ offset: (s.offset - min) / (max - min), color: s.color })), extend);
  }

  /**
   * Paint の表 (位置 at) と、その下の木を、命令の並びにする。path は、根からここまでの Paint の表 (循環の検出。COLR の
   * 「Color glyphs as a directed acyclic graph」: 循環や崩れた所は、その部分木だけを描かない)
   */
  private paint(at: number, pal: Array<[number, number, number, number]>, path: number[], budget: { left: number }): ColorOp[] {
    const colr = this.colr!;
    if (path.includes(at) || path.length >= MAX_PAINT_DEPTH || --budget.left < 0) return [];
    let format: number;
    try {
      format = colr.u8(at);
    } catch {
      return [];
    }
    const next = [...path, at];
    const child = (off: number) => this.paint(at + off, pal, next, budget);
    const wrap = (m: Matrix, ops: ColorOp[]): ColorOp[] => (ops.length ? [{ op: 'transform', m, ops }] : []);
    // 中心 (cx, cy) のまわりの変換 = 平行移動 (中心へ)・変換・平行移動 (戻す)
    const around = (m: Matrix, cx: number, cy: number): Matrix => mul(mul([1, 0, 0, 1, cx, cy], m), [1, 0, 0, 1, -cx, -cy]);
    try {
      switch (format) {
        case 1: {
          // PaintColrLayers: LayerList の一部分を、下から上へ重ねる
          const n = colr.u8(at + 1);
          const first = colr.u32(at + 2);
          const listAt = colr.u32(18);
          if (!listAt) return [];
          const total = colr.u32(listAt);
          const out: ColorOp[] = [];
          for (let i = first; i < first + n && i < total; i++) out.push(...this.paint(listAt + colr.u32(listAt + 4 + i * 4), pal, next, budget));
          return out;
        }
        case 2:
        case 3: {
          // PaintSolid・PaintVarSolid (変化の付く形式は、既定の値で読む)
          const color = this.colorRef(pal, colr.u16(at + 1), colr.f2(at + 3));
          return color ? [{ op: 'paint', fill: { kind: 'solid', color } }] : [];
        }
        case 4:
        case 5: {
          // PaintLinearGradient: p₀ (位置 0)・p₁ (位置 1)・p₂ (向きを回す点)
          const line = this.colorLine(at + colr.u24(at + 1), format === 5, pal);
          const [x0, y0, x1, y1, x2, y2] = [0, 1, 2, 3, 4, 5].map((k) => colr.i16(at + 4 + k * 2));
          // p₁ か p₂ が p₀ と同じ、または p₀p₂ が p₀p₁ と平行なら、描かない (COLR の「Linear gradients」)
          const vx = x1 - x0;
          const vy = y1 - y0;
          const rx = x2 - x0;
          const ry = y2 - y0;
          if ((vx === 0 && vy === 0) || (rx === 0 && ry === 0) || Math.abs(vx * ry - vy * rx) < 1e-9) return [];
          // p₃ = p₀ + (p₀p₁ を、p₀p₂ に直交する向きへ射影したもの)。色は p₀p₃ に直交する向きに延びる (同じ節の注)
          const nx = -ry;
          const ny = rx;
          const k = (vx * nx + vy * ny) / (nx * nx + ny * ny);
          const wx = nx * k;
          const wy = ny * k;
          const fill = this.gradient(line, (lo, hi, stops, extend) => ({ kind: 'linear', stops, extend, x0: x0 + wx * lo, y0: y0 + wy * lo, x1: x0 + wx * hi, y1: y0 + wy * hi }));
          return fill ? [{ op: 'paint', fill }] : [];
        }
        case 6:
        case 7: {
          // PaintRadialGradient: 円 0 (中心・半径) と円 1
          const line = this.colorLine(at + colr.u24(at + 1), format === 7, pal);
          const x0 = colr.i16(at + 4);
          const y0 = colr.i16(at + 6);
          const r0 = colr.u16(at + 8);
          const x1 = colr.i16(at + 10);
          const y1 = colr.i16(at + 12);
          const r1 = colr.u16(at + 14);
          // 2 つの円が同じなら、描かない (COLR の「Radial gradients」の手順 1)
          if (x0 === x1 && y0 === y1 && r0 === r1) return [];
          const fill = this.gradient(line, (lo, hi, stops, extend) => {
            // 半径が負になる位置 (r(ω) < 0) は描かれないので、色の線を、半径が 0 になる位置で切る (同じ節の「Note on implementation」)
            const r = (t: number) => r0 + (r1 - r0) * t;
            let a = lo;
            let b = hi;
            let st = stops;
            if (r(a) < 0 || r(b) < 0) {
              if (extend !== 0 || r0 === r1) return undefined;
              const tip = r0 / (r0 - r1);
              const cut = (tip - lo) / (hi - lo);
              const fg: Rgb = [0, 0, 0];
              if (r(a) < 0) {
                const c = colorAt(stops, cut, fg);
                // 前景色を含む色の線は、切った所の色を計算できないので、切らずに端の半径を 0 に寄せるだけにする
                st = stops.some((s) => s.color.rgb === null) ? stops : [{ offset: 0, color: c }, ...stops.filter((s) => s.offset > cut).map((s) => ({ offset: (s.offset - cut) / (1 - cut), color: s.color }))];
                a = tip;
              } else {
                const c = colorAt(stops, cut, fg);
                st = stops.some((s) => s.color.rgb === null) ? stops : [...stops.filter((s) => s.offset < cut).map((s) => ({ offset: s.offset / cut, color: s.color })), { offset: 1, color: c }];
                b = tip;
              }
            }
            return { kind: 'radial', stops: st, extend, x0: x0 + (x1 - x0) * a, y0: y0 + (y1 - y0) * a, r0: Math.max(r(a), 0), x1: x0 + (x1 - x0) * b, y1: y0 + (y1 - y0) * b, r1: Math.max(r(b), 0) };
          });
          return fill ? [{ op: 'paint', fill }] : [];
        }
        case 8:
        case 9: {
          // PaintSweepGradient: 角度は、1.0 を足して 180° を掛けた、反時計回りの度
          const line = this.colorLine(at + colr.u24(at + 1), format === 9, pal);
          const cx = colr.i16(at + 4);
          const cy = colr.i16(at + 6);
          const start = (colr.f2(at + 8) + 1) * 180;
          const end = (colr.f2(at + 10) + 1) * 180;
          // 始まりと終わりの角度が同じで、延ばし方が repeat・reflect なら、描かない (COLR の「Sweep gradients」)
          if (start === end && line.extend !== 0) return [];
          const fill = this.gradient(line, (lo, hi, stops, extend) => ({ kind: 'sweep', stops, extend, cx, cy, start: start + (end - start) * lo, end: start + (end - start) * hi }));
          return fill ? [{ op: 'paint', fill }] : [];
        }
        case 10: {
          // PaintGlyph: 字形の輪郭で切り抜いて、子を描く。子が塗り 1 つなら、輪郭をその塗りで塗る
          const ops = child(colr.u24(at + 1));
          const outline = this.outline(colr.u16(at + 4));
          if (!ops.length || !outline.length) return [];
          if (ops.length === 1 && ops[0].op === 'paint') return [{ op: 'fill', path: outline, fill: ops[0].fill }];
          return [{ op: 'clip', path: outline, ops }];
        }
        case 11: {
          // PaintColrGlyph: BaseGlyphList の別の字形の木を、部品として描く。その字形の ClipBox があれば、それで切り抜く
          const g = colr.u16(at + 1);
          const root = this.baseGlyphPaint(g);
          if (root === undefined) return [];
          const ops = this.paint(root, pal, next, budget);
          const box = this.clipBox(g);
          return box && ops.length ? [{ op: 'clip', path: boxPath(box), ops }] : ops;
        }
        case 12:
        case 13: {
          // PaintTransform: Affine2x3 (xx・yx・xy・yy・dx・dy。x′ = xx·x + xy·y + dx、y′ = yx·x + yy·y + dy)
          const t = at + colr.u24(at + 4);
          return wrap([colr.fixed(t), colr.fixed(t + 4), colr.fixed(t + 8), colr.fixed(t + 12), colr.fixed(t + 16), colr.fixed(t + 20)], child(colr.u24(at + 1)));
        }
        case 14:
        case 15:
          return wrap([1, 0, 0, 1, colr.i16(at + 4), colr.i16(at + 6)], child(colr.u24(at + 1)));
        case 16:
        case 17:
          return wrap([colr.f2(at + 4), 0, 0, colr.f2(at + 6), 0, 0], child(colr.u24(at + 1)));
        case 18:
        case 19:
          return wrap(around([colr.f2(at + 4), 0, 0, colr.f2(at + 6), 0, 0], colr.i16(at + 8), colr.i16(at + 10)), child(colr.u24(at + 1)));
        case 20:
        case 21:
          return wrap([colr.f2(at + 4), 0, 0, colr.f2(at + 4), 0, 0], child(colr.u24(at + 1)));
        case 22:
        case 23:
          return wrap(around([colr.f2(at + 4), 0, 0, colr.f2(at + 4), 0, 0], colr.i16(at + 6), colr.i16(at + 8)), child(colr.u24(at + 1)));
        case 24:
        case 25:
        case 26:
        case 27: {
          // PaintRotate: 角度は 1.0 が 180° (反時計回り)。行列は xx = cos θ、yx = sin θ、xy = −sin θ、yy = cos θ
          const th = colr.f2(at + 4) * Math.PI;
          const m: Matrix = [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th), 0, 0];
          return wrap(format >= 26 ? around(m, colr.i16(at + 6), colr.i16(at + 8)) : m, child(colr.u24(at + 1)));
        }
        case 28:
        case 29:
        case 30:
        case 31: {
          // PaintSkew: x の向きの角度 φ、y の向きの角度 ψ (1.0 が 180°)。行列は xx = yy = 1、yx = tan ψ、xy = −tan φ
          const m: Matrix = [1, Math.tan(colr.f2(at + 6) * Math.PI), -Math.tan(colr.f2(at + 4) * Math.PI), 1, 0, 0];
          return wrap(format >= 30 ? around(m, colr.i16(at + 8), colr.i16(at + 10)) : m, child(colr.u24(at + 1)));
        }
        case 32: {
          // PaintComposite: 先に backdrop、次に source を、合成の種類で重ねる。知らない種類は CLEAR (何も描かない)
          const mode = colr.u8(at + 4);
          if (mode > COMPOSITE.HSL_LUMINOSITY || mode === COMPOSITE.CLEAR) return [];
          const source = child(colr.u24(at + 1));
          const backdrop = child(colr.u24(at + 5));
          if (mode === COMPOSITE.SRC) return source;
          if (mode === COMPOSITE.DEST) return backdrop;
          if (mode === COMPOSITE.SRC_OVER) return [...backdrop, ...source];
          if (mode === COMPOSITE.DEST_OVER) return [...source, ...backdrop];
          // 片方が空のとき: 相手の無い所だけに残る種類は残る方を、相手のある所だけに残る種類は何も描かない
          if (!source.length || !backdrop.length) {
            const keepsBackdrop = mode !== COMPOSITE.SRC_IN && mode !== COMPOSITE.DEST_IN && mode !== COMPOSITE.SRC_OUT && mode !== COMPOSITE.DEST_ATOP;
            const keepsSource = mode !== COMPOSITE.SRC_IN && mode !== COMPOSITE.DEST_IN && mode !== COMPOSITE.DEST_OUT && mode !== COMPOSITE.SRC_ATOP;
            return !source.length ? (keepsBackdrop ? backdrop : []) : keepsSource ? source : [];
          }
          return [{ op: 'composite', mode, source, backdrop }];
        }
        default:
          return [];
      }
    } catch {
      // 表の範囲の外を指す Paint は、その部分木を描かない
      return [];
    }
  }

  // ---- SVG ----

  private svgGlyph(gid: number, sel?: FontPalette): ColorGlyph | undefined {
    const svg = this.svg;
    if (!svg || !this.svgReader) return undefined;
    const doc = this.svgDocument(gid);
    if (!doc) return undefined;
    const r = this.svgReader(doc, gid, this.unitsPerEm, this.palette(sel));
    return r ? this.finish(r.ops, 'svg') : undefined;
  }

  /** SVG の表の、字形 gid を含む文書 (圧縮されていれば、そのままのバイト列)。無ければ undefined */
  svgDocument(gid: number): Uint8Array | undefined {
    const svg = this.svg;
    if (!svg) return undefined;
    try {
      // SVG の表の見出し: version (uint16)・svgDocumentListOffset (Offset32)。文書の一覧: numEntries (uint16) と
      // SVGDocumentRecord (startGlyphID・endGlyphID・svgDocOffset (一覧の先頭から)・svgDocLength)。字形の番号の昇順
      const listAt = svg.u32(2);
      let lo = 0;
      let hi = svg.u16(listAt) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rec = listAt + 2 + mid * 12;
        if (svg.u16(rec + 2) < gid) lo = mid + 1;
        else if (svg.u16(rec) > gid) hi = mid - 1;
        else return svg.bytes(listAt + svg.u32(rec + 4), svg.u32(rec + 8));
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  // ---- CBDT/CBLC ----

  private cbdtGlyph(gid: number): ColorGlyph | undefined {
    if (!this.cblc) return undefined;
    let img = this.bitmapMemo.get(gid);
    if (img === undefined) {
      img = this.cbdtImage(gid) ?? null;
      if (this.bitmapMemo.size > 20000) this.bitmapMemo.clear();
      this.bitmapMemo.set(gid, img);
    }
    return img ? this.finish([img], 'cbdt') : undefined;
  }

  private cbdtImage(gid: number): Extract<ColorOp, { op: 'image' }> | undefined {
    const cblc = this.cblc!;
    const cbdt = this.cbdt!;
    const numSizes = cblc.u32(4);
    // 大きさ (strike) ごとの BitmapSize (48 バイト)。PDF・画面のどちらも拡大・縮小して描くので、その字形を持つ、いちばん大きい大きさを使う
    // (CBDT の「Scaling behavior」: 望む大きさより大きい、いちばん近いものを縮めるのがよい)
    let best: { ppemX: number; ppemY: number; sub: number; first: number; last: number } | undefined;
    for (let s = 0; s < numSizes; s++) {
      const rec = 8 + s * 48;
      const listAt = cblc.u32(rec);
      const count = cblc.u32(rec + 8);
      const ppemX = cblc.u8(rec + 44);
      const ppemY = cblc.u8(rec + 45);
      if (gid < cblc.u16(rec + 40) || gid > cblc.u16(rec + 42) || !ppemX || !ppemY) continue;
      if (best && ppemY <= best.ppemY) continue;
      for (let i = 0; i < count; i++) {
        const first = cblc.u16(listAt + i * 8);
        const last = cblc.u16(listAt + i * 8 + 2);
        if (gid >= first && gid <= last) {
          best = { ppemX, ppemY, sub: listAt + cblc.u32(listAt + i * 8 + 4), first, last };
          break;
        }
      }
    }
    if (!best) return undefined;
    // 索引の部分表 (IndexSubtable。EBLC の形式 1〜5): 見出し (indexFormat・imageFormat・imageDataOffset) の後に、字形ごとの位置
    const { sub, first, last } = best;
    const indexFormat = cblc.u16(sub);
    const imageFormat = cblc.u16(sub + 2);
    const dataAt = cblc.u32(sub + 4);
    let start: number;
    let end: number;
    /** 形式 2・5 の、部分表の中の共通の寸法 (BigGlyphMetrics) の位置 */
    let sharedMetrics: number | undefined;
    if (indexFormat === 1) {
      start = cblc.u32(sub + 8 + (gid - first) * 4);
      end = cblc.u32(sub + 8 + (gid - first + 1) * 4);
    } else if (indexFormat === 2) {
      const size = cblc.u32(sub + 8);
      sharedMetrics = sub + 12;
      start = (gid - first) * size;
      end = start + size;
    } else if (indexFormat === 3) {
      start = cblc.u16(sub + 8 + (gid - first) * 2);
      end = cblc.u16(sub + 8 + (gid - first + 1) * 2);
    } else if (indexFormat === 4) {
      const n = cblc.u32(sub + 8);
      let k = -1;
      for (let i = 0; i < n; i++) if (cblc.u16(sub + 12 + i * 4) === gid) { k = i; break; }
      if (k < 0) return undefined;
      start = cblc.u16(sub + 12 + k * 4 + 2);
      end = cblc.u16(sub + 12 + (k + 1) * 4 + 2);
    } else if (indexFormat === 5) {
      const size = cblc.u32(sub + 8);
      sharedMetrics = sub + 12;
      const n = cblc.u32(sub + 20);
      let k = -1;
      for (let i = 0; i < n; i++) if (cblc.u16(sub + 24 + i * 2) === gid) { k = i; break; }
      if (k < 0) return undefined;
      start = k * size;
      end = start + size;
    } else return undefined;
    void last;
    // 位置が同じ (長さ 0) なら、この字形の画像は無い
    if (end <= start) return undefined;
    const at = dataAt + start;
    // 画像の形式 17 (小さい寸法 + PNG)・18 (大きい寸法 + PNG)・19 (寸法は CBLC。PNG)。どれも、寸法の後に dataLen (uint32) と PNG
    let width: number;
    let height: number;
    let bearingX: number;
    let bearingY: number;
    let png: Uint8Array;
    if (imageFormat === 17) {
      height = cbdt.u8(at);
      width = cbdt.u8(at + 1);
      bearingX = cbdt.i8(at + 2);
      bearingY = cbdt.i8(at + 3);
      png = cbdt.bytes(at + 9, cbdt.u32(at + 5));
    } else if (imageFormat === 18) {
      height = cbdt.u8(at);
      width = cbdt.u8(at + 1);
      bearingX = cbdt.i8(at + 2);
      bearingY = cbdt.i8(at + 3);
      png = cbdt.bytes(at + 12, cbdt.u32(at + 8));
    } else if (imageFormat === 19 && sharedMetrics !== undefined) {
      height = cblc.u8(sharedMetrics);
      width = cblc.u8(sharedMetrics + 1);
      bearingX = cblc.i8(sharedMetrics + 2);
      bearingY = cblc.i8(sharedMetrics + 3);
      png = cbdt.bytes(at + 4, cbdt.u32(at));
    } else return undefined;
    if (!width || !height || !bitmapSize(png)) return undefined;
    // 寸法は、その大きさ (ppem) の画素の数。書体の単位へは unitsPerEm / ppem を掛ける。
    // bearingX は原点から画像の左端まで、bearingY は原点 (基線) から画像の上端まで
    const sx = this.unitsPerEm / best.ppemX;
    const sy = this.unitsPerEm / best.ppemY;
    return { op: 'image', kind: 'png', data: png, x: bearingX * sx, y: (bearingY - height) * sy, w: width * sx, h: height * sy };
  }

  // ---- sbix ----

  private sbixGlyph(gid: number): ColorGlyph | undefined {
    if (!this.sbix) return undefined;
    let img = this.bitmapMemo.get(gid);
    if (img === undefined) {
      img = this.sbixImage(gid, 0) ?? null;
      if (this.bitmapMemo.size > 20000) this.bitmapMemo.clear();
      this.bitmapMemo.set(gid, img);
    }
    return img ? this.finish([img], 'sbix') : undefined;
  }

  private sbixImage(gid: number, depth: number): Extract<ColorOp, { op: 'image' }> | undefined {
    const sbix = this.sbix!;
    const numGlyphs = this.fk.numGlyphs;
    if (gid < 0 || gid >= numGlyphs || depth > 8) return undefined;
    const numStrikes = sbix.u32(4);
    // その字形の画像を持つ、いちばん大きい大きさ (strike) を使う (sbix の「Strikes」: どれかの大きさに画像があれば、画像で描く)
    let best: { ppem: number; data: number; len: number } | undefined;
    for (let s = 0; s < numStrikes; s++) {
      const strike = sbix.u32(8 + s * 4);
      const ppem = sbix.u16(strike);
      const a = sbix.u32(strike + 4 + gid * 4);
      const b = sbix.u32(strike + 4 + (gid + 1) * 4);
      // 字形のデータ: originOffsetX・originOffsetY (int16)・graphicType (Tag) の 8 バイトの後に、画像
      if (b - a > 8 && ppem && (!best || ppem > best.ppem)) best = { ppem, data: strike + a, len: b - a };
    }
    if (!best) return undefined;
    const ox = sbix.i16(best.data);
    const oy = sbix.i16(best.data + 2);
    const type = String.fromCharCode(sbix.u8(best.data + 4), sbix.u8(best.data + 5), sbix.u8(best.data + 6), sbix.u8(best.data + 7));
    // 'dupe': 中身は別の字形の番号 (uint16)。その字形の画像を使う
    if (type === 'dupe') return this.sbixImage(sbix.u16(best.data + 8), depth + 1);
    if (type !== 'png ' && type !== 'jpg ') return undefined;
    const data = sbix.bytes(best.data + 8, best.len - 8);
    const size = bitmapSize(data);
    if (!size || !size.width || !size.height) return undefined;
    // 画像の画素と originOffset は、その大きさ (ppem) の画素の数として、unitsPerEm / ppem を掛けて書体の単位にする
    // (sbix の章は originOffset の単位を明記しない。FreeType・HarfBuzz は、大きさ (ppem) の画素として扱う)。
    // 画像の左下の角を、字形の原点から (originOffsetX, originOffsetY) に置く。glyf に輪郭のある字形では、原点の代わりに、
    // 輪郭の外接枠の左下 (xMin, yMin) を基準にする (sbix の「Glyph data」)
    const s = this.unitsPerEm / best.ppem;
    const box = segsBox(this.outline(gid));
    return { op: 'image', kind: size.kind, data, x: (box ? box[0] : 0) + ox * s, y: (box ? box[1] : 0) + oy * s, w: size.width * s, h: size.height * s };
  }
}

/** 既定で絵文字の表示になる字 (UTS #51 ED-6: default emoji presentation character = Emoji_Presentation の字) で始まるか */
const EMOJI_DEFAULT = /^\p{Emoji_Presentation}/u;

/**
 * 字 (か字の単位) が求める表示 (UTS #51 の 4 章 Presentation Style):
 *  - 'emoji': 絵文字の表示の指定 (U+FE0F VARIATION SELECTOR-16。ED-9) を含む。または、既定で絵文字の表示になる字 (ED-6) で始まる
 *  - 'text': 文字の表示の指定 (U+FE0E VARIATION SELECTOR-15。ED-8) を含む
 *  - undefined: どちらでもない (既定で文字の表示になる字だけ、絵文字でない字)
 * explicit は、異体字セレクタで指定されているか
 */
export function presentationOf(unit: string): { want: 'emoji' | 'text'; explicit: boolean } | undefined {
  if (unit.includes('\uFE0F')) return { want: 'emoji', explicit: true };
  if (unit.includes('\uFE0E')) return { want: 'text', explicit: true };
  return EMOJI_DEFAULT.test(unit) ? { want: 'emoji', explicit: false } : undefined;
}

/**
 * 後備の書体の候補を、求める表示に合うものが先になるように並べ直す (同じ組の中の順は変えない): 絵文字の表示なら色つきの表を持つ書体、
 * 文字の表示なら色つきの表を持たない書体を先にする (CSS Fonts 4 §9.3 の注: 絵文字の表示を求められたとき、色つきの表を持たない書体を
 * 候補から外してよい)。候補に色つきの書体が無ければ、元の配列をそのまま返す (色つきの書体を読み込んでいない文書では、何も変わらない)
 */
export function orderByPresentation<T extends { fk: unknown; buffer: ArrayBuffer }>(fonts: T[], unit: string): T[] {
  const p = presentationOf(unit);
  if (!p || !fonts.some((f) => colorFontOf(f))) return fonts;
  const color = fonts.filter((f) => colorFontOf(f));
  const plain = fonts.filter((f) => !colorFontOf(f));
  return p.want === 'emoji' ? [...color, ...plain] : [...plain, ...color];
}

/** 書体 (fontkit の書体) ごとの結果。色つきの表が無ければ null */
const memo = new WeakMap<object, ColorFont | null>();

/**
 * 書体が色つきの表 (COLR + CPAL・CBDT + CBLC・sbix・SVG) を持てば、その読み手。持たなければ undefined。
 * 書体ごとに 1 度だけ表の一覧を見て、結果を覚える
 */
export function colorFontOf(font: { fk: unknown; buffer: ArrayBuffer }): ColorFont | undefined {
  const fk = font.fk as FkFont;
  let cf = memo.get(fk);
  if (cf === undefined) {
    cf = null;
    try {
      const dir = tableDirectory(font.buffer);
      if ((dir.has('COLR') && dir.has('CPAL')) || (dir.has('CBDT') && dir.has('CBLC')) || dir.has('sbix') || dir.has('SVG ')) {
        const c = new ColorFont(fk, font.buffer, dir);
        if (c.tables.colr !== undefined || c.tables.cbdt || c.tables.sbix || c.tables.svg) cf = c;
      }
    } catch {
      cf = null;
    }
    memo.set(fk, cf);
  }
  return cf ?? undefined;
}

/**
 * 書体を登録するときに呼ぶ (fontManager.ts の registerBuffer)。輪郭の表 (glyf・CFF・CFF2) を持たない、ビットマップだけの書体
 * (CBDT/CBLC の Noto Color Emoji など) を、@pdf-lib/fontkit で組めるようにする: fontkit の getGlyph は、輪郭の表が無いと null を返し、
 * 字の並びを組む layout が例外で止まる。その書体の物 (インスタンス) の getGlyph だけを差し替えて、送り (hmtx・vmtx) を持つ、
 * 輪郭の空の字形を返す。ほかの書体 (輪郭の表のある書体。色つきの表の無い書体も含む) には、何もしない
 */
export function prepareColorFont(fk: unknown): void {
  const f = fk as FkFont & { _getBaseGlyph?: unknown };
  const t = f.directory?.tables;
  if (!t || t.glyf || t['CFF '] || t.CFF2) return;
  if (!(t.CBDT || t.sbix || t.COLR || t['SVG '])) return;
  // fontkit の字形の基底の型 (Glyph。輪郭は空で、送りは hmtx・vmtx から読む) を、TrueType の字形の型の親から取り出す
  const proto = Object.getPrototypeOf(f) as { _getBaseGlyph?: (this: unknown, id: number, cps?: number[]) => object | null };
  let Base: (new (id: number, cps: number[], font: unknown) => object) | undefined;
  for (let p: typeof proto | null = proto; p && !Base; p = Object.getPrototypeOf(p)) {
    if (!Object.hasOwn(p, '_getBaseGlyph') || typeof p._getBaseGlyph !== 'function') continue;
    try {
      const sample = p._getBaseGlyph.call({ _glyphs: {}, directory: { tables: { glyf: {} } } }, 0);
      const parent = sample && Object.getPrototypeOf(Object.getPrototypeOf(sample));
      if (parent && typeof parent._getPath === 'function') Base = parent.constructor;
    } catch {
      // 型が取り出せなければ、差し替えない
    }
  }
  if (!Base) return;
  const make = function (this: FkFont, id: number, codePoints: number[] = []) {
    const glyphs = (this._glyphs ??= {});
    return (glyphs[id] ??= new Base!(id, codePoints, this));
  };
  f.getGlyph = make;
  f._getBaseGlyph = make as never;
}

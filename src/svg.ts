/**
 * svg — SVG を「PDF のベクタ命令に落とせる図形リスト」に変換する。
 *
 * 対応: svg / g / path / rect / circle / ellipse / line / polyline / polygon
 *       fill・stroke・stroke-width・opacity・fill-opacity・stroke-opacity・fill-rule・stroke-linecap/linejoin/dasharray/dashoffset/miterlimit・
 *       transform・style 属性・display:none (サブツリーごと無視)・viewBox
 *       線形・円形グラデーション (塗り・線。gradientUnits・gradientTransform・href の継承・spreadMethod・fr)・clipPath (userSpaceOnUse)・use / symbol・
 *       pattern・mask (ソフトマスク)・text (字形の輪郭。letter-spacing・textLength・lengthAdjust・text-decoration)・textPath・marker・
 *       style 要素 (単純な選択子)・入れ子の svg・switch
 *       Kumiori の拡張 (CGM の字のため): data-max-length・data-fit・data-kendot (text)、data-rotate・data-extend (textPath)
 *       image (PNG・JPEG。href が data: か、呼ぶ側の引く外のファイル。preserveAspectRatio の meet・slice・none)
 *       mix-blend-mode (normal のほかの 15 通り。図形・画像の要素のもの。PDF の BM。g などの子を持つ要素のものは無視して描く)
 * 非対応 (null を返す = 呼び出し側でラスタライズに切り替える。Node では仮の枠):
 *   filter (Node では影とぼかしなどを近似)・PNG・JPEG でない data: の画像・読めない CSS 選択子 (引けない外のファイルの image は描かない)
 *
 * 変換は座標に焼き込む (transform を適用済みの 点列) ので、描画側は cm のネストを持たなくてよい。
 */
import { fromBase64 } from './base64';
import { parseColor } from './color';
import { createSelectorMemo, matches, parentDecides, parseSelectorList, type Selector, type SelectorMemo } from './cssSelector';
import { decodeBmp, decodeGif, encodePngStored } from './pixels';
import { decodeWebp } from './webp';
import { lineBreakActions } from './lineBreak';
import { IDENTITY as ID, invert, mul, transformSegs, type Matrix, type Seg } from './matrix';
import { defaultSubregion, subregionAttrs, subregionRefs } from './svgFilterSubregion';

export type { Seg } from './matrix';

export interface XmlNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  childNodes: ArrayLike<XmlNode>;
  getAttribute?(k: string): string | null;
  hasAttribute?(k: string): boolean;
  textContent?: string | null;
}

/** グラデーション (PDF の shading pattern になる) */
export interface SvgGradient {
  kind: 'linear' | 'radial';
  /** linear: [x1, y1, x2, y2] / radial: [fx, fy, fr, cx, cy, r] (グラデーション空間。PDF の Coords と同じ並び) */
  coords: number[];
  /** offset 0〜1 の昇順。色は #rrggbb、opacity は stop-opacity (1 なら省く) */
  stops: Array<{ offset: number; color: string; opacity?: number }>;
  /** グラデーション空間 → SVG のルートの座標 */
  matrix: [number, number, number, number, number, number];
}

/** 切り抜き (clipPath)。複数あれば、すべての共通部分 */
export interface SvgClip {
  segs: Seg[];
  evenOdd: boolean;
}

/** マスク (mask)。中身の図形 (ルートの座標) を描いた輝度で、図形を隠す */
export interface SvgMask {
  shapes: SvgShape[];
  /** mask-type: alpha (中身の不透明度で隠す。CSS Masking 1 §9.2。既定の luminance は輝度で隠す) */
  alpha?: boolean;
}

/** 模様 (pattern)。PDF のタイリングパターンになる */
export interface SvgPattern {
  /** 1 枚のタイルの大きさ (タイルの座標) */
  width: number;
  height: number;
  /** タイルの座標 → SVG のルートの座標 */
  matrix: [number, number, number, number, number, number];
  /** タイルの中身 (タイルの座標) */
  shapes: SvgShape[];
}

export interface SvgShape {
  segs: Seg[];
  /** CSS 色 (#rrggbb)。無ければ塗らない */
  fill?: string;
  /** 塗りのグラデーション (fill より優先) */
  fillPaint?: SvgGradient;
  /** 塗りの模様 (fill より優先) */
  fillPattern?: SvgPattern;
  /** 線のグラデーション (stroke より優先) */
  strokePaint?: SvgGradient;
  /** 切り抜き */
  clips?: SvgClip[];
  /** マスク (中身の輝度で隠す。PDF ではソフトマスク)。外側の要素のものから順に */
  masks?: SvgMask[];
  evenOdd: boolean;
  stroke?: string;
  strokeWidth: number;
  /** strokeWidth (と dash) は、ページの上の太さ (CSS px)。絵の拡大縮小を受けない (vector-effect="non-scaling-stroke") */
  nonScalingStroke?: boolean;
  /**
   * 形の大きさがページの上の大きさ (CSS px) の図形 (vector-effect="non-scaling-size")。segs は、この点 (SVG のルートの座標) を
   * 原点として、拡大縮小・回転を受けない大きさで置いてある。描くときに、この点を中心に、絵を置く拡大率の逆数で縮める
   */
  nonScalingAnchor?: [number, number];
  lineCap: 0 | 1 | 2;
  lineJoin: 0 | 1 | 2;
  dash?: number[];
  /** 破線の始めのずらし (stroke-dashoffset。dash と同じ単位) */
  dashOffset?: number;
  /** 尖ったつなぎの上限 (stroke-miterlimit。線の太さに対する比。既定 4) */
  miterLimit?: number;
  /** 塗り・線の不透明度 (祖先の opacity を掛けた値) */
  fillOpacity: number;
  strokeOpacity: number;
  /**
   * 画像 (image 要素の PNG・JPEG)。
   * matrix は、PDF の画像の単位正方形 (左下が原点、上の辺が画像の 1 行目) → SVG のルートの座標
   */
  image?: {
    kind: 'png' | 'jpeg';
    bytes: Uint8Array;
    matrix: [number, number, number, number, number, number];
    /** filter を画素で計算した画像の画素 (bytes は圧縮しない PNG。呼ぶ側が、圧縮した PNG にして埋め込む) */
    pixels?: FilterRasterResult;
  };
  /** 描画モード (mix-blend-mode。normal のほかの 15 通り。PDF の ExtGState の BM) */
  blend?: SvgBlend;
  /**
   * 透明のグループ (Compositing and Blending 1 §3.3 の isolated group)。子の図形を、まとめて重ねてから、fillOpacity の不透明度と
   * blend の描画モードで置く (PDF では、透明のグループの Form XObject。ISO 32000-2 §11.6.6)。このとき segs は空
   */
  group?: { shapes: SvgShape[] };
  /** リンク (a 要素の href。SVG 2 の Linking の章の a 要素。http(s)・mailto などの絶対の URL だけ)。PDF では、図形の外接矩形のリンクの注釈にする */
  link?: string;
  /**
   * 文字 (text 要素の字)。segs はその字の形。PDF に書くときは、塗りだけの単色の字なら、segs の代わりに書体の文字として描く
   * (ビューアの字の描き方 (ヒンティング) が本文と同じになり、文字として選べる)。
   * matrix は字の座標 (基線の上の原点、x 右向き、y 下向き、単位はユーザー単位) → SVG のルートの座標。size は字の大きさ
   */
  text?: { chars: TextChars; size: number; matrix: [number, number, number, number, number, number] };
}

/**
 * mix-blend-mode の値 (Compositing and Blending 1 §3.4.1。normal を除く)。PDF の描画モード (ISO 32000-2 §11.3.5) と同じ 15 通りで、
 * 名前は PDF の BM の名前の小文字・ハイフン区切り
 */
export const SVG_BLENDS = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type SvgBlend = (typeof SVG_BLENDS)[number];

/** filter を画素で計算するときに渡すもの (svgFilterRaster.ts の rasterFilter) */
export interface FilterRasterRequest {
  /** filter の要素 (順に)。name は小文字の要素名。color はその要素の色の性質 (flood-color・lighting-color) と不透明度の性質の、乗算していない RGBA */
  prims: Array<{
    name: string;
    attr: (k: string) => string | undefined;
    linear: boolean;
    color: (colorProp: string, opacityProp?: string) => number[];
    colorMatrix: () => number[];
    componentTransfer: () => (c: number[]) => number[];
    children: Array<{ name: string; attr: (k: string) => string | undefined }>;
    /** feImage の中身 (部分領域。要素の座標) の図形 (根の座標) */
    image: (box: { x: number; y: number; w: number; h: number }) => SvgShape[] | undefined;
  }>;
  /** filter を付けた要素の図形 (根の座標) */
  source: SvgShape[];
  /** filter の領域 (要素の座標) */
  region: { x: number; y: number; w: number; h: number };
  /** 要素の座標 → 根の座標 */
  toRoot: [number, number, number, number, number, number];
  /** 要素の座標の 1 単位あたりの画素の数 */
  pxPerUnit: number;
  /** 要素の外接矩形 (要素の座標)。primitiveUnits が objectBoundingBox のときの基準 */
  bbox?: { x: number; y: number; w: number; h: number };
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox';
  /** 要素の viewport の大きさ (要素の座標)。primitiveUnits が userSpaceOnUse のときの、要素の x・y・width・height の百分率の基準 */
  viewport?: { w: number; h: number };
  /** 要素の塗り・線の色 (FillPaint・StrokePaint。単色のときだけ。乗算していない RGBA) */
  fillPaint?: number[];
  strokePaint?: number[];
  /**
   * 画素の計算の予算の使った量 (1 つの SVG のすべての filter で同じものを渡す。rasterFilter が足していき、尽きたら null を返す。
   * filter を付けた要素が多い・入れ子の SVG で止まらなくなっていた)
   */
  budget?: { used?: number };
}
/** filter を画素で計算した結果 (filter の領域の画素。sRGB・8 ビットの RGBA。乗算していない) */
export interface FilterRasterResult {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * 拡大しない線・大きさ (vector-effect の non-scaling-stroke・non-scaling-size。SVG 2 §13.3.1) の図形を、ふつうの図形にする。
 * f は、ページの上の 1 CSS px にあたる SVG の根の座標の長さ (0.75pt を、SVG を置く拡大率で割ったもの)。線の太さ・破線の長さとずれを f 倍し、
 * 拡大しない大きさの図形は、原点 (nonScalingAnchor) の周りに f 倍に縮める。PDF・SVG・PNG の書き出しで同じ式を使う
 */
export function resolveNonScaling(sh: SvgShape, f: number): SvgShape {
  if (sh.nonScalingStroke) sh = { ...sh, nonScalingStroke: false, strokeWidth: sh.strokeWidth * f, ...(sh.dash ? { dash: sh.dash.map((x) => x * f) } : {}), ...(sh.dashOffset ? { dashOffset: sh.dashOffset * f } : {}) };
  const a = sh.nonScalingAnchor;
  if (a) {
    const sc = (x: number, y: number) => ({ x: a[0] + (x - a[0]) * f, y: a[1] + (y - a[1]) * f });
    const segs = sh.segs.map((g) =>
      g.op === 'Z' ? g : g.op === 'C' ? { op: 'C' as const, ...sc(g.x, g.y), ...((p1, p2) => ({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }))(sc(g.x1, g.y1), sc(g.x2, g.y2)) } : { op: g.op, ...sc(g.x, g.y) },
    );
    sh = { ...sh, segs, nonScalingAnchor: undefined };
  }
  return sh;
}

/**
 * 図形の並びを、グループ (SvgShape.group) を開いた並びにする (グループを描けない描き手のため)。グループの不透明度は子の図形に掛け、
 * 描画モードは、自分の描画モードの無い子に付ける。グループの切り抜き・マスクは、子の切り抜き・マスクの前 (外側) に足す
 * (重なった子の重ね方・マスクの掛かり方は、グループで描いたものと少し違う。子ごとに掛かる)
 */
export function flattenGroups(shapes: SvgShape[]): SvgShape[] {
  return shapes.flatMap((sh) =>
    sh.group
      ? flattenGroups(sh.group.shapes).map((c) => ({
          ...c,
          fillOpacity: c.fillOpacity * sh.fillOpacity,
          strokeOpacity: c.strokeOpacity * sh.fillOpacity,
          ...(sh.blend && !c.blend ? { blend: sh.blend } : {}),
          ...(sh.clips?.length ? { clips: [...sh.clips, ...(c.clips ?? [])] } : {}),
          ...(sh.masks?.length ? { masks: [...sh.masks, ...(c.masks ?? [])] } : {}),
        }))
      : [sh],
  );
}

/**
 * filter の近似 (影・色の変換) のために、グループを開く (flattenGroups と同じ)。ただし、切り抜き・マスクの付いたグループは開かずに残す
 * (中のグループは開く)。そのグループは、近似の写しを作る所 (blurredCopies) が、グループのまま写す
 */
function openForFilter(shapes: SvgShape[]): SvgShape[] {
  return shapes.flatMap((sh) => {
    if (!sh.group) return [sh];
    if (sh.clips?.length || sh.masks?.length) return [{ ...sh, group: { shapes: openForFilter(sh.group.shapes) } }];
    return openForFilter(sh.group.shapes).map((c) => ({ ...c, fillOpacity: c.fillOpacity * sh.fillOpacity, strokeOpacity: c.strokeOpacity * sh.fillOpacity, ...(sh.blend && !c.blend ? { blend: sh.blend } : {}) }));
  });
}

/**
 * 図形の並びに付いた切り抜き (SvgShape.clips) を、図形ごとに書き直さずに、続く図形でまとめて書く手順。
 * PDF の切り抜きは、q で積んだ状態の中で、Q で戻すまで効き続ける (ISO 32000-2 §8.4.2・§8.5.4) ので、前の図形と前から同じ (同じ物の)
 * 切り抜きは開いたまま次の図形を描き、違うところから後ろだけを閉じて開き直す。切り抜き 1 つを 1 段の q で開く (外側の切り抜きだけが同じ
 * 図形が続いたとき、内側だけを閉じられるように。q の入れ子は、clip-path の入れ子の深さになる)。切り抜きは領域の共通部分なので、外側で
 * まとめて掛けても、図形ごとに掛けても、描く結果は同じ。
 * steps[i] は i 番目の図形の前に、close 段の q を閉じ (Q)、open の切り抜きを 1 つずつ q で開く。最後に end 段を閉じる。
 * 図形そのものは、clips を外して描く。描く側 (pdfRenderer.ts・colorGlyphSvg.ts) と、線分の予算 (parseSvg) が、同じ手順を使う
 */
export function clipRuns(shapes: readonly SvgShape[]): { steps: Array<{ close: number; open: SvgClip[] }>; end: number } {
  const open: SvgClip[] = [];
  const steps = shapes.map((sh) => {
    const cl = sh.clips ?? [];
    let k = 0;
    while (k < open.length && k < cl.length && open[k] === cl[k]) k++;
    const close = open.length - k;
    open.length = k;
    const add = cl.slice(k);
    open.push(...add);
    return { close, open: add };
  });
  return { steps, end: open.length };
}

/** 図形と、その中の図形 (グループの子・模様の中身・マスクの中身) を、すべて訪ねる */
export function eachSvgShape(shapes: SvgShape[], fn: (sh: SvgShape) => void): void {
  for (const sh of shapes) {
    fn(sh);
    if (sh.group) eachSvgShape(sh.group.shapes, fn);
    if (sh.fillPattern) eachSvgShape(sh.fillPattern.shapes, fn);
    for (const mk of sh.masks ?? []) eachSvgShape(mk.shapes, fn);
  }
}

export interface SvgDoc {
  /** viewBox (無ければ 0 0 width height) */
  viewBox: [number, number, number, number];
  /** 画像の領域で切り抜かない (ParseOptions.rootOverflowVisible で、根の overflow が visible のとき) */
  noClip?: boolean;
  /** preserveAspectRatio。align が none なら引き伸ばす。既定 xMidYMid meet */
  aspect?: { align: string; slice: boolean };
  shapes: SvgShape[];
}

type M = Matrix;
/** 外接矩形 */
type Box = { x: number; y: number; w: number; h: number };

/** 繰り返し・折り返しのグラデーション (spreadMethod) を並べた後の、stop の数の上限 */
const MAX_SPREAD_STOPS = 100_000;

/**
 * spreadMethod の repeat・reflect (SVG 1.1 §13.2.2)。PDF のシェーディングは端の色を延ばす (pad) しか持たないので、
 * 図形を覆う範囲まで stop を繰り返して並べ、座標をその範囲に広げる。pts は図形の外接矩形の角 (グラデーションの空間)
 */
function spreadGradient(g: SvgGradient, spread: 'repeat' | 'reflect', pts: number[][]) {
  const c = g.coords;
  let t0: number;
  let t1: number;
  if (g.kind === 'linear') {
    const [x1, y1, x2, y2] = c;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 1e-12)) return;
    const ts = pts.map(([x, y]) => ((x - x1) * dx + (y - y1) * dy) / len2);
    t0 = Math.floor(Math.min(...ts));
    t1 = Math.ceil(Math.max(...ts));
    // 繰り返しの数は 2000 まで、並べた stop の合計は MAX_SPREAD_STOPS まで (stop の多いグラデーションを繰り返して、数千万の stop を作らせない)
    if (t1 - t0 > 2000 || (t1 - t0) * g.stops.length > MAX_SPREAD_STOPS) return;
    g.coords = [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1];
  } else {
    // 円は t の関数: 中心 f + t (c - f)、半径 fr + t (r - fr)。焦点が円の中にあれば、t を大きくすると円は図形を覆う
    const [fx, fy, fr, cx, cy, r] = c;
    const dr = r - fr;
    const off = Math.hypot(cx - fx, cy - fy);
    if (!(dr > off + 1e-9)) return;
    const far = Math.max(...pts.map(([x, y]) => Math.hypot(x - fx, y - fy)));
    t1 = Math.max(1, Math.ceil((far - fr) / (dr - off)));
    // 半径が 0 になる t まで内側にも繰り返す (fr が 0 なら t0 = 0)
    t0 = fr > 0 ? -Math.ceil(fr / dr) : 0;
    // 繰り返しの数は 2000 まで、並べた stop の合計は MAX_SPREAD_STOPS まで (stop の多いグラデーションを繰り返して、数千万の stop を作らせない)
    if (t1 - t0 > 2000 || (t1 - t0) * g.stops.length > MAX_SPREAD_STOPS) return;
    const tz = fr > 0 ? -fr / dr : 0;
    const at = (t: number) => [fx + (cx - fx) * t, fy + (cy - fy) * t, fr + dr * t];
    const [ax, ay] = at(tz);
    const [bx, by, br] = at(t1);
    g.coords = [ax, ay, 0, bx, by, br];
    // 半径 0 の t (tz) から t1 までを 0〜1 にするので、周期の始まりを tz に合わせて並べ直す
    const span = t1 - tz;
    const out: SvgGradient['stops'] = [];
    for (let k = t0; k < t1; k++) {
      const rev = spread === 'reflect' && k % 2 !== 0;
      const seq = rev ? [...g.stops].reverse().map((s) => ({ ...s, offset: 1 - s.offset })) : g.stops;
      for (const s of seq) {
        const t = k + s.offset;
        if (t < tz - 1e-9) continue;
        out.push({ ...s, offset: (t - tz) / span });
      }
    }
    g.stops = clampStops(out);
    return;
  }
  const span = t1 - t0;
  const out: SvgGradient['stops'] = [];
  for (let k = t0; k < t1; k++) {
    const rev = spread === 'reflect' && k % 2 !== 0;
    const seq = rev ? [...g.stops].reverse().map((s) => ({ ...s, offset: 1 - s.offset })) : g.stops;
    for (const s of seq) out.push({ ...s, offset: (k - t0 + s.offset) / span });
  }
  g.stops = clampStops(out);
}

/** offset を 0〜1・昇順にそろえる */
function clampStops(stops: SvgGradient['stops']): SvgGradient['stops'] {
  let prev = 0;
  return stops.map((s) => {
    prev = Math.max(prev, Math.min(1, Math.max(0, s.offset)));
    return { ...s, offset: prev };
  });
}

/**
 * transform の値 → 行列 (読めなければ null)。SVG の属性の書き方 (CSS Transforms 1 §7.3: 単位の無い数は px と deg。rotate(a cx cy)) と、
 * §9.1 の 2D の関数 (単位の付いた値: 角度の deg・rad・grad・turn、長さの px など。translateX・scaleY・skew など。none) の両方を読む
 * (属性の書き方に無い関数も、ブラウザと同じに読む)。box は百分率の基準の箱 (transform-box。translate の % は、その幅・高さに対して)。無ければ % は読めない
 */
function parseTransform(s: string | null | undefined, box?: { w: number; h: number }): M | null {
  let m = ID;
  if (!s) return m;
  if (s.trim() === 'none') return ID;
  const re = /(?<!\w)([a-zA-Z][\w-]*)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  let any = false;
  let last = 0;
  /** 角度 (度)。単位の無い数は度 */
  const angle = (x: string) => {
    const mm = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(deg|rad|grad|turn)?$/i.exec(x);
    if (!mm) return NaN;
    const n = parseFloat(mm[1]);
    const u = (mm[2] ?? 'deg').toLowerCase();
    return u === 'rad' ? (n * 180) / Math.PI : u === 'grad' ? n * 0.9 : u === 'turn' ? n * 360 : n;
  };
  /** 長さ (利用者の単位)。% は箱の幅 (ref) に対して */
  const length = (x: string, ref?: number) => {
    const mm = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(px|pt|pc|mm|cm|in|q|%)?$/i.exec(x);
    if (!mm) return NaN;
    const n = parseFloat(mm[1]);
    const u = (mm[2] ?? 'px').toLowerCase();
    if (u === '%') return ref === undefined ? NaN : (n / 100) * ref;
    return n * ({ px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 } as Record<string, number>)[u];
  };
  /** 倍率 (数か百分率) */
  const factor = (x: string) => (/%$/.test(x) ? parseFloat(x) / 100 : /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(x) ? parseFloat(x) : NaN);
  while ((t = re.exec(s))) {
    // 関数の間には、空白・カンマのほかは書けない
    if (s.slice(last, t.index).replace(/[\s,]/g, '')) return null;
    last = t.index + t[0].length;
    any = true;
    const a = t[2].split(/[\s,]+/).filter(Boolean);
    let c: M;
    const nums = (f: (x: string) => number) => {
      const v = a.map(f);
      return v.every(Number.isFinite) ? v : null;
    };
    switch (t[1]) {
      case 'matrix': {
        const v = nums(Number);
        if (!v || v.length !== 6) return null;
        c = v as M;
        break;
      }
      case 'translate': {
        if (a.length < 1 || a.length > 2) return null;
        const x = length(a[0], box?.w);
        const y = a.length > 1 ? length(a[1], box?.h) : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        c = [1, 0, 0, 1, x, y];
        break;
      }
      case 'translateX':
      case 'translateY': {
        const d = a.length === 1 ? length(a[0], t[1] === 'translateX' ? box?.w : box?.h) : NaN;
        if (!Number.isFinite(d)) return null;
        c = t[1] === 'translateX' ? [1, 0, 0, 1, d, 0] : [1, 0, 0, 1, 0, d];
        break;
      }
      case 'scale': {
        const v = nums(factor);
        if (!v || v.length < 1 || v.length > 2) return null;
        c = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
        break;
      }
      case 'scaleX':
      case 'scaleY': {
        const v = nums(factor);
        if (!v || v.length !== 1) return null;
        c = t[1] === 'scaleX' ? [v[0], 0, 0, 1, 0, 0] : [1, 0, 0, v[0], 0, 0];
        break;
      }
      case 'rotate': {
        // SVG の rotate(a cx cy) は、(cx, cy) の周りに回す
        const deg = a.length ? angle(a[0]) : NaN;
        const cxy = a.slice(1).map((x) => length(x));
        if (!Number.isFinite(deg) || (a.length !== 1 && a.length !== 3) || !cxy.every(Number.isFinite)) return null;
        const r0 = (deg * Math.PI) / 180;
        const r: M = [Math.cos(r0), Math.sin(r0), -Math.sin(r0), Math.cos(r0), 0, 0];
        c = a.length === 3 ? mul(mul([1, 0, 0, 1, cxy[0], cxy[1]], r), [1, 0, 0, 1, -cxy[0], -cxy[1]]) : r;
        break;
      }
      case 'skew':
      case 'skewX':
      case 'skewY': {
        const v = nums(angle);
        if (!v || v.length < 1 || v.length > (t[1] === 'skew' ? 2 : 1)) return null;
        const ax = t[1] === 'skewY' ? 0 : v[0];
        const ay = t[1] === 'skewY' ? v[0] : t[1] === 'skew' ? (v[1] ?? 0) : 0;
        c = [1, Math.tan((ay * Math.PI) / 180), Math.tan((ax * Math.PI) / 180), 1, 0, 0];
        break;
      }
      default:
        return null;
    }
    m = mul(m, c);
  }
  if (s.slice(last).replace(/[\s,]/g, '')) return null;
  return any || !s.trim() ? m : null;
}

// ───────────── パス ─────────────

/** SVG の d 属性 → 絶対座標の M/L/C/Z。構文エラーは null */
export function parsePathData(d: string): Seg[] | null {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];
  const segs: Seg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let lastC: [number, number] | null = null; // 直前の C の第 2 制御点 (S 用)
  let lastQ: [number, number] | null = null; // 直前の Q の制御点 (T 用)
  const num = () => {
    const t = tokens[i++];
    const n = Number(t);
    if (t === undefined || !Number.isFinite(n) || /^[A-Za-z]$/.test(t)) throw new Error('bad path');
    return n;
  };
  const flag = () => {
    // A のフラグは 1 字の "0" か "1" (SVG 2 §9.3.9 の文法: flag::= ("0" | "1")) で、後の区切りは省ける。
    // "10"・"01.71" のように詰めて書かれると、数の字句が後の数とつながっているので、頭の 1 字だけを取り、残りを次の字句にする
    // (例: "0 01.71.29" は フラグ 0・フラグ 1・.71・.29。SVGO の出力でふつうの書き方)
    const t = tokens[i];
    if (t && /^[01]./.test(t)) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    return num();
  };
  try {
    while (i < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (!cmd) return null;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      let nextC: [number, number] | null = null;
      let nextQ: [number, number] | null = null;
      if (C === 'Z') {
        segs.push({ op: 'Z' });
        cx = sx;
        cy = sy;
        // closepath は引数を取らない (SVG 2 §9.3.4 と §9.3.9 の文法)。続く数は構文エラーなので、命令を忘れて、次の周で null を返す
        // (ここを抜かすと、数を読み進めないまま Z を足し続けて止まらない。誤りは、この関数のほかの誤りと同じく null にする)
        cmd = '';
      } else if (C === 'M') {
        cx = ox + num();
        cy = oy + num();
        sx = cx;
        sy = cy;
        segs.push({ op: 'M', x: cx, y: cy });
        cmd = rel ? 'l' : 'L'; // 続く座標は lineto
      } else if (C === 'L') {
        cx = ox + num();
        cy = oy + num();
        segs.push({ op: 'L', x: cx, y: cy });
      } else if (C === 'H') {
        cx = ox + num();
        segs.push({ op: 'L', x: cx, y: cy });
      } else if (C === 'V') {
        cy = oy + num();
        segs.push({ op: 'L', x: cx, y: cy });
      } else if (C === 'C' || C === 'S') {
        let x1: number;
        let y1: number;
        if (C === 'C') {
          x1 = ox + num();
          y1 = oy + num();
        } else {
          x1 = lastC ? 2 * cx - lastC[0] : cx;
          y1 = lastC ? 2 * cy - lastC[1] : cy;
        }
        const x2 = ox + num();
        const y2 = oy + num();
        const x = ox + num();
        const y = oy + num();
        segs.push({ op: 'C', x1, y1, x2, y2, x, y });
        nextC = [x2, y2];
        cx = x;
        cy = y;
      } else if (C === 'Q' || C === 'T') {
        let qx: number;
        let qy: number;
        if (C === 'Q') {
          qx = ox + num();
          qy = oy + num();
        } else {
          qx = lastQ ? 2 * cx - lastQ[0] : cx;
          qy = lastQ ? 2 * cy - lastQ[1] : cy;
        }
        const x = ox + num();
        const y = oy + num();
        segs.push({ op: 'C', x1: cx + (2 / 3) * (qx - cx), y1: cy + (2 / 3) * (qy - cy), x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y), x, y });
        nextQ = [qx, qy];
        cx = x;
        cy = y;
      } else if (C === 'A') {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const x = ox + num();
        const y = oy + num();
        for (const c of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) segs.push(c);
        cx = x;
        cy = y;
      } else return null;
      lastC = nextC;
      lastQ = nextQ;
    }
  } catch {
    return null;
  }
  return segs;
}

/** SVG 仕様 F.6 の端点パラメータ化 → 中心パラメータ化 → 90° 以下の三次ベジエ */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [{ op: 'L', x: x2, y: y2 }];
  const phi = (rotDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  let t = th1;
  for (let j = 0; j < n; j++) {
    const t2 = t + step;
    const e = (tt: number): [number, number] => [cp * rx * Math.cos(tt) - sp * ry * Math.sin(tt) + cx, sp * rx * Math.cos(tt) + cp * ry * Math.sin(tt) + cy];
    const d = (tt: number): [number, number] => [-cp * rx * Math.sin(tt) - sp * ry * Math.cos(tt), -sp * rx * Math.sin(tt) + cp * ry * Math.cos(tt)];
    const p1 = e(t);
    const p2 = e(t2);
    const d1 = d(t);
    const d2 = d(t2);
    out.push({
      op: 'C',
      x1: p1[0] + k * d1[0],
      y1: p1[1] + k * d1[1],
      x2: p2[0] - k * d2[0],
      y2: p2[1] - k * d2[1],
      x: j === n - 1 ? x2 : p2[0],
      y: j === n - 1 ? y2 : p2[1],
    });
    t = t2;
  }
  return out;
}


// ───────────── スタイル ─────────────

/** url(#id) の参照 (グラデーション) */
interface PaintRef {
  ref: string;
}

/** 模様・グラデーションを当てる座標系 (m) と、objectBoundingBox の基準の形 (segs。m の座標)。測れなければ undefined */
type PaintFrame = () => { segs: Seg[]; m: M } | undefined;
/**
 * context element (marker を付けた図形・use の要素) の塗り・線を、中身に渡すもの (Style.context)。frame は context element の座標系と
 * 外接矩形 (1 度だけ測る)。context element の塗り自体が、さらに外の context element から来たものなら、その座標系のまま
 */
function contextOf(s: Style, frame: PaintFrame): NonNullable<Style['context']> {
  let kept: { v: ReturnType<PaintFrame> } | undefined;
  const once: PaintFrame = () => (kept ??= { v: frame() }).v;
  return { fill: s.fill, stroke: s.stroke, fillAlpha: s.fillAlpha, strokeAlpha: s.strokeAlpha, fillFrame: s.fillFrame ?? once, strokeFrame: s.strokeFrame ?? once };
}
/** 矩形の形 (外接矩形を、模様・グラデーションの objectBoundingBox の基準に渡す) */
const rectSegs = (b: { x: number; y: number; w: number; h: number }): Seg[] => [
  { op: 'M', x: b.x, y: b.y },
  { op: 'L', x: b.x + b.w, y: b.y },
  { op: 'L', x: b.x + b.w, y: b.y + b.h },
  { op: 'L', x: b.x, y: b.y + b.h },
  { op: 'Z' },
];
interface Style {
  fill: string | null | PaintRef; // null = none
  stroke: string | null | PaintRef;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  evenOdd: boolean;
  lineCap: 0 | 1 | 2;
  lineJoin: 0 | 1 | 2;
  dash?: number[];
  dashOffset?: number;
  miterLimit?: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight: number;
  /** visibility が hidden・collapse (継承する。子が visible に戻せば、その子は描く。SVG 2 の visibility は CSS 2.1 §11.2 のもの) */
  hidden?: boolean;
  /**
   * context-fill・context-stroke (SVG 2 §13.2 の context element の塗り): marker の中身では marker を付けた図形の、use で置いた中身では
   * use の要素の塗り・線 (受け継ぐ)
   */
  context?: { fill: Style['fill']; stroke: Style['stroke']; fillAlpha?: number; strokeAlpha?: number; fillFrame?: PaintFrame; strokeFrame?: PaintFrame };
  /**
   * 塗り・線が context-fill・context-stroke から来た模様・グラデーションのときの、塗りの座標系と外接矩形 (context element のもの。
   * SVG 2 §13.2: 塗りの要素を当てる座標系と、大きさを合わせる外接矩形は、context element のものを使う)。
   * 無ければ、塗る図形そのものの座標系と外接矩形
   */
  fillFrame?: PaintFrame;
  strokeFrame?: PaintFrame;
  /**
   * 縦書き (writing-mode が縦。受け継ぐ) のときの字の向き (text-orientation。CSS Writing Modes 3 §5.1)。横書きは undefined
   */
  vertical?: 'mixed' | 'upright' | 'sideways';
  /** リンク (a 要素の中の図形。外側の a の href を受け継ぐ) */
  link?: string;
  /** letter-spacing・word-spacing (継承する。CSS Text 3 §8.2・§8.3。ユーザー単位。normal は 0) */
  letterSpacing?: number;
  wordSpacing?: number;
  /**
   * text-decoration (SVG 1.1 §10.12): 線を引く要素の指定を、子孫の字へ伝える。線の色は、指定した要素の塗り (fill) と不透明度
   */
  decorations?: Array<{ under: boolean; over: boolean; through: boolean; fill: string | null | PaintRef; opacity: number }>;
  /** paint-order (継承する。SVG 2 §13.8)。normal なら undefined。省いた語は、normal の順 (fill・stroke・markers) で後に続く */
  paintOrder?: Array<'fill' | 'stroke' | 'markers'>;
  /** font-style (継承する。立体は undefined) */
  fontStyle?: 'italic' | 'oblique';
  /** baseline-shift を重ねた量 (下向きが正。ユーザー単位)。text の中の入れ子の要素の分を足す (SVG 1.1 §10.9.2) */
  baselineShift?: number;
  /** dominant-baseline (継承する。CSS Inline 3 §4.1)。alignment-baseline (§4.2.2。継承しない) があれば、その要素の字はそれ */
  dominantBaseline?: string;
  alignmentBaseline?: string;
  textAnchor: 'start' | 'middle' | 'end';
  /** vector-effect="non-scaling-stroke" (継承しない): 線の太さを、ページの上の太さ (CSS px) とする */
  nonScalingStroke?: boolean;
  /** vector-effect="non-scaling-size" (継承しない): 形の大きさを、ページの上の大きさ (CSS px) とする (位置は変換に従う) */
  nonScalingSize?: boolean;
  /** marker の id (marker-start・marker-mid・marker-end。継承する) */
  markerStart?: string;
  markerMid?: string;
  markerEnd?: string;
  /** xml:space="preserve" (継承する。SVG 1.1 §10.15): 改行・タブを空白にし、先頭・末尾・続いた空白もそのまま描く */
  preserveSpace?: boolean;
  /**
   * color (継承する。currentColor の値を決めるだけ。SVG 2 §13.3)。colorAlpha はその不透明度 (1 なら省く)。
   * fillCurrent・strokeCurrent は、fill・stroke が currentColor か: currentcolor は語のまま継承し、使う要素の color で決まる (CSS Color 4 §15.5)
   */
  color: string;
  colorAlpha?: number;
  fillCurrent?: boolean;
  strokeCurrent?: boolean;
  /** fill・stroke の色の不透明度 (rgba() の 4 つ目の成分。1 なら省く)。fill-opacity・stroke-opacity に掛ける */
  fillAlpha?: number;
  strokeAlpha?: number;
}

const ROOT_STYLE: Style = { color: '#000000', fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1, evenOdd: false, lineCap: 0, lineJoin: 0, fontSize: 16, fontWeight: 400, textAnchor: 'start' };

/** 文字の輪郭 (text を図形にするため)。原点は基線の始点、y は下向き。描けない文字があれば null */
/** 字の並び (PDF の文字として描くため): 字・書体 (読み込んだ書体の鍵)・字の原点の x (字の座標。基線の上、右向き) */
export type TextChars = Array<{ ch: string; font: string; x: number }>;
/**
 * 文字の輪郭を作る。style は font-style (italic・oblique。立体なら undefined)。
 * ascent・descent は、字の大きさに対する書体の上の高さ・下の深さ (em の割合。dominant-baseline の基線を求めるのに使う。無ければ見積もる)
 */
export type TextOutliner = (
  text: string,
  family: string | undefined,
  weight: number,
  size: number,
  style?: 'italic' | 'oblique',
  /** 縦書きの字 (text-orientation)。このときは 1 字ずつ渡し、原点は字の枠の上端の中央、advance は縦の送り */
  vertical?: 'mixed' | 'upright' | 'sideways',
) => { segs: Seg[]; advance: number; chars?: TextChars; ascent?: number; descent?: number } | null;

export interface ParseSvgOptions {
  /** text 要素を輪郭にして描く (無ければ text を含む SVG はラスタライズ) */
  outline?: TextOutliner;
  /**
   * image の href が外のファイル (data: でないもの) のとき、その PNG・JPEG の中身を返す (呼ぶ側が、SVG の場所を基準に引く)。
   * 無ければ (引けなければ)、その image は描かない
   */
  image?: (href: string) => { kind: 'png' | 'jpeg'; bytes: Uint8Array } | undefined;
  /**
   * use の href が外のファイル (file.svg#id) のとき、そのファイルの中身 (SVG の文字) を返す (呼ぶ側が、SVG の場所を基準に引く)。
   * 無ければ (引けなければ)、その use は描かない
   */
  resource?: (href: string) => string | undefined;
  /**
   * filter を画素で計算する関数 (svgFilterRaster.ts の rasterFilter)。approximateFilters のとき、図形で近似できない filter に使う。
   * 無ければ、その SVG は描けないもの
   */
  rasterFilter?: (req: FilterRasterRequest) => FilterRasterResult | null;
  /** 画素で計算する filter の解像度 (SVG の根の座標の 1 単位あたりの画素の数。既定 4) */
  filterResolution?: number;
  /**
   * foreignObject の中身を組んだ図形 (文書の順の番号 → foreignObject の中の座標の図形)。呼ぶ側が、中身の HTML・MathML を本文と同じ組版で組んで渡す。
   * 無い番号の foreignObject は、HTML の文字だけを近似して描く
   */
  foreignShapes?: (index: number) => SvgShape[] | undefined;
  /**
   * foreignObject を描かずに、中身を組むための情報 (ForeignContext) を受け取る (foreignObjectContexts が使う。番号は foreignShapes と同じ)。
   * 描く順に訪ねたときに呼ぶ (描かれない foreignObject では呼ばない)
   */
  collectForeign?: (index: number, context: ForeignContext) => void;
  /** systemLanguage を照らす利用者の言語 (BCP 47 の言語タグ。好む順)。省けば実行環境の言語 (ブラウザは navigator.languages、Node は Intl の言語) */
  languages?: string[];
  /** 図形にできなかったとき (null を返すとき)、その理由 (filter・marker など、扱えない機能の名前) を受け取る */
  onUnsupported?: (what: string) => void;
  /**
   * filter と foreignObject の HTML の文字を近似して図形にする (ラスタライズできない環境用。影 (feDropShadow、feGaussianBlur + feOffset + feMerge) と、ぼかしだけのもの)。
   * ぼかしは、少しずつ太らせた半透明の図形を重ねて表す。ほかの filter は図形にできない
   */
  approximateFilters?: boolean;
  /**
   * overflow の指定が無い marker を、その枠で切り抜かない (Antenna House Formatter の描き方に合わせる互換の設定)。
   * SVG 1.1 では marker の overflow の初期値は hidden で、既定 (false) はそれに従って切り抜く
   */
  markerOverflowVisible?: boolean;
  /**
   * 根の svg の overflow が visible (・auto) なら、画像の領域 (viewport) で切り抜かない (Antenna House Formatter の描き方に合わせる
   * 互換の設定)。SVG 1.1 §14.3.3 では、単独の SVG (ファイル) の根の overflow は描画に使わず、viewport で切り抜く。既定 (false) はそれに従う
   */
  rootOverflowVisible?: boolean;
}

/**
 * foreignObject の中身を、本文と同じ HTML の組版で組むための情報 (SVG 2 §23.2 の foreignObject: 中身は、SVG の文書の中の要素として
 * スタイルが当たり、SVG の祖先から書式を受け継ぐ。CSS 2.1 §6.2 の継承)
 */
export interface ForeignContext {
  /** 中身 (foreignObject の子) を直列化した HTML (解析した木から。字の上で探すと、注釈や入れ子で食い違う) */
  content: string;
  /** foreignObject の幅・高さ (利用者の単位 = CSS px) */
  width: number;
  height: number;
  /** SVG の <style> の規則 (文書の全部。中身の要素にも当たる) */
  css: string;
  /**
   * 根の svg から foreignObject までの要素 (外から順。最後が foreignObject)。名前 (小文字)・id・class・style 属性。
   * 組む文書に同じ id・class の入れ物を並べて、<style> の「#id p」の形の選択子を中身に当てる
   */
  ancestors: Array<{ name: string; id?: string; className?: string; style?: string }>;
  /** foreignObject の計算した書式のうち、中身が受け継ぐもの (font-family・font-size・font-weight・font-style・color など。CSS の宣言の並び) */
  inherited: string;
}

/** HTML の空の要素 (終わりのタグを書かない。HTML Living Standard §13.1.2 の void elements) */
const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/**
 * XML の要素の子を、HTML の構文の文字にする (foreignObject の中身を、本文の HTML の組版で読ませるため)。名前は接頭辞を外した名前
 * (xhtml:div → div)。名前空間の宣言 (xmlns) は書かない (HTML の構文では、名前空間は要素の名前で決まる)。注釈は落とす。
 * style・script の中は、字をそのまま (HTML の構文では、その中の文字参照を読まない)
 */
function serializeChildren(n: XmlNode): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const out: string[] = [];
  const walk = (el: XmlNode, raw: boolean) => {
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3 || c.nodeType === 4) out.push(raw ? (c.textContent ?? '').replace(/<\//g, '<\\/') : esc(c.textContent ?? ''));
      if (c.nodeType !== 1) continue;
      const name = (c.localName ?? c.nodeName.replace(/^[^:]*:/, '')).replace(/[^\w.-]/g, '');
      if (!name) continue;
      out.push(`<${name}`);
      for (const a of Array.from((c as { attributes?: ArrayLike<{ name: string; value: string }> }).attributes ?? [])) {
        if (/^xmlns(:|$)/.test(a.name) || !/^[\w:.-]+$/.test(a.name)) continue;
        out.push(` ${a.name}="${attr(a.value)}"`);
      }
      out.push('>');
      const lower = name.toLowerCase();
      if (HTML_VOID.has(lower)) continue;
      walk(c, lower === 'style' || lower === 'script');
      out.push(`</${name}>`);
    }
  };
  walk(n, false);
  return out.join('');
}

/**
 * SVG の foreignObject ごとの、中身を組むための情報 (文書の順の番号。parseSvg の foreignShapes の番号と同じ)。描かれない foreignObject は undefined。
 * SVG を図形にできなければ空 (中身を組まない。文字だけの近似か、仮の枠になる)
 */
export function foreignObjectContexts(text: string, parse: (xml: string) => XmlNode, opts: Pick<ParseSvgOptions, 'languages' | 'resource'> = {}): Array<ForeignContext | undefined> {
  const out: Array<ForeignContext | undefined> = [];
  // 字の輪郭・filter の画素の計算は要らない (foreignObject に届くまでを訪ねられればよい)
  const doc = parseSvg(text, parse, {
    ...opts,
    outline: () => ({ segs: [], advance: 0 }),
    approximateFilters: true,
    rasterFilter: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    collectForeign: (i, c) => {
      while (out.length < i) out.push(undefined);
      if (out[i] === undefined) out[i] = c;
    },
  });
  return doc ? out : [];
}

/** 描けない要素 (textPath は text の中でだけ描く。text の外のものは誤り。foreignObject は walk0 で、中身が HTML なら文字を近似して描く) */
const UNSUPPORTED = new Set(['textpath']);
/** clipPath の中身に置けない要素 */
const CLIP_UNSUPPORTED = new Set(['textpath', 'foreignobject']);
/** 定義だけで、その場では描かない要素 */
const DEFINITIONS = new Set(['lineargradient', 'radialgradient', 'clippath', 'symbol', 'style', 'pattern', 'mask', 'filter', 'marker', 'font', 'font-face']);
const IGNORED = new Set(['title', 'desc', 'metadata', 'defs', 'sodipodi:namedview', 'namedview']);

class Unsupported extends Error {}

/**
 * 1 つの SVG で、参照 (use・marker・pattern・mask・clipPath の中の use) をたどって要素を訪ねる回数の上限 (文書に書かれた要素の数に足す分)。
 * use を 10 個ずつ 6 段重ねるだけで 100 万の図形になり、数 KB の SVG が数秒〜止まらなくなるので、ここで切って「図形にできない」ものとして扱う。
 * 文書に書かれた要素を 1 回ずつ訪ねる分は数えない (上限 = 要素の数 + この値) ので、要素が数十万ある地図・図面はそのまま読める。
 * 記号 (symbol) を数万回置く地図でも、参照で増える分は数十万までなので、50 万にする
 */
const MAX_EXPANDED_VISITS = 500_000;
/**
 * 訪ね直す要素の重さ: 2 回目からの訪問は、属性の値の字数を、この字数ごとに 1 回分として余分に数える。
 * 要素を訪ねるたびに、属性 (stroke-dasharray・x の並び・書式の値など) を読み直すので、数十万字の属性を持つ要素を use で何千回も
 * 置くと、訪ねる回数は上限の中でも、数百 MB 分の字を読むことになる。ふつうの要素 (属性の合計が 64 字に満たない) は、これまでと同じ 1 回
 */
const VISIT_WEIGHT_CHARS = 64;
/**
 * 1 つの SVG で、参照 (use・marker・pattern・mask・clip-path・textPath) や効果 (filter の影の写し) によって、書かれた数より増える分の
 * 線分 (M・L・C・Z の 1 つを 1 と数える。グラデーションの stop、切り抜きを図形の並びの途中で書き直す分も同じに数える) の上限。
 * 5 万点の path を use で 400 回置くだけ (212KB) で 2000 万の線分になり、メモリを使い切るので、ここで切って「図形にできない」ものとして扱う
 * (訪ねる回数の上限 MAX_EXPANDED_VISITS は、訪ねた先の path の大きさを数えない)。
 * 要素ごとに 1 回目に読む形 (文書に書かれたとおりの分) は数えないので、線分が数百万ある地図・図面は、これまでどおり読める。
 * 上限 = EXPANDED_SEGS_BASE + SVG の字数 × EXPANDED_SEGS_PER_CHAR (MAX_EXPANDED_SEGS まで):
 * - 記号 (数十の線分) を数千〜1 万回置く地図・字形を use で置く SVG (matplotlib・cairo の出力。1 字が 40 線分ほど、use 1 つが 50 字ほど) は、
 *   参照で増える分が use の字数の 1 倍ほど。小さな SVG でも足りるように 25 万を足し、字数の 2 倍までを許す
 *   (25 万は、点の多い記号 (1000 線分) を数百回置く小さな SVG の分。100 万にすると、12KB の marker の SVG (1000 線分の marker を
 *   1000 の頂点に置く) が 100 万の線分・10MB の PDF になり、8 秒・700MB かかった)
 * - 全体の上限は、EPS のパスの点の上限 (imageLimits.ts の PS_MAX_PATH_POINTS = 500 万) と同じにする
 */
const EXPANDED_SEGS_BASE = 250_000;
/**
 * SVG フォントの合字 (unicode が何字かの glyph) の字の数の上限。SVG 1.1 §20.5 に数は無い。実在の合字 (ffi・ﬃ、絵文字の ZWJ の並び・
 * 旗のタグの並び) は 10 字ほどまでなので、64 字あれば足りる。超える glyph は使わない (字を 1 つ当てるのに、その長さだけたどらないように)
 */
const SVG_FONT_MAX_LIGATURE = 64;
const EXPANDED_SEGS_PER_CHAR = 2;
const MAX_EXPANDED_SEGS = 5_000_000;
/**
 * SVG の要素の入れ子の上限 (250 段。XSL-FO の入れ子の上限 (xslfoImport.ts の MAX_FO_NEST) と同じ値)。
 * 図形になる要素の入れ子は、もともと 32 段まで (walk の depth。超えれば「図形にできない」) なので、これより深い SVG は、どのみち描けない。
 * `<g>` を 10 万段重ねた SVG (700KB) は、XML の解析だけで 5〜10 秒かかるので、解析の前に字の上で段を数えて、読まずに「図形にできない」ものとする
 */
export const SVG_MAX_NEST = 250;

/**
 * SVG (XML) の文字列の要素の入れ子が limit 段を超えるか。解析せずに、字の上で開始タグ・終了タグを数える (文字列の長さに比例する手間)。
 * 注釈・CDATA・処理命令・DOCTYPE は飛ばし、開始タグの中の引用符で囲んだ値は > で終わらせない
 */
export function svgNestTooDeep(text: string, limit = SVG_MAX_NEST): boolean {
  const n = text.length;
  let depth = 0;
  let i = text.indexOf('<');
  while (i >= 0 && i < n) {
    const c = text.charCodeAt(i + 1);
    let next: number;
    if (c === 0x21 /* ! */) {
      if (text.startsWith('<!--', i)) {
        const e = text.indexOf('-->', i + 4);
        if (e < 0) break;
        next = e + 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        const e = text.indexOf(']]>', i + 9);
        if (e < 0) break;
        next = e + 3;
      } else {
        // DOCTYPE など: 内部サブセット [ ] と引用符の中の > は終わりでない
        let j = i + 2;
        let br = 0;
        let q = 0;
        for (; j < n; j++) {
          const d = text.charCodeAt(j);
          if (q) {
            if (d === q) q = 0;
          } else if (d === 0x22 || d === 0x27) q = d;
          else if (d === 0x5b) br++;
          else if (d === 0x5d) br--;
          else if (d === 0x3e && br <= 0) break;
        }
        next = j + 1;
      }
    } else if (c === 0x3f /* ? */) {
      const e = text.indexOf('?>', i + 2);
      if (e < 0) break;
      next = e + 2;
    } else if (c === 0x2f /* / */) {
      if (depth > 0) depth--;
      const e = text.indexOf('>', i + 2);
      if (e < 0) break;
      next = e + 1;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x3a || c >= 0x80) {
      let j = i + 1;
      let q = 0;
      for (; j < n; j++) {
        const d = text.charCodeAt(j);
        if (q) {
          if (d === q) q = 0;
        } else if (d === 0x22 || d === 0x27) q = d;
        else if (d === 0x3e) break;
      }
      if (j >= n) break;
      if (text.charCodeAt(j - 1) !== 0x2f && ++depth > limit) return true;
      next = j + 1;
    } else next = i + 1; // 名前の続かない < は文字
    i = text.indexOf('<', next);
  }
  return false;
}
/** pattern の中身の図形が、また pattern で塗られているときの入れ子の上限 (互いを指す pattern で止まらなくなるのを防ぐ。gradient の参照の上限と同じ 8) */
const MAX_PATTERN_NEST = 8;

/**
 * <style> の規則。単純な選択子 (要素名・.class・#id とその組み合わせ) は tag・id・classes で引く。
 * それ以外の選択子 (結合子・属性・疑似クラス。Selectors 4) は complex に読み、要素ごとに照らす (cssSelector.ts)
 */
interface CssRule {
  tag?: string;
  id?: string;
  classes: string[];
  complex?: Selector;
  /** 詳細度 (Selectors 4 §17。[id, class, 要素名] を a×10⁶ + b×10³ + c の 1 つの数にする。cssSelector.ts と同じ) */
  specificity: number;
  order: number;
  decls: Record<string, string>;
}

function parseDecls(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    // カスタムプロパティ (--で始まる名前) は、大文字小文字を区別する (CSS Variables 1 §2)
    const name = decl.slice(0, i).trim();
    if (i > 0) out[name.startsWith('--') ? name : name.toLowerCase()] = decl.slice(i + 1).replace(/!important/i, '').trim();
  }
  return out;
}

/** p 以降の最初の { か } の位置 (無ければ -1) */
function nextBrace(text: string, p: number): number {
  for (let i = p; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x7b || c === 0x7d) return i;
  }
  return -1;
}

/** 注釈を取り除く (/\/\*[\s\S]*?\*\//g の置き換えと同じ結果。終わりの無い注釈は残す) */
function stripCssComments(css: string): string {
  let out = '';
  let p = 0;
  for (;;) {
    const s = css.indexOf('/*', p);
    const e = s < 0 ? -1 : css.indexOf('*/', s + 2);
    if (e < 0) return out + css.slice(p);
    out += css.slice(p, s);
    p = e + 2;
  }
}

/**
 * @import・@charset・@namespace の文 (; まで) を取り除く (/@(import|charset|namespace)\b[^;{}]*;/gi の置き換えと同じ結果。
 * ; より先に { } が来るもの・; の無いものは残す)。次の区切り (; { }) の位置は、そこを過ぎるまで使い回す
 */
function stripAtStatements(text: string): string {
  const re = /@(?:import|charset|namespace)\b/gi;
  let out = '';
  let p = 0;
  let stop = -1; // 直前に探した区切りの位置 (text.length = 無い)
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const from = re.lastIndex;
    if (stop < from) {
      stop = from;
      while (stop < text.length && !';{}'.includes(text[stop])) stop++;
    }
    if (text[stop] !== ';') continue;
    out += text.slice(p, m.index);
    p = stop + 1;
    re.lastIndex = p;
  }
  return out + text.slice(p);
}

/** media query を照らす環境: 印刷 (print) の、幅・高さ (CSS px) の画面 */
export interface MediaEnv {
  width: number;
  height: number;
}

/**
 * media query の並び (カンマ区切り。どれかが合えば合う) を照らす (Media Queries 4)。描くのは印刷物なので、media type は all・print が合い、
 * screen と古い type・知らない type は合わない (§2.3・§3.2。not で反転、only は何もしない: §2.2)。特徴は width・height (min-・max-)・orientation・aspect-ratio・color・monochrome・grid・prefers-color-scheme (light) を読む。
 * (width・height は §4.1・§4.2、orientation は §4.4、prefers-color-scheme は Media Queries 5 §12.5)。知らない特徴・読めない書き方の query は合わない (§3.2)
 */
export function mediaMatches(list: string, env: MediaEnv): boolean {
  const queries = list.split(',').map((q) => q.trim().toLowerCase());
  if (!queries.some(Boolean)) return true;
  const len = (v: string) => {
    const m = /^(-?[\d.]+)(px|em|rem|pt|pc|mm|cm|in|q)?$/.exec(v.trim());
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    const u = m[2] ?? 'px';
    return u === 'em' || u === 'rem' ? n * 16 : n * (PX_PER[u] ?? NaN);
  };
  const feature = (f: string): boolean => {
    const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]*?))?\s*\)$/.exec(f.trim());
    if (!m) return false;
    const [, name, value] = m;
    const v = value?.trim();
    const cmp = (actual: number) => {
      const pre = /^(min|max)-/.exec(name)?.[1];
      if (v === undefined) return actual > 0;
      const want = len(v);
      if (!Number.isFinite(want)) return false;
      return pre === 'min' ? actual >= want : pre === 'max' ? actual <= want : Math.abs(actual - want) < 1e-6;
    };
    switch (name.replace(/^(min|max)-/, '')) {
      case 'width':
        return cmp(env.width);
      case 'height':
        return cmp(env.height);
      case 'aspect-ratio': {
        if (v === undefined) return true;
        const r = /^([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(v);
        if (!r) return false;
        const want = parseFloat(r[1]) / (r[2] ? parseFloat(r[2]) : 1);
        const actual = env.width / env.height;
        const pre = /^(min|max)-/.exec(name)?.[1];
        return pre === 'min' ? actual >= want : pre === 'max' ? actual <= want : Math.abs(actual - want) < 1e-6;
      }
      case 'orientation':
        return v === (env.height >= env.width ? 'portrait' : 'landscape');
      case 'color':
        return v === undefined || (/^(min|max)-/.test(name) ? (name.startsWith('min') ? parseFloat(v) <= 8 : parseFloat(v) >= 8) : parseFloat(v) === 8);
      case 'monochrome':
        return v !== undefined && parseFloat(v) === 0 && !name.startsWith('min');
      case 'grid':
        return v !== undefined && parseFloat(v) === 0;
      case 'prefers-color-scheme':
        return v === 'light';
      default:
        return false;
    }
  };
  return queries.some((q0) => {
    const not = /^not\s/.test(q0);
    const q = q0.replace(/^(not|only)\s+/, '');
    const parts = q.split(/\s+and\s+/);
    // 先頭が ( でなければ media type。知らない type は、何にも合わない
    const type = q.startsWith('(') ? undefined : parts.shift();
    const ok = (!type || type === 'all' || type === 'print') && parts.every((f) => feature(f));
    return not ? !ok : ok;
  });
}

/** @media の規則: 合う media query の中の規則は、外に書いたものとして読み、合わないものは捨てる (入れ子も) */
function expandMedia(text: string, env: MediaEnv, depth = 0): string {
  // 入れ子の深すぎる @media は読めない (呼び出しの段が尽きないように)
  if (depth > 32) throw new Unsupported('css');
  let out = '';
  let p = 0;
  const re = /@media\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const open = text.indexOf('{', re.lastIndex);
    if (open < 0) break;
    let level = 1;
    let i = open + 1;
    for (; i < text.length && level; i++) {
      if (text[i] === '{') level++;
      else if (text[i] === '}') level--;
    }
    if (level) break;
    out += text.slice(p, m.index);
    if (mediaMatches(text.slice(re.lastIndex, open), env)) out += expandMedia(text.slice(open + 1, i - 1), env, depth + 1);
    p = i;
    re.lastIndex = i;
  }
  return out + text.slice(p);
}

/**
 * CSS を規則の列にする。読めない選択子や @ 規則 (読み飛ばすもの以外) があれば Unsupported。
 * @media は、env (無ければ 300 × 150 の印刷の画面) で照らして、合うものの中の規則を読む
 */
export function parseCss(css: string, env: MediaEnv = { width: 300, height: 150 }): CssRule[] {
  const rules: CssRule[] = [];
  // @font-face (SVG に埋め込んだ書体。text は読み込み済みの書体の輪郭で描く)・@import・@charset・@namespace は読み飛ばす
  // (注釈と @import などは、終わりの無いものが並ぶと正規表現では 2 乗の手間になるので、1 回の走査で取り除く)
  const text = stripAtStatements(
    expandMedia(
      stripCssComments(css)
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/@font-face\s*\{[^{}]*\}/gi, ''),
      env,
    ),
  );
  // 規則 = 「{ } を含まない 1 字以上の選択子」「{」「{ } を含まない宣言」「}」。頭から 1 回の走査で切り出す
  // (正規表現 /([^{}]+)\{([^{}]*)\}/g と同じ切り方。正規表現だと、{ の無い長い文で、始まりの位置ごとに終わりまで読み直して 2 乗の手間になる)。
  // 規則に入らない { } や、空白でない残りがあれば Unsupported (@media などの入れ子)
  const blocks: Array<[string, string]> = [];
  for (let p = 0; ; ) {
    const open = nextBrace(text, p);
    if (open < 0) {
      if (text.slice(p).trim()) throw new Unsupported('css');
      break;
    }
    const close = text[open] === '{' && open > p ? nextBrace(text, open + 1) : -1;
    if (close < 0 || text[close] !== '}') throw new Unsupported('css');
    blocks.push([text.slice(p, open), text.slice(open + 1, close)]);
    p = close + 1;
  }
  let order = 0;
  for (const [selectors, body] of blocks) {
    const decls = parseDecls(body);
    for (const raw of selectors.split(',')) {
      const sel = raw.trim();
      // * (すべての要素。matplotlib の出力など) は型の指定なしと同じ
      if (!sel || sel.startsWith('@')) throw new Unsupported(`css selector ${sel}`);
      const parsed = /^(\*|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(sel);
      const parts = parsed?.[2].match(/[.#][\w-]+/g) ?? [];
      const ids = parts.filter((p) => p[0] === '#').map((p) => p.slice(1));
      if (parsed && ids.length <= 1) {
        const classes = parts.filter((p) => p[0] === '.').map((p) => p.slice(1));
        const tag = parsed[1] === '*' ? undefined : parsed[1]?.toLowerCase();
        rules.push({ tag, id: ids[0], classes, specificity: ids.length * 1e6 + classes.length * 1e3 + (tag ? 1 : 0), order: order++, decls });
        continue;
      }
      // 結合子 (子孫・子・隣接・後続)・属性・疑似クラスの選択子 (Selectors 4)。読めない選択子は描けないものとする
      const [complex] = parseSelectorList(sel);
      if (!complex) throw new Unsupported(`css selector ${sel}`);
      // 疑似要素 (::before など) の規則は、SVG では描くものが無い (SVG 2 §6.4 は ::before・::after の中身を描かない)
      if (complex.pseudoElement) continue;
      rules.push({ classes: [], complex, specificity: complex.specificity, order: order++, decls });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

/** 同じ選択子 (要素名・id・class の組) の規則をまとめたもの。decls は、プロパティごとに、その組の中で最後に効く宣言 (pos は規則の当てる順) */
interface CssGroup {
  tag?: string;
  id?: string;
  classes: string[];
  decls: Map<string, { pos: number; value: string }>;
}
/**
 * <style> の規則の索引。規則 × 要素の総当たり (5000 規則 × 5000 要素の 400KB で 8 秒、2 万 × 2 万で 90 秒超) を避けるため、
 * 規則を id・class・要素名で引けるようにして、要素に当たりうる組だけを確かめる。
 * 当てる順 (詳細度・出現順) は変えない: プロパティごとに、当たる規則のうち pos がいちばん後の宣言が勝つ (順に Object.assign したのと同じ結果)
 */
interface CssIndex {
  byId: Map<string, CssGroup[]>;
  byClass: Map<string, CssGroup[]>;
  byTag: Map<string, CssGroup[]>;
  any: CssGroup[];
  /** 要素名・id・class の値が同じ要素の、単純な選択子の規則の結果 (同じ class の要素が何千とある絵で、計算し直さない) */
  cache: Map<string, Map<string, { pos: number; value: string }>>;
  /**
   * 単純でない選択子の規則 (要素ごとに照らす)。いちばん右の複合の選択子の id (#名前)・class (.名前)・属性の名前 ([名前。小文字])・要素名で引く
   * (どれも無ければ complexAny)。属性の名前で引くのは、[a1] {…} を 1000 規則と rect を 1 万個並べた 299KB の SVG で、全部の規則を全部の
   * 要素に照らして 30 秒かかったため (属性の選択子は、その名前の属性を持つ要素にしか当たらない。Selectors 4 §6)
   */
  complexBy: Map<string, ComplexRule[]>;
  complexAny: ComplexRule[];
  /**
   * 単純でない選択子の規則のうち、照合の結果が要素の親で決まるもの (右端が条件の無い * の、g *・*:nth-child(…) > * など。cssSelector の parentDecides)。
   * 索引で引けないので、要素ごとに照らすと 規則の数 × 要素の数 の手間になる。親ごとに 1 度だけ照らして (complexByParent)、兄弟に使い回す
   */
  complexUp: ComplexRule[];
  /** 親 → その子に当たる complexUp の規則 */
  complexByParent: WeakMap<object, ComplexRule[]>;
  /** 単純でない選択子を要素に照らす回数の残り (CSS_MAX_MATCHES から減らす)。尽きたら、その SVG は描けないものとする */
  matchLeft: number;
  /**
   * 照らした結果の覚え (cssSelector の SelectorMemo。SVG の木は、書式を読む間は変わらない)。覚えが無いと、子孫の結合子の左側
   * (*:nth-child(…) * の祖先) と :has() を、要素ごとに照らし直す
   */
  memo: SelectorMemo;
}

/**
 * 1 つの <style> の索引で、単純でない選択子を要素に照らす回数の上限。索引で引けない規則 (右端が * や疑似クラスだけ: *:nth-child(…) *) を
 * 1000 個と要素 8000 個の 354KB の SVG で、照らすだけで 90 秒を超えた (1 回に 3µs ほど)。実在の SVG (Inkscape・Illustrator・matplotlib・
 * d3・draw.io の出力) の単純でない規則は、右端に class か要素名があって索引で引け、引けない規則は数個までなので、照らす回数は
 * 要素の数 (数万) の数倍で、50 万に届かない。50 万回は 1.5 秒ほどで終わる量 (描けないときは、filter を近似してもう 1 度読むので、その 2 倍)
 */
const CSS_MAX_MATCHES = 500_000;
interface ComplexRule {
  sel: Selector;
  pos: number;
  decls: Record<string, string>;
}

/** rules は parseCss の結果 (当てる順に並んでいる) */
function indexCss(rules: CssRule[]): CssIndex | undefined {
  if (!rules.length) return undefined;
  const ix: CssIndex = { byId: new Map(), byClass: new Map(), byTag: new Map(), any: [], cache: new Map(), complexBy: new Map(), complexAny: [], complexUp: [], complexByParent: new WeakMap(), matchLeft: CSS_MAX_MATCHES, memo: createSelectorMemo() };
  const groups = new Map<string, CssGroup>();
  rules.forEach((r, pos) => {
    if (r.complex) {
      const right = r.complex.compounds[0];
      // 属性の名前は、照らす側 (cssSelector の attrValue) と同じく小文字で比べる。名前空間の付いた名前 (a|b) は引かない
      const attr = right.attrs.find((a) => !a.name.includes('|'))?.name;
      const key = right.ids[0] !== undefined ? `#${right.ids[0]}` : right.classes[0] !== undefined ? `.${right.classes[0]}` : attr !== undefined ? `[${attr}` : right.tag ? right.tag : undefined;
      const rule = { sel: r.complex, pos, decls: r.decls };
      if (key === undefined && parentDecides(r.complex)) ix.complexUp.push(rule);
      else if (key === undefined) ix.complexAny.push(rule);
      else {
        const list = ix.complexBy.get(key);
        if (list) list.push(rule);
        else ix.complexBy.set(key, [rule]);
      }
      return;
    }
    const classes = [...new Set(r.classes)].sort();
    const sig = `${r.tag ?? ''}#${r.id ?? ''}.${classes.join('.')}`;
    let g = groups.get(sig);
    if (!g) {
      g = { tag: r.tag, id: r.id, classes, decls: new Map() };
      groups.set(sig, g);
      // 組は 1 つの引き出しにだけ入れる (id → 最初の class → 要素名 → どれも無い)
      const [map, key] = r.id ? [ix.byId, r.id] : classes.length ? [ix.byClass, classes[0]] : r.tag ? [ix.byTag, r.tag] : [undefined, ''];
      if (!map) ix.any.push(g);
      else {
        const list = map.get(key);
        if (list) list.push(g);
        else map.set(key, [g]);
      }
    }
    for (const k of Object.keys(r.decls)) g.decls.set(k, { pos, value: r.decls[k] });
  });
  return ix;
}

/** 要素に当たる <style> の規則の宣言 (当てる順に重ねた結果) */
function cssDeclsOf(n: XmlNode, ix: CssIndex): Record<string, string> {
  const tag = (n.localName ?? n.nodeName.split(':').pop() ?? '').toLowerCase();
  const id = n.getAttribute?.('id') ?? undefined;
  const classAttr = n.getAttribute?.('class') ?? '';
  const key = `${tag}\0${id !== undefined && ix.byId.has(id) ? id : ''}\0${classAttr}`;
  const cls = new Set(classAttr.split(/\s+/).filter(Boolean));
  let win = ix.cache.get(key);
  if (!win) {
    win = simpleDecls(ix, tag, id, cls);
    if (ix.cache.size < 4096) ix.cache.set(key, win);
  }
  // 単純でない選択子の規則: いちばん右の複合の選択子が当たりうる規則だけを、要素に照らす
  const cands = [...ix.complexAny, ...(id ? (ix.complexBy.get(`#${id}`) ?? []) : []), ...[...cls].flatMap((c) => ix.complexBy.get(`.${c}`) ?? []), ...(ix.complexBy.get(tag) ?? [])];
  if (ix.complexBy.size) for (const a of Array.from((n as unknown as Element).attributes ?? [])) {
    const list = ix.complexBy.get(`[${a.name.toLowerCase()}`);
    if (list) for (const r of list) cands.push(r);
  }
  let merged = win;
  const apply = (r: ComplexRule) => {
    if (merged === win) merged = new Map(win);
    for (const [k, value] of Object.entries(r.decls)) {
      const w = merged.get(k);
      if (!w || w.pos < r.pos) merged.set(k, { pos: r.pos, value });
    }
  };
  // 親で決まる規則は、親ごとに 1 度だけ照らした結果から (答えは、子ごとに照らしたのと同じ。当てる順は下の pos の比べ方で決まる)
  const parent = (n as { parentNode?: { nodeType?: number } | null }).parentNode;
  if (ix.complexUp.length && parent && parent.nodeType === 1) {
    let up = ix.complexByParent.get(parent);
    if (!up) {
      up = [];
      for (const r of ix.complexUp) {
        if (--ix.matchLeft < 0) throw new Unsupported('css selectors: too many matches');
        if (matches(n as unknown as Element, r.sel, undefined, ix.memo)) up.push(r);
      }
      ix.complexByParent.set(parent, up);
    }
    for (const r of up) apply(r);
  }
  if (cands.length && typeof (n as { parentNode?: unknown }).parentNode !== 'undefined') {
    // 当てる順は pos (規則の順) で決まり、照らす順にはよらない (下の pos の比べ方)
    for (const r of new Set(cands)) {
      if (--ix.matchLeft < 0) throw new Unsupported('css selectors: too many matches');
      if (matches(n as unknown as Element, r.sel, undefined, ix.memo)) apply(r);
    }
  }
  const out: Record<string, string> = {};
  for (const [k, d] of merged) out[k] = d.value;
  return out;
}

/** 単純な選択子の規則のうち、要素名・id・class が tag・id・cls の要素に当たるものの宣言 (プロパティごとに、勝つ宣言) */
function simpleDecls(ix: CssIndex, tag: string, id: string | undefined, cls: Set<string>): Map<string, { pos: number; value: string }> {
  const win = new Map<string, { pos: number; value: string }>();
  const apply = (list: CssGroup[] | undefined) => {
    if (!list) return;
    for (const g of list) {
      if ((g.tag && g.tag !== tag) || (g.id && g.id !== id) || !g.classes.every((c) => cls.has(c))) continue;
      for (const [k, d] of g.decls) {
        const w = win.get(k);
        if (!w || w.pos < d.pos) win.set(k, d);
      }
    }
  };
  apply(ix.any);
  apply(ix.byTag.get(tag));
  if (id) apply(ix.byId.get(id));
  for (const c of cls) apply(ix.byClass.get(c));
  return win;
}

function propsOf(n: XmlNode, css?: CssIndex): Record<string, string> {
  const out: Record<string, string> = {};
  const names = ['color', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'display', 'visibility', 'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'baseline-shift', 'dominant-baseline', 'alignment-baseline', 'paint-order', 'transform', 'transform-origin', 'transform-box', 'isolation', 'letter-spacing', 'word-spacing', 'text-decoration', 'text-decoration-line', 'mask-type', 'inline-size', 'line-height', 'text-align', 'white-space', 'writing-mode', 'text-orientation', 'glyph-orientation-vertical', 'overflow', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'data-fill-cmyk', 'data-stroke-cmyk', 'vector-effect', 'mix-blend-mode', 'xml:space'];
  for (const k of names) {
    const v = n.getAttribute?.(k);
    if (v !== null && v !== undefined) out[k] = v.trim();
  }
  // 優先度: 表示属性 < <style> の規則 (詳細度・出現順) < style 属性
  if (css) Object.assign(out, cssDeclsOf(n, css));
  const st = n.getAttribute?.('style');
  if (st) Object.assign(out, parseDecls(st));
  return out;
}

const isCurrentColor = (v: string) => /^currentcolor$/i.test(v.trim());

/** s の i 番目 (開き括弧の次) から、対応する閉じ括弧の位置。無ければ -1 */
function closeParen(s: string, i: number): number {
  for (let d = 1; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return -1;
}

/** var() を置き換えた値の長さの上限 (字の数)。HTML の側 (htmlPaged の MAX_VAR_LENGTH) と同じ値 (Chromium の上限 2097152 と同じ。Variables 1 §3.3) */
const SVG_MAX_VAR_LENGTH = 2 * 1024 * 1024;

/**
 * var() を、カスタムプロパティの値 (vars。要素の祖先から受け継いだもの) に置き換える (CSS Variables 1 §3)。名前が無く、代わりの値も無ければ
 * undefined (計算値の時点で無効。§3.1。呼ぶ側は、そのプロパティの指定が無いものとする)。値の中の var() も置き換える (深さ 16 まで。輪は無効)。
 * 置き換えた値の長さの合計 (と置き換えの回数) が上限 (SVG_MAX_VAR_LENGTH。HTML の側の resolveVars と同じ) を超えたら、無効 (undefined) にする
 * (Variables 1 §3.3「Safely Handling Overly-Long Variables」)。--v1: var(--v0) var(--v0) var(--v0) var(--v0) を 15 段重ねた 834 バイトの SVG で、
 * 値が 4^15 字に膨らみ、60 秒・2.7GB を超えていた。budget は、入れ子の置き換えで共有する残りの長さ
 */
export function substituteVars(v: string, vars: ReadonlyMap<string, string>, depth = 0, budget: { left: number } = { left: SVG_MAX_VAR_LENGTH }): string | undefined {
  if (depth > 16) return undefined;
  let out = '';
  let p = 0;
  for (;;) {
    const k = v.indexOf('var(', p);
    if (k < 0) return out + v.slice(p);
    const e = closeParen(v, k + 4);
    if (e < 0) return undefined;
    const inner = v.slice(k + 4, e);
    const comma = (() => {
      for (let i = 0, d = 0; i < inner.length; i++) {
        if (inner[i] === '(') d++;
        else if (inner[i] === ')') d--;
        else if (inner[i] === ',' && d === 0) return i;
      }
      return -1;
    })();
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const own = vars.get(name);
    // 空の値の置き換えも 1 と数える (長さの増えない置き換えを、指数的な回数だけ繰り返させない)
    if ((budget.left -= 1) < 0) return undefined;
    const got = own !== undefined ? substituteVars(own, vars, depth + 1, budget) : undefined;
    const value = got ?? (fallback !== undefined ? substituteVars(fallback, vars, depth + 1, budget) : undefined);
    if (value === undefined) return undefined;
    if ((budget.left -= value.length) < 0) return undefined;
    out += v.slice(p, k) + value;
    p = e + 1;
  }
}

/** 長さの単位 → 利用者の単位 (px) */
const PX_PER: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };
/** 角度の単位 → 度 */
const DEG_PER: Record<string, number> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/**
 * calc() (CSS Values 4 §10.1) を数にする。項がすべて同じ種類 (数・長さ・角度・百分率) の式だけを読み、長さは px、角度は deg にして書く。
 * 読めない式 (百分率と長さを足す式など) は、そのまま残す (そのプロパティは読めない値になる)
 */
export function evaluateCalc(v: string): string {
  let out = '';
  let p = 0;
  // 小文字にするのは 1 度だけ、探すのは今の位置から (ループの 1 回ごとに値の全体を search・toLowerCase すると、calc(1) を 4 万個並べた
  // stroke-dasharray で長さの 2 乗の時間 (32 秒) がかかった)
  const lower = v.toLowerCase();
  for (;;) {
    const k = lower.indexOf('calc(', p);
    if (k < 0) return out + v.slice(p);
    const e = closeParen(v, k + 5);
    if (e < 0) return out + v.slice(p);
    const r = calcValue(v.slice(k + 5, e));
    out += v.slice(p, k) + (r ? `${+r.n.toFixed(6)}${r.u}` : v.slice(k, e + 1));
    p = e + 1;
  }
}
type CalcVal = { n: number; u: '' | 'px' | 'deg' | '%' };
/** calc() の括弧の入れ子の深さの上限。仕様 (CSS Values 4 §10) に数は無い。手で書く式は数段で、32 段は実在の SVG の届かない深さ */
const CALC_MAX_DEPTH = 32;
function calcValue(src: string): CalcVal | undefined {
  const toks = src.match(/\d*\.?\d+(?:e[-+]?\d+)?(?:[a-z]+|%)?|[-+*/()]|calc\(/gi);
  if (!toks || toks.join('').replace(/calc\(/gi, '(') !== src.replace(/\s+/g, '').replace(/calc\(/gi, '(')) return undefined;
  let i = 0;
  // 括弧・符号の入れ子の深さ。上限 (CALC_MAX_DEPTH) を超えた式は読めない値にする (calc(((((… を数万段重ねた値で、
  // 呼び出しのスタックが尽きないように)
  let depth = 0;
  const atom = (): CalcVal | undefined => {
    const t = toks[i++];
    if (t === undefined) return undefined;
    if (t === '(' || /^calc\($/i.test(t) || t === '-' || t === '+') {
      if (++depth > CALC_MAX_DEPTH) return undefined;
      try {
        if (t === '-' || t === '+') {
          const v = atom();
          return v && { n: t === '-' ? -v.n : v.n, u: v.u };
        }
        const v = sum();
        return toks[i++] === ')' ? v : undefined;
      } finally {
        depth--;
      }
    }
    const m = /^(\d*\.?\d+(?:e[-+]?\d+)?)([a-z]+|%)?$/i.exec(t);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    const u = (m[2] ?? '').toLowerCase();
    if (!u) return { n, u: '' };
    if (u === '%') return { n, u: '%' };
    if (PX_PER[u] !== undefined) return { n: n * PX_PER[u], u: 'px' };
    if (DEG_PER[u] !== undefined) return { n: n * DEG_PER[u], u: 'deg' };
    return undefined;
  };
  const product = (): CalcVal | undefined => {
    let a = atom();
    while (a && (toks[i] === '*' || toks[i] === '/')) {
      const op = toks[i++];
      const b = atom();
      if (!b) return undefined;
      // 掛け算は片方が数、割り算は割る数が数 (CSS Values 4 §10 の型の決まり)
      if (op === '*') {
        if (a.u && b.u) return undefined;
        a = { n: a.n * b.n, u: a.u || b.u };
      } else {
        if (b.u || b.n === 0) return undefined;
        a = { n: a.n / b.n, u: a.u };
      }
    }
    return a;
  };
  const sum = (): CalcVal | undefined => {
    let a = product();
    while (a && (toks[i] === '+' || toks[i] === '-')) {
      const op = toks[i++];
      const b = product();
      if (!b || b.u !== a.u) return undefined;
      a = { n: op === '+' ? a.n + b.n : a.n - b.n, u: a.u };
    }
    return a;
  };
  const r = sum();
  return r && i === toks.length && Number.isFinite(r.n) ? r : undefined;
}

/** 色の不透明度: rgb()・rgba() の 4 つ目の成分 (数か百分率。[0, 1] に丸める)。無ければ 1 */
function alphaOf(v: string): number {
  const m = /^rgba?\(([^)]*)\)$/i.exec(v.trim());
  const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
  if (parts.length !== 4) return 1;
  const a = parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
  return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
}

/** current は、currentColor の値 (その要素の color。無ければ color の初期値の黒) */
function colorOf(v: string, allowRef = false, current = '#000000'): string | null | PaintRef {
  const s = v.trim();
  if (s === 'none' || s === 'transparent') return null;
  const u = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(s);
  if (u) {
    if (!allowRef) throw new Unsupported('paint server');
    return { ref: u[1] };
  }
  if (/^url\(/i.test(s)) throw new Unsupported('paint server');
  if (isCurrentColor(s)) return current;
  const c = parseColor(s);
  if (c.mode !== 'rgb') return s;
  const h = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const num = (v: string | undefined, d: number) => {
  if (v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.includes('%') ? n / 100 : n) : d;
};

function inherit(parent: Style, p: Record<string, string>): Style {
  const ve = (p['vector-effect'] ?? '').split(/\s+/);
  const s: Style = { ...parent, opacity: 1, nonScalingStroke: ve.includes('non-scaling-stroke'), nonScalingSize: ve.includes('non-scaling-size') };
  // color: currentColor の値 (SVG 2 §13.3)。color: currentColor は継承した値 (CSS Color 4 §15.5)
  if (p.color !== undefined && p.color !== 'inherit' && !isCurrentColor(p.color)) {
    const c = colorOf(p.color);
    if (typeof c === 'string') {
      s.color = c;
      const a = alphaOf(p.color);
      if (a < 1) s.colorAlpha = a;
      else delete s.colorAlpha;
    }
  }
  // fill・stroke: currentColor は語のまま継承するので、宣言の無い要素でも、自分の color で決め直す
  for (const [k, cur, alpha, frame] of [['fill', 'fillCurrent', 'fillAlpha', 'fillFrame'], ['stroke', 'strokeCurrent', 'strokeAlpha', 'strokeFrame']] as const) {
    const v = p[k];
    const ctx = v?.trim() === 'context-fill' ? 'fill' : v?.trim() === 'context-stroke' ? 'stroke' : undefined;
    if (ctx) {
      // context-fill・context-stroke: context element の塗り・線 (無ければ塗らない)。模様・グラデーションは、context element の
      // 座標系と外接矩形で当てる (SVG 2 §13.2)
      s[k] = parent.context ? parent.context[ctx] : null;
      const f = parent.context?.[ctx === 'fill' ? 'fillFrame' : 'strokeFrame'];
      if (f && s[k] && typeof s[k] !== 'string') s[frame] = f;
      else delete s[frame];
      delete s[cur];
      const a = parent.context?.[ctx === 'fill' ? 'fillAlpha' : 'strokeAlpha'];
      if (a !== undefined && a < 1) s[alpha] = a;
      else delete s[alpha];
    } else if (v !== undefined && v !== 'inherit') {
      s[k] = colorOf(v, true, s.color);
      delete s[frame];
      const current = isCurrentColor(v);
      const a = current ? (s.colorAlpha ?? 1) : alphaOf(v);
      if (current) s[cur] = true;
      else delete s[cur];
      if (a < 1) s[alpha] = a;
      else delete s[alpha];
    } else if (s[cur]) {
      s[k] = s.color;
      if (s.colorAlpha !== undefined) s[alpha] = s.colorAlpha;
      else delete s[alpha];
    }
  }
  // Kumiori の EPS の SVG: CMYK で決まる色の値 (data-fill-cmyk・data-stroke-cmyk。ブラウザは fill・stroke の RGB で描く)。PDF には DeviceCMYK で描く
  const cmyk = (v: string | undefined) => {
    const n = (v ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    return n.length === 4 && n.every((x) => Number.isFinite(x)) ? `cmyk(${n.join(',')})` : undefined;
  };
  if (typeof s.fill === 'string' && cmyk(p['data-fill-cmyk'])) s.fill = cmyk(p['data-fill-cmyk'])!;
  if (typeof s.stroke === 'string' && cmyk(p['data-stroke-cmyk'])) s.stroke = cmyk(p['data-stroke-cmyk'])!;
  if (p['stroke-width'] !== undefined) s.strokeWidth = /(px|pt|pc|mm|cm|in)\s*$/i.test(p['stroke-width']) ? userLen(p['stroke-width'], 0) : num(p['stroke-width'], s.strokeWidth);
  if (p.opacity !== undefined) s.opacity = num(p.opacity, 1);
  if (p['fill-opacity'] !== undefined) s.fillOpacity = num(p['fill-opacity'], 1);
  if (p['stroke-opacity'] !== undefined) s.strokeOpacity = num(p['stroke-opacity'], 1);
  if (p['fill-rule'] !== undefined) s.evenOdd = p['fill-rule'] === 'evenodd';
  if (p['stroke-linecap'] !== undefined) s.lineCap = p['stroke-linecap'] === 'round' ? 1 : p['stroke-linecap'] === 'square' ? 2 : 0;
  if (p['stroke-linejoin'] !== undefined) s.lineJoin = p['stroke-linejoin'] === 'round' ? 1 : p['stroke-linejoin'] === 'bevel' ? 2 : 0;
  if (p['font-size'] !== undefined) {
    const v = p['font-size'];
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) s.fontSize = /pt$/.test(v) ? (n * 4) / 3 : /em$/.test(v) ? n * parent.fontSize : /%$/.test(v) ? (n / 100) * parent.fontSize : n;
  }
  if (p['font-family'] !== undefined && p['font-family'] !== 'inherit') s.fontFamily = p['font-family'];
  if (p['font-weight'] !== undefined) {
    const w = p['font-weight'];
    s.fontWeight = w === 'bold' || w === 'bolder' ? 700 : w === 'normal' || w === 'lighter' ? 400 : parseInt(w, 10) || s.fontWeight;
  }
  // baseline-shift (SVG 1.1 §10.9.2・CSS Inline 3 §4.2.3): 入れ子の要素の分は足し合わせる。百分率は字の大きさ (SVG の line-height) に対して。
  // sub・super は、書体の上付き・下付きの位置が無いので、CSS Inline 3 §4.2.3 の既定 (親の字の大きさの 1/5 下げる・1/3 上げる)
  delete s.alignmentBaseline;
  if (p['baseline-shift'] !== undefined) {
    const v = p['baseline-shift'].trim();
    const fs = parent.fontSize;
    const up = v === 'sub' ? -fs / 5 : v === 'super' ? fs / 3 : v === 'baseline' ? 0 : /%$/.test(v) ? (parseFloat(v) / 100) * fs : /em$/.test(v) ? parseFloat(v) * fs : userLen(v, fs);
    if (Number.isFinite(up) && up) s.baselineShift = (parent.baselineShift ?? 0) - up;
  }
  if (p['dominant-baseline'] !== undefined && p['dominant-baseline'] !== 'inherit') s.dominantBaseline = p['dominant-baseline'].trim();
  if (p['alignment-baseline'] !== undefined && !/^(auto|baseline|inherit)$/.test(p['alignment-baseline'].trim())) s.alignmentBaseline = p['alignment-baseline'].trim();
  // visibility (CSS 2.1 §11.2。継承する): hidden・collapse の要素は描かないが、visible の子は描く
  if (p.visibility !== undefined && p.visibility !== 'inherit') {
    const v = p.visibility.trim();
    if (v === 'hidden' || v === 'collapse') s.hidden = true;
    else if (v === 'visible') delete s.hidden;
  }
  // writing-mode (SVG 1.1 §10.7.2 の lr-tb・rl-tb・tb-rl・lr・rl・tb、CSS Writing Modes 3 §2.1 の horizontal-tb・vertical-rl・vertical-lr、
  // Writing Modes 4 の sideways-rl・sideways-lr) と text-orientation (§5.1。mixed・upright・sideways)、SVG 1.1 の glyph-orientation-vertical
  // (0 は立てる、90 は寝かせる、auto は mixed)
  const wm = p['writing-mode']?.trim();
  if (wm !== undefined && wm !== 'inherit') {
    if (/^(tb|tb-rl|vertical-rl|vertical-lr)$/.test(wm)) s.vertical = s.vertical ?? 'mixed';
    else if (/^sideways-(rl|lr)$/.test(wm)) s.vertical = 'sideways';
    else if (/^(lr|lr-tb|rl|rl-tb|horizontal-tb)$/.test(wm)) delete s.vertical;
  }
  const to = p['text-orientation']?.trim();
  const gov = p['glyph-orientation-vertical']?.trim();
  if (s.vertical && to && /^(mixed|upright|sideways|sideways-right)$/.test(to)) s.vertical = to === 'sideways-right' ? 'sideways' : (to as 'mixed' | 'upright' | 'sideways');
  else if (s.vertical && gov) s.vertical = gov === 'auto' ? 'mixed' : /^0(deg)?$/.test(gov) ? 'upright' : /^90(deg)?$/.test(gov) ? 'sideways' : s.vertical;
  // letter-spacing・word-spacing: normal は 0。em は字の大きさに対して
  for (const [k, f] of [['letter-spacing', 'letterSpacing'], ['word-spacing', 'wordSpacing']] as const) {
    const v = p[k]?.trim();
    if (v === undefined || v === 'inherit') continue;
    if (v === 'normal') delete s[f];
    else {
      const em = /^(-?[\d.]+(?:e-?\d+)?)em$/i.exec(v);
      const x = em ? parseFloat(em[1]) * s.fontSize : userLen(v, s.fontSize);
      if (Number.isFinite(x)) s[f] = x;
    }
  }
  // text-decoration (SVG 1.1 §10.12・CSS Text Decoration 3 §2.1 の text-decoration-line): 線の種類と、指定した要素の塗り
  const deco = p['text-decoration-line'] ?? p['text-decoration'];
  if (deco !== undefined && deco !== 'inherit' && deco.trim() !== 'none') {
    const d = { under: /\bunderline\b/.test(deco), over: /\boverline\b/.test(deco), through: /\bline-through\b/.test(deco) };
    if (d.under || d.over || d.through) s.decorations = [...(parent.decorations ?? []), { ...d, fill: s.fill, opacity: s.fillOpacity * (s.fillAlpha ?? 1) }];
  }
  // paint-order (SVG 2 §13.8): normal | [ fill || stroke || markers ]。読めない値は無視する
  if (p['paint-order'] !== undefined && p['paint-order'] !== 'inherit') {
    const ws = p['paint-order'].trim().split(/\s+/);
    const all = ['fill', 'stroke', 'markers'] as const;
    if (ws.length === 1 && ws[0] === 'normal') delete s.paintOrder;
    else if (ws.every((w) => (all as readonly string[]).includes(w)) && new Set(ws).size === ws.length) {
      const order = [...(ws as Array<(typeof all)[number]>), ...all.filter((w) => !ws.includes(w))];
      if (order.join() === all.join()) delete s.paintOrder;
      else s.paintOrder = order;
    }
  }
  // font-style (CSS Fonts 4 §2.4): normal | italic | oblique <角度>?
  if (p['font-style'] !== undefined && p['font-style'] !== 'inherit') {
    const v = p['font-style'].trim().toLowerCase();
    if (v === 'normal') delete s.fontStyle;
    else if (v === 'italic') s.fontStyle = 'italic';
    else if (/^oblique\b/.test(v)) s.fontStyle = 'oblique';
  }
  if (p['text-anchor'] === 'start' || p['text-anchor'] === 'middle' || p['text-anchor'] === 'end') s.textAnchor = p['text-anchor'];
  if (p['xml:space'] === 'preserve') s.preserveSpace = true;
  else if (p['xml:space'] === 'default') s.preserveSpace = false;
  const markerRef = (v: string) => /url\(\s*['"]?#([^'")\s]+)/.exec(v)?.[1];
  if (p.marker !== undefined && p.marker !== 'inherit') s.markerStart = s.markerMid = s.markerEnd = markerRef(p.marker);
  for (const [k, f] of [['marker-start', 'markerStart'], ['marker-mid', 'markerMid'], ['marker-end', 'markerEnd']] as const) if (p[k] !== undefined && p[k] !== 'inherit') s[f] = markerRef(p[k]);
  if (p['stroke-dasharray'] !== undefined) {
    const d = p['stroke-dasharray'] === 'none' ? [] : p['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(Number);
    s.dash = d.length && d.every((x) => Number.isFinite(x) && x >= 0) && d.some((x) => x > 0) ? d : undefined;
  }
  if (p['stroke-dashoffset'] !== undefined) {
    const v = parseFloat(p['stroke-dashoffset']);
    s.dashOffset = Number.isFinite(v) && v !== 0 ? v : undefined;
  }
  if (p['stroke-miterlimit'] !== undefined) {
    // 1 未満は誤り (SVG 1.1 §11.4)。既定の 4 のまま
    const v = parseFloat(p['stroke-miterlimit']);
    s.miterLimit = Number.isFinite(v) && v >= 1 ? v : undefined;
  }
  return s;
}

// ───────────── 本体 ─────────────

const nm = (n: XmlNode) => (n.localName ?? n.nodeName.split(':').pop() ?? '').toLowerCase();
/** SVG でない名前空間の要素 (接頭辞の付いた要素: Visio の v:・Illustrator の i: など)。ブラウザと同じに描かない */
const foreign = (n: XmlNode) => n.nodeName.includes(':') && !/^svg:/i.test(n.nodeName);
/** 長さ (単位つき・ref に対する %) を、利用者の単位 (px) にする。読めなければ 0 */
const ulen = (v: string, ref: number) => {
  const m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(%|px|pt|pc|mm|cm|in)?\s*$/i.exec(v);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] ?? 'px').toLowerCase();
  return u === '%' ? (n * ref) / 100 : n * ({ px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 } as Record<string, number>)[u];
};
/** 長さ: 単位 (px・pt・pc・mm・cm・in・%) があれば利用者座標の単位 (px) に直し、無ければ数のまま (ref は % の基準) */
const userLen = (v: string | null | undefined, ref: number) => {
  if (!v) return 0;
  if (/^\s*-?[\d.]+(?:e-?\d+)?\s*(%|px|pt|pc|mm|cm|in)\s*$/i.test(v)) return ulen(v, ref);
  return len(v);
};
const len = (v: string | null | undefined) => {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** SVG を解釈する。PDF ベクタにできない内容を含む場合は null (ラスタライズへフォールバック) */
export function parseSvg(text: string, parse: (xml: string) => XmlNode, opts: ParseSvgOptions = {}): SvgDoc | null {
  try {
    // 入れ子の深すぎる SVG は、解析の前に断る (SVG_MAX_NEST の説明)
    if (svgNestTooDeep(text)) throw new Unsupported('too deep');
    const doc = parse(text);
    const root = Array.from(doc.childNodes).find((c) => c.nodeType === 1);
    if (!root || nm(root) !== 'svg') return null;
    const vb = (root.getAttribute?.('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    let viewBox: [number, number, number, number];
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = vb as [number, number, number, number];
    else {
      // 単位付きの長さ (cm など) は、利用者座標の単位 (px) に直す (SVG 1.1 §7.10: viewBox が無ければ利用者座標の 1 単位は 1px)
      // (百分率は基準が無いので、従来どおり数のまま)
      const rootLen = (v: string | null | undefined) => (v && /%\s*$/.test(v) ? len(v) : userLen(v, 0));
      const w = rootLen(root.getAttribute?.('width'));
      const h = rootLen(root.getAttribute?.('height'));
      if (w <= 0 || h <= 0) return null;
      viewBox = [0, 0, w, h];
    }
    const shapes: SvgShape[] = [];
    /** 図形を足す先 (pattern の中身を集めるときは差し替える) */
    let target = shapes;
    // id → 要素 (グラデーション・clipPath・use の参照先)
    const byId = new Map<string, XmlNode>();
    /** 要素を訪ねられる残りの回数 (文書の要素の数 + MAX_EXPANDED_VISITS)。尽きたら Unsupported */
    let visitsLeft = MAX_EXPANDED_VISITS;
    /** n を訪ねる。2 回目からは、属性の字数に応じて余分に数える (VISIT_WEIGHT_CHARS の説明) */
    const visit = (n: XmlNode) => {
      const e = entryOf(n);
      let cost = 1;
      if (e.seen) {
        if (e.weight === undefined) {
          // 属性の値の字数の合計 (属性の一覧を読めない実装では、書式のプロパティの字数)。
          // 形の属性 (d・points) は数えない: 形は要素ごとに 1 度だけ読み (geometryOf)、置き直す分は線分の数で数える
          let w = 0;
          const attrs = (n as { attributes?: ArrayLike<{ name?: string; value?: string | null }> }).attributes;
          if (attrs && typeof attrs.length === 'number')
            for (let k = 0; k < attrs.length; k++) {
              const at = attrs[k];
              if (at && at.name !== 'd' && at.name !== 'points') w += at.value?.length ?? 0;
            }
          else for (const k of Object.keys(e.p)) w += k.length + e.p[k].length;
          e.weight = Math.floor(w / VISIT_WEIGHT_CHARS);
        }
        cost += e.weight;
      } else e.seen = true;
      if ((visitsLeft -= cost) < 0) throw new Unsupported('too many elements');
    };
    /** 参照や効果で増える線分の残り (MAX_EXPANDED_SEGS の説明)。尽きたら Unsupported */
    let segsLeft = Math.min(MAX_EXPANDED_SEGS, EXPANDED_SEGS_BASE + text.length * EXPANDED_SEGS_PER_CHAR);
    const charge = (k: number) => {
      if ((segsLeft -= k) < 0) throw new Unsupported('too many path segments');
    };
    /**
     * transform の値 → 行列 (読めなければ null)。同じ文字列は 1 度だけ読む (長い transform を持つ要素を use で何度も置くと、
     * 置くたびに読み直すことになる)。返した行列は書き換えない
     */
    const transforms = new Map<string, M | null>();
    const tf = (v: string | null | undefined): M | null => {
      if (!v) return ID;
      let m = transforms.get(v);
      if (m === undefined) transforms.set(v, (m = parseTransform(v)));
      return m;
    };
    /**
     * 要素の変換: transform (属性・<style>・style 属性。スタイルの transform は属性に勝つ: CSS Transforms 1 §7.1) を、transform-origin (§5。
     * SVG の要素の初期値は 0 0) の点の周りに掛ける (変換 = translate(origin) · transform · translate(−origin))。transform-box (§6。初期値 view-box) は、
     * 百分率と transform-origin の基準の箱: view-box はいまの viewport (原点は座標の原点)、fill-box・content-box は要素の外接矩形、
     * stroke-box・border-box は線の太さの半分を外へ広げた外接矩形 (§6: SVG の要素の content-box は fill-box、border-box は stroke-box)。
     * bbox は要素の外接矩形を求める関数 (無ければ fill-box も view-box で代える)。読めなければ null
     */
    const elementTransform = (n: XmlNode, bbox?: () => Box | undefined): M | null => {
      const p = props(n);
      const raw = p.transform;
      if (!raw || raw.trim() === 'none') return ID;
      const originRaw = p['transform-origin'];
      const boxKind = (p['transform-box'] ?? 'view-box').trim();
      const needBox = /%/.test(raw) || originRaw !== undefined;
      if (!needBox) return tf(raw);
      let box: Box = { x: 0, y: 0, w: vp.w, h: vp.h };
      if (boxKind !== 'view-box' && bbox) {
        const b = bbox();
        if (b) {
          box = b;
          if (boxKind === 'stroke-box' || boxKind === 'border-box') {
            const st = props(n)['stroke'];
            const half = st && st !== 'none' ? userLen(props(n)['stroke-width'] ?? '1', Math.hypot(vp.w, vp.h) / Math.SQRT2) / 2 : 0;
            box = { x: b.x - half, y: b.y - half, w: b.w + 2 * half, h: b.h + 2 * half };
          }
        }
      }
      const t = parseTransform(raw, box);
      if (!t || originRaw === undefined) return t;
      // transform-origin (CSS Transforms 1 §5): 1〜3 個の値 (x y z。z は 2D では使わない)。語 (left・center・right・top・bottom)・長さ・百分率
      const parts = originRaw.trim().split(/\s+/);
      let ox: string | undefined;
      let oy: string | undefined;
      for (const v of parts.slice(0, 2)) {
        if ((v === 'top' || v === 'bottom') && oy === undefined) oy = v;
        else if ((v === 'left' || v === 'right') && ox === undefined) ox = v;
        else if (ox === undefined) ox = v;
        else oy = v;
      }
      const pos = (v: string | undefined, start: number, size: number, lo: string, hi: string) => {
        if (v === undefined || v === 'center') return start + size / 2;
        if (v === lo) return start;
        if (v === hi) return start + size;
        if (/%$/.test(v)) return start + (parseFloat(v) / 100) * size;
        const l = userLen(v, size);
        return start + l;
      };
      const x = pos(ox, box.x, box.w, 'left', 'right');
      const y = pos(oy, box.y, box.h, 'top', 'bottom');
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return mul(mul([1, 0, 0, 1, x, y], t), [1, 0, 0, 1, -x, -y]);
    };
    let patternNest = 0;
    /** filter を画素で計算する予算 (この SVG の分。FilterRasterRequest の budget) */
    const filterBudget: { used?: number } = {};
    /** 要素 → 親の要素 (stop-color・flood-color の currentColor を、その要素の color で決めるため) */
    const parentOf = new Map<XmlNode, XmlNode>();
    const index = (n: XmlNode) => {
      visitsLeft++;
      const id = n.getAttribute?.('id');
      if (id) byId.set(id, n);
      for (const c of Array.from(n.childNodes))
        if (c.nodeType === 1) {
          parentOf.set(c, n);
          index(c);
        }
    };
    index(root);
    // <style> の規則 (どこに書かれていても文書全体に効く)
    let cssText = '';
    const collectCss = (n: XmlNode) => {
      if (nm(n) === 'style') cssText += `${n.textContent ?? ''}\n`;
      for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) collectCss(c);
    };
    collectCss(root);
    // @media は、SVG の画像の大きさ (viewBox の幅・高さ) の印刷の画面として照らす
    const media: MediaEnv = { width: viewBox[2], height: viewBox[3] };
    const css = cssText.trim() ? indexCss(parseCss(cssText, media)) : undefined;
    /** 外のファイルの要素の、そのファイルの <style> の規則 (use で外のファイルを指したとき) */
    const extCss = new Map<XmlNode, CssIndex | undefined>();
    /** 読んだ外のファイル (名前 → 根の要素と id の索引。読めなければ null) */
    const extDocs = new Map<string, { root: XmlNode; ids: Map<string, XmlNode> } | null>();
    /**
     * use の参照先。同じ文書の #id のほか、外のファイル (file.svg#id。#id が無ければ、そのファイルの根) を opts.resource で読む
     * (SVG 2 の use は、外の文書の要素も指せる)。外のファイルの中の #id の参照 (グラデーションなど) は、そのファイルの id で引けるように、
     * 同じ id の無いものを id の索引に足す。読むファイルは 8 つまで
     */
    const useRef = (n: XmlNode): XmlNode | undefined => {
      const raw = (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').trim();
      const k = raw.indexOf('#');
      const file = k < 0 ? raw : raw.slice(0, k);
      const id = k < 0 ? '' : raw.slice(k + 1);
      if (!file) return byId.get(id);
      if (/^data:/i.test(file) || !opts.resource) return undefined;
      let ext = extDocs.get(file);
      if (ext === undefined) {
        ext = null;
        const text = extDocs.size < 8 ? opts.resource(file) : undefined;
        if (text !== undefined && !svgNestTooDeep(text)) {
          const d = parse(text);
          const r = Array.from(d.childNodes).find((c) => c.nodeType === 1);
          if (r && nm(r) === 'svg') {
            const ids = new Map<string, XmlNode>();
            let extText = '';
            const walkExt = (e: XmlNode) => {
              visitsLeft++;
              const eid = e.getAttribute?.('id');
              if (eid && !ids.has(eid)) ids.set(eid, e);
              if (nm(e) === 'style') extText += `${e.textContent ?? ''}\n`;
              for (const c of Array.from(e.childNodes))
                if (c.nodeType === 1) {
                  parentOf.set(c, e);
                  walkExt(c);
                }
            };
            walkExt(r);
            const ix = extText.trim() ? indexCss(parseCss(extText, media)) : undefined;
            const mark = (e: XmlNode) => {
              extCss.set(e, ix);
              for (const c of Array.from(e.childNodes)) if (c.nodeType === 1) mark(c);
            };
            mark(r);
            for (const [i2, e] of ids) if (!byId.has(i2)) byId.set(i2, e);
            ext = { root: r, ids };
          }
        }
        extDocs.set(file, ext);
      }
      if (!ext) return undefined;
      return id ? ext.ids.get(id) : ext.root;
    };
    /**
     * 要素の書式 (属性・<style> の規則・style 属性) は、要素ごとに 1 度だけ読んで覚える (1 回の訪問で何度も引き、use で置くたびにも引く)。
     * 返したものは書き換えない。seen・weight は visit が使う
     */
    const entries = new Map<XmlNode, { p: Record<string, string>; seen?: boolean; weight?: number }>();
    const entryOf = (n: XmlNode) => {
      let e = entries.get(n);
      if (!e) entries.set(n, (e = { p: resolveValues(n, propsOf(n, extCss.has(n) ? extCss.get(n) : css)) }));
      return e;
    };
    /** 要素のカスタムプロパティ (受け継ぐ。CSS Variables 1 §2): 親のものに、自分の --名前 の宣言を重ねる */
    const customKept = new Map<XmlNode, ReadonlyMap<string, string>>();
    const NO_VARS: ReadonlyMap<string, string> = new Map();
    const customOf = (n: XmlNode | undefined): ReadonlyMap<string, string> => {
      if (!n) return NO_VARS;
      let c = customKept.get(n);
      if (c) return c;
      const parent = customOf(parentOf.get(n));
      const own = Object.entries(entryOf(n).p).filter(([k]) => k.startsWith('--'));
      c = own.length ? new Map([...parent, ...own]) : parent;
      customKept.set(n, c);
      return c;
    };
    /**
     * 1 つの SVG で var() を置き換えた長さの合計の上限 (1 つの値の上限の 8 倍)。1 つの値は上限に収まっても (--v: 1M 字)、
     * それを使う要素がそれぞれ自分の --名前 を持つと (受け継いだ表を使い回せないので) 要素の数だけ置き換え直し、30KB の SVG で 1GB を使えた。
     * 同じ表 (受け継いだもの) で同じ値を置き換えるときは、覚えた結果を使い回し、合計に数えない (実在の絵の、同じ var() を引く多数の要素はこちら)。
     * 尽きたら、それより後の var() を含む値は無効 (Variables 1 §3.3 と同じ扱い)
     */
    const varTotal = { left: 8 * SVG_MAX_VAR_LENGTH };
    const varKept = new WeakMap<ReadonlyMap<string, string>, Map<string, string | undefined>>();
    const substituteVarsKept = (v: string, vars: ReadonlyMap<string, string>): string | undefined => {
      let kept = varKept.get(vars);
      if (!kept) varKept.set(vars, (kept = new Map()));
      if (kept.has(v)) return kept.get(v);
      const budget = { left: Math.min(SVG_MAX_VAR_LENGTH, varTotal.left) };
      const start = budget.left;
      const r = varTotal.left > 0 ? substituteVars(v, vars, 0, budget) : undefined;
      varTotal.left -= start - budget.left;
      kept.set(v, r);
      return r;
    };
    /** 値の var() (CSS Variables 1 §3) と calc() (CSS Values 4 §10.1) を解く。var() の解けない値のプロパティは、指定が無いものとする */
    const resolveValues = (n: XmlNode, p: Record<string, string>): Record<string, string> => {
      if (!Object.values(p).some((v) => v.includes('var(') || /calc\(/i.test(v))) return p;
      const out: Record<string, string> = {};
      let vars: ReadonlyMap<string, string> | undefined;
      for (const [k, v0] of Object.entries(p)) {
        if (k.startsWith('--')) {
          out[k] = v0;
          continue;
        }
        let v: string | undefined = v0;
        if (v.includes('var(')) {
          // 自分の --名前 の宣言は、entryOf がまだ返せないので、ここで重ねる
          if (!vars) {
            const own = Object.entries(p).filter(([q]) => q.startsWith('--'));
            vars = own.length ? new Map([...customOf(parentOf.get(n)), ...own]) : customOf(parentOf.get(n));
          }
          v = substituteVarsKept(v, vars);
        }
        if (v === undefined) continue;
        out[k] = /calc\(/i.test(v) ? evaluateCalc(v) : v;
      }
      return out;
    };
    const props = (n: XmlNode) => entryOf(n).p;
    /** 要素の color (祖先をさかのぼって最初の指定。無ければ初期値の黒)。図形でない要素 (stop・フィルタの要素) の currentColor に使う */
    const colorAt = (n: XmlNode): string => {
      for (let e: XmlNode | undefined = n; e; e = parentOf.get(e)) {
        const c = props(e).color;
        if (c === undefined || c === 'inherit' || isCurrentColor(c)) continue;
        const v = colorOf(c);
        if (typeof v === 'string') return v;
      }
      return '#000000';
    };
    const hrefOf = (n: XmlNode) => (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').replace(/^#/, '');
    const vbW = viewBox[2];
    const vbH = viewBox[3];

    /**
     * 図形要素の形 (ローカル座標)。図形でなければ undefined。返した並びは書き換えない。
     * 同じ要素の形を 2 度目に求められたら覚え、それからは読み直さない (use・clip-path・marker・textPath で何度も引かれる path の d を、
     * 引かれるたびに読み直さない。1 度しか引かれない要素は覚えないので、大きな絵でメモリを余分に使わない)。
     * 2 度目からは、線分の数を「参照で増える分」に数える (MAX_EXPANDED_SEGS の説明)
     */
    const geoSeen = new Set<XmlNode>();
    const geoKept = new Map<XmlNode, Seg[]>();
    const geometryOf = (n: XmlNode, name: string): Seg[] | undefined => {
      const kept = geoKept.get(n);
      if (kept) {
        charge(kept.length);
        return kept;
      }
      const segs = geometryOf0(n, name);
      if (!segs) return segs;
      if (geoSeen.has(n)) {
        geoKept.set(n, segs);
        charge(segs.length);
      } else geoSeen.add(n);
      return segs;
    };
    const geometryOf0 = (n: XmlNode, name: string): Seg[] | undefined => {
      // 長さは単位を利用者座標 (px) に直す。百分率は viewport の幅 (x 方向)・高さ (y 方向)・対角 / √2 (r) に対して (SVG 1.1 §7.10)
      const ref = (k: string) => (/^(y|cy|y1|y2|height|ry)$/.test(k) ? vbH : k === 'r' ? Math.hypot(vbW, vbH) / Math.SQRT2 : vbW);
      const g = (k: string) => userLen(n.getAttribute?.(k), ref(k));
      switch (name) {
        case 'path': {
          const segs = parsePathData(n.getAttribute?.('d') ?? '');
          if (!segs) throw new Unsupported('path data');
          return segs;
        }
        case 'rect': {
          const x = g('x');
          const y = g('y');
          const w = g('width');
          const h = g('height');
          let rx = n.getAttribute?.('rx') ? g('rx') : g('ry');
          let ry = n.getAttribute?.('ry') ? g('ry') : rx;
          rx = Math.min(rx, w / 2);
          ry = Math.min(ry, h / 2);
          if (w <= 0 || h <= 0) return [];
          if (rx <= 0 || ry <= 0) return [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
          return (
            parsePathData(
              `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`,
            ) ?? []
          );
        }
        case 'circle':
        case 'ellipse': {
          const cx = g('cx');
          const cy = g('cy');
          const rx = name === 'circle' ? g('r') : g('rx');
          const ry = name === 'circle' ? g('r') : g('ry');
          return rx > 0 && ry > 0 ? (parsePathData(`M${cx + rx},${cy}A${rx},${ry} 0 1 1 ${cx - rx},${cy}A${rx},${ry} 0 1 1 ${cx + rx},${cy}Z`) ?? []) : [];
        }
        case 'line':
          return [{ op: 'M', x: g('x1'), y: g('y1') }, { op: 'L', x: g('x2'), y: g('y2') }];
        case 'polyline':
        case 'polygon': {
          const v = (n.getAttribute?.('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
          if (v.length % 2 || v.some((x) => !Number.isFinite(x))) throw new Unsupported('points');
          const segs: Seg[] = [];
          for (let i = 0; i + 1 < v.length; i += 2) segs.push({ op: i === 0 ? 'M' : 'L', x: v[i], y: v[i + 1] });
          if (name === 'polygon' && segs.length) segs.push({ op: 'Z' });
          return segs;
        }
        default:
          return undefined;
      }
    };

    /** グラデーションの属性・stop を、href の参照元から引き継いで集める */
    const gradientAttr = (n: XmlNode, k: string, depth = 0): string | undefined => {
      const v = n.getAttribute?.(k);
      if (v !== null && v !== undefined) return v;
      const ref = byId.get(hrefOf(n));
      return ref && depth < 8 ? gradientAttr(ref, k, depth + 1) : undefined;
    };
    const gradientStops = (n: XmlNode, depth = 0): XmlNode[] => {
      const own = Array.from(n.childNodes).filter((c) => c.nodeType === 1 && nm(c) === 'stop');
      if (own.length) return own;
      const ref = byId.get(hrefOf(n));
      return ref && depth < 8 ? gradientStops(ref, depth + 1) : [];
    };
    const segBox = (segs: Seg[]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const g of segs) {
        if (g.op === 'Z') continue;
        const pts = g.op === 'C' ? [[g.x1, g.y1], [g.x2, g.y2], [g.x, g.y]] : [[g.x, g.y]];
        for (const [x, y] of pts) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      return { x: x0, y: y0, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) };
    };
    /** グラデーションの要素 → 読んだ stop の並び (書き換えない) */
    const gradientStopsKept = new Map<XmlNode, SvgGradient['stops']>();
    /** 塗りのグラデーション。stop が 1 つなら単色、無ければ塗らない */
    const gradientOf = (id: string, local: Seg[], mm: M): SvgGradient | string | null => {
      const g = byId.get(id);
      if (!g) return null;
      const kind = nm(g) === 'lineargradient' ? 'linear' : nm(g) === 'radialgradient' ? 'radial' : undefined;
      if (!kind) throw new Unsupported(`paint server ${nm(g)}`);
      const bboxUnits = (gradientAttr(g, 'gradientUnits') ?? 'objectBoundingBox') !== 'userSpaceOnUse';
      // stop の並びは、グラデーションごとに 1 度だけ読む (stop が 2 万個のグラデーションで 500 個の図形を塗ると、塗るたびに読み直して
      // 1000 万個の stop を作っていた)。2 度目からは、stop の数を「参照で増える分」に数える (描く側は、図形ごとに stop の数だけの関数を書く)
      let stops = gradientStopsKept.get(g);
      if (stops) charge(stops.length);
      else {
        stops = gradientStops(g).map((st) => {
          const p = props(st);
          const sc = p['stop-color'] ?? '#000000';
          const color = colorOf(sc, false, isCurrentColor(sc) ? colorAt(st) : undefined) as string | null;
          // stop-color が none・transparent なら、透明の黒
          const op = color ? Math.max(0, Math.min(1, num(p['stop-opacity'], 1))) : 0;
          return { offset: Math.max(0, Math.min(1, num(st.getAttribute?.('offset') ?? undefined, 0))), color: color ?? '#000000', ...(op < 1 ? { opacity: op } : {}) };
        });
        for (let k = 1; k < stops.length; k++) stops[k].offset = Math.max(stops[k].offset, stops[k - 1].offset);
        gradientStopsKept.set(g, stops);
      }
      if (!stops.length) return null;
      if (stops.length === 1) return stops[0].color;
      // 座標: bbox 単位は 0〜1 (% も)、userSpaceOnUse は長さ (% は viewBox に対する割合)
      const coord = (k: string, def: string, axis: 'x' | 'y' | 'r') => {
        const v = gradientAttr(g, k) ?? def;
        const n = parseFloat(v);
        if (!Number.isFinite(n)) return 0;
        if (v.trim().endsWith('%')) return bboxUnits ? n / 100 : (n / 100) * (axis === 'x' ? vbW : axis === 'y' ? vbH : Math.hypot(vbW, vbH) / Math.SQRT2);
        return n;
      };
      let coords: number[];
      if (kind === 'linear') coords = [coord('x1', '0%', 'x'), coord('y1', '0%', 'y'), coord('x2', '100%', 'x'), coord('y2', '0%', 'y')];
      else {
        const cx = coord('cx', '50%', 'x');
        const cy = coord('cy', '50%', 'y');
        const r = coord('r', '50%', 'r');
        const fx = gradientAttr(g, 'fx') !== undefined ? coord('fx', '50%', 'x') : cx;
        const fy = gradientAttr(g, 'fy') !== undefined ? coord('fy', '50%', 'y') : cy;
        // fr (SVG 2): 焦点の円の半径。PDF の放射のシェーディングの始めの円の半径にする
        const fr = Math.min(Math.max(coord('fr', '0%', 'r'), 0), r);
        coords = [fx, fy, fr, cx, cy, r];
      }
      const gt = tf(gradientAttr(g, 'gradientTransform'));
      if (!gt) throw new Unsupported('gradientTransform');
      const b = segBox(local);
      const unitMap: M = bboxUnits ? [b.w, 0, 0, b.h, b.x, b.y] : ID;
      const spread = gradientAttr(g, 'spreadMethod');
      const grad: SvgGradient = { kind, coords, stops, matrix: mul(mul(mm, unitMap), gt) };
      if (spread === 'repeat' || spread === 'reflect') {
        // 図形の外接矩形の角を、グラデーションの空間に写す
        const inv = invert(mul(unitMap, gt));
        if (inv) spreadGradient(grad, spread, [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]));
        // 繰り返して並べた stop は、図形ごとに作るので、増えた分を数える
        if (grad.stops !== stops) charge(grad.stops.length - stops.length);
      }
      return grad;
    };
    /**
     * 塗りの模様 (pattern)。patternUnits (既定 objectBoundingBox)・patternContentUnits・viewBox・patternTransform・href の継承。
     * 中身はほかの図形と同じに描く (マスク・vector-effect があればラスタライズ)
     */
    const patternOf = (id: string, local: Seg[], mm: M): SvgPattern | null => {
      const g = byId.get(id)!;
      const a = (k: string) => gradientAttr(g, k);
      const bboxUnits = (a('patternUnits') ?? 'objectBoundingBox') !== 'userSpaceOnUse';
      const b = segBox(local);
      const v = (k: string, axis: 'x' | 'y') => {
        const raw = a(k) ?? '0';
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return 0;
        const frac = raw.trim().endsWith('%') ? n / 100 : n;
        if (bboxUnits) return axis === 'x' ? b.x * (k === 'x' ? 1 : 0) + frac * b.w : b.y * (k === 'y' ? 1 : 0) + frac * b.h;
        return raw.trim().endsWith('%') ? frac * (axis === 'x' ? vbW : vbH) : n;
      };
      const x = v('x', 'x');
      const y = v('y', 'y');
      const w = v('width', 'x');
      const h = v('height', 'y');
      if (!(w > 0) || !(h > 0)) return null;
      const pt = tf(a('patternTransform'));
      if (!pt) throw new Unsupported('patternTransform');
      // 中身の座標 → タイルの座標
      const pvb = (a('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
      let content: M = ID;
      if (pvb.length === 4 && pvb.every(Number.isFinite) && pvb[2] > 0 && pvb[3] > 0) content = [w / pvb[2], 0, 0, h / pvb[3], (-pvb[0] * w) / pvb[2], (-pvb[1] * h) / pvb[3]];
      else if (a('patternContentUnits') === 'objectBoundingBox') content = [b.w, 0, 0, b.h, 0, 0];
      // 中身 (子が無ければ href の参照先の子)
      const kidsOf = (n: XmlNode, depth = 0): XmlNode[] => {
        const own = Array.from(n.childNodes).filter((c) => c.nodeType === 1);
        if (own.length) return own;
        const ref = byId.get(hrefOf(n));
        return ref && depth < 8 ? kidsOf(ref, depth + 1) : [];
      };
      const saved = target;
      const savedMasks = masks;
      const inner: SvgShape[] = [];
      target = inner;
      // 中身は、模様の座標系の新しい状態で描く: 模様で塗る要素 (とその祖先) の切り抜き・マスクは受け継がない (SVG 2 §14.3.1: pattern の中身は、
      // pattern の要素の祖先から性質を受け継ぎ、参照する要素からは受け継がない。切り抜き・マスクは、模様で塗った結果に、塗った要素の側で当たる)。
      // 前は、mask を付けたグループの中の要素の模様の塗りが、外のマスクを中身の図形に持ち込み、下の「pattern content」で読めなかった
      masks = [];
      // 中身の walk は深さを 1 から数え直すので、pattern の入れ子はここで数える (中身が自分自身で塗られている pattern で止まらなくなる)
      if (patternNest >= MAX_PATTERN_NEST) throw new Unsupported('too deep');
      patternNest++;
      try {
        for (const c of kidsOf(g)) walk(c, ROOT_STYLE, content, 1, false, [], 1);
      } finally {
        patternNest--;
        target = saved;
        masks = savedMasks;
      }
      // マスク・大きさの変わらない線や形 (vector-effect) は、タイルの中では描けない
      if (inner.some((sh) => sh.masks || sh.nonScalingStroke || sh.nonScalingAnchor)) throw new Unsupported('pattern content');
      return { width: w, height: h, matrix: mul(mul(mm, pt), [1, 0, 0, 1, x, y]), shapes: inner };
    };

    /**
     * clip-path="url(#id)" の切り抜き。clipPathUnits が objectBoundingBox なら、中身の座標は要素の外接矩形 (bbox。要素の座標系) の
     * 0〜1 (CSS Masking 1 §6.1。外接矩形の無い要素は描かない)
     */
    const clipOf = (id: string, mm0: M, bbox: () => Box | undefined): SvgClip | null => {
      const cp = byId.get(id);
      if (!cp || nm(cp) !== 'clippath') return null;
      const units = cp.getAttribute?.('clipPathUnits') ?? 'userSpaceOnUse';
      const ct = elementTransform(cp);
      if (!ct) throw new Unsupported('transform');
      // clipPath の transform は要素の座標系で掛け、外接矩形の単位はその内側 (ブラウザの描き方と同じ)
      let base = mul(mm0, ct);
      if (units === 'objectBoundingBox') {
        const b = bbox();
        if (!b) return { segs: [], evenOdd: false };
        base = mul(base, [b.w, 0, 0, b.h, b.x, b.y]);
      } else if (units !== 'userSpaceOnUse') throw new Unsupported('clipPathUnits');
      // 同じ clipPath を同じ座標系で使う切り抜きは、1 つを共有する (図形ごとに clip-path を付けた絵で、付けた数だけ形を作り直さない)
      const key = `${id}\0${base.join(' ')}`;
      const shared = clipsKept.get(key);
      if (shared) return shared;
      const segs: Seg[] = [];
      let evenOdd = false;
      const add = (n: XmlNode, m: M, depth: number) => {
        visit(n);
        const name = nm(n);
        const tr = elementTransform(n);
        if (!tr) throw new Unsupported('transform');
        const m2 = mul(m, tr);
        if (name === 'use') {
          const ref = useRef(n);
          if (ref && depth < 8) add(ref, mul(m2, [1, 0, 0, 1, userLen(n.getAttribute?.('x'), vbW), userLen(n.getAttribute?.('y'), vbH)]), depth + 1);
          return;
        }
        if (name === 'g') {
          for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) add(c, m2, depth + 1);
          return;
        }
        if (CLIP_UNSUPPORTED.has(name)) throw new Unsupported(name);
        const geo = geometryOf(n, name);
        if (!geo) return;
        if (props(n)['clip-rule'] === 'evenodd') evenOdd = true;
        segs.push(...transformSegs(geo, m2));
      };
      for (const c of Array.from(cp.childNodes)) if (c.nodeType === 1) add(c, base, 0);
      const clip: SvgClip = { segs, evenOdd };
      clipsKept.set(key, clip);
      return clip;
    };
    const clipsKept = new Map<string, SvgClip>();
    /**
     * 描くときに書く切り抜きの線分を「参照で増える分」に数える (読み終えた図形について)。描く側は、続く図形で同じ切り抜きを 1 度だけ書く
     * (clipRuns) ので、同じ手順で開く切り抜きを数える。切り抜きごとに、最初に開く 1 回の分は数えない。5 万点の切り抜きを 400 個の図形に
     * 付けても 1 度だけ書くが、2 つの切り抜きを交互に付けると、図形ごとに開き直すことになるので数える。
     * グループの中身・模様の中身 (使うたびに描く) も同じに数え、マスクの中身は、マスクごとに 1 度 (描く側が使い回す)
     */
    const clipsUsed = new Set<SvgClip>();
    const masksSeen = new Set<SvgMask>();
    const chargeClipRuns = (list: readonly SvgShape[]) => {
      const { steps } = clipRuns(list);
      list.forEach((sh, i) => {
        for (const c of steps[i].open) {
          if (clipsUsed.has(c)) charge(c.segs.length);
          else clipsUsed.add(c);
        }
        if (sh.group) chargeClipRuns(sh.group.shapes);
        if (sh.fillPattern) chargeClipRuns(sh.fillPattern.shapes);
        for (const mk of sh.masks ?? []) {
          if (masksSeen.has(mk)) continue;
          masksSeen.add(mk);
          chargeClipRuns(mk.shapes);
        }
      });
    };

    /** filter を近似して描き直している要素 */
    const filtering = new Set<XmlNode>();
    /**
     * filter の要素を読み、近似のしかたを決める (Filter Effects 1)。filter の結果を「層」の並び (下から順) として求める:
     *  - source: 元の図形 (ずらす量・ぼかしの幅・色の変換 recolor・不透明度を掛けて描く)
     *  - alpha: 元の図形の形を 1 色で塗った影 (SourceAlpha から作ったもの。色・不透明度)
     *  - flood: 領域いっぱいの単色 (feFlood。feComposite の in で、影の形の色になる)
     * ぼかしは近似 (blurredCopies)。feComposite の in・out・atop は、図形で正しく描ける組み合わせだけを近似する (fecomposite の説明)。
     * 扱えない filter なら Unsupported (画素の計算 rasterFilter が渡っていればそれに回し、無ければ仮の枠)
     *  - uncut: feComposite の out で、元の図形の形 (ずらさない SourceAlpha など) を切り抜かずに描いた層。
     *    filter の結果で、後ろに元の図形 (不透明・ずらさない) が重なって、切り抜くはずの所が隠れるときだけ使える
     *  - cut: 層を切り抜く矩形 (要素の座標。どれにも入る所だけを描く)。filter の要素の部分領域 (Filter Effects 1 §9.4) が
     *    filter の領域を覆わないとき、要素の結果を部分領域で切る。後の要素がずらせば、矩形も一緒にずらす。
     *    切った層をぼかすと、切った縁がぼけるので図形では描けない (Unsupported にして、画素の計算に回す)
     */
    type FilterLayer =
      | { kind: 'source'; dx: number; dy: number; std: number; opacity: number; recolor: Array<(c: number[]) => number[]>; blend?: SvgBlend; uncut?: true; cut?: Box[] }
      | { kind: 'alpha'; dx: number; dy: number; std: number; color: number[]; opacity: number; blend?: SvgBlend; uncut?: true; cut?: Box[] }
      | { kind: 'flood'; color: number[]; opacity: number; blend?: SvgBlend; cut?: Box[] };
    /** filter を画素で計算するときの組み立て: filter の要素の並び (feImage の画像を引く関数を受け取る) と、primitiveUnits が objectBoundingBox か */
    type FilterRasterPlan = { prims: (image: (e: XmlNode, box: Box) => SvgShape[] | undefined) => FilterRasterRequest['prims']; obb: boolean };
    /**
     * filter の領域 (filterUnits の既定は objectBoundingBox、x・y・width・height の既定は −10%・−10%・120%・120%。Filter Effects 1 §8)。
     * box は要素の外接矩形を受け取って、領域 (要素の座標) を返す関数
     */
    const filterRegion = (f: XmlNode) => (box: () => Box | undefined, view: { w: number; h: number }): Box | undefined => {
      const ra = (k: string, d: string) => (f.getAttribute?.(k) ?? d).trim();
      if ((f.getAttribute?.('filterUnits') ?? 'objectBoundingBox') === 'userSpaceOnUse')
        return { x: ulen(ra('x', '-10%'), view.w), y: ulen(ra('y', '-10%'), view.h), w: ulen(ra('width', '120%'), view.w), h: ulen(ra('height', '120%'), view.h) };
      const b = box();
      if (!b) return undefined;
      const fr = (k: string, d: string) => (/%$/.test(ra(k, d)) ? parseFloat(ra(k, d)) / 100 : parseFloat(ra(k, d)));
      return { x: b.x + fr('x', '-10%') * b.w, y: b.y + fr('y', '-10%') * b.h, w: fr('width', '120%') * b.w, h: fr('height', '120%') * b.h };
    };
    /**
     * filter を読む。box は要素の外接矩形を求める関数、view は viewport の幅・高さ (filter の領域と、要素の部分領域の百分率に使う)
     */
    const filterOf = (
      ref: string,
      box: () => Box | undefined,
      view: { w: number; h: number },
    ): { layers: FilterLayer[]; region: ReturnType<typeof filterRegion>; raster?: FilterRasterPlan; rasterFallback?: FilterRasterPlan } => {
      const u = /url\(\s*['"]?#([^'")\s]+)/.exec(ref);
      const f = u ? byId.get(u[1]) : undefined;
      if (!f || nm(f) !== 'filter') throw new Unsupported('filter');
      const obbUnits = (f.getAttribute?.('primitiveUnits') ?? 'userSpaceOnUse') === 'objectBoundingBox';
      const prims = Array.from(f.childNodes).filter((c) => c.nodeType === 1);
      const a = (e: XmlNode, k: string) => e.getAttribute?.(k) ?? '';
      const num = (e: XmlNode, k: string, d = 0) => {
        const v = parseFloat(a(e, k));
        return Number.isFinite(v) ? v : d;
      };
      const nums = (v: string) => v.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
      /** #rrggbb → [r, g, b] (0〜1)。読めない色 (cmyk など) は Unsupported */
      const rgbOf = (c: string | null | undefined): number[] => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c ?? '');
        if (!m) throw new Unsupported('filter color');
        return [1, 2, 3].map((k) => parseInt(m[k], 16) / 255);
      };
      const floodOf = (e: XmlNode): { color: number[]; opacity: number } => {
        const c = props(e)['flood-color'] ?? a(e, 'flood-color');
        const col = c ? (colorOf(c, false, isCurrentColor(c) ? colorAt(e) : undefined) as string | null) : '#000000';
        const v = parseFloat(props(e)['flood-opacity'] ?? a(e, 'flood-opacity'));
        const op = (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1) * (col ? alphaOf(c ?? '') : 0);
        return { color: rgbOf(col ?? '#000000'), opacity: op };
      };
      // color-interpolation-filters (継承する。初期値 linearRGB。Filter Effects 1 §10): 色を変える計算を、線形の RGB でするか sRGB でするか
      const linearOf = (e: XmlNode) => {
        for (let n: XmlNode | undefined = e; n; n = parentOf.get(n)) {
          const v = (props(n)['color-interpolation-filters'] ?? n.getAttribute?.('color-interpolation-filters') ?? '').trim();
          if (v === 'sRGB' || v === 'srgb') return false;
          if (v === 'linearRGB' || v === 'linearrgb') return true;
        }
        return true;
      };
      const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
      const clamp = (x: number) => Math.min(1, Math.max(0, x));
      /** 色 (sRGB の r, g, b と不透明度 a) を変える関数を、color-interpolation-filters の色空間で fn を当てるものにする */
      const inSpace = (e: XmlNode, fn: (c: number[]) => number[]) => {
        const lin = linearOf(e);
        return (c: number[]) => {
          const x = fn(lin ? [toLin(c[0]), toLin(c[1]), toLin(c[2]), c[3]] : c).map(clamp);
          return lin ? [toSrgb(x[0]), toSrgb(x[1]), toSrgb(x[2]), x[3]] : x;
        };
      };
      /**
       * feColorMatrix (Filter Effects 1 §9.6。2018-12-18 の WD) の行列 (4 行 5 列を並べた 20 個)。
       * saturate・hueRotate の係数 (0.213・0.715・0.072 など) は §9.6 の行列のとおりで、SVG 1.1 §15.10 と同じ
       * (§9.6 の a00 の式だけ 0.2127・0.7873 と書くが、同じ節の行列は 0.213・0.787)。
       * luminanceToAlpha は §9.6 の 0.2126・0.7152・0.0722 (SVG 1.1 §15.10 は 0.2125・0.7154・0.0721。差は 1/255 より小さい)
       */
      const colorMatrix = (e: XmlNode): number[] => {
        const type = a(e, 'type') || 'matrix';
        const v = nums(a(e, 'values'));
        if (type === 'matrix') return v.length === 20 ? v : [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
        if (type === 'saturate') {
          const s = v.length ? v[0] : 1;
          return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0, 0, 0, 0, 1, 0];
        }
        if (type === 'hueRotate') {
          const t = ((v.length ? v[0] : 0) * Math.PI) / 180;
          const c = Math.cos(t);
          const s = Math.sin(t);
          return [
            0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
            0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
            0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
            0, 0, 0, 1, 0,
          ];
        }
        if (type === 'luminanceToAlpha') return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0];
        throw new Unsupported('filter feColorMatrix');
      };
      const applyMatrix = (m: number[]) => (c: number[]) => [0, 1, 2, 3].map((r) => m[r * 5] * c[0] + m[r * 5 + 1] * c[1] + m[r * 5 + 2] * c[2] + m[r * 5 + 3] * c[3] + m[r * 5 + 4]);
      /** feComponentTransfer (§9.7) の、成分ごとの関数 (feFuncR・G・B・A。無い成分はそのまま) */
      const componentTransfer = (e: XmlNode) => {
        const fns = ['fefuncr', 'fefuncg', 'fefuncb', 'fefunca'].map((name) => {
          const fn = Array.from(e.childNodes).find((c) => c.nodeType === 1 && nm(c) === name);
          if (!fn) return (x: number) => x;
          const t = a(fn, 'type');
          const tv = nums(a(fn, 'tableValues'));
          if (t === 'linear') return (x: number) => num(fn, 'slope', 1) * x + num(fn, 'intercept', 0);
          if (t === 'gamma') return (x: number) => num(fn, 'amplitude', 1) * x ** num(fn, 'exponent', 1) + num(fn, 'offset', 0);
          if (t === 'table' && tv.length) {
            const n = tv.length - 1;
            return (x: number) => {
              if (!n) return tv[0];
              const k = Math.min(Math.floor(x * n), n - 1);
              return tv[k] + (x - k / n) * n * (tv[k + 1] - tv[k]);
            };
          }
          if (t === 'discrete' && tv.length) return (x: number) => tv[Math.min(Math.floor(x * tv.length), tv.length - 1)];
          return (x: number) => x;
        });
        return (c: number[]) => c.map((x, k) => fns[k](x));
      };
      /** 層の色 (不透明度つき) を fn で変える */
      const recolorLayer = (l: FilterLayer, fn: (c: number[]) => number[]): FilterLayer => {
        if (l.kind === 'source') return { ...l, recolor: [...l.recolor, fn] };
        const c = fn([...l.color, l.opacity]);
        return { ...l, color: c.slice(0, 3), opacity: c[3] };
      };
      const results = new Map<string, FilterLayer[]>();
      let prev: FilterLayer[] | undefined;
      // in・in2 (§9.2): 名前の無い・無い結果を指すものは、前の要素の結果 (最初の要素なら SourceGraphic)
      const input = (e: XmlNode, k: 'in' | 'in2'): FilterLayer[] => {
        const v = a(e, k).trim();
        if (v === 'SourceGraphic') return [{ kind: 'source', dx: 0, dy: 0, std: 0, opacity: 1, recolor: [] }];
        if (v === 'SourceAlpha') return [{ kind: 'alpha', dx: 0, dy: 0, std: 0, color: [0, 0, 0], opacity: 1 }];
        // BackgroundImage・BackgroundAlpha は、描くものが無い (Filter Effects 1 では透明の黒)
        if (v === 'BackgroundImage' || v === 'BackgroundAlpha') return [];
        if (v === 'FillPaint' || v === 'StrokePaint') throw new Unsupported(`filter ${v}`);
        const r = v ? results.get(v) : undefined;
        if (r) return r;
        return prev ?? [{ kind: 'source', dx: 0, dy: 0, std: 0, opacity: 1, recolor: [] }];
      };
      // 切り抜かずに描いた層 (uncut) をずらす・ぼかすと、切り抜くはずの所が元の図形からはみ出るので、近似しない
      const movable = (l: FilterLayer, moved: boolean) => {
        if (moved && l.kind !== 'flood' && l.uncut) throw new Unsupported('filter feComposite out');
      };
      /** 切り抜く矩形を (dx, dy) ずらす (部分領域で切った後にずらした結果は、切った所ごと動く) */
      const shiftCut = (cut: Box[] | undefined, dx: number, dy: number) => (cut ? { cut: cut.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })) } : {});
      /**
       * 切り抜く矩形の並びが長くなりすぎたら、重なりの 1 つの矩形にまとめる。並びは「どれにも入る所だけを描く」
       * (描くときに、矩形ごとの切り抜きを重ねる。PDF 32000-1 §8.5.4 の切り抜きの重ねは、重なりになる) ので、
       * 軸に平行な矩形の並びで切るのは、その重なりの 1 つの矩形で切るのと同じ。feComposite の in の in と in2 に
       * 同じ切った結果を渡すと並びがつながって 2 倍になり、重ねると数が指数で増えるため、上限を置く
       * (上限までは並びのまま描くので、ふつうの filter の結果は変わらない)。重なりが空なら undefined (何も描かない)
       */
      const CUT_MAX = 8;
      /**
       * 近似の層の数の上限。feComposite の over (in2 の上に in。§9.8)・feMerge (§9.10) は、入力の層を並べてつなぐので、
       * in と in2 に同じ結果を渡したものを重ねると、層の数が 2 倍ずつ増える。同じ層を重ねた over は、不透明度が重なるので
       * 1 つの層にはまとめられない。上限を超えたら図形での近似をやめ、画素の計算 (予算のあるもの) に回す。
       * ふつうの filter (影・光彩を数個重ねたものなど) の層は数個から数十なので、届かない
       */
      const LAYER_MAX = 128;
      const capCuts = (cut: Box[]): Box[] | undefined => {
        if (cut.length <= CUT_MAX) return cut;
        let x0 = -Infinity, y0 = -Infinity, x1 = Infinity, y1 = Infinity;
        for (const c of cut) {
          x0 = Math.max(x0, c.x);
          y0 = Math.max(y0, c.y);
          x1 = Math.min(x1, c.x + c.w);
          y1 = Math.min(y1, c.y + c.h);
        }
        return x1 > x0 && y1 > y0 ? [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }] : undefined;
      };
      /** 2 つの層の切り抜く矩形を合わせる (両方の中だけを描く)。重なりが空なら undefined */
      const bothCuts = (a?: Box[], b?: Box[]): { cut?: Box[] } | undefined => {
        if (!a && !b) return {};
        const cut = capCuts([...(a ?? []), ...(b ?? [])]);
        return cut ? { cut } : undefined;
      };
      const shift = (ls: FilterLayer[], dx: number, dy: number) =>
        ls.map((l) => (movable(l, !!(dx || dy)), l.kind === 'flood' ? { ...l, ...shiftCut(l.cut, dx, dy) } : { ...l, dx: l.dx + dx, dy: l.dy + dy, ...shiftCut(l.cut, dx, dy) }));
      const blur = (ls: FilterLayer[], s: number) =>
        ls.map((l) => {
          movable(l, !!s);
          // 部分領域で切った層をぼかすと、切った縁もぼける (切り抜きの図形では描けない)
          if (s && l.cut) throw new Unsupported('filter subregion');
          return l.kind === 'flood' ? l : { ...l, std: Math.hypot(l.std, s) };
        });
      /** 影の形 (in2 の層) を、色 (flood) で塗った層にする (feComposite の in)。色の層を部分領域で切っていれば、その中だけ */
      const paintShape = (flood: { color: number[]; opacity: number; cut?: Box[] }, shape: FilterLayer[]) =>
        shape.flatMap((s): FilterLayer[] => {
          const cut = bothCuts(flood.cut, s.cut);
          if (!cut) return [];
          return s.kind === 'flood'
            ? [{ kind: 'flood', color: flood.color, opacity: flood.opacity * s.opacity, ...cut }]
            : [{ kind: 'alpha', dx: s.dx, dy: s.dy, std: s.std, color: flood.color, opacity: flood.opacity * s.opacity, ...(s.uncut ? { uncut: true as const } : {}), ...cut }];
        });
      /**
       * 元の図形と同じ形の層 (ずらさず、ぼかさない SourceGraphic・SourceAlpha。色を変えた SourceGraphic は、不透明度が変わりうるので除く。
       * 部分領域で切った層も除く)
       */
      const isSelf = (l: FilterLayer) => l.kind !== 'flood' && !l.uncut && !l.cut && !l.dx && !l.dy && !l.std && l.opacity > 0 && (l.kind === 'alpha' || !l.recolor.length);
      /** 元の図形を不透明に覆う層 (filter の結果の中で、切り抜かずに描いた層 uncut の上にあれば、切り抜くはずの所を隠す) */
      const covers = (l: FilterLayer) => isSelf(l) && l.opacity >= 1 && !l.blend;
      const vectorLayers = (): FilterLayer[] => {
      if (obbUnits) throw new Unsupported('filter primitiveUnits');
      // 要素の部分領域 (Filter Effects 1 §9.4。読み方は画素の計算と同じ。svgFilterSubregion.ts)。filter の領域 (要素の座標) は、
      // 部分領域を書いた要素が出てきたときに求める。subs は名前を付けた結果の部分領域、prevSub は前の要素の結果の部分領域
      // (どちらも、部分領域を書いた要素が出てくるまでは空で、filter の領域と同じ)
      let region: Box | undefined | null = null;
      const subs = new Map<string, Box>();
      let prevSub: Box | undefined;
      const attrOf = (n: XmlNode) => (k: string) => n.getAttribute?.(k) ?? undefined;
      const mergeNodes = (e: XmlNode) => Array.from(e.childNodes).filter((c) => c.nodeType === 1 && nm(c) === 'femergenode');
      /** a が b の中にあるか (計算の誤差は許す) */
      const within = (a: Box, b: Box, eps: number) => a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;
      for (const e of prims) {
        let out: FilterLayer[];
        switch (nm(e)) {
          case 'fedropshadow': {
            // §9.12: in をずらしてぼかした影を、flood-color・flood-opacity で塗り、in の下に置く
            const src = input(e, 'in');
            const fl = floodOf(e);
            const sd = nums(a(e, 'stdDeviation'));
            const shadow = blur(shift(paintShape(fl, src), num(e, 'dx', 2), num(e, 'dy', 2)), sd.length ? sd[0] : 2);
            out = [...shadow, ...src];
            break;
          }
          case 'fegaussianblur': {
            const sd = nums(a(e, 'stdDeviation'));
            out = blur(input(e, 'in'), sd.length ? sd[0] : 0);
            break;
          }
          case 'feoffset':
            out = shift(input(e, 'in'), num(e, 'dx'), num(e, 'dy'));
            break;
          case 'feflood': {
            const fl = floodOf(e);
            out = fl.opacity > 0 ? [{ kind: 'flood', ...fl }] : [];
            break;
          }
          case 'fecolormatrix':
            out = input(e, 'in').map((l) => recolorLayer(l, inSpace(e, applyMatrix(colorMatrix(e)))));
            break;
          case 'fecomponenttransfer':
            out = input(e, 'in').map((l) => recolorLayer(l, inSpace(e, componentTransfer(e))));
            break;
          case 'fecomposite': {
            // §9.8 (Porter-Duff): in = in の in2 の中の部分、out = in の in2 の外の部分、atop = in2 の上に、in の in2 の中の部分。
            // 図形で正しく描けるのは、次の組み合わせだけ (ほかは Unsupported にして、画素の計算に回す):
            //  - in・atop で、in が単色 (flood): in2 の形をその色で塗る (paintShape)
            //  - in・atop で、in も in2 も元の図形と同じ形 (isSelf): in の中の部分は in そのもの (in2 の不透明度を掛ける)
            //  - out で、in2 が元の図形と同じ形: 切り抜かずに描き (uncut)、filter の結果で後ろに元の図形が重なって隠れるときだけ使う
            //    (Figma などの書き出す影。終わりで確かめる)
            //  - in2 が空 (BackgroundAlpha など): in・atop は空、out は in のまま
            const op = a(e, 'operator') || 'over';
            const i1 = input(e, 'in');
            const i2 = input(e, 'in2');
            const self2 = i2.length === 1 && isSelf(i2[0]) ? i2[0] : undefined;
            /** in の層の、in2 の中の部分 (in・atop) */
            const inside = () =>
              i1.flatMap((l): FilterLayer[] => {
                if (l.kind === 'flood') return paintShape(l, i2);
                if (self2 && isSelf(l)) return [{ ...l, opacity: l.opacity * self2.opacity }];
                throw new Unsupported(`filter feComposite ${op}`);
              });
            if (op === 'over') out = [...i2, ...i1];
            else if (!i2.length && (op === 'in' || op === 'atop' || op === 'out')) out = op === 'out' ? i1 : [];
            else if (op === 'in') out = inside();
            else if (op === 'atop') out = [...i2, ...inside()];
            else if (op === 'out') {
              if (!i2.every(isSelf) || i1.some((l) => l.kind === 'flood')) throw new Unsupported(`filter feComposite ${op}`);
              out = i1.map((l) => (l.kind === 'flood' ? l : { ...l, uncut: true as const }));
            } else throw new Unsupported(`filter feComposite ${op}`);
            break;
          }
          case 'feblend': {
            // §9.5: in を in2 の上に、mode の描画モード (Compositing and Blending 1 の 16 通り) で重ねる。描画モードは in の層の図形に付け、
            // filter の結果を透明のグループにまとめる (in2 の外のもの (filter の外の図形) と混ぜない)
            const mode = (a(e, 'mode') || 'normal').trim();
            const i1 = input(e, 'in');
            if (mode !== 'normal') {
              if (!(SVG_BLENDS as readonly string[]).includes(mode) || i1.some((l) => l.kind === 'flood')) throw new Unsupported(`filter feBlend ${mode}`);
              out = [...input(e, 'in2'), ...i1.map((l) => ({ ...l, blend: mode as SvgBlend }))];
            } else out = [...input(e, 'in2'), ...i1];
            break;
          }
          case 'femerge':
            out = mergeNodes(e).flatMap((mn) => input(mn, 'in'));
            break;
          default:
            throw new Unsupported(`filter ${nm(e)}`);
        }
        if (out.length > LAYER_MAX) throw new Unsupported('filter layers');
        const r = a(e, 'result').trim();
        // 部分領域 (§9.4): 要素の結果は、部分領域の外が透明。既定は参照する結果の部分領域の和で、x・y・width・height を書けばその値
        const own = subregionAttrs(attrOf(e), { obb: false, viewport: view });
        if (Object.keys(own).length || prevSub || subs.size) {
          if (region === null) region = filterRegion(f)(box, view);
          const R = region;
          if (R) {
            const refs = subregionRefs(nm(e), attrOf(e), () => mergeNodes(e).map((mn) => attrOf(mn)('in')));
            const sub: Box = { ...defaultSubregion(refs, (n) => subs.get(n), prevSub, R), ...own };
            // 幅か高さが 0 (負の値は誤り) の部分領域は、何も描かない (画素の計算と同じ)
            if (!(sub.w > 0 && sub.h > 0)) out = [];
            // 部分領域が filter の領域を覆うなら、切っても変わらない (filter の領域では、どの道切る)。既定の部分領域で、層が
            // 既に部分領域の中の矩形で切ってあるもの (feMerge で重ねただけなど) も、切り直さない
            else if (!within(R, sub, 1e-9 * Math.max(Math.abs(R.w), Math.abs(R.h), 1)))
              out = out.flatMap((l): FilterLayer[] => {
                if (l.cut?.some((c) => within(c, sub, 0))) return [l];
                // ぼかした層は切らない (ぼかしは写しの重ねの近似で、ぼかしだけの filter は元の図形のまま描くが、切るとそれができない。
                // 迷うものは画素の計算に回す)
                if (l.kind !== 'flood' && l.std) throw new Unsupported('filter subregion');
                const cut = capCuts([...(l.cut ?? []), sub]);
                return cut ? [{ ...l, cut }] : [];
              });
            prevSub = sub;
            if (r) subs.set(r, sub);
          }
        }
        prev = out;
        if (r) results.set(r, out);
      }
      const layers = prev ?? [{ kind: 'source', dx: 0, dy: 0, std: 0, opacity: 1, recolor: [] }];
      // 領域いっぱいの単色は、filter の領域の形を求めないと描けない
      if (layers.some((l) => l.kind === 'flood')) throw new Unsupported('filter feFlood');
      // 切り抜かずに描いた層 (feComposite の out) は、その上に元の図形が不透明に重なって、切り抜くはずの所が隠れるときだけ
      let lastUncut = -1;
      layers.forEach((l, k) => l.kind !== 'flood' && l.uncut && (lastUncut = k));
      if (lastUncut >= 0 && !layers.slice(lastUncut + 1).some(covers)) throw new Unsupported('filter feComposite out');
      return layers.map((l) => (l.kind !== 'flood' && l.uncut ? (({ uncut: _u, ...r }) => r)(l) : l)) as FilterLayer[];
      };
      /** 画素で計算するときの、filter の要素の読み方 (svgFilterRaster.ts に渡す) */
      const rasterPrims = (image: (e: XmlNode, box: Box) => SvgShape[] | undefined): FilterRasterRequest['prims'] =>
        prims.map((e) => {
          const attr = (k: string) => {
            const v = e.getAttribute?.(k);
            return v === null || v === undefined ? undefined : v;
          };
          return {
            name: nm(e),
            attr,
            linear: linearOf(e),
            color: (cp: string, op?: string) => {
              const c = props(e)[cp] ?? attr(cp);
              const col = c ? (colorOf(c, false, isCurrentColor(c) ? colorAt(e) : undefined) as string | null) : cp === 'lighting-color' ? '#ffffff' : '#000000';
              const ov = op ? parseFloat(props(e)[op] ?? attr(op) ?? '') : 1;
              const rgb = col ? rgbOf(col) : [0, 0, 0];
              return [rgb[0], rgb[1], rgb[2], (col ? 1 : 0) * (Number.isFinite(ov) ? Math.min(Math.max(ov, 0), 1) : 1) * (c ? alphaOf(c) : 1)];
            },
            colorMatrix: () => colorMatrix(e),
            componentTransfer: () => componentTransfer(e),
            children: Array.from(e.childNodes)
              .filter((c) => c.nodeType === 1)
              .map((c) => ({ name: nm(c), attr: (k: string) => c.getAttribute?.(k) ?? undefined })),
            image: (box: Box) => image(e, box),
          };
        });
      try {
        // 図形に当てる段で近似できないと分かったとき (画像・模様の色を変えるなど) に、画素の計算に回せるように、その組み立ても返す
        return { layers: vectorLayers(), region: filterRegion(f), ...(opts.rasterFilter ? { rasterFallback: { prims: rasterPrims, obb: obbUnits } } : {}) };
      } catch (err) {
        // 図形で近似できない filter は、画素で計算する (呼ぶ側が svgFilterRaster.ts を渡したとき)
        if (!(err instanceof Unsupported) || !opts.rasterFilter) throw err;
        return { layers: [], region: filterRegion(f), raster: { prims: rasterPrims, obb: obbUnits } };
      }
    };
    /**
     * 図形の色を filter の色の変換 (feColorMatrix・feComponentTransfer) で変える。色は図形ごとに変えるので、重なった半透明の図形では、
     * 重ねた結果の色を変えるのと少し違う (不透明の図形なら同じ)。画像・CMYK の色は変えられないので Unsupported
     */
    const recolorShape = (sh: SvgShape, fns: Array<(c: number[]) => number[]>): SvgShape => {
      if (sh.image || sh.fillPattern) throw new Unsupported('filter color');
      const conv = (c: string, a: number): [string, number] => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
        if (!m) throw new Unsupported('filter color');
        let v = [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255, a];
        for (const fn of fns) v = fn(v);
        return [`#${v.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`, v[3]];
      };
      const out: SvgShape = { ...sh };
      if (sh.fill !== undefined) [out.fill, out.fillOpacity] = conv(sh.fill, sh.fillOpacity);
      if (sh.stroke !== undefined) [out.stroke, out.strokeOpacity] = conv(sh.stroke, sh.strokeOpacity);
      // グラデーションは stop ごとに変える (不透明度の変わる分は、stop の不透明度に掛ける)
      const grad = (g: SvgGradient, base: number): SvgGradient => ({
        ...g,
        stops: g.stops.map((st) => {
          const [color, op] = conv(st.color, (st.opacity ?? 1) * base);
          const k = base > 0 ? op / base : 0;
          return { offset: st.offset, color, ...(k < 1 ? { opacity: k } : {}) };
        }),
      });
      if (sh.fillPaint) out.fillPaint = grad(sh.fillPaint, sh.fillOpacity);
      if (sh.strokePaint) out.strokePaint = grad(sh.strokePaint, sh.strokeOpacity);
      // 切り抜き・マスクの付いたグループ (openForFilter が開かずに残したもの) は、中の図形の色を変える (マスクの中身は変えない)
      if (sh.group) out.group = { shapes: sh.group.shapes.map((x) => recolorShape(x, fns)) };
      return out;
    };
    /**
     * 影: 図形の写しを (ox, oy) ずらし、ぼかしの幅 std (ルートの座標) を、少しずつ太らせた半透明の写し (5 枚) の重ねで表す。
     * color が無ければ図形の色のまま (模様・グラデーションの塗りと線も、図形と一緒にずらして写す。Filter Effects 1 §9.19 の feOffset は、
     * 入力の画像をそのままずらすので、塗りの中身も動く)
     */
    const blurredCopies = (shapes: SvgShape[], ox: number, oy: number, std: number, color: string | undefined, opacity: number, memo = new Map<SvgClip, SvgClip>()): SvgShape[] => {
      const move: M = [1, 0, 0, 1, ox, oy];
      // 図形の切り抜き・マスク (filter の付いた要素の子孫のもの。SourceGraphic の一部) は、写しと一緒にずらす (Filter Effects 1 §9.19 の
      // feOffset は、入力の画像をそのままずらす)。同じ切り抜き・マスクは、同じ 1 つの写しにする (描く側が使い回せるように)
      const maskMemo = new Map<SvgMask, SvgMask>();
      const movedClips = (cs: SvgClip[] | undefined) =>
        cs?.map((c) => {
          let t = memo.get(c);
          if (!t) memo.set(c, (t = ox || oy ? { ...c, segs: transformSegs(c.segs, move) } : c));
          return t;
        });
      const movedMasks = (ms: SvgMask[] | undefined) =>
        ms?.map((mk) => {
          let t = maskMemo.get(mk);
          if (!t) maskMemo.set(mk, (t = ox || oy ? { ...mk, shapes: mk.shapes.map((x) => transformShape(x, move, 1, memo)) } : mk));
          return t;
        });
      // 太らせる量 (外の層から) と、そこまで重ねたときの濃さ (ガウスぼかしの縁の外の濃さ: 縁で約半分、2σ でほぼ 0)
      const steps = std > 0 ? [2, 1.5, 1, 0.5, 0].map((k) => k * std) : [0];
      const cum = std > 0 ? [0.03, 0.08, 0.17, 0.32, 0.6].map((c) => c * opacity) : [opacity];
      const alphas = cum.map((c, k) => 1 - (1 - c) / (1 - (k ? cum[k - 1] : 0)));
      const out: SvgShape[] = [];
      // 切り抜き・マスクの付いたグループ (openForFilter が開かずに残したもの) は、グループのまま写す: 中の図形の写し (太らせた層の全部) を
      // 1 つのグループにして、グループの切り抜き・マスクを 1 度だけ掛ける (開いて子ごとに掛けると、子の数 × 層の数だけマスクを描き直す)。
      // 写しは、ほかの図形の写しとの重なりの順を保つように、元の並びの位置 (太らせない最後の層の中) に入れる
      const groupCopy = (sh: SvgShape): SvgShape => {
        const clips = movedClips(sh.clips);
        const masks = movedMasks(sh.masks);
        return { ...sh, ...(clips ? { clips } : {}), ...(masks ? { masks } : {}), group: { shapes: blurredCopies(sh.group!.shapes, ox, oy, std, color, opacity, memo) } };
      };
      // 画像は輪郭を太らせられないので、色を変えないぼかしでは、ぼかさずにそのまま (ずらして) 描く。影 (色を付けた写し) には使わない
      if (color === undefined)
        for (const sh of shapes) {
          if (!sh.image) continue;
          const [a, b, c, d, e, f] = sh.image.matrix;
          const clips = movedClips(sh.clips);
          const masks = movedMasks(sh.masks);
          out.push({ ...sh, ...(clips ? { clips } : {}), ...(masks ? { masks } : {}), image: { ...sh.image, matrix: [a, b, c, d, e + ox, f + oy] }, fillOpacity: sh.fillOpacity * opacity, strokeOpacity: sh.strokeOpacity * opacity });
        }
      steps.forEach((grow, k) => {
        const alpha = alphas[k];
        for (const sh of shapes) {
          if (sh.group) {
            if (k === steps.length - 1) out.push(groupCopy(sh));
            continue;
          }
          if (sh.image) continue;
          // 写しは「効果で増える分」に数える (filter の付いた g を 8 段重ねると、1 つの図形が 6 の 8 乗 = 168 万個になる)
          charge(sh.segs.length + 1);
          const filled = sh.fill !== undefined || !!sh.fillPaint || !!sh.fillPattern;
          const fillColor = color ?? sh.fill;
          // 色を変えない写しは、模様・グラデーションの塗りと線を、ずらして持たせる (持たせないと、模様は代わりの灰色、グラデーションは
          // 終わりの色の一面になっていた)。太らせる線 (ぼかしの近似) は、線が無ければ塗りで描く: グラデーションの塗りは線のグラデーションに
          // できるが、模様の線は描けないので、模様で塗った図形は太らせない (ぼかしだけの filter は元の図形のまま描くのと同じ)
          const fillPaint = color === undefined && sh.fillPaint ? { ...sh.fillPaint, matrix: mul(move, sh.fillPaint.matrix) } : undefined;
          const fillPattern = color === undefined && sh.fillPattern ? { ...sh.fillPattern, matrix: mul(move, sh.fillPattern.matrix) } : undefined;
          const strokePaint = color !== undefined ? undefined : sh.strokePaint ? { ...sh.strokePaint, matrix: mul(move, sh.strokePaint.matrix) } : sh.stroke === undefined && grow > 0 ? fillPaint : undefined;
          const strokeColor = color ?? sh.stroke ?? (sh.stroke === undefined && fillPattern ? undefined : sh.fill);
          const width = (sh.stroke !== undefined ? sh.strokeWidth : 0) + 2 * grow;
          out.push({
            segs: sh.segs.map((g) => (g.op === 'Z' ? g : g.op === 'C' ? { ...g, x1: g.x1 + ox, y1: g.y1 + oy, x2: g.x2 + ox, y2: g.y2 + oy, x: g.x + ox, y: g.y + oy } : { ...g, x: g.x + ox, y: g.y + oy })),
            ...(filled && fillColor ? { fill: fillColor } : {}),
            ...(filled && fillPaint ? { fillPaint } : {}),
            ...(filled && fillPattern ? { fillPattern } : {}),
            ...(sh.clips ? { clips: movedClips(sh.clips) } : {}),
            ...(sh.masks ? { masks: movedMasks(sh.masks) } : {}),
            evenOdd: sh.evenOdd,
            ...(width > 0 && strokeColor ? { stroke: strokeColor } : {}),
            ...(width > 0 && strokeColor && strokePaint ? { strokePaint } : {}),
            strokeWidth: width,
            lineCap: 1,
            lineJoin: 1,
            fillOpacity: sh.fillOpacity * alpha,
            strokeOpacity: (sh.stroke !== undefined ? sh.strokeOpacity : sh.fillOpacity) * alpha,
          });
        }
      });
      return out;
    };
    /** いま描いている要素に掛かるマスク (外側から順に) と、マスクを付けて描き直している要素 */
    let masks: SvgMask[] = [];
    const masking = new Set<XmlNode>();
    /** いまの座標系の枠 (viewport) の大きさ。% の長さの基準 */
    let vp = { w: viewBox[2], h: viewBox[3] };
    /**
     * 枠 (x, y, w, h。いまの座標系) に、el の viewBox を preserveAspectRatio で合わせた座標系を作り、draw を呼ぶ。
     * overflow が visible でなければ、枠で切り抜く。枠の大きさが 0 なら描かない
     */
    /** el の viewBox を、(0, 0) から w × h の枠に preserveAspectRatio で合わせる変換と、中身の座標系の枠の大きさ */
    const viewBoxOf = (el: XmlNode, w: number, h: number): { m: M; size: { w: number; h: number } } => {
      const vb = (el.getAttribute?.('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
      if (!(vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0)) return { m: ID, size: { w, h } };
      const par = (el.getAttribute?.('preserveAspectRatio') ?? '').trim().split(/\s+/);
      const align = par[0] || 'xMidYMid';
      let sx = w / vb[2];
      let sy = h / vb[3];
      if (align !== 'none') sx = sy = par[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
      const ax = /xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0;
      const ay = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
      return { m: [sx, 0, 0, sy, (w - vb[2] * sx) * ax - vb[0] * sx, (h - vb[3] * sy) * ay - vb[1] * sy], size: { w: vb[2], h: vb[3] } };
    };
    const inViewport = (el: XmlNode, x: number, y: number, w: number, h: number, mm: M, cl: SvgClip[], draw: (m: M, cl: SvgClip[]) => void, noClip = false) => {
      if (!(w > 0 && h > 0)) return;
      const vbm = viewBoxOf(el, w, h);
      const m: M = [vbm.m[0], vbm.m[1], vbm.m[2], vbm.m[3], vbm.m[4] + x, vbm.m[5] + y];
      const size = vbm.size;
      const ov = props(el).overflow;
      const box: Seg[] = [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
      const cl2 = noClip || ov === 'visible' || ov === 'auto' ? cl : [...cl, { segs: transformSegs(box, mm), evenOdd: false }];
      const saved = vp;
      vp = size;
      try {
        draw(mul(mm, m), cl2);
      } finally {
        vp = saved;
      }
    };

    /**
     * 条件の属性 (SVG 2 §5.6.4・§5.6.5) が満たされるか。requiredExtensions は、拡張を持たないので、属性があれば満たさない。
     * systemLanguage は、言語の並び (空白・カンマ区切り) のどれかが、利用者の言語 (opts.languages。無ければ実行環境の言語) に合えば満たす:
     * 大文字小文字を区別せずに同じか、利用者の言語がその言語に「-」の続くもの (利用者の en-US は en に合う)。空の値は満たさない
     */
    const userLangs = (opts.languages ?? environmentLanguages()).map((l) => l.toLowerCase());
    const conditionsHold = (c: XmlNode) => {
      if (c.getAttribute?.('requiredExtensions') !== null && c.getAttribute?.('requiredExtensions') !== undefined) return false;
      const sl = c.getAttribute?.('systemLanguage');
      if (sl === null || sl === undefined) return true;
      return systemLanguageHolds(sl, userLangs);
    };
    /**
     * clip-path の基本図形と参照の箱 (CSS Masking 1 §5.1: [ <basic-shape> || <geometry-box> ])。基本図形は CSS Shapes 1 §3.1 の
     * inset()・circle()・ellipse()・polygon()・path()・xywh()・rect()。参照の箱は、SVG の要素では content-box・padding-box が fill-box、
     * border-box・margin-box が stroke-box (§5.1。指定が無ければ border-box、つまり stroke-box)。stroke-box は、外接矩形を線の太さの半分だけ広げた箱。
     * 座標は要素の座標 (mm で写す)。読めない値は null
     */
    const basicShapeClip = (v: string, n: XmlNode, mm: M, bbox: () => Box | undefined): SvgClip | null => {
      const fn = /^([a-z]+)\(/i.exec(v);
      let shape = '';
      let rest = v;
      if (fn) {
        const e = closeParen(v, fn[0].length);
        if (e < 0) return null;
        shape = v.slice(0, e + 1);
        rest = v.slice(e + 1);
      } else {
        const after = /\)\s*$/.test(v) ? v.indexOf(v.match(/[a-z]+\(/i)?.[0] ?? '\0') : -1;
        if (after > 0) {
          shape = v.slice(after);
          rest = v.slice(0, after);
        }
      }
      const boxWord = rest.trim();
      if (boxWord && !/^(content-box|padding-box|border-box|margin-box|fill-box|stroke-box|view-box)$/.test(boxWord)) return null;
      const kind = boxWord || 'border-box';
      let box: Box;
      if (kind === 'view-box') box = { x: 0, y: 0, w: vp.w, h: vp.h };
      else {
        const b = bbox();
        if (!b) return { segs: [], evenOdd: false };
        box = b;
        if (kind === 'border-box' || kind === 'margin-box' || kind === 'stroke-box') {
          const sw = props(n)['stroke'];
          const half = sw && sw !== 'none' ? userLen(props(n)['stroke-width'] ?? '1', Math.hypot(vp.w, vp.h) / Math.SQRT2) / 2 : 0;
          box = { x: b.x - half, y: b.y - half, w: b.w + 2 * half, h: b.h + 2 * half };
        }
      }
      const rect = (x: number, y: number, w: number, h: number): Seg[] => [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
      const L = (t: string, ref: number) => (/%$/.test(t) ? (parseFloat(t) / 100) * ref : /^[-+]?(?:\d|\.\d)/.test(t) ? userLen(t, ref) : NaN);
      /** <position> (1・2 個の値。語・長さ・百分率)。既定は center */
      const position = (ws: string[]): [number, number] | null => {
        if (!ws.length) return [box.x + box.w / 2, box.y + box.h / 2];
        if (ws.length > 2) return null;
        let px: string | undefined;
        let py: string | undefined;
        for (const w of ws) {
          if ((w === 'top' || w === 'bottom') && py === undefined) py = w;
          else if ((w === 'left' || w === 'right') && px === undefined) px = w;
          else if (px === undefined && w !== 'top' && w !== 'bottom') px = w;
          else py = w;
        }
        const at = (w: string | undefined, start: number, size: number, lo: string, hi: string) =>
          w === undefined || w === 'center' ? start + size / 2 : w === lo ? start : w === hi ? start + size : start + L(w, size);
        const r: [number, number] = [at(px, box.x, box.w, 'left', 'right'), at(py, box.y, box.h, 'top', 'bottom')];
        return r.every(Number.isFinite) ? r : null;
      };
      const ellipseSegs = (cx: number, cy: number, rx: number, ry: number): Seg[] =>
        rx > 0 && ry > 0 ? (parsePathData(`M${cx + rx},${cy}A${rx},${ry} 0 1 1 ${cx - rx},${cy}A${rx},${ry} 0 1 1 ${cx + rx},${cy}Z`) ?? []) : [];
      let segs: Seg[];
      let evenOdd = false;
      if (!shape) segs = rect(box.x, box.y, box.w, box.h);
      else {
        const name = /^([a-z]+)\(/i.exec(shape)![1].toLowerCase();
        const inner = shape.slice(name.length + 1, -1).trim();
        if (name === 'inset' || name === 'xywh' || name === 'rect') {
          // inset(上 右 下 左 [round 半径])・xywh(x y 幅 高さ [round 半径])・rect(上 右 下 左 [round 半径]。auto は箱の端)
          const [a, r] = inner.split(/\s+round\s+/);
          const ws = a.trim().split(/\s+/);
          let x0: number, y0: number, x1: number, y1: number;
          if (name === 'xywh') {
            if (ws.length !== 4) return null;
            x0 = box.x + L(ws[0], box.w);
            y0 = box.y + L(ws[1], box.h);
            x1 = x0 + L(ws[2], box.w);
            y1 = y0 + L(ws[3], box.h);
          } else {
            if (ws.length < 1 || ws.length > 4) return null;
            const [t, ri, b, le] = [ws[0], ws[1] ?? ws[0], ws[2] ?? ws[0], ws[3] ?? ws[1] ?? ws[0]];
            if (name === 'inset') {
              x0 = box.x + L(le, box.w);
              y0 = box.y + L(t, box.h);
              x1 = box.x + box.w - L(ri, box.w);
              y1 = box.y + box.h - L(b, box.h);
            } else {
              // rect() の値は、箱の上端・左端からの位置 (auto は、その辺の箱の端)
              y0 = t === 'auto' ? box.y : box.y + L(t, box.h);
              x1 = ri === 'auto' ? box.x + box.w : box.x + L(ri, box.w);
              y1 = b === 'auto' ? box.y + box.h : box.y + L(b, box.h);
              x0 = le === 'auto' ? box.x : box.x + L(le, box.w);
            }
          }
          if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
          const w = Math.max(x1 - x0, 0);
          const h = Math.max(y1 - y0, 0);
          // 角の丸み (1 つの半径。横 / 縦の 2 つの値も)。辺の長さの半分までにする
          const rs = (r ?? '').trim().split(/\s*\/\s*/);
          const rx = r ? Math.min(L(rs[0].split(/\s+/)[0], box.w), w / 2) : 0;
          const ry = r ? Math.min(L((rs[1] ?? rs[0]).split(/\s+/)[0], box.h), h / 2) : 0;
          if (r && !(Number.isFinite(rx) && Number.isFinite(ry))) return null;
          segs =
            rx > 0 && ry > 0
              ? (parsePathData(`M${x0 + rx},${y0}H${x1 - rx}A${rx},${ry} 0 0 1 ${x1},${y0 + ry}V${y1 - ry}A${rx},${ry} 0 0 1 ${x1 - rx},${y1}H${x0 + rx}A${rx},${ry} 0 0 1 ${x0},${y1 - ry}V${y0 + ry}A${rx},${ry} 0 0 1 ${x0 + rx},${y0}Z`) ?? [])
              : w > 0 && h > 0
                ? rect(x0, y0, w, h)
                : [];
        } else if (name === 'circle' || name === 'ellipse') {
          // circle(半径 [at 位置])・ellipse(横の半径 縦の半径 [at 位置])。半径の既定は closest-side。circle の % は、箱の対角の長さ / √2 に対して
          const [sz, at] = inner.split(/\s*\bat\b\s*/);
          const c = position(at ? at.trim().split(/\s+/) : []);
          if (!c) return null;
          const radii = sz.trim() ? sz.trim().split(/\s+/) : [];
          const side = (w: string, axis: 'x' | 'y' | 'r'): number => {
            const dx = [c[0] - box.x, box.x + box.w - c[0]];
            const dy = [c[1] - box.y, box.y + box.h - c[1]];
            const pick = w === 'farthest-side' ? Math.max : Math.min;
            if (w === 'closest-side' || w === 'farthest-side') return axis === 'x' ? pick(...dx) : axis === 'y' ? pick(...dy) : pick(...dx, ...dy);
            return L(w, axis === 'x' ? box.w : axis === 'y' ? box.h : Math.hypot(box.w, box.h) / Math.SQRT2);
          };
          let rx: number;
          let ry: number;
          if (name === 'circle') {
            if (radii.length > 1) return null;
            rx = ry = side(radii[0] ?? 'closest-side', 'r');
          } else {
            if (radii.length !== 0 && radii.length !== 2) return null;
            rx = side(radii[0] ?? 'closest-side', 'x');
            ry = side(radii[1] ?? 'closest-side', 'y');
          }
          if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
          segs = ellipseSegs(c[0], c[1], rx, ry);
        } else if (name === 'polygon') {
          // polygon([<fill-rule>,] x y, …)
          const parts = inner.split(',').map((t) => t.trim());
          if (/^(nonzero|evenodd)$/.test(parts[0])) evenOdd = parts.shift() === 'evenodd';
          segs = [];
          for (const pt of parts) {
            const xy = pt.split(/\s+/);
            if (xy.length !== 2) return null;
            const x = box.x + L(xy[0], box.w);
            const y = box.y + L(xy[1], box.h);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            segs.push({ op: segs.length ? 'L' : 'M', x, y });
          }
          if (segs.length) segs.push({ op: 'Z' });
        } else if (name === 'path') {
          // path([<fill-rule>,] "パスの書き方")。座標は参照の箱の左上が原点
          const pm = /^(?:(nonzero|evenodd)\s*,\s*)?(?:"([^"]*)"|'([^']*)')$/.exec(inner);
          if (!pm) return null;
          evenOdd = pm[1] === 'evenodd';
          const d = parsePathData(pm[2] ?? pm[3] ?? '');
          if (!d) return null;
          segs = transformSegs(d, [1, 0, 0, 1, box.x, box.y]);
        } else return null;
      }
      return { segs: transformSegs(segs, mm), evenOdd };
    };
    /** foreignObject の、文書の順の番号 (opts.foreignShapes の番号。呼ぶ側が、文字の上で foreignObject を前から数えた順と同じ) */
    const foreignIndex = new Map<XmlNode, number>();
    for (const e of allElements(root)) if (nm(e) === 'foreignobject') foreignIndex.set(e, foreignIndex.size);
    /** 透明のグループにまとめて描いている要素 (グループの中身を描くときは、自分の不透明度を掛けない) */
    const grouping = new Set<XmlNode>();
    /** 外接矩形を測っている要素 (切り抜き・マスク・filter を当てずに、形だけを集める) */
    const measuring = new Set<XmlNode>();
    /**
     * 要素の外接矩形 (objectBoundingBox。SVG 2 §8.10: 形の外接矩形で、線の太さ・marker・filter を含まない)。座標は mm の座標系 (要素の座標系)。
     * 要素を描いて形を集め、mm の逆で戻して測る。幅か高さが 0 なら undefined
     */
    const bboxOf = (n: XmlNode, st: Style, m: M, op: number, isRoot: boolean, depth: number, mm: M): Box | undefined => {
      const inv = invert(mm);
      if (!inv) return undefined;
      const saved = target;
      const savedMasks = masks;
      const tmp: SvgShape[] = [];
      target = tmp;
      masks = [];
      measuring.add(n);
      try {
        walk(n, st, m, op, isRoot, [], depth);
      } finally {
        measuring.delete(n);
        target = saved;
        masks = savedMasks;
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (x: number, y: number) => {
        const u = inv[0] * x + inv[2] * y + inv[4];
        const v = inv[1] * x + inv[3] * y + inv[5];
        x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v);
      };
      for (const sh of flattenGroups(tmp)) {
        if (sh.image) {
          const [a, b, c, d, e, f] = sh.image.matrix;
          for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) add(a * px + c * py + e, b * px + d * py + f);
          continue;
        }
        if (sh.nonScalingAnchor) continue;
        // 曲線は、端の点と、要素の座標系での x・y の極値の点 (制御点は形の外に出るので使わない)
        let cx = 0;
        let cy = 0;
        let sx = 0;
        let sy = 0;
        const tp = (x: number, y: number): [number, number] => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]];
        for (const g of sh.segs) {
          if (g.op === 'Z') {
            cx = sx;
            cy = sy;
            continue;
          }
          if (g.op === 'C') {
            const P = [tp(cx, cy), tp(g.x1, g.y1), tp(g.x2, g.y2), tp(g.x, g.y)];
            for (const k of [0, 1]) {
              // 3 次ベジェの微分 (2 次式) の根
              const [p0, p1, p2, p3] = P.map((q) => q[k]);
              const a = -p0 + 3 * p1 - 3 * p2 + p3;
              const b = 2 * (p0 - 2 * p1 + p2);
              const c = p1 - p0;
              const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : (() => {
                const D = b * b - 4 * a * c;
                return D < 0 ? [] : [(-b + Math.sqrt(D)) / (2 * a), (-b - Math.sqrt(D)) / (2 * a)];
              })();
              for (const t of roots) {
                if (!(t > 0 && t < 1)) continue;
                const u = 1 - t;
                const pt = [0, 1].map((j) => u * u * u * P[0][j] + 3 * u * u * t * P[1][j] + 3 * u * t * t * P[2][j] + t * t * t * P[3][j]);
                x0 = Math.min(x0, pt[0]); y0 = Math.min(y0, pt[1]); x1 = Math.max(x1, pt[0]); y1 = Math.max(y1, pt[1]);
              }
            }
          }
          add(g.x, g.y);
          cx = g.x;
          cy = g.y;
          if (g.op === 'M') {
            sx = g.x;
            sy = g.y;
          }
        }
      }
      return x1 - x0 > 0 && y1 - y0 > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
    };
    /**
     * mix-blend-mode (SVG_BLENDS) の付いた要素は、その要素の図形に描画モードを付ける。重ね方は図形ごとなので、
     * 子を持つ要素 (g など。子をまとめて重ねる) のものと、ほかの値は扱わず、描画モード無しで描く (対応する前と同じ)
     */
    const walk = (n: XmlNode, st: Style, m: M, op: number, isRoot: boolean, clips: SvgClip[] = [], depth = 0) => {
      const bm = n.nodeType === 1 ? (props(n)['mix-blend-mode'] ?? 'normal').trim() : 'normal';
      if (!(SVG_BLENDS as readonly string[]).includes(bm) || ['g', 'svg', 'a', 'use', 'switch', 'text'].includes(nm(n))) return walk0(n, st, m, op, isRoot, clips, depth);
      const before = target.length;
      walk0(n, st, m, op, isRoot, clips, depth);
      for (let i = before; i < target.length; i++) target[i] = { ...target[i], blend: bm as SvgBlend };
    };
    const walk0 = (n: XmlNode, st: Style, m: M, op: number, isRoot: boolean, clips: SvgClip[] = [], depth = 0) => {
      const name = nm(n);
      if (IGNORED.has(name) || IGNORED.has(n.nodeName.toLowerCase()) || foreign(n)) return;
      if (DEFINITIONS.has(name)) return;
      // switch (SVG 2 §5.6.3): 条件を満たす最初の子だけを描く (Illustrator の foreignObject は requiredExtensions で満たさない)
      if (name === 'switch') {
        const pick = Array.from(n.childNodes).find((c) => c.nodeType === 1 && !foreign(c) && nm(c) !== 'foreignobject' && conditionsHold(c));
        if (pick) walk(pick, st, m, op, false, clips, depth + 1);
        return;
      }
      // 条件の属性が満たされない要素は、switch の外でも描かない (SVG 2 §5.6.1)
      if (!conditionsHold(n)) return;
      if (UNSUPPORTED.has(name)) throw new Unsupported(name);
      if (depth > 32) throw new Unsupported('too deep');
      const p = props(n);
      if (p.display === 'none') return;
      // filter は、clip-path・mask・opacity より先に (内側で) 当てる (下の「filter」の所)。画像にできる環境では、SVG ごと画像にする
      if (p.filter && p.filter !== 'none' && !filtering.has(n) && !measuring.has(n) && !opts.approximateFilters) throw new Unsupported('filter');
      // 外接矩形を測っている要素は、自分の変換を掛けずに測る (外接矩形は要素の座標で求める。transform-box の fill-box もこれで測る)
      const tr = isRoot || measuring.has(n) ? ID : elementTransform(n, () => bboxOf(n, st, m, op, isRoot, depth, m));
      if (!tr) throw new Unsupported('transform');
      const mm = mul(m, tr);
      // マスク: 中身をこの要素の座標系 (transform 適用後) で図形にし、この要素の図形すべてに付けて、もう一度この要素を描く
      // (マスクの領域 x・y・width・height は見ない)
      if (p.mask && p.mask !== 'none' && !masking.has(n) && !filtering.has(n) && !measuring.has(n)) {
        const u = /url\(\s*['"]?#([^'")\s]+)/.exec(p.mask);
        const mk = u ? byId.get(u[1]) : undefined;
        if (!mk || nm(mk) !== 'mask') throw new Unsupported('mask');
        // maskContentUnits が objectBoundingBox なら、中身の座標は要素の外接矩形の 0〜1 (CSS Masking 1 §7.1)
        const mcu = mk.getAttribute?.('maskContentUnits') ?? 'userSpaceOnUse';
        let contentM = mm;
        let bb: Box | undefined | null = null;
        const bboxOnce = () => (bb === null ? (bb = bboxOf(n, st, m, op, isRoot, depth, m)) : bb);
        if (mcu === 'objectBoundingBox') {
          const b = bboxOnce();
          if (!b) return;
          contentM = mul(mm, [b.w, 0, 0, b.h, b.x, b.y]);
        } else if (mcu !== 'userSpaceOnUse') throw new Unsupported('maskContentUnits');
        // マスクの領域 (x・y・width・height。maskUnits の既定は objectBoundingBox で、既定の領域は外接矩形の −10%・−10%・120%・120%。
        // CSS Masking 1 §9.1): 領域の外は、マスクの値が 0 なので隠れる。要素を領域で切り抜くのと同じ
        const mu = mk.getAttribute?.('maskUnits') ?? 'objectBoundingBox';
        const ra = (k: string, d: string) => mk.getAttribute?.(k) ?? d;
        let region: Box;
        if (mu === 'userSpaceOnUse') {
          region = { x: ulen(ra('x', '-10%'), vp.w), y: ulen(ra('y', '-10%'), vp.h), w: ulen(ra('width', '120%'), vp.w), h: ulen(ra('height', '120%'), vp.h) };
        } else {
          const b = bboxOnce();
          if (!b) return;
          const f = (k: string, d: string) => {
            const v = ra(k, d).trim();
            return /%$/.test(v) ? parseFloat(v) / 100 : parseFloat(v);
          };
          region = { x: b.x + f('x', '-10%') * b.w, y: b.y + f('y', '-10%') * b.h, w: f('width', '120%') * b.w, h: f('height', '120%') * b.h };
        }
        if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w <= 0 || region.h <= 0) return;
        const regionSegs: Seg[] = [{ op: 'M', x: region.x, y: region.y }, { op: 'L', x: region.x + region.w, y: region.y }, { op: 'L', x: region.x + region.w, y: region.y + region.h }, { op: 'L', x: region.x, y: region.y + region.h }, { op: 'Z' }];
        const regionClip: SvgClip = { segs: transformSegs(regionSegs, mm), evenOdd: false };
        const savedTarget = target;
        const savedMasks = masks;
        const content: SvgShape[] = [];
        target = content;
        masks = [];
        try {
          const ms = inherit(ROOT_STYLE, props(mk));
          for (const c of Array.from(mk.childNodes)) if (c.nodeType === 1) walk(c, ms, contentM, 1, false, [], depth + 1);
        } finally {
          target = savedTarget;
        }
        const alpha = (props(mk)['mask-type'] ?? '').trim() === 'alpha';
        const allMasks = [...savedMasks, { shapes: content, ...(alpha ? { alpha: true } : {}) }];
        const cl = [...clips, regionClip];
        // マスクは、要素の全体 (子を重ねた絵) に掛ける (CSS Masking 1 §7.1)。子ごとに掛けると、重なった子の下の色が透けるので、
        // 子の図形をまとめて透明のグループにし、そのグループに切り抜き・マスクを掛ける。図形が 1 つなら、その図形に掛けても同じ。
        // 線の太さ・形の大きさが変わらない図形 (vector-effect) はグループの中で描けないので、子ごとに掛ける (前と同じ)
        const inner: SvgShape[] = [];
        target = inner;
        masks = [];
        masking.add(n);
        try {
          walk(n, st, m, op, isRoot, [], depth);
        } finally {
          target = savedTarget;
          masks = savedMasks;
          masking.delete(n);
        }
        // 塗りと線のある図形 1 つも、塗りと線に別々に掛けると重なった所 (線の内側の半分) で塗りが透けるので、グループにする (透明のグループの所と同じ判定)
        const paintsBoth = (x: SvgShape) => (x.fill !== undefined || !!x.fillPaint || !!x.fillPattern) && x.stroke !== undefined && x.strokeWidth > 0;
        if ((inner.length > 1 || (inner.length === 1 && paintsBoth(inner[0]))) && !inner.some((x) => x.nonScalingStroke || x.nonScalingAnchor))
          target.push({ segs: [], evenOdd: false, strokeWidth: 0, lineCap: 0, lineJoin: 0, fillOpacity: 1, strokeOpacity: 1, clips: cl, masks: allMasks, group: { shapes: inner } });
        else for (const x of inner) target.push({ ...x, clips: [...cl, ...(x.clips ?? [])], masks: [...allMasks, ...(x.masks ?? [])] });
        return;
      }
      // (mask でこの要素を描き直す分は、ここまで来ないので、filter の元の図形を集める分 (filtering) と合わせて 1 回と数える)
      if (!filtering.has(n)) visit(n);
      const s = inherit(st, p);
      // 透明のグループ (Compositing and Blending 1 §3.3): opacity が 1 未満の要素・mix-blend-mode の付いた子を持つ要素・isolation: isolate の要素は、
      // 子をまとめて描いてから、不透明度・描画モードで置く (子ごとに不透明度を掛けると、重なった所が濃くなる)
      const bm = (p['mix-blend-mode'] ?? 'normal').trim();
      const container = ['g', 'svg', 'a', 'use', 'text'].includes(name);
      const blend = container && (SVG_BLENDS as readonly string[]).includes(bm) ? (bm as SvgBlend) : undefined;
      if (!grouping.has(n) && !filtering.has(n) && !measuring.has(n) && (s.opacity < 1 || blend || (container && p.isolation === 'isolate'))) {
        const saved = target;
        const inner: SvgShape[] = [];
        target = inner;
        grouping.add(n);
        try {
          walk0(n, st, m, op, isRoot, clips, depth);
        } finally {
          grouping.delete(n);
          target = saved;
        }
        if (!inner.length) return;
        const one = inner.length === 1 ? inner[0] : undefined;
        const paints = (x: SvgShape) => (x.fill !== undefined || !!x.fillPaint || !!x.fillPattern) && x.stroke !== undefined && x.strokeWidth > 0;
        // 線の太さ・形の大きさが変わらない図形 (vector-effect) はグループの中で描けないので、子ごとに掛ける (前と同じ)
        const perShape = inner.some((x) => x.nonScalingStroke || x.nonScalingAnchor);
        if (perShape || (one && !blend && p.isolation !== 'isolate' && !one.group && !paints(one))) {
          // 図形 1 つ (塗りと線の重なりの無いもの) は、その図形に不透明度を掛ければ同じ
          for (const x of inner) target.push({ ...x, fillOpacity: x.fillOpacity * s.opacity, strokeOpacity: x.strokeOpacity * s.opacity, ...(blend && !x.blend ? { blend } : {}) });
          return;
        }
        target.push({ segs: [], evenOdd: false, strokeWidth: 0, lineCap: 0, lineJoin: 0, fillOpacity: s.opacity, strokeOpacity: s.opacity, ...(blend ? { blend } : {}), group: { shapes: inner } });
        return;
      }
      const o = op * (grouping.has(n) || filtering.has(n) ? 1 : s.opacity);
      // 切り抜き: この要素の座標系 (transform 適用後) で clipPath の形を作る
      let cl = clips;
      if (p['clip-path'] && p['clip-path'] !== 'none' && !filtering.has(n) && !measuring.has(n)) {
        const cp = p['clip-path'].trim();
        const u = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(cp);
        const bbox = () => bboxOf(n, st, m, op, isRoot, depth, m);
        // 無い要素・clipPath でない要素を指す url() は、指定が無いものとする (CSS Masking 1 §5.1)
        const c = u ? (byId.get(u[1]) && nm(byId.get(u[1])!) === 'clippath' ? clipOf(u[1], mm, bbox) : undefined) : basicShapeClip(cp, n, mm, bbox);
        if (c === null) throw new Unsupported('clip-path');
        if (c) {
          // 中身の無い切り抜き (空の clipPath・外接矩形の無い要素の objectBoundingBox) は、すべてを切る (CSS Masking 1 §6.1)
          if (!c.segs.length) return;
          cl = [...clips, c];
        }
      }
      // filter (Filter Effects 1 §5・CSS Masking 1 §2・SVG 2 §3.6): 要素の図形 (SourceGraphic) に filter を当ててから、その結果を
      // clip-path で切り抜き、mask で隠し、opacity で薄める。だから filter の元の図形は、この要素の clip-path・mask・opacity と、祖先から
      // 受け継いだ切り抜き・マスク・不透明度を当てずに集め (filtering の間は、上の mask・opacity・clip-path の所を飛ばす)、
      // filter の結果に place で当てる。opacity と、mix-blend-mode・isolation のグループは、上の透明のグループの所で、filter の結果を包む
      if (p.filter && p.filter !== 'none' && !filtering.has(n) && !measuring.has(n)) {
        if (!opts.approximateFilters) throw new Unsupported('filter');
        const fr = filterOf(p.filter, () => bboxOf(n, st, m, op, isRoot, depth, m), vp);
        const { layers, region: regionOf } = fr;
        // 要素の図形を集めてから、層を下から順に足す (影 (ずらしてぼかした写し) が先、元の図形が後)
        const savedTarget = target;
        const savedMasks = masks;
        const own: SvgShape[] = [];
        target = own;
        masks = [];
        filtering.add(n);
        try {
          walk0(n, st, m, 1, isRoot, [], depth);
        } finally {
          filtering.delete(n);
          target = savedTarget;
          masks = savedMasks;
        }
        /**
         * filter の結果に、この要素と祖先の切り抜き (cl)・マスク (masks)・不透明度 (o) を当てて描く。結果が図形の重なり (影と元の図形など) で、
         * マスクか不透明度があるときは、重なりをまとめて隠す・薄めるように、透明のグループにする (図形ごとに掛けると、下の図形が透ける)
         */
        const place = (shapes: SvgShape[]) => {
          if (!shapes.length) return;
          const clipped = (x: SvgShape): SvgShape => (cl.length ? { ...x, clips: [...cl, ...(x.clips ?? [])] } : x);
          if ((masks.length || o < 1) && shapes.length > 1 && !shapes.some((x) => x.nonScalingStroke || x.nonScalingAnchor)) {
            target.push(clipped({ segs: [], evenOdd: false, strokeWidth: 0, lineCap: 0, lineJoin: 0, fillOpacity: o, strokeOpacity: o, ...(masks.length ? { masks } : {}), group: { shapes } }));
            return;
          }
          for (const x of shapes)
            target.push(clipped({ ...x, ...(o < 1 ? { fillOpacity: x.fillOpacity * o, strokeOpacity: x.strokeOpacity * o } : {}), ...(masks.length ? { masks: [...masks, ...(x.masks ?? [])] } : {}) }));
        };
        // 色の変換 (feColorMatrix・feComponentTransfer) を図形ごとに当てられない図形 (画像・模様の塗り・CMYK の色。recolorShape) があれば、
        // 図形で近似せず、画素で計算する (Filter Effects 1 §9.6・§9.7 の変換は画素の色に当たる。画素で計算すれば、画像・模様の色も変えられる)
        let raster = fr.raster;
        if (!raster && fr.rasterFallback && layers.some((l) => l.kind === 'source' && l.recolor.length)) {
          try {
            const flat = flattenGroups(own);
            for (const l of layers) if (l.kind === 'source' && l.recolor.length) for (const sh of flat) recolorShape(sh, l.recolor);
          } catch (err) {
            if (!(err instanceof Unsupported)) throw err;
            raster = fr.rasterFallback;
          }
        }
        if (raster) {
          // 画素で計算する: 要素の図形を filter の領域 (要素の座標) の画素にして、filter の要素を順に計算し、結果の画像を領域に置く
          const tr1 = isRoot ? ID : (elementTransform(n, () => bboxOf(n, st, m, op, isRoot, depth, m)) ?? ID);
          const lm1 = mul(m, tr1);
          const bb = bboxOf(n, st, m, op, isRoot, depth, m);
          const reg = regionOf(() => bb, vp);
          if (!reg || !(reg.w > 0 && reg.h > 0)) return;
          const scale = Math.sqrt(Math.abs(lm1[0] * lm1[3] - lm1[1] * lm1[2])) || 1;
          const s0 = inherit(st, p);
          const paintOf = (v: Style['fill']): number[] | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? [...[1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16) / 255), 1] : undefined);
          // feImage: 画像 (data: と、呼ぶ側の引く外のファイル) は部分領域に preserveAspectRatio で合わせ、#id の要素はその要素を描く
          const imageFor = (e: XmlNode, box: Box): SvgShape[] | undefined => {
            const href = (e.getAttribute?.('href') ?? e.getAttribute?.('xlink:href') ?? '').trim();
            const saved = target;
            const tmp: SvgShape[] = [];
            target = tmp;
            try {
              if (href.startsWith('#')) {
                const el = byId.get(href.slice(1));
                if (el) walk(el, ROOT_STYLE, lm1, 1, false, [], depth + 1);
              } else if (href) {
                const fake = { nodeType: 1, nodeName: 'image', localName: 'image', childNodes: [], getAttribute: (k: string) => ({ href, x: String(box.x), y: String(box.y), width: String(box.w), height: String(box.h), preserveAspectRatio: e.getAttribute?.('preserveAspectRatio') ?? null })[k] ?? null } as XmlNode;
                walk(fake, ROOT_STYLE, lm1, 1, false, [], depth + 1);
              }
            } finally {
              target = saved;
            }
            return tmp.length ? tmp : undefined;
          };
          const result = opts.rasterFilter!({
            prims: raster.prims(imageFor),
            source: own,
            region: reg,
            toRoot: lm1,
            pxPerUnit: (opts.filterResolution ?? 4) * scale,
            ...(bb ? { bbox: bb } : {}),
            primitiveUnits: raster.obb ? 'objectBoundingBox' : 'userSpaceOnUse',
            viewport: { w: vp.w, h: vp.h },
            ...(paintOf(s0.fill) ? { fillPaint: paintOf(s0.fill) } : {}),
            ...(paintOf(s0.stroke) ? { strokePaint: paintOf(s0.stroke) } : {}),
            budget: filterBudget,
          });
          if (!result) throw new Unsupported('filter');
          place([
            {
              segs: [],
              evenOdd: false,
              strokeWidth: 0,
              lineCap: 0,
              lineJoin: 0,
              fillOpacity: 1,
              strokeOpacity: 1,
              image: { kind: 'png', bytes: encodePngStored(result), pixels: result, matrix: mul(lm1, [reg.w, 0, 0, -reg.h, reg.x, reg.y + reg.h]) },
            },
          ]);
          return;
        }
        // 影・色の変換は図形ごとに作るので、グループは開いて扱う。ただし切り抜き・マスクの付いたグループは開かない (blurredCopies が、
        // グループのまま写して、マスクを 1 度だけ掛ける。開くと、子の数 × 影の写しの数だけマスクを描き直す)。
        // 色の変換が不透明度 (アルファ) を変えるとき (feColorMatrix の 4 行目・feComponentTransfer の feFuncA が恒等でないとき) は、
        // 残したグループの不透明度に変換を掛けられない (a' = 0.5a + 0.5 のように定数を足す変換は、グループの不透明度に掛けても同じにならない) ので、
        // 前と同じに開く (子ごとに色と不透明度を変える)
        const probe = [0, 0.3, 1].flatMap((c) => [0, 0.5, 1].map((a) => [c, 1 - c, c, a]));
        const keepsAlpha = layers.every((l) => l.kind !== 'source' || l.recolor.every((fn) => probe.every((v) => Math.abs(fn([...v])[3] - v[3]) < 1e-9)));
        const flat = keepsAlpha ? openForFilter(own) : flattenGroups(own);
        own.length = 0;
        own.push(...flat);
        const tr0 = isRoot ? ID : (elementTransform(n, () => bboxOf(n, st, m, op, isRoot, depth, m)) ?? ID);
        const lm = mul(m, tr0);
        const scale = Math.sqrt(Math.abs(lm[0] * lm[3] - lm[1] * lm[2]));
        const hex = (c: number[]) => `#${c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
        // ぼかしだけ (ずらさず、色も変えない元の図形 1 つ) は、元の図形のまま描く
        const only = layers.length === 1 && layers[0].kind === 'source' ? layers[0] : undefined;
        if (only && !only.dx && !only.dy && !only.recolor.length && only.opacity === 1 && !only.blend && !only.cut) {
          place(own);
          return;
        }
        // 結果を集めて、filter の領域で切り抜く (領域の外は描かない。Filter Effects 1 §8)。描画モードがあれば透明のグループにする
        const outer = target;
        const result: SvgShape[] = [];
        target = result;
        for (const l of layers) {
          if (l.kind === 'flood') continue;
          // ずらす量は要素の座標系で (移動を除いた変換を掛ける)、ぼかしの幅は拡大率を掛ける
          const ox = lm[0] * l.dx + lm[2] * l.dy;
          const oy = lm[1] * l.dx + lm[3] * l.dy;
          const before = target.length;
          if (l.kind === 'alpha') {
            if (l.opacity > 0) target.push(...blurredCopies(own, ox, oy, l.std * scale, hex(l.color), l.opacity));
          } else {
            const shapes = l.recolor.length ? own.map((sh) => recolorShape(sh, l.recolor)) : own;
            if (!l.std && !ox && !oy && l.opacity === 1) target.push(...shapes);
            else target.push(...blurredCopies(shapes, ox, oy, l.std * scale, undefined, l.opacity));
          }
          if (l.blend) for (let i = before; i < target.length; i++) target[i] = { ...target[i], blend: l.blend };
          // 部分領域で切る (要素の座標の矩形を、ルートの座標にして切り抜きに足す)
          if (l.cut) {
            const cuts = l.cut.map((c): SvgClip => ({ segs: transformSegs(rectSegs(c), lm), evenOdd: false }));
            for (let i = before; i < target.length; i++) target[i] = { ...target[i], clips: [...(target[i].clips ?? []), ...cuts] };
          }
        }
        target = outer;
        const reg = regionOf(() => bboxOf(n, st, m, op, isRoot, depth, m), vp);
        if (!reg || !(reg.w > 0 && reg.h > 0)) return;
        const regionClip: SvgClip = { segs: transformSegs(rectSegs(reg), lm), evenOdd: false };
        if (layers.some((l) => l.blend)) place([{ segs: [], evenOdd: false, strokeWidth: 0, lineCap: 0, lineJoin: 0, fillOpacity: 1, strokeOpacity: 1, clips: [regionClip], group: { shapes: result } }]);
        else place(result.map((x) => ({ ...x, clips: [...(x.clips ?? []), regionClip] })));
        return;
      }
      if (name === 'svg' && !isRoot) {
        // 入れ子の svg: 枠 (x・y・width・height。既定は 0・0・100%・100%) に viewBox を合わせた座標系で、中身を描く
        const a = (k: string, d: string) => n.getAttribute?.(k) ?? d;
        inViewport(n, ulen(a('x', '0'), vp.w), ulen(a('y', '0'), vp.h), ulen(a('width', '100%'), vp.w), ulen(a('height', '100%'), vp.h), mm, cl, (m2, cl2) => {
          for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) walk(c, s, m2, o, false, cl2, depth + 1);
        });
        return;
      }
      if (name === 'svg' || name === 'g' || name === 'a') {
        // a の href (SVG 2 の a 要素。xlink:href も): 絶対の URL (http(s)・mailto・ftp・tel) だけを、中の図形のリンクにする
        const href = name === 'a' ? (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').trim() : '';
        const sa: Style = /^(https?|mailto|ftp|tel):/i.test(href) ? { ...s, link: href } : s;
        for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) walk(c, sa, mm, o, false, cl, depth + 1);
        return;
      }
      if (name === 'use') {
        // 参照先を、use の位置 (x, y) に描く。symbol は、viewBox があれば use の枠に合わせ、無ければ g と同じに扱う
        const ref = useRef(n);
        if (!ref) return;
        const ux = ulen(n.getAttribute?.('x') ?? '0', vp.w);
        const uy = ulen(n.getAttribute?.('y') ?? '0', vp.h);
        const at = mul(mm, [1, 0, 0, 1, ux, uy]);
        // use の中身の context element は use の要素 (context-fill・context-stroke は use の塗り・線)。模様・グラデーションは、use の
        // 座標系と、use の外接矩形 (中身の外接矩形) で当てる (SVG 2 §13.2)。use の座標系は、x・y のずらし (translate(x,y)) を
        // 変換の右に足したもの (SVG 2 §5.5.2)
        const useFrame = (): ReturnType<PaintFrame> => {
          if (measuring.has(n)) return undefined;
          const b = bboxOf(n, st, m, op, isRoot, depth, at);
          return b ? { segs: rectSegs(b), m: at } : undefined;
        };
        const su: Style = { ...s, context: contextOf(s, useFrame) };
        if (nm(ref) === 'symbol') {
          const kids = (m2: M, cl2: SvgClip[]) => {
            for (const c of Array.from(ref.childNodes)) if (c.nodeType === 1) walk(c, su, m2, o, false, cl2, depth + 1);
          };
          // viewBox のある symbol: use の枠 (width・height。既定は 100%) に viewBox を合わせる
          if (ref.getAttribute?.('viewBox')) inViewport(ref, ux, uy, ulen(n.getAttribute?.('width') ?? '100%', vp.w), ulen(n.getAttribute?.('height') ?? '100%', vp.h), mm, cl, kids);
          else kids(at, cl);
        } else walk(ref, su, at, o, false, cl, depth + 1);
        return;
      }
      if (name === 'image') {
        // PNG・JPEG を、枠 (x・y・width・height) に preserveAspectRatio で合わせて描く
        const href = (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').trim();
        // 外のファイルを指す href は、呼ぶ側 (opts.image) が引いた PNG・JPEG を描く。引けない画像と、href の無い image は描かない
        // (ほかの要素は描く。ブラウザも、読めない画像の image は描かない)
        let kind: 'png' | 'jpeg';
        let bytes: Uint8Array;
        const d = /^data:image\/(png|jpeg|jpg|gif|bmp|x-ms-bmp|webp);base64,([\s\S]*)$/i.exec(href);
        if (d) {
          bytes = fromBase64(d[2]);
          const t = d[1].toLowerCase();
          if (t === 'png' || t === 'jpeg' || t === 'jpg') kind = t === 'png' ? 'png' : 'jpeg';
          else {
            // GIF・BMP・WebP は画素に戻して PNG にする (PDF に入れられるのは PNG・JPEG。GIF は最初の絵)
            const px = t === 'gif' ? decodeGif(bytes) : t === 'webp' ? decodeWebp(bytes) : decodeBmp(bytes);
            if (!px) throw new Unsupported('image');
            bytes = encodePngStored(px);
            kind = 'png';
          }
        } else if (/^data:/i.test(href)) throw new Unsupported('image');
        else {
          const got = href ? opts.image?.(href) : undefined;
          if (!got) return;
          ({ kind, bytes } = got);
        }
        const a = (k: string, def: string) => n.getAttribute?.(k) ?? def;
        let ix = ulen(a('x', '0'), vp.w);
        let iy = ulen(a('y', '0'), vp.h);
        let iw = ulen(a('width', '0'), vp.w);
        let ih = ulen(a('height', '0'), vp.h);
        if (!(iw > 0 && ih > 0)) return;
        // preserveAspectRatio (SVG 1.1 §7.8。既定は xMidYMid meet): 画像の縦横比を保って枠に収め、揃えの位置に置く。
        // slice は、枠を覆う大きさにして、はみ出しを枠で切る
        const par = (n.getAttribute?.('preserveAspectRatio') ?? 'xMidYMid meet').trim().split(/\s+/);
        let icl = cl;
        if (par[0] !== 'none') {
          const nat = imagePixelSize(bytes, kind);
          if (!nat) throw new Unsupported('image');
          const slice = par[1] === 'slice';
          if (slice) {
            const box: Seg[] = [{ op: 'M', x: ix, y: iy }, { op: 'L', x: ix + iw, y: iy }, { op: 'L', x: ix + iw, y: iy + ih }, { op: 'L', x: ix, y: iy + ih }, { op: 'Z' }];
            icl = [...cl, { segs: transformSegs(box, mm), evenOdd: false }];
          }
          const k = slice ? Math.max(iw / nat.w, ih / nat.h) : Math.min(iw / nat.w, ih / nat.h);
          const dw = nat.w * k;
          const dh = nat.h * k;
          const al = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(par[0]);
          if (!al) throw new Unsupported('image');
          const f = (v: string) => (v === 'Min' ? 0 : v === 'Mid' ? 0.5 : 1);
          ix += (iw - dw) * f(al[1]);
          iy += (ih - dh) * f(al[2]);
          iw = dw;
          ih = dh;
        }
        if (s.hidden) return;
        target.push({
          segs: [],
          evenOdd: false,
          strokeWidth: 0,
          lineCap: 0,
          lineJoin: 0,
          fillOpacity: o,
          strokeOpacity: o,
          ...(icl.length ? { clips: icl } : {}),
          ...(masks.length ? { masks } : {}),
          image: { kind, bytes, matrix: mul(mm, [iw, 0, 0, -ih, ix, iy + ih]) },
          ...(s.link ? { link: s.link } : {}),
        });
        return;
      }
      if (name === 'text') {
        textShapes(n, s, mm, o, cl);
        return;
      }
      if (name === 'foreignobject') {
        if (opts.collectForeign) {
          collectForeign(n, s, opts.collectForeign);
          return;
        }
        // 近似なので、画像にできる環境 (ブラウザ) では使わない (SVG ごと画像にして、HTML の組版のとおりに描く)
        if (!opts.approximateFilters) throw new Unsupported('foreignobject');
        foreignText(n, s, mm, o, cl, depth);
        return;
      }
      if (name === 'tspan') throw new Unsupported('tspan');
      const segs = geometryOf(n, name);
      if (!segs || !segs.length) return; // 未知の要素 (メタデータ等) は描かない
      const hasMarkers = /^(path|line|polyline|polygon)$/.test(name) && !!(s.markerStart || s.markerMid || s.markerEnd);
      if (!s.paintOrder) {
        pushShape(name, segs, s, mm, o, cl);
        if (hasMarkers) markers(segs, s, mm, o, cl, depth);
        return;
      }
      // paint-order: 塗り・線・marker を、指定の順に描く (塗りと線は別の図形にする)
      for (const step of s.paintOrder) {
        if (step === 'markers') {
          if (hasMarkers) markers(segs, s, mm, o, cl, depth);
        } else if (step === 'fill' ? s.fill : s.stroke) pushShape(name, segs, step === 'fill' ? { ...s, stroke: null } : { ...s, fill: null }, mm, o, cl);
      }
    };

    /**
     * 図形の頂点に marker を描く (始点・途中・終点)。向きは orient (auto は入る線と出る線の二等分、auto-start-reverse は始点を逆向き、
     * 角度は固定)。markerUnits が strokeWidth なら線の太さで拡大し、viewBox を markerWidth × markerHeight の枠に合わせて、refX・refY を頂点に重ねる。
     * 中身はマーカーの要素の書式を受け継ぐ (図形の書式は受け継がない)
     */
    const markers = (segs: Seg[], s: Style, mm: M, o: number, cl: SvgClip[], depth: number) => {
      // 頂点と、入る向き・出る向き
      const verts: Array<{ x: number; y: number; inA?: number; outA?: number }> = [];
      let sx = 0;
      let sy = 0;
      let px = 0;
      let py = 0;
      let start = -1;
      for (const g of segs) {
        if (g.op === 'M') {
          verts.push({ x: g.x, y: g.y });
          start = verts.length - 1;
          sx = px = g.x;
          sy = py = g.y;
          continue;
        }
        const [x, y] = g.op === 'Z' ? [sx, sy] : [g.x, g.y];
        const [ax, ay] = g.op === 'C' ? (g.x1 !== px || g.y1 !== py ? [g.x1 - px, g.y1 - py] : [g.x2 - px, g.y2 - py]) : [x - px, y - py];
        const [bx, by] = g.op === 'C' ? (g.x !== g.x2 || g.y !== g.y2 ? [g.x - g.x2, g.y - g.y2] : [g.x - g.x1, g.y - g.y1]) : [x - px, y - py];
        if (verts.length) verts[verts.length - 1].outA = Math.atan2(ay, ax);
        const v: { x: number; y: number; inA?: number; outA?: number } = { x, y, inA: Math.atan2(by, bx) };
        // 閉じた線の終わりの頂点は、始まりの頂点の出る向きへ続く
        if (g.op === 'Z' && start >= 0) v.outA = verts[start].outA;
        verts.push(v);
        px = x;
        py = y;
      }
      if (!verts.length) return;
      const angleOf = (v: (typeof verts)[number]) =>
        v.inA !== undefined && v.outA !== undefined
          ? Math.abs(Math.cos(v.inA) + Math.cos(v.outA)) + Math.abs(Math.sin(v.inA) + Math.sin(v.outA)) < 1e-9
            ? v.inA
            : Math.atan2(Math.sin(v.inA) + Math.sin(v.outA), Math.cos(v.inA) + Math.cos(v.outA))
          : (v.inA ?? v.outA ?? 0);
      const place = (id: string | undefined, v: (typeof verts)[number], isStart: boolean) => {
        const mk = id ? byId.get(id) : undefined;
        if (!mk || nm(mk) !== 'marker') return;
        const orient = (mk.getAttribute?.('orient') ?? '0').trim();
        const a = orient === 'auto' ? angleOf(v) : orient === 'auto-start-reverse' ? angleOf(v) + (isStart ? Math.PI : 0) : (parseFloat(orient) * Math.PI) / 180 || 0;
        const sc = (mk.getAttribute?.('markerUnits') ?? 'strokeWidth') === 'strokeWidth' ? s.strokeWidth : 1;
        const mw = ulen(mk.getAttribute?.('markerWidth') ?? '3', 0);
        const mh = ulen(mk.getAttribute?.('markerHeight') ?? '3', 0);
        if (!(mw > 0 && mh > 0)) return;
        const base = mul(mm, [Math.cos(a) * sc, Math.sin(a) * sc, -Math.sin(a) * sc, Math.cos(a) * sc, v.x, v.y]);
        // refX・refY (中身の座標) が頂点に来るように、枠をずらす
        const vb = viewBoxOf(mk, mw, mh).m;
        const rx = num(mk.getAttribute?.('refX') ?? undefined, 0);
        const ry = num(mk.getAttribute?.('refY') ?? undefined, 0);
        // marker の中身の context element は marker を付けた図形。模様・グラデーションは、その図形の座標系と外接矩形で当てる
        // (SVG 2 §13.2。図形から marker へ続けて塗る)
        const ms = inherit({ ...ROOT_STYLE, context: contextOf(s, () => ({ segs, m: mm })) }, props(mk));
        inViewport(mk, -(vb[0] * rx + vb[2] * ry + vb[4]), -(vb[1] * rx + vb[3] * ry + vb[5]), mw, mh, base, cl, (m2, cl2) => {
          for (const c of Array.from(mk.childNodes)) if (c.nodeType === 1) walk(c, ms, m2, o, false, cl2, depth + 1);
        }, !!opts.markerOverflowVisible && props(mk).overflow === undefined);
      };
      verts.forEach((v, k) => place(k === 0 ? s.markerStart : k === verts.length - 1 ? s.markerEnd : s.markerMid, v, k === 0));
    };

    /** 図形 (ローカル座標の形) を、塗り・線の指定とともに shapes へ足す */
    const pushShape = (name: string, segs: Seg[], s: Style, mm: M, o: number, cl: SvgClip[], evenOdd = s.evenOdd, text?: { chars?: TextChars; size: number; t: M }) => {
      if (s.hidden) return;
      // 字の paint-order (SVG 2 §13.8): 線を塗りより先にするなら、字ごとに、線と塗りを別の図形にして描く
      if (name === 'text' && s.paintOrder && s.fill && s.stroke && s.paintOrder.indexOf('stroke') < s.paintOrder.indexOf('fill')) {
        pushShape(name, segs, { ...s, fill: null, paintOrder: undefined }, mm, o, cl, evenOdd, text);
        pushShape(name, segs, { ...s, stroke: null, paintOrder: undefined }, mm, o, cl, evenOdd, text);
        return;
      }
      const det = Math.abs(mm[0] * mm[3] - mm[1] * mm[2]);
      const fillable = name !== 'line';
      let fill: string | undefined;
      let fillPaint: SvgGradient | undefined;
      let fillPattern: SvgPattern | undefined;
      if (fillable && s.fill) {
        // context-fill・context-stroke の模様・グラデーションは、context element の座標系と外接矩形で当てる (Style.fillFrame)
        const ff = s.fillFrame?.();
        if (typeof s.fill === 'string') fill = s.fill;
        else if (nm(byId.get(s.fill.ref) ?? root) === 'pattern') {
          const pt = patternOf(s.fill.ref, ff?.segs ?? segs, ff?.m ?? mm);
          if (pt) fillPattern = pt;
        } else {
          const gr = gradientOf(s.fill.ref, ff?.segs ?? segs, ff?.m ?? mm);
          if (typeof gr === 'string') fill = gr;
          else if (gr) fillPaint = gr;
        }
      }
      let stroke: string | undefined;
      let strokePaint: SvgGradient | undefined;
      if (s.stroke) {
        if (typeof s.stroke === 'string') stroke = s.stroke;
        else {
          const sf = s.strokeFrame?.();
          const gr = gradientOf(s.stroke.ref, sf?.segs ?? segs, sf?.m ?? mm);
          if (typeof gr === 'string') stroke = gr;
          else if (gr) strokePaint = gr;
        }
      }
      // non-scaling-size: 要素の原点だけを変換で写し、形は元の大きさのまま、その点の周りに置く
      const anchor: [number, number] | undefined = s.nonScalingSize ? [mm[4], mm[5]] : undefined;
      // use で置き直した text の字の輪郭 (textAgain の説明)
      if (textAgain) charge(segs.length + 1);
      target.push({
        segs: anchor ? transformSegs(segs, [1, 0, 0, 1, anchor[0], anchor[1]]) : transformSegs(segs, mm),
        ...(anchor ? { nonScalingAnchor: anchor } : {}),
        fill: fill ?? (fillPaint ? fillPaint.stops[fillPaint.stops.length - 1].color : fillPattern ? '#808080' : undefined),
        ...(fillPaint ? { fillPaint } : {}),
        ...(fillPattern ? { fillPattern } : {}),
        ...(cl.length ? { clips: cl } : {}),
        ...(masks.length ? { masks } : {}),
        evenOdd,
        stroke: stroke ?? (strokePaint ? strokePaint.stops[strokePaint.stops.length - 1].color : undefined),
        ...(strokePaint ? { strokePaint } : {}),
        strokeWidth: s.nonScalingStroke ? s.strokeWidth : s.strokeWidth * Math.sqrt(det),
        ...(s.nonScalingStroke ? { nonScalingStroke: true } : {}),
        lineCap: s.lineCap,
        lineJoin: s.lineJoin,
        dash: s.nonScalingStroke ? s.dash : s.dash?.map((x) => x * Math.sqrt(det)),
        ...(s.dash && s.dashOffset ? { dashOffset: s.nonScalingStroke ? s.dashOffset : s.dashOffset * Math.sqrt(det) } : {}),
        ...(s.miterLimit !== undefined ? { miterLimit: s.miterLimit } : {}),
        fillOpacity: o * s.fillOpacity * (s.fillAlpha ?? 1),
        strokeOpacity: o * s.strokeOpacity * (s.strokeAlpha ?? 1),
        ...(text?.chars?.length && !anchor ? { text: { chars: text.chars, size: text.size, matrix: mul(mm, text.t) } } : {}),
        ...(s.link ? { link: s.link } : {}),
      });
    };
    /**
     * text: 文字を輪郭 (図形) にする。tspan は入れ子の文字の流れとして続けて置き、x / y があればそこから新しい塊にする。
     * text-anchor は塊ごと。空白は 1 つにまとめ、先頭・末尾は落とす (xml:space="default")
     */
    /**
     * textPath: 参照するパスに沿って、1 字ずつ置く。字の送りの真ん中がパスの上に来るように、その場所のパスの向きに回す。
     * startOffset (長さ・パスの長さに対する %) と text-anchor で始まりをずらす。パスの外にはみ出す字は描かない
     */
    /**
     * 文字データの空白 (SVG 1.1 §10.15)。preserve: 改行・タブを空白にし、空白はすべて残す。
     * default: 空白の並びを 1 つにまとめる (先頭・末尾は、塊の両端で落とす)
     */
    /**
     * いま描いている text が、2 度目からの描き直し (use で置き直したもの) か。描き直しでは、字の数と輪郭の線分を「参照で増える分」に数える
     * (2000 字の text を use で 3000 回置く 92KB の SVG で、600 万字の輪郭を作っていた)
     */
    const textSeen = new Set<XmlNode>();
    let textAgain = false;
    /**
     * SVG フォント (SVG 1.1 §20 の font 要素): font-face の font-family の名前 → 字形 (glyph の unicode → 輪郭と送り)。
     * 字形の座標は y が上向きで、units-per-em (既定 1000) の単位。unicode が何字かの glyph (合字) は、長いものを先に当てる。
     * 字形の無い字は missing-glyph、それも無ければ、呼ぶ側の書体 (opts.outline) で描く。
     * glyph は unicode の字の木 (trie) で引く: 字の位置ごとに、最長の unicode の長さから 1 まで、そのたびに slice と join で引き直すと、
     * 2000 字の unicode の glyph と 2000 字の text で 3 乗の手間 (29 秒) になった
     */
    type SvgGlyph = { segs: Seg[]; adv: number };
    type GlyphNode = { next: Map<string, GlyphNode>; glyph?: SvgGlyph };
    /** 1 度描いた glyph (2 度目からを線分の予算に数える) */
    const glyphDrawn = new WeakSet<SvgGlyph>();
    const svgFonts = new Map<string, { upm: number; adv: number; trie: GlyphNode; missing?: SvgGlyph }>();
    for (const f of allElements(root)) {
      if (nm(f) !== 'font') continue;
      const face = Array.from(f.childNodes).find((c) => c.nodeType === 1 && nm(c) === 'font-face');
      const fam = face?.getAttribute?.('font-family')?.trim().replace(/^['"]|['"]$/g, '');
      if (!fam) continue;
      const upm = parseFloat(face?.getAttribute?.('units-per-em') ?? '') || 1000;
      const adv = parseFloat(f.getAttribute?.('horiz-adv-x') ?? '') || upm;
      const trie: GlyphNode = { next: new Map() };
      let missing: SvgGlyph | undefined;
      for (const g of Array.from(f.childNodes)) {
        if (g.nodeType !== 1) continue;
        const kind = nm(g);
        if (kind !== 'glyph' && kind !== 'missing-glyph') continue;
        const segs = parsePathData(g.getAttribute?.('d') ?? '') ?? [];
        const ga = { segs, adv: parseFloat(g.getAttribute?.('horiz-adv-x') ?? '') || adv };
        if (kind === 'missing-glyph') missing = ga;
        else {
          const u = g.getAttribute?.('unicode');
          const cps = u ? [...u] : [];
          // 合字の unicode の長さの上限 (SVG_FONT_MAX_LIGATURE)。超える glyph は使わない
          if (cps.length && cps.length <= SVG_FONT_MAX_LIGATURE) {
            let node = trie;
            for (const c of cps) {
              let nx = node.next.get(c);
              if (!nx) node.next.set(c, (nx = { next: new Map() }));
              node = nx;
            }
            // 同じ unicode の glyph は、先に書かれたものを使う (これまでと同じ)
            node.glyph ??= ga;
          }
        }
      }
      if (!svgFonts.has(fam)) svgFonts.set(fam, { upm, adv, trie, ...(missing ? { missing } : {}) });
    }
    /** 字の輪郭: font-family の並びの最初の名前が SVG フォントなら、その字形で、ほかは呼ぶ側の書体で */
    const textOutline: TextOutliner | undefined = !svgFonts.size
      ? opts.outline
      : (text, family, weight, size, style, vertical) => {
          const name = family?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
          const sf = name ? svgFonts.get(name) : undefined;
          if (!sf) return opts.outline ? opts.outline(text, family, weight, size, style, vertical) : null;
          const k = size / sf.upm;
          const segs: Seg[] = [];
          let x = 0;
          const cs = [...text];
          // 線分を足す (push(...並び) は、大きな並びで呼び出しのスタックが尽きるので、1 つずつ)
          const add = (from: Seg[]) => {
            for (const sg of from) segs.push(sg);
          };
          for (let i = 0; i < cs.length; ) {
            // 字の木をたどり、いちばん長く合う glyph を当てる
            let hit: GlyphNode | undefined;
            let used = 1;
            for (let node: GlyphNode | undefined = sf.trie, n = 0; i + n < cs.length; ) {
              node = node.next.get(cs[i + n]);
              if (!node) break;
              n++;
              if (node.glyph) {
                hit = node;
                used = n;
              }
            }
            if (!hit && !sf.missing && opts.outline) {
              // 字形の無い字は、呼ぶ側の書体で
              const ol = opts.outline(cs[i], family, weight, size, style);
              if (!ol) return null;
              add(transformSegs(ol.segs, [1, 0, 0, 1, x, 0]));
              x += ol.advance;
              i++;
              continue;
            }
            const g = hit?.glyph ?? sf.missing;
            if (g) {
              // 字形の輪郭は、文書に 1 度だけ書かれ、字の数だけ写す (use で置くのと同じ) ので、2 度目からを線分の予算に数える
              // (4 万線分の glyph を 1000 字並べると 4000 万の線分になり、メモリが尽きて落ちていた)。
              // use で置き直した text は、呼ぶ側が輪郭の全部を数えるので、ここでは数えない (textAgain の説明)
              if (!textAgain) {
                if (glyphDrawn.has(g)) charge(g.segs.length);
                else glyphDrawn.add(g);
              }
              add(transformSegs(g.segs, [k, 0, 0, -k, x, 0]));
              x += g.adv * k;
            }
            i += used;
          }
          return { segs, advance: x };
        };
    const spaced = (t: string, st: Style) => (st.preserveSpace ? t.replace(/\r\n|[\n\r\t]/g, ' ') : t.replace(/\s+/g, ' '));
    const textOnPath = (tp: XmlNode, st: Style, mm: M, o: number, cl: SvgClip[], parentSpacing = 0) => {
      const outline = textOutline;
      if (!outline) throw new Unsupported('text');
      const ref = byId.get(hrefOf(tp));
      if (!ref) return;
      const geo = geometryOf(ref, nm(ref));
      if (!geo || !geo.length) return;
      const rt = elementTransform(ref);
      if (!rt) throw new Unsupported('transform');
      // パスを折れ線にして、長さを積み上げる
      const pts: Array<{ x: number; y: number; d: number }> = [];
      let cx = 0;
      let cy = 0;
      let sx = 0;
      let sy = 0;
      const add = (x: number, y: number, jump = false) => {
        const [tx, ty] = [rt[0] * x + rt[2] * y + rt[4], rt[1] * x + rt[3] * y + rt[5]];
        const last = pts[pts.length - 1];
        pts.push({ x: tx, y: ty, d: !last || jump ? (last?.d ?? 0) : last.d + Math.hypot(tx - last.x, ty - last.y) });
      };
      for (const g of geo) {
        if (g.op === 'M') {
          add(g.x, g.y, true);
          cx = sx = g.x;
          cy = sy = g.y;
        } else if (g.op === 'L') {
          add(g.x, g.y);
          cx = g.x;
          cy = g.y;
        } else if (g.op === 'C') {
          for (let k = 1; k <= 24; k++) {
            const t = k / 24;
            const u = 1 - t;
            add(u * u * u * cx + 3 * u * u * t * g.x1 + 3 * u * t * t * g.x2 + t * t * t * g.x, u * u * u * cy + 3 * u * u * t * g.y1 + 3 * u * t * t * g.y2 + t * t * t * g.y);
          }
          cx = g.x;
          cy = g.y;
        } else {
          add(sx, sy);
          cx = sx;
          cy = sy;
        }
      }
      // side="right" (SVG 2 の textPath の side): パスの向きを逆にして、字をパスの右側に置く
      if (tp.getAttribute?.('side') === 'right') {
        const rev = pts.reverse();
        const total0 = rev[0].d;
        for (const q of rev) q.d = total0 - q.d;
      }
      const total = pts[pts.length - 1].d;
      if (!(total > 0)) return;
      /** 長さ d の点と向き */
      const at = (d: number) => {
        // d 以上の長さの最初の点 (1 〜 末尾)。長さは点の順に減らないので、二分して探す
        // (頭から探すと、字の数 × 点の数の手間になる: 2 万の曲線の path に 2 万字で 96 億回)
        let lo = 1;
        let hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (pts[mid].d < d) lo = mid + 1;
          else hi = mid;
        }
        const i = lo;
        const a = pts[i - 1];
        const b = pts[i];
        const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      };
      // 字 (tspan の書式も) を集める
      const chars: Array<{ ch: string; st: Style }> = [];
      const gather = (el: XmlNode, s2: Style) => {
        for (const c of Array.from(el.childNodes)) {
          if (c.nodeType === 3 || c.nodeType === 4) for (const ch of spaced(c.textContent ?? '', s2)) chars.push({ ch, st: s2 });
          else if (c.nodeType === 1 && nm(c) === 'tspan') gather(c, inherit(s2, props(c)));
        }
      };
      gather(tp, st);
      if (!st.preserveSpace) {
        while (chars.length && chars[0].ch === ' ') chars.shift();
        while (chars.length && chars[chars.length - 1].ch === ' ') chars.pop();
      }
      if (textAgain) charge(chars.length);
      const glyphs = chars.map((c) => {
        const ol = outline(c.ch, c.st.fontFamily, c.st.fontWeight, c.st.fontSize, c.st.fontStyle);
        if (!ol) throw new Unsupported('text outline');
        return { ...c, ol };
      });
      // letter-spacing は textPath のもの (無ければ text 要素のもの)
      const ls = st.letterSpacing ?? parentSpacing;
      const width = glyphs.reduce((a, g) => a + g.ol.advance + ls, 0);
      const so = tp.getAttribute?.('startOffset') ?? '0';
      let d = /%\s*$/.test(so) ? (parseFloat(so) / 100) * total : parseFloat(so) || 0;
      d += st.textAnchor === 'middle' ? -width / 2 : st.textAnchor === 'end' ? -width : 0;
      // data-rotate="none" (Kumiori の拡張。CGM の GENERALIZED TEXT PATH MODE の non-tangential): 字を経路の向きに回さない。
      // data-extend="true" (同。CGM の複合の文字の経路): 経路の外にはみ出す字は、端の接線の向きにまっすぐ延ばした線の上に置く
      const noRotate = tp.getAttribute?.('data-rotate') === 'none';
      const extend = tp.getAttribute?.('data-extend') === 'true';
      const head = pts.find((q, i) => i > 0 && q.d > 0);
      const tail = [...pts].reverse().find((q, i, arr) => i < arr.length - 1 && q.d < total);
      const beyond = (mid: number) => {
        if (mid < 0 && head) {
          const a = pts[0];
          const ang = Math.atan2(head.y - a.y, head.x - a.x);
          return { x: a.x + Math.cos(ang) * mid, y: a.y + Math.sin(ang) * mid, angle: ang };
        }
        const b = pts[pts.length - 1];
        const a = tail ?? b;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        return { x: b.x + Math.cos(ang) * (mid - total), y: b.y + Math.sin(ang) * (mid - total), angle: ang };
      };
      for (const g of glyphs) {
        const mid = d + g.ol.advance / 2;
        d += g.ol.advance + ls;
        if ((mid < 0 || mid > total) && !extend) continue;
        const p = mid < 0 || mid > total ? beyond(mid) : at(mid);
        const c = noRotate ? 1 : Math.cos(p.angle);
        const sn = noRotate ? 0 : Math.sin(p.angle);
        // baseline-shift (SVG 1.1 §10.9.2): 字を、パスに垂直な向きにずらす
        const t: M = mul([c, sn, -sn, c, p.x, p.y], [1, 0, 0, 1, -g.ol.advance / 2, g.st.baselineShift ?? 0]);
        pushShape('text', transformSegs(g.ol.segs, t), g.st, mm, o, cl, false, { chars: g.ol.chars, size: g.st.fontSize, t });
      }
    };

    /**
     * 縦書きの text (SVG 2 の text の章・CSS Writing Modes 3): 字を 1 字ずつ下へ送る。x は字の中央の線 (central の基線)、y は送りの向きの位置。
     * x・y の指定で始まる塊ごとに、text-anchor で送りの向きにずらす。letter-spacing・word-spacing は送りに足し、baseline-shift は
     * 右 (上の向き) へずらす。rotate は字をその原点の周りに回す。textLength (text と tspan。SVG 1.1 §10.5) は送りの向きの長さにそろえる。
     * text-decoration は、underline を字の左 (縦書きの行の下の側)、overline を右、line-through を中央に引く (CSS Text Decoration 3 §2.1)
     */
    const verticalText = (
      runs: Array<{ text: string; st: Style; x?: number; y?: number; dx: number; dy: number; rotate?: number; tl?: { length: number; glyphs: boolean } }>,
      outline: TextOutliner,
      mm: M,
      o: number,
      cl: SvgClip[],
      textLength?: { length: number; glyphs: boolean },
    ) => {
      let px = runs[0].x ?? 0;
      let py = runs[0].y ?? 0;
      type VG = { st: Style; segs: Seg[]; x: number; y: number; adv: number; rotate?: number; sy?: number; tl?: { length: number; glyphs: boolean } };
      let chunk: VG[] = [];
      const fit = (gs: VG[], spec: { length: number; glyphs: boolean }) => {
        const y0 = gs[0].y;
        const w0 = gs[gs.length - 1].y + gs[gs.length - 1].adv - y0;
        if (!(w0 > 0)) return 0;
        if (spec.glyphs) {
          const f = spec.length / w0;
          for (const g of gs) {
            g.y = y0 + (g.y - y0) * f;
            g.sy = (g.sy ?? 1) * f;
            g.adv *= f;
          }
        } else if (gs.length > 1) {
          const gap = (spec.length - w0) / (gs.length - 1);
          gs.forEach((g, q) => (g.y += gap * q));
        }
        return spec.length - w0;
      };
      const flushV = () => {
        if (!chunk.length) return;
        // tspan の textLength (字の範囲ごと。後ろの字をずらす)、text の textLength (塊の全体)
        let moved = 0;
        for (let i = 0; i < chunk.length; ) {
          const tl = chunk[i].tl;
          let j = i + 1;
          while (j < chunk.length && chunk[j].tl === tl) j++;
          for (let q = i; q < j; q++) chunk[q].y += moved;
          if (tl) moved += fit(chunk.slice(i, j), tl);
          i = j;
        }
        if (textLength) fit(chunk, textLength);
        const first = chunk[0];
        const lastG = chunk[chunk.length - 1];
        const len = lastG.y + lastG.adv - first.y;
        const anchor = first.st.textAnchor;
        const shift = anchor === 'middle' ? -len / 2 : anchor === 'end' ? -len : 0;
        for (const c of chunk) {
          const r = ((c.rotate ?? 0) * Math.PI) / 180;
          const sy = c.sy ?? 1;
          const t: M = c.rotate ? [Math.cos(r), Math.sin(r) * sy, -Math.sin(r), Math.cos(r) * sy, c.x, c.y + shift] : [1, 0, 0, sy, c.x, c.y + shift];
          pushShape('text', transformSegs(c.segs, t), c.st, mm, o, cl, false);
        }
        // 線: 同じ指定の続く字の範囲ごとに、指定した要素の塗りで
        for (let i = 0; i < chunk.length; ) {
          const ds = chunk[i].st.decorations;
          let j = i + 1;
          while (j < chunk.length && chunk[j].st.decorations === ds) j++;
          for (const d of ds ?? []) {
            const fs = Math.max(...chunk.slice(i, j).map((c) => c.st.fontSize));
            const th = fs * 0.06;
            const ya = chunk[i].y + shift;
            const yb = chunk[j - 1].y + chunk[j - 1].adv + shift;
            const xc = chunk[i].x;
            const segs: Seg[] = [];
            const bar = (x: number) => segs.push({ op: 'M', x, y: ya }, { op: 'L', x: x + th, y: ya }, { op: 'L', x: x + th, y: yb }, { op: 'L', x, y: yb }, { op: 'Z' });
            if (d.under) bar(xc - fs / 2 - th);
            if (d.over) bar(xc + fs / 2);
            if (d.through) bar(xc - th / 2);
            pushShape('path', segs, { ...chunk[i].st, fill: d.fill, stroke: null, fillOpacity: d.opacity, fillAlpha: undefined }, mm, o, cl, false);
          }
          i = j;
        }
        chunk = [];
      };
      for (const r of runs) {
        if (r.x !== undefined || r.y !== undefined) {
          flushV();
          if (r.x !== undefined) px = r.x;
          if (r.y !== undefined) py = r.y;
        }
        px += r.dx;
        py += r.dy;
        if (textAgain) charge(r.text.length);
        for (const ch of r.text) {
          const ol = outline(ch, r.st.fontFamily, r.st.fontWeight, r.st.fontSize, r.st.fontStyle, r.st.vertical ?? 'mixed');
          if (!ol) throw new Unsupported('text outline');
          chunk.push({ st: r.st, segs: ol.segs, x: px - (r.st.baselineShift ?? 0), y: py, adv: ol.advance, ...(r.rotate ? { rotate: r.rotate } : {}), ...(r.tl ? { tl: r.tl } : {}) });
          py += ol.advance + (r.st.letterSpacing ?? 0) + (ch === ' ' ? (r.st.wordSpacing ?? 0) : 0);
        }
      }
      flushV();
    };
    /** inline-size の折り返し: Run の並びを、行ごとに x・y を付けた Run の並びにする (行の頭と末尾の空白は落とす) */
    const wrapRuns = <R extends { text: string; st: Style; x?: number; y?: number; dx: number; dy: number; rotate?: number }>(runs: R[], width: number, outline: TextOutliner, lineHeight?: string): R[] => {
      const X = runs[0].x ?? 0;
      const Y = runs[0].y ?? 0;
      const chars: Array<{ ch: string; run: R; adv: number }> = [];
      for (const r of runs)
        for (const ch of r.text) {
          const ol = outline(ch, r.st.fontFamily, r.st.fontWeight, r.st.fontSize, r.st.fontStyle);
          if (!ol) throw new Unsupported('text outline');
          chars.push({ ch, run: r, adv: ol.advance + (r.st.letterSpacing ?? 0) + (ch === ' ' ? (r.st.wordSpacing ?? 0) : 0) });
        }
      const acts = lineBreakActions(chars.map((c) => c.ch.codePointAt(0)!), { cjk: true });
      const lines: Array<[number, number]> = [];
      let start = 0;
      let w = 0;
      let lastBreak = -1;
      for (let i = 0; i < chars.length; i++) {
        if (i > start && acts[i] === '!') {
          lines.push([start, i]);
          start = i;
          w = 0;
          lastBreak = -1;
        }
        if (i > start && acts[i] === '÷') lastBreak = i;
        w += chars[i].adv;
        // 幅を超えたら、最後の改行の機会で折る (空白は行の末尾にぶら下げるので、幅に数えない)
        if (w > width && chars[i].ch !== ' ' && lastBreak > start) {
          lines.push([start, lastBreak]);
          start = lastBreak;
          w = chars.slice(start, i + 1).reduce((a, c) => a + c.adv, 0);
          lastBreak = -1;
        }
      }
      lines.push([start, chars.length]);
      const fs = runs[0].st.fontSize;
      const lhRaw = (lineHeight ?? 'normal').trim();
      const lh = lhRaw === 'normal' ? fs * 1.2 : /^[\d.]+$/.test(lhRaw) ? parseFloat(lhRaw) * fs : /%$/.test(lhRaw) ? (parseFloat(lhRaw) / 100) * fs : userLen(lhRaw, fs) || fs * 1.2;
      const out: R[] = [];
      lines.forEach(([a, b], li) => {
        while (a < b && chars[a].ch === ' ') a++;
        while (b > a && chars[b - 1].ch === ' ') b--;
        let first = true;
        for (let i = a; i < b; i++) {
          const c = chars[i];
          const last = out[out.length - 1];
          if (!first && last && last.st === c.run.st && !c.run.rotate && !last.rotate) {
            last.text += c.ch;
            continue;
          }
          out.push({ ...c.run, text: c.ch, dx: 0, dy: 0, ...(first ? { x: X, y: Y + li * lh } : { x: undefined, y: undefined }) });
          first = false;
        }
      });
      return out.map((r) => {
        const { x, y, ...rest } = r;
        return { ...rest, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) } as R;
      });
    };
    /**
     * foreignObject (SVG 2 の embedded の章) の中身の HTML を、文字だけ近似して描く (HTML の組版はしない)。ブロックの要素 (div・p・li・h1〜h6 など。
     * display の指定も見る) と br で行を分け、枠の幅で折り返し (white-space: nowrap・pre なら折り返さない)、text-align で揃える。
     * 字の色 (color)・大きさ・太さ・斜体・書体は、SVG の <style> の規則と style 属性から読む (HTML の既定: h1〜h6 の大きさと太字、b・strong の太字、
     * i・em の斜体)。行の間は line-height (normal は字の大きさの 1.2 倍)。枠の外は切る (overflow の初期値。visible なら切らない)。
     * 背景・罫線・画像・表の組み方は描かない。中身が HTML でなければ (MathML など) 描けないもの
     */
    /** foreignObject の中身を組むための情報を渡す (ForeignContext) */
    const collectForeign = (n: XmlNode, s: Style, put: NonNullable<ParseSvgOptions['collectForeign']>) => {
      const idx = foreignIndex.get(n);
      const w = ulen(n.getAttribute?.('width') ?? '0', vp.w);
      const h = ulen(n.getAttribute?.('height') ?? '0', vp.h);
      if (idx === undefined || !(w > 0 && h > 0)) return;
      const ancestors: ForeignContext['ancestors'] = [];
      for (let e: XmlNode | undefined = n; e; e = parentOf.get(e)) {
        const id = e.getAttribute?.('id');
        const cls = e.getAttribute?.('class');
        const st = e.getAttribute?.('style');
        ancestors.unshift({ name: nm(e), ...(id ? { id } : {}), ...(cls ? { className: cls } : {}), ...(st ? { style: st } : {}) });
      }
      // 受け継ぐ書式 (SVG の計算した値。字の大きさは利用者の単位 = CSS px)。color の不透明度は rgba にする
      const decl: string[] = [`font-size:${s.fontSize}px`, `font-weight:${s.fontWeight}`, `font-style:${s.fontStyle ?? 'normal'}`];
      if (s.fontFamily) decl.push(`font-family:${s.fontFamily.replace(/[;{}<>]/g, '')}`);
      const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.color);
      if (rgb) decl.push(s.colorAlpha !== undefined && s.colorAlpha < 1 ? `color:rgba(${[1, 2, 3].map((k) => parseInt(rgb[k], 16)).join(',')},${s.colorAlpha})` : `color:${s.color}`);
      if (s.letterSpacing) decl.push(`letter-spacing:${s.letterSpacing}px`);
      if (s.wordSpacing) decl.push(`word-spacing:${s.wordSpacing}px`);
      if (s.hidden) decl.push('visibility:hidden');
      put(idx, { content: serializeChildren(n), width: w, height: h, css: cssText, ancestors, inherited: decl.join(';') });
    };
    const foreignText = (n: XmlNode, s: Style, mm: M, o: number, cl: SvgClip[], depth: number) => {
      const XHTML = 'http://www.w3.org/1999/xhtml';
      const fa = (k: string, d: string) => n.getAttribute?.(k) ?? d;
      const fx = ulen(fa('x', '0'), vp.w);
      const fy = ulen(fa('y', '0'), vp.h);
      const fw = ulen(fa('width', '0'), vp.w);
      const fh = ulen(fa('height', '0'), vp.h);
      if (!(fw > 0 && fh > 0)) return;
      const ov = props(n).overflow;
      const cl2 = ov === 'visible' || ov === 'auto' ? cl : [...cl, { segs: transformSegs([{ op: 'M', x: fx, y: fy }, { op: 'L', x: fx + fw, y: fy }, { op: 'L', x: fx + fw, y: fy + fh }, { op: 'L', x: fx, y: fy + fh }, { op: 'Z' }], mm), evenOdd: false }];
      // 呼ぶ側が中身を本文と同じ組版で組んだもの (HTML の背景・罫線・画像・表、MathML も) があれば、それを foreignObject の位置に置く
      const idx = foreignIndex.get(n);
      const pre = idx !== undefined ? opts.foreignShapes?.(idx) : undefined;
      if (pre) {
        const t = mul(mm, [1, 0, 0, 1, fx, fy]);
        const memo = new Map<SvgClip, SvgClip>();
        for (const sh of pre) {
          const x = transformShape(sh, t, o, memo);
          target.push(cl2.length ? { ...x, clips: [...cl2, ...(x.clips ?? [])] } : x);
        }
        return;
      }
      const kids = Array.from(n.childNodes).filter((c) => c.nodeType === 1);
      const isHtml = (c: XmlNode) => (c as { namespaceURI?: string | null }).namespaceURI === XHTML || /^(html:|xhtml:)/i.test(c.nodeName);
      if (kids.some((c) => !isHtml(c))) throw new Unsupported('foreignobject');
      const BLOCK = /^(address|article|aside|blockquote|center|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|td|th|ul|body|html)$/;
      const HEADING: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
      type Block = { runs: Array<{ text: string; st: Style; dx: number; dy: number; x?: number; y?: number }>; align: string; nowrap: boolean; lh?: string };
      const blocks: Block[] = [];
      let cur: Block | undefined;
      const open = (align: string, nowrap: boolean, lh?: string) => {
        if (!cur || cur.runs.length) blocks.push((cur = { runs: [], align, nowrap, ...(lh ? { lh } : {}) }));
        else Object.assign(cur, { align, nowrap, ...(lh ? { lh } : {}) });
      };
      type Ctx = { st: Style; align: string; nowrap: boolean; lh?: string };
      // HTML の要素の書式: color は字の塗り。h1〜h6・b・strong・i・em の既定
      const styleOf = (el: XmlNode, ctx: Ctx): Ctx => {
        const tag = nm(el);
        const p = props(el);
        const q: Record<string, string> = {};
        if (HEADING[tag]) Object.assign(q, { 'font-size': `${HEADING[tag]}em`, 'font-weight': 'bold' });
        if (tag === 'b' || tag === 'strong' || tag === 'th') q['font-weight'] = 'bold';
        if (tag === 'i' || tag === 'em') q['font-style'] = 'italic';
        for (const k of ['font-size', 'font-weight', 'font-style', 'font-family', 'letter-spacing', 'word-spacing', 'text-decoration']) if (p[k] !== undefined) q[k] = p[k];
        if (p.color !== undefined) q.fill = p.color;
        if (p.opacity !== undefined) q.opacity = p.opacity;
        const st = inherit(ctx.st, q);
        st.opacity = 1;
        const ws = p['white-space'];
        return {
          st,
          align: p['text-align'] ?? (tag === 'center' ? 'center' : ctx.align),
          nowrap: ws !== undefined ? /^(nowrap|pre)$/.test(ws.trim()) : ctx.nowrap,
          lh: p['line-height'] ?? ctx.lh,
        };
      };
      const visit2 = (el: XmlNode, ctx: Ctx) => {
        for (const c of Array.from(el.childNodes)) {
          if (c.nodeType === 3 || c.nodeType === 4) {
            const t = (c.textContent ?? '').replace(/\s+/g, ' ');
            if (!t.trim() && !cur?.runs.length) continue;
            if (!cur) open(ctx.align, ctx.nowrap, ctx.lh);
            cur!.runs.push({ text: t, st: ctx.st, dx: 0, dy: 0 });
            continue;
          }
          if (c.nodeType !== 1) continue;
          const tag = nm(c);
          const p = props(c);
          if (p.display === 'none' || /^(script|style|head|title)$/.test(tag)) continue;
          if (tag === 'br') {
            cur = undefined;
            continue;
          }
          const ctx2 = styleOf(c, ctx);
          const block = p.display ? !/^inline/.test(p.display.trim()) : BLOCK.test(tag);
          if (block) {
            cur = undefined;
            open(ctx2.align, ctx2.nowrap, ctx2.lh);
            visit2(c, ctx2);
            cur = undefined;
          } else visit2(c, ctx2);
        }
      };
      // foreignObject の中の HTML は、SVG の書式 (font-size・font-family・color など) を受け継ぐ。字の色は color
      const base: Ctx = { st: { ...s, fill: s.color, stroke: null, opacity: 1 }, align: 'start', nowrap: false };
      visit2(n, base);
      let top = fy;
      for (const b of blocks) {
        // 行の頭と末尾の空白を落とす
        const runs = b.runs.map((r) => ({ ...r }));
        if (!runs.length) continue;
        runs[0].text = runs[0].text.replace(/^ +/, '');
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, '');
        const live = runs.filter((r) => r.text);
        if (!live.length || !textOutline) continue;
        const fs = Math.max(...live.map((r) => r.st.fontSize));
        const lhRaw = (b.lh ?? 'normal').trim();
        const lh = lhRaw === 'normal' ? fs * 1.2 : /^[\d.]+$/.test(lhRaw) ? parseFloat(lhRaw) * fs : /%$/.test(lhRaw) ? (parseFloat(lhRaw) / 100) * fs : userLen(lhRaw, fs) || fs * 1.2;
        const align = b.align === 'center' ? 'middle' : b.align === 'right' || b.align === 'end' ? 'end' : 'start';
        const ax = align === 'middle' ? fx + fw / 2 : align === 'end' ? fx + fw : fx;
        // 最初の行の基線: 行の高さの中で、字の枠 (上 0.8・下 0.2) を真ん中に置く
        live[0].x = ax;
        live[0].y = top + (lh - fs) / 2 + fs * 0.8;
        const lines = b.nowrap ? live : wrapRuns(live, fw, textOutline, `${lh}px`);
        // 行ごとに、仮の text 要素を作って描く (字の書式は style 属性に書く: <style> の text・tspan の規則に負けない)
        let group: typeof lines = [];
        const emit = () => {
          if (!group.length) return;
          const tspans = group.map((r) => {
            const css = [`fill:${typeof r.st.fill === 'string' ? r.st.fill : 'none'}`, `font-size:${r.st.fontSize}px`, `font-weight:${r.st.fontWeight}`, `font-style:${r.st.fontStyle ?? 'normal'}`, ...(r.st.fontFamily ? [`font-family:${r.st.fontFamily.replace(/;/g, '')}`] : [])].join(';');
            const t: XmlNode = { nodeType: 3, nodeName: '#text', childNodes: [], textContent: r.text };
            return { nodeType: 1, nodeName: 'tspan', localName: 'tspan', childNodes: [t], getAttribute: (k: string) => (k === 'style' ? css : null) } as XmlNode;
          });
          const g0 = group[0];
          const attrs: Record<string, string> = { x: String(g0.x ?? ax), y: String(g0.y ?? 0), 'text-anchor': align, 'xml:space': 'preserve' };
          const fake = { nodeType: 1, nodeName: 'text', localName: 'text', childNodes: tspans, getAttribute: (k: string) => attrs[k] ?? null } as XmlNode;
          walk(fake, { ...s, fill: s.color, stroke: null, opacity: 1, decorations: undefined }, mm, o, false, cl2, depth + 1);
          group = [];
        };
        let count = 0;
        for (const r of lines) {
          if (r.y !== undefined) {
            emit();
            count++;
          }
          group.push(r);
        }
        emit();
        top += Math.max(1, count) * lh;
      }
    };
    const textShapes = (n: XmlNode, s: Style, mm: M, o: number, cl: SvgClip[]) => {
      const saved = textAgain;
      textAgain = textSeen.has(n);
      textSeen.add(n);
      try {
        textShapes0(n, s, mm, o, cl);
      } finally {
        textAgain = saved;
      }
    };
    const textShapes0 = (n: XmlNode, s: Style, mm: M, o: number, cl: SvgClip[]) => {
      const outline = textOutline;
      if (!outline) throw new Unsupported('text');
      // 長さの並び (em・ex はその要素の字の大きさに対して。Visio の dy="1.2em" など)。読めない値は NaN (指定の無いもの)
      const list = (v: string | null | undefined, fs: number): number[] =>
        (v?.trim() ? v.trim().split(/[\s,]+/) : []).map((t) => {
          const m = /^(-?[\d.]+(?:e-?\d+)?)(em|ex)$/i.exec(t);
          if (m) return parseFloat(m[1]) * fs * (m[2].toLowerCase() === 'ex' ? 0.5 : 1);
          return /[a-z%]$/i.test(t) ? ulen(t, 0) : parseFloat(t);
        });
      interface Run {
        text: string;
        st: Style;
        x?: number;
        y?: number;
        dx: number;
        dy: number;
        /** 字の回転 (度。時計回り)。回す字は 1 字の Run */
        rotate?: number;
        /** この字を含む、textLength の付いた tspan (いちばん内側のもの) */
        tl?: TextLengthSpec;
      }
      /** tspan の textLength・lengthAdjust (SVG 1.1 §10.5) */
      type TextLengthSpec = { length: number; glyphs: boolean };
      const runs: Run[] = [];
      /** パスに沿う文字 (textPath) */
      const onPath: Array<{ el: XmlNode; st: Style }> = [];
      // 字を 1 字ずつ集め、x・y・dx・dy・rotate の並びを当てる (SVG 1.1 §10.5): 要素の並びの i 番目の値は、その要素の中の i 番目の字に当たる。
      // 子の tspan に同じ属性があれば、その中の字は子の値 (無い番号は先祖の値)。dx・dy は並びの外の字をずらさず、rotate は最後の値が後の字にも続く
      type Key = 'x' | 'y' | 'dx' | 'dy' | 'rotate';
      const KEYS: Key[] = ['x', 'y', 'dx', 'dy', 'rotate'];
      const cs: Array<{ ch: string; st: Style; tl?: TextLengthSpec }> = [];
      /** 要素ごとの字の範囲 (cs の番号) と並び。先祖から順 (後のものほど内側) */
      const ranges: Array<{ start: number; end: number; lists: Partial<Record<Key, number[]>> }> = [];
      const collect = (el: XmlNode, st: Style, tl?: TextLengthSpec) => {
        const lists: Partial<Record<Key, number[]>> = {};
        for (const k of KEYS) {
          const v = list(el.getAttribute?.(k), st.fontSize);
          if (v.length) lists[k] = v;
        }
        const range = { start: cs.length, end: cs.length, lists };
        if (Object.keys(lists).length) ranges.push(range);
        for (const c of Array.from(el.childNodes)) {
          if (c.nodeType === 3 || c.nodeType === 4) {
            for (const ch of spaced(c.textContent ?? '', st)) cs.push({ ch, st, ...(tl ? { tl } : {}) });
          } else if (c.nodeType === 1) {
            const name = nm(c);
            if (name === 'textpath') {
              const p = props(c);
              if (p.display !== 'none') onPath.push({ el: c, st: inherit(st, p) });
              continue;
            }
            if (name !== 'tspan') {
              if (IGNORED.has(name) || foreign(c)) continue;
              throw new Unsupported(name);
            }
            const p = props(c);
            if (p.display === 'none') continue;
            // tspan の transform は使わない (tspan は変換できる要素 (CSS Transforms 1 の用語の transformable element) でない。ブラウザも使わない)
            // tspan の textLength: その中の字を、この長さにそろえる (text 要素のものは、塊の全体に flush で当てる)
            const len = parseFloat(c.getAttribute?.('textLength') ?? '');
            const tl2 = Number.isFinite(len) && len > 0 ? { length: len, glyphs: c.getAttribute?.('lengthAdjust') === 'spacingAndGlyphs' } : tl;
            collect(c, inherit(st, p), tl2);
          }
        }
        range.end = cs.length;
      };
      // baseline-shift は text の中の要素 (tspan・textPath) のもの。text の外から受け継いだ分は使わない
      collect(n, { ...s, baselineShift: 0 });
      for (const tp of onPath) textOnPath(tp.el, tp.st, mm, o, cl);
      // 先頭・末尾の空白は落とす (xml:space="default")。落とした字は数えない (並びの番号を詰める)
      let lo = 0;
      let hi = cs.length;
      if (hi && !cs[0].st.preserveSpace && cs[0].ch === ' ') lo = 1;
      if (hi > lo && !cs[hi - 1].st.preserveSpace && cs[hi - 1].ch === ' ') hi--;
      const at: Array<Partial<Record<Key, number>>> = Array.from({ length: hi - lo }, () => ({}));
      for (const r of ranges) {
        const s0 = Math.max(r.start, lo);
        const e0 = Math.min(r.end, hi);
        for (const k of KEYS) {
          const v = r.lists[k];
          if (!v) continue;
          for (let i = s0; i < e0; i++) {
            const j = i - s0;
            const val = j < v.length ? v[j] : k === 'rotate' ? v[v.length - 1] : NaN;
            if (Number.isFinite(val)) at[i - lo][k] = val;
          }
        }
      }
      // 続く字を Run にまとめる (位置の指定のある字・回す字で分ける)
      for (let i = lo; i < hi; i++) {
        const c = cs[i];
        const p = at[i - lo];
        const rot = p.rotate ?? 0;
        const last = runs[runs.length - 1];
        const fresh = p.x !== undefined || p.y !== undefined || p.dx !== undefined || p.dy !== undefined || rot !== 0;
        if (last && !fresh && last.st === c.st && !last.rotate && last.tl === c.tl) {
          last.text += c.ch;
          continue;
        }
        runs.push({ text: c.ch, st: c.st, ...(p.x !== undefined ? { x: p.x } : {}), ...(p.y !== undefined ? { y: p.y } : {}), dx: p.dx ?? 0, dy: p.dy ?? 0, ...(rot ? { rotate: rot } : {}), ...(c.tl ? { tl: c.tl } : {}) });
      }
      if (!runs.length) return;
      // inline-size (SVG 2 の text の章の自動の折り返し): 横書きの text を、この幅の中で行に折り返す。改行できる位置は UAX #14
      // (lineBreak.ts)。行は x から始め (text-anchor の揃えは行ごと)、行の間は line-height (normal は字の大きさの 1.2 倍)
      const inlineSize = s.vertical ? NaN : userLen(props(n)['inline-size'] ?? '', vp.w);
      if (Number.isFinite(inlineSize) && inlineSize > 0) {
        const wrapped = wrapRuns(runs, inlineSize, outline, props(n)['line-height']);
        runs.length = 0;
        runs.push(...wrapped);
        if (!runs.length) return;
      }
      // 字の形の高さ (字の座標の上端・下端。y は下向き)。書体ごとに 1 度だけ測る
      const measured = new Map<string, { top: number; bottom: number } | undefined>();
      const measure = (ch: string, st: Style) => {
        const key = `${ch}\0${st.fontFamily ?? ''}\0${st.fontWeight}\0${st.fontStyle ?? ''}`;
        if (measured.has(key)) return measured.get(key);
        const ol = outline(ch, st.fontFamily, st.fontWeight, 1000, st.fontStyle);
        let top = Infinity;
        let bottom = -Infinity;
        for (const g of ol?.segs ?? []) {
          if (g.op === 'Z') continue;
          for (const y of g.op === 'C' ? [g.y1, g.y2, g.y] : [g.y]) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
        const r = top < bottom ? { top: top / 1000, bottom: bottom / 1000 } : undefined;
        measured.set(key, r);
        return r;
      };
      /**
       * dominant-baseline・alignment-baseline (CSS Inline 3 §4.1・§4.2.2) の基線を、字の y に合わせるために、字を下へずらす量。
       * 書体の基線の表は読まないので、CSS Inline 3 の付録 A.2 のとおりに作る: central は上の高さと下の深さ (ascent・descent) の中ほど、
       * text-top・text-bottom は上の高さ・下の深さ、ideographic は下の深さ、middle は x の高さ (「o」の上端から下へのはみ出しを引いた高さ。
       * 測れなければ 0.5em) の半分、mathematical は負の記号 (U+2212) の中ほど、hanging は 0.6em (付録 A.2 の既定)
       */
      const baselineOffset = (st: Style, ol: { ascent?: number; descent?: number }) => {
        const b = st.alignmentBaseline ?? st.dominantBaseline ?? 'auto';
        if (b === 'auto' || b === 'alphabetic' || b === 'baseline') return 0;
        const fs = st.fontSize;
        const asc = ol.ascent ?? 0.8;
        const desc = ol.descent ?? 0.2;
        const xHeight = () => {
          const m = measure('o', st);
          return m ? -m.top - Math.max(m.bottom, 0) : 0.5;
        };
        switch (b) {
          case 'text-top':
          case 'text-before-edge':
          case 'before-edge':
            return asc * fs;
          case 'text-bottom':
          case 'text-after-edge':
          case 'after-edge':
          case 'ideographic':
            return -desc * fs;
          case 'central':
            return ((asc - desc) / 2) * fs;
          case 'middle':
            return (xHeight() / 2) * fs;
          case 'mathematical': {
            const m = measure('\u2212', st);
            return (m ? -(m.top + m.bottom) / 2 : xHeight() / 2) * fs;
          }
          case 'hanging':
            return 0.6 * fs;
          default:
            return 0;
        }
      };
      // 塊 (x / y の指定で始まる) ごとに置く
      let px = runs[0].x ?? 0;
      let py = runs[0].y ?? 0;
      let chunk: Array<{ run: Run; segs: Seg[]; at: number; y: number; adv: number; chars?: TextChars; sx?: number }> = [];
      // textLength・lengthAdjust (SVG 1.1 §10.5): 文字列の長さを textLength にそろえる。spacingAndGlyphs は字ごと横に伸び縮みさせ、
      // spacing は字の間を空ける (詰める)。text-decoration (underline・overline・line-through) は字の色の線を引く
      const textLength = parseFloat(n.getAttribute?.('textLength') ?? '');
      const lengthAdjust = n.getAttribute?.('lengthAdjust') === 'spacingAndGlyphs' ? 'glyphs' : 'spacing';
      // data-kendot (Kumiori の拡張。CGM の TEXT SCORE TYPE の kendot): 字ごとに、字の下に点を打つ
      // data-kendot="over" は字の上に打つ (CGM の left の path では、右側が字の上になる)
      const kendotAttr = n.getAttribute?.('data-kendot');
      const kendot = kendotAttr === 'true' || kendotAttr === 'over';
      // data-fit="uniform" (Kumiori の拡張。CGM の RESTRICTED TEXT の isotropic): data-max-length を超えるとき、縦横同じ比で縮める
      const uniform = n.getAttribute?.('data-fit') === 'uniform';
      // letter-spacing (SVG 1.1 §10.11) は字ごとに字の後に、word-spacing (CSS Text 3 §8.2) は語を分ける空白 (U+0020) の後に足す。
      // どちらも字の書式 (Style。tspan で変えられる) のもの
      const spaced0 = runs.some((r) => r.st.letterSpacing || r.st.wordSpacing);
      const flush = () => {
        if (!chunk.length) return;
        const anchor = chunk[0].run.st.textAnchor;
        const last = chunk[chunk.length - 1];
        let width = last.at + last.adv - chunk[0].at;
        // 字の間を空ける (textLength の spacing・letter-spacing): 字ごとに輪郭を作り直して、間に足す
        const spread = Number.isFinite(textLength) && textLength > 0 && lengthAdjust === 'spacing';
        const hasTl = chunk.some((c) => c.run.tl);
        if (spread || spaced0 || hasTl) {
          const glyphs: typeof chunk = [];
          let extra = 0;
          for (const c of chunk) {
            let at = c.at + extra;
            for (const ch of [...c.run.text]) {
              const ol = outline(ch, c.run.st.fontFamily, c.run.st.fontWeight, c.run.st.fontSize, c.run.st.fontStyle);
              if (!ol) continue;
              glyphs.push({ run: c.run, segs: ol.segs, at, y: c.y, adv: ol.advance, ...(ol.chars ? { chars: ol.chars } : {}) });
              const gap = (c.run.st.letterSpacing ?? 0) + (ch === ' ' ? (c.run.st.wordSpacing ?? 0) : 0);
              at += ol.advance + gap;
              extra += gap;
            }
          }
          // tspan の textLength: その tspan の字の範囲ごとに、字の間を空ける (spacing) か、字を横に伸び縮みさせる (spacingAndGlyphs)。
          // 後ろの字は、範囲の長さの変わった分だけずらす
          let moved = 0;
          for (let i = 0; i < glyphs.length; ) {
            const tl = glyphs[i].run.tl;
            let j = i + 1;
            while (j < glyphs.length && glyphs[j].run.tl === tl) j++;
            for (let q = i; q < j; q++) glyphs[q].at += moved;
            if (tl) {
              const a0 = glyphs[i].at;
              const w0 = glyphs[j - 1].at + glyphs[j - 1].adv - a0;
              if (w0 > 0) {
                if (tl.glyphs) {
                  const f = tl.length / w0;
                  for (let q = i; q < j; q++) {
                    glyphs[q].at = a0 + (glyphs[q].at - a0) * f;
                    glyphs[q].sx = f;
                    glyphs[q].adv *= f;
                  }
                } else if (j - i > 1) {
                  const gap = (tl.length - w0) / (j - i - 1);
                  for (let q = i; q < j; q++) glyphs[q].at += gap * (q - i);
                }
                moved += tl.length - w0;
              }
            }
            i = j;
          }
          if (glyphs.length) {
            chunk = glyphs;
            const lastG = glyphs[glyphs.length - 1];
            width = lastG.at + lastG.adv - glyphs[0].at;
          }
          if (spread && glyphs.length > 1) {
            const gap = (textLength - width) / (glyphs.length - 1);
            glyphs.forEach((g, i) => (g.at += gap * i));
            width = textLength;
          }
        }
        // data-max-length (Kumiori の拡張。CGM の RESTRICTED TEXT): 文字列がこの長さを超えるときだけ、横に縮めて収める
        const max = parseFloat(n.getAttribute?.('data-max-length') ?? '');
        let k = Number.isFinite(max) && max > 0 && width > max ? max / width : 1;
        if (Number.isFinite(textLength) && textLength > 0 && lengthAdjust === 'glyphs' && width > 0) k = textLength / width;
        const ky = uniform ? k : 1;
        width *= k;
        const shift = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
        const x0 = chunk[0].at;
        const placed: Array<{ x: number; adv: number; y: number; fs: number; deco?: Style['decorations'] }> = [];
        for (const c of chunk) {
          // rotate (SVG 1.1 §10.5): 字をその原点の周りに回す (時計回り)
          const rad = ((c.run.rotate ?? 0) * Math.PI) / 180;
          const [co, si] = [Math.cos(rad), Math.sin(rad)];
          const kx = k * (c.sx ?? 1);
          const t: M = c.run.rotate ? [kx * co, kx * si, -ky * si, ky * co, x0 + (c.at - x0) * k + shift, c.y] : [kx, 0, 0, ky, x0 + (c.at - x0) * k + shift, c.y];
          pushShape('text', transformSegs(c.segs, t), c.run.st, mm, o, cl, false, { chars: c.chars, size: c.run.st.fontSize, t });
          placed.push({ x: t[4], adv: c.adv * k, y: c.y, fs: c.run.st.fontSize * ky, deco: c.run.st.decorations });
        }
        // 線と点 (字の色。太さは字の大きさの 0.06。位置は基線から下 0.12・上 0.85・0.3 の高さ)
        const st0 = chunk[0].run.st;
        const rect = (x: number, y: number, w: number, h: number): Seg[] => [
          { op: 'M', x, y },
          { op: 'L', x: x + w, y },
          { op: 'L', x: x + w, y: y + h },
          { op: 'L', x, y: y + h },
          { op: 'Z' },
        ];
        const fsMax = Math.max(...placed.map((p) => p.fs));
        const th = fsMax * 0.06;
        const lineSegs: Seg[] = [];
        const yb = placed[0].y;
        // 線: 同じ指定の続く字の範囲ごとに、指定した要素の塗りで引く (字の色と同じなら、点と一緒の図形にする)
        const others: Array<{ segs: Seg[]; fill: string | null | PaintRef; opacity: number }> = [];
        for (let i = 0; i < placed.length; ) {
          const ds = placed[i].deco;
          let j = i + 1;
          while (j < placed.length && placed[j].deco === ds) j++;
          for (const d of ds ?? []) {
            const xa = placed[i].x;
            const xb = placed[j - 1].x + placed[j - 1].adv;
            const segs: Seg[] = [];
            if (d.under) segs.push(...rect(xa, yb + fsMax * 0.12, xb - xa, th));
            if (d.over) segs.push(...rect(xa, yb - fsMax * 0.85 - th, xb - xa, th));
            if (d.through) segs.push(...rect(xa, yb - fsMax * 0.3 - th / 2, xb - xa, th));
            if (d.fill === st0.fill && d.opacity === 1) lineSegs.push(...segs);
            else others.push({ segs, fill: d.fill, opacity: d.opacity });
          }
          i = j;
        }
        for (const x of others) pushShape('path', x.segs, { ...st0, fill: x.fill, stroke: null, fillOpacity: x.opacity, fillAlpha: undefined }, mm, o, cl, false);
        if (kendot)
          for (const c of chunk) {
            const n0 = [...c.run.text].length || 1;
            const step = (c.adv * k) / n0;
            const base = x0 + (c.at - x0) * k + shift;
            for (let i = 0; i < n0; i++) {
              const cx = base + step * (i + 0.5);
              const r = fsMax * 0.08;
              const cy = kendotAttr === 'over' ? yb - fsMax * 1.0 : yb + fsMax * 0.3;
              lineSegs.push(...Array.from({ length: 12 }, (_, j): Seg => ({ op: j ? 'L' : 'M', x: cx + r * Math.cos((j * Math.PI) / 6), y: cy + r * Math.sin((j * Math.PI) / 6) })), { op: 'Z' });
            }
          }
        if (lineSegs.length) pushShape("path", transformSegs(lineSegs, ID), { ...st0, stroke: null }, mm, o, cl, false);
        chunk = [];
      };
      if (s.vertical) {
        const tlen = parseFloat(n.getAttribute?.('textLength') ?? '');
        verticalText(runs, outline, mm, o, cl, Number.isFinite(tlen) && tlen > 0 ? { length: tlen, glyphs: n.getAttribute?.('lengthAdjust') === 'spacingAndGlyphs' } : undefined);
        return;
      }
      for (const r of runs) {
        if (r.x !== undefined || r.y !== undefined) {
          flush();
          if (r.x !== undefined) px = r.x;
          if (r.y !== undefined) py = r.y;
        }
        px += r.dx;
        py += r.dy;
        if (!r.text) continue;
        if (textAgain) charge(r.text.length);
        const ol = outline(r.text, r.st.fontFamily, r.st.fontWeight, r.st.fontSize, r.st.fontStyle);
        if (!ol) throw new Unsupported('text outline');
        chunk.push({ run: r, segs: ol.segs, at: px, y: py + (r.st.baselineShift ?? 0) + baselineOffset(r.st, ol), adv: ol.advance, ...(ol.chars ? { chars: ol.chars } : {}) });
        px += ol.advance;
      }
      flush();
    };

    walk(root, ROOT_STYLE, ID, 1, true);
    chargeClipRuns(shapes);
    const par = (root.getAttribute?.('preserveAspectRatio') ?? '').trim().split(/\s+/).filter(Boolean);
    const aspect = { align: par[0] ?? 'xMidYMid', slice: par[1] === 'slice' };
    const rov = (props(root).overflow ?? '').trim();
    const noClip = !!opts.rootOverflowVisible && (rov === 'visible' || rov === 'auto');
    return { viewBox, shapes, aspect, ...(noClip ? { noClip: true } : {}) };
  } catch (e) {
    opts.onUnsupported?.(e instanceof Unsupported ? e.message : 'parse');
    return null;
  }
}

/**
 * 図形を変換 m で写す (形・切り抜き・画像・グラデーション・模様・グループの中身・字の行列。線の太さと破線は拡大率を掛ける)。
 * opacity は、塗り・線の不透明度に掛ける (foreignObject の祖先の opacity)。
 * clipMemo: 写した切り抜き (元の切り抜き → 写したもの)。同じ m で図形の並びを写すときに、並びで共有すると、同じ切り抜きは同じ 1 つに
 * 写る (描く側が、続く図形の切り抜きを 1 度だけ書けるように。clipRuns の説明)
 */
export function transformShape(sh: SvgShape, m: Matrix, opacity = 1, clipMemo = new Map<SvgClip, SvgClip>()): SvgShape {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const out: SvgShape = {
    ...sh,
    segs: transformSegs(sh.segs, m),
    strokeWidth: sh.nonScalingStroke ? sh.strokeWidth : sh.strokeWidth * k,
    fillOpacity: sh.fillOpacity * opacity,
    strokeOpacity: sh.strokeOpacity * opacity,
  };
  if (sh.dash && !sh.nonScalingStroke) out.dash = sh.dash.map((d) => d * k);
  if (sh.clips)
    out.clips = sh.clips.map((c) => {
      let t = clipMemo.get(c);
      if (!t) clipMemo.set(c, (t = { ...c, segs: transformSegs(c.segs, m) }));
      return t;
    });
  if (sh.masks) out.masks = sh.masks.map((mk) => ({ ...mk, shapes: mk.shapes.map((x) => transformShape(x, m, 1, clipMemo)) }));
  if (sh.image) out.image = { ...sh.image, matrix: mul(m, sh.image.matrix) };
  if (sh.fillPaint) out.fillPaint = { ...sh.fillPaint, matrix: mul(m, sh.fillPaint.matrix) };
  if (sh.strokePaint) out.strokePaint = { ...sh.strokePaint, matrix: mul(m, sh.strokePaint.matrix) };
  if (sh.fillPattern) out.fillPattern = { ...sh.fillPattern, matrix: mul(m, sh.fillPattern.matrix) };
  if (sh.group) out.group = { shapes: sh.group.shapes.map((x) => transformShape(x, m, 1, clipMemo)) };
  if (sh.text) out.text = { ...sh.text, matrix: mul(m, sh.text.matrix) };
  return out;
}

/** 文書のすべての要素 (font 要素などを探すため) */
function allElements(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    out.push(n);
    for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) walk(c);
  };
  walk(root);
  return out;
}

/** systemLanguage の値 sl が、利用者の言語 (小文字にしたもの) に合うか (parseSvg の conditionsHold の説明) */
function systemLanguageHolds(sl: string, userLangs: readonly string[]): boolean {
  const tags = sl.split(/[\s,]+/).filter(Boolean).map((t) => t.toLowerCase());
  return tags.some((t) => userLangs.some((u) => u === t || u.startsWith(`${t}-`)));
}

/**
 * SVG の字の中の systemLanguage の値ごとに、利用者の言語 languages (parseSvg の opts.languages と同じ。省けば実行環境の言語) で
 * 満たすかを並べた鍵。鍵の同じ言語は、parseSvg の結果が同じ (照らし方の結果が同じ) なので、組んだものを使い回せる
 * (30 種の言語の所に置いた SVG を 30 回組み直し、画素のフィルタも 30 回計算して 74 秒かかった)。
 * 値に文字の参照 (&…;) があるなど、字の上で値を読めないときは undefined (使い回さない)
 */
export function systemLanguageKey(text: string, languages?: readonly string[]): string | undefined {
  const userLangs = (languages ?? environmentLanguages()).map((l) => l.toLowerCase());
  let key = '';
  for (const m of text.matchAll(/\ssystemLanguage\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const v = m[1] ?? m[2] ?? '';
    if (v.includes('&')) return undefined;
    key += systemLanguageHolds(v, userLangs) ? '1' : '0';
  }
  return key;
}

/** 実行環境の言語 (ブラウザは navigator.languages、ほかは Intl の既定の言語)。分からなければ空 */
function environmentLanguages(): string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages?.length) return [...nav.languages];
  if (nav?.language) return [nav.language];
  try {
    return [new Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

/** 埋め込んだ PNG・JPEG の画素の大きさ (PNG は IHDR、JPEG は SOFn の印から読む)。読めなければ undefined */
function imagePixelSize(b: Uint8Array, kind: 'png' | 'jpeg'): { w: number; h: number } | undefined {
  if (kind === 'png') {
    if (b.length < 24) return undefined;
    const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
    const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
    return w > 0 && h > 0 ? { w, h } : undefined;
  }
  // JPEG: 印 (FF xx) をたどり、SOF0〜SOF15 (C4・C8・CC を除く) の高さ・幅を読む
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (b[i + 5] << 8) | b[i + 6];
      const w = (b[i + 7] << 8) | b[i + 8];
      return w > 0 && h > 0 ? { w, h } : undefined;
    }
    i += 2 + len;
  }
  return undefined;
}

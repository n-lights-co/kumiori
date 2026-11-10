/**
 * svg — SVG を「PDF のベクタ命令に落とせる図形リスト」に変換する。
 *
 * 対応: svg / g / path / rect / circle / ellipse / line / polyline / polygon
 *       fill・stroke・stroke-width・opacity・fill-opacity・stroke-opacity・fill-rule・stroke-linecap/linejoin/dasharray/dashoffset/miterlimit・
 *       transform・style 属性・display:none (サブツリーごと無視)・viewBox
 *       線形・円形グラデーション (塗り・線。gradientUnits・gradientTransform・href の継承・spreadMethod・fr)・clipPath (userSpaceOnUse)・use / symbol・
 *       pattern (中身は単色)・mask (ソフトマスク)・text (字形の輪郭。letter-spacing・textLength・lengthAdjust・text-decoration)・textPath・marker・
 *       style 要素 (単純な選択子)・入れ子の svg・switch
 *       Kumiori の拡張 (CGM の字のため): data-max-length・data-fit・data-kendot (text)、data-rotate・data-extend (textPath)
 *       image (href が data: の PNG・JPEG で、preserveAspectRatio が none のもの)
 *       mix-blend-mode (multiply・screen・difference。図形・画像の要素のもの。PDF の BM。g のもの・ほかの値は無視して描く)
 * 非対応 (null を返す = 呼び出し側でラスタライズに切り替える。Node では仮の枠):
 *   filter (Node では影とぼかしを近似)・それ以外の image・扱えない CSS 選択子
 *
 * 変換は座標に焼き込む (transform を適用済みの 点列) ので、描画側は cm のネストを持たなくてよい。
 */
import { parseColor } from './color';
import { IDENTITY as ID, invert, mul, transformSegs, type Matrix, type Seg } from './matrix';

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
}

/** 模様 (pattern)。PDF のタイリングパターンになる */
export interface SvgPattern {
  /** 1 枚のタイルの大きさ (タイルの座標) */
  width: number;
  height: number;
  /** タイルの座標 → SVG のルートの座標 */
  matrix: [number, number, number, number, number, number];
  /** タイルの中身 (タイルの座標。単色の塗り・線だけ) */
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
   * 画像 (image 要素。href が data: の PNG・JPEG で、preserveAspectRatio が none のもの)。
   * matrix は、PDF の画像の単位正方形 (左下が原点、上の辺が画像の 1 行目) → SVG のルートの座標
   */
  image?: { kind: 'png' | 'jpeg'; bytes: Uint8Array; matrix: [number, number, number, number, number, number] };
  /** 描画モード (mix-blend-mode。PDF の ExtGState の BM: Multiply・Screen・Difference) */
  blend?: 'multiply' | 'screen' | 'difference';
  /**
   * 文字 (text 要素の字)。segs はその字の形。PDF に書くときは、塗りだけの単色の字なら、segs の代わりに書体の文字として描く
   * (ビューアの字の描き方 (ヒンティング) が本文と同じになり、文字として選べる)。
   * matrix は字の座標 (基線の上の原点、x 右向き、y 下向き、単位はユーザー単位) → SVG のルートの座標。size は字の大きさ
   */
  text?: { chars: TextChars; size: number; matrix: [number, number, number, number, number, number] };
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
    if (t1 - t0 > 2000) return;
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
    if (t1 - t0 > 2000) return;
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

function parseTransform(s: string | null | undefined): M | null {
  let m = ID;
  if (!s) return m;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  let any = false;
  while ((t = re.exec(s))) {
    any = true;
    const v = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.some((x) => !Number.isFinite(x))) return null;
    let c: M;
    switch (t[1]) {
      case 'matrix':
        if (v.length !== 6) return null;
        c = v as M;
        break;
      case 'translate':
        c = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        c = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r: M = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        c = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r;
        break;
      }
      case 'skewX':
        c = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        c = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    m = mul(m, c);
  }
  return any || !s.trim() ? m : null;
}

// ───────────── パス ─────────────

/** SVG の d 属性 → 絶対座標の M/L/C/Z。構文エラーは null */
export function parsePathData(d: string): Seg[] | null {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
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
}

const ROOT_STYLE: Style = { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1, evenOdd: false, lineCap: 0, lineJoin: 0, fontSize: 16, fontWeight: 400, textAnchor: 'start' };

/** 文字の輪郭 (text を図形にするため)。原点は基線の始点、y は下向き。描けない文字があれば null */
/** 字の並び (PDF の文字として描くため): 字・書体 (読み込んだ書体の鍵)・字の原点の x (字の座標。基線の上、右向き) */
export type TextChars = Array<{ ch: string; font: string; x: number }>;
export type TextOutliner = (text: string, family: string | undefined, weight: number, size: number) => { segs: Seg[]; advance: number; chars?: TextChars } | null;

export interface ParseSvgOptions {
  /** text 要素を輪郭にして描く (無ければ text を含む SVG はラスタライズ) */
  outline?: TextOutliner;
  /** 図形にできなかったとき (null を返すとき)、その理由 (filter・marker など、扱えない機能の名前) を受け取る */
  onUnsupported?: (what: string) => void;
  /**
   * filter を近似して図形にする (ラスタライズできない環境用。影 (feDropShadow、feGaussianBlur + feOffset + feMerge) と、ぼかしだけのもの)。
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

const UNSUPPORTED = new Set(['textpath', 'foreignobject']);
/** 定義だけで、その場では描かない要素 */
const DEFINITIONS = new Set(['lineargradient', 'radialgradient', 'clippath', 'symbol', 'style', 'pattern', 'mask', 'filter', 'marker']);
const IGNORED = new Set(['title', 'desc', 'metadata', 'defs', 'sodipodi:namedview', 'namedview']);

class Unsupported extends Error {}

/**
 * 1 つの SVG で、参照 (use・marker・pattern・mask・clipPath の中の use) をたどって要素を訪ねる回数の上限 (文書に書かれた要素の数に足す分)。
 * use を 10 個ずつ 6 段重ねるだけで 100 万の図形になり、数 KB の SVG が数秒〜止まらなくなるので、ここで切って「図形にできない」ものとして扱う。
 * 文書に書かれた要素を 1 回ずつ訪ねる分は数えない (上限 = 要素の数 + この値) ので、要素が数十万ある地図・図面はそのまま読める。
 * 記号 (symbol) を数万回置く地図でも、参照で増える分は数十万までなので、50 万にする
 */
const MAX_EXPANDED_VISITS = 500_000;
/** pattern の中身の図形が、また pattern で塗られているときの入れ子の上限 (互いを指す pattern で止まらなくなるのを防ぐ。gradient の参照の上限と同じ 8) */
const MAX_PATTERN_NEST = 8;

/** <style> の規則 (単純な選択子だけ: 要素名・.class・#id とその組み合わせ、カンマ区切り) */
interface CssRule {
  tag?: string;
  id?: string;
  classes: string[];
  specificity: number;
  order: number;
  decls: Record<string, string>;
}

function parseDecls(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).replace(/!important/i, '').trim();
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

/** CSS を規則の列にする。扱えない選択子 (子孫・疑似クラスなど) や @ 規則 (読み飛ばすもの以外) があれば Unsupported */
export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  // @font-face (SVG に埋め込んだ書体。text は読み込み済みの書体の輪郭で描く)・@import・@charset・@namespace は読み飛ばす
  // (注釈と @import などは、終わりの無いものが並ぶと正規表現では 2 乗の手間になるので、1 回の走査で取り除く)
  const text = stripAtStatements(
    stripCssComments(css)
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/@font-face\s*\{[^{}]*\}/gi, ''),
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
      const parsed = /^(\*|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(sel);
      if (!sel || !parsed || sel.startsWith('@')) throw new Unsupported(`css selector ${sel}`);
      const parts = parsed[2].match(/[.#][\w-]+/g) ?? [];
      const ids = parts.filter((p) => p[0] === '#').map((p) => p.slice(1));
      const classes = parts.filter((p) => p[0] === '.').map((p) => p.slice(1));
      if (ids.length > 1) throw new Unsupported(`css selector ${sel}`);
      const tag = parsed[1] === '*' ? undefined : parsed[1]?.toLowerCase();
      rules.push({ tag, id: ids[0], classes, specificity: ids.length * 100 + classes.length * 10 + (tag ? 1 : 0), order: order++, decls });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

function propsOf(n: XmlNode, css: CssRule[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const names = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'display', 'visibility', 'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'overflow', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'data-fill-cmyk', 'data-stroke-cmyk', 'vector-effect', 'mix-blend-mode', 'xml:space'];
  for (const k of names) {
    const v = n.getAttribute?.(k);
    if (v !== null && v !== undefined) out[k] = v.trim();
  }
  // 優先度: 表示属性 < <style> の規則 (詳細度・出現順) < style 属性
  if (css.length) {
    const tag = (n.localName ?? n.nodeName.split(':').pop() ?? '').toLowerCase();
    const id = n.getAttribute?.('id') ?? undefined;
    const cls = new Set((n.getAttribute?.('class') ?? '').split(/\s+/).filter(Boolean));
    for (const r of css) {
      if ((r.tag && r.tag !== tag) || (r.id && r.id !== id) || !r.classes.every((c) => cls.has(c))) continue;
      Object.assign(out, r.decls);
    }
  }
  const st = n.getAttribute?.('style');
  if (st) Object.assign(out, parseDecls(st));
  return out;
}

function colorOf(v: string, allowRef = false): string | null | PaintRef {
  const s = v.trim();
  if (s === 'none' || s === 'transparent') return null;
  const u = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(s);
  if (u) {
    if (!allowRef) throw new Unsupported('paint server');
    return { ref: u[1] };
  }
  if (/^url\(/i.test(s)) throw new Unsupported('paint server');
  if (s === 'currentColor') return '#000000';
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
  if (p.fill !== undefined && p.fill !== 'inherit') s.fill = colorOf(p.fill, true);
  if (p.stroke !== undefined && p.stroke !== 'inherit') s.stroke = colorOf(p.stroke, true);
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

/** letter-spacing (属性か style) の長さ。normal・読めない値は 0 */
function letterSpacingOf(n: XmlNode): number {
  const v = n.getAttribute?.('letter-spacing') ?? /letter-spacing\s*:\s*([^;]+)/i.exec(n.getAttribute?.('style') ?? '')?.[1];
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : 0;
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
    const visit = () => {
      if (--visitsLeft < 0) throw new Unsupported('too many elements');
    };
    let patternNest = 0;
    const index = (n: XmlNode) => {
      visitsLeft++;
      const id = n.getAttribute?.('id');
      if (id) byId.set(id, n);
      for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) index(c);
    };
    index(root);
    // <style> の規則 (どこに書かれていても文書全体に効く)
    let cssText = '';
    const collectCss = (n: XmlNode) => {
      if (nm(n) === 'style') cssText += `${n.textContent ?? ''}\n`;
      for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) collectCss(c);
    };
    collectCss(root);
    const css = cssText.trim() ? parseCss(cssText) : [];
    const props = (n: XmlNode) => propsOf(n, css);
    const hrefOf = (n: XmlNode) => (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').replace(/^#/, '');
    const vbW = viewBox[2];
    const vbH = viewBox[3];

    /** 図形要素の形 (ローカル座標)。図形でなければ undefined */
    const geometryOf = (n: XmlNode, name: string): Seg[] | undefined => {
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
    /** 塗りのグラデーション。stop が 1 つなら単色、無ければ塗らない */
    const gradientOf = (id: string, local: Seg[], mm: M): SvgGradient | string | null => {
      const g = byId.get(id);
      if (!g) return null;
      const kind = nm(g) === 'lineargradient' ? 'linear' : nm(g) === 'radialgradient' ? 'radial' : undefined;
      if (!kind) throw new Unsupported(`paint server ${nm(g)}`);
      const bboxUnits = (gradientAttr(g, 'gradientUnits') ?? 'objectBoundingBox') !== 'userSpaceOnUse';
      const stops = gradientStops(g)
        .map((st) => {
          const p = props(st);
          const sc = p['stop-color'] ?? '#000000';
          const color = colorOf(sc) as string | null;
          // stop-color が none・transparent なら、透明の黒
          const op = color ? Math.max(0, Math.min(1, num(p['stop-opacity'], 1))) : 0;
          return { offset: Math.max(0, Math.min(1, num(st.getAttribute?.('offset') ?? undefined, 0))), color: color ?? '#000000', ...(op < 1 ? { opacity: op } : {}) };
        });
      for (let k = 1; k < stops.length; k++) stops[k].offset = Math.max(stops[k].offset, stops[k - 1].offset);
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
      const gt = parseTransform(gradientAttr(g, 'gradientTransform'));
      if (!gt) throw new Unsupported('gradientTransform');
      const b = segBox(local);
      const unitMap: M = bboxUnits ? [b.w, 0, 0, b.h, b.x, b.y] : ID;
      const spread = gradientAttr(g, 'spreadMethod');
      const grad: SvgGradient = { kind, coords, stops, matrix: mul(mul(mm, unitMap), gt) };
      if (spread === 'repeat' || spread === 'reflect') {
        // 図形の外接矩形の角を、グラデーションの空間に写す
        const inv = invert(mul(unitMap, gt));
        if (inv) spreadGradient(grad, spread, [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]));
      }
      return grad;
    };
    /**
     * 塗りの模様 (pattern)。patternUnits (既定 objectBoundingBox)・patternContentUnits・viewBox・patternTransform・href の継承。
     * 中身は単色の塗り・線だけ (透明度・グラデーション・切り抜き・入れ子の模様があればラスタライズ)
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
      const pt = parseTransform(a('patternTransform'));
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
      const inner: SvgShape[] = [];
      target = inner;
      // 中身の walk は深さを 1 から数え直すので、pattern の入れ子はここで数える (中身が自分自身で塗られている pattern で止まらなくなる)
      if (patternNest >= MAX_PATTERN_NEST) throw new Unsupported('too deep');
      patternNest++;
      try {
        for (const c of kidsOf(g)) walk(c, ROOT_STYLE, content, 1, false, [], 1);
      } finally {
        patternNest--;
        target = saved;
      }
      if (inner.some((sh) => sh.fillPaint || sh.fillPattern || sh.strokePaint || sh.clips || sh.blend || sh.fillOpacity < 1 || sh.strokeOpacity < 1)) throw new Unsupported('pattern content');
      return { width: w, height: h, matrix: mul(mul(mm, pt), [1, 0, 0, 1, x, y]), shapes: inner };
    };

    /** clip-path="url(#id)" の切り抜き (clipPathUnits=userSpaceOnUse のみ) */
    const clipOf = (id: string, mm: M): SvgClip | null => {
      const cp = byId.get(id);
      if (!cp || nm(cp) !== 'clippath') return null;
      if ((cp.getAttribute?.('clipPathUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') throw new Unsupported('clipPathUnits');
      const ct = parseTransform(cp.getAttribute?.('transform'));
      if (!ct) throw new Unsupported('transform');
      const base = mul(mm, ct);
      const segs: Seg[] = [];
      let evenOdd = false;
      const add = (n: XmlNode, m: M, depth: number) => {
        visit();
        const name = nm(n);
        const tr = parseTransform(n.getAttribute?.('transform'));
        if (!tr) throw new Unsupported('transform');
        const m2 = mul(m, tr);
        if (name === 'use') {
          const ref = byId.get(hrefOf(n));
          if (ref && depth < 8) add(ref, mul(m2, [1, 0, 0, 1, userLen(n.getAttribute?.('x'), vbW), userLen(n.getAttribute?.('y'), vbH)]), depth + 1);
          return;
        }
        if (name === 'g') {
          for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) add(c, m2, depth + 1);
          return;
        }
        if (UNSUPPORTED.has(name)) throw new Unsupported(name);
        const geo = geometryOf(n, name);
        if (!geo) return;
        if (props(n)['clip-rule'] === 'evenodd') evenOdd = true;
        segs.push(...transformSegs(geo, m2));
      };
      for (const c of Array.from(cp.childNodes)) if (c.nodeType === 1) add(c, base, 0);
      return { segs, evenOdd };
    };

    /** filter を近似して描き直している要素 */
    const filtering = new Set<XmlNode>();
    /**
     * filter の要素を読み、近似のしかたを決める。shadow: 影 (ずらす量・ぼかしの幅・色 (無ければ図形の色)・不透明度)、
     * source: 元の図形も描くか。扱えない filter なら Unsupported
     */
    const filterOf = (ref: string): { shadow?: { dx: number; dy: number; std: number; color?: string; opacity: number }; source: boolean } => {
      const u = /url\(\s*['"]?#([^'")\s]+)/.exec(ref);
      const f = u ? byId.get(u[1]) : undefined;
      if (!f || nm(f) !== 'filter') throw new Unsupported('filter');
      if ((f.getAttribute?.('primitiveUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') throw new Unsupported('filter primitiveUnits');
      const prims = Array.from(f.childNodes).filter((c) => c.nodeType === 1);
      const a = (e: XmlNode, k: string) => e.getAttribute?.(k) ?? '';
      const num = (e: XmlNode, k: string, d = 0) => {
        const v = parseFloat(a(e, k));
        return Number.isFinite(v) ? v : d;
      };
      const color = (e: XmlNode) => {
        const c = props(e)['flood-color'] ?? a(e, 'flood-color');
        return c ? ((colorOf(c) as string | null) ?? undefined) : '#000000';
      };
      const opacityOf = (e: XmlNode) => {
        const v = parseFloat(props(e)['flood-opacity'] ?? a(e, 'flood-opacity'));
        return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1;
      };
      let dx = 0;
      let dy = 0;
      let std = 0;
      let col: string | undefined;
      let opac = 1;
      let alphaSource = false;
      let merged = false;
      let source = false;
      for (const e of prims) {
        switch (nm(e)) {
          case 'fedropshadow':
            dx = num(e, 'dx', 2);
            dy = num(e, 'dy', 2);
            std = num(e, 'stdDeviation', 2);
            col = color(e);
            opac = opacityOf(e);
            return { shadow: { dx, dy, std, color: col, opacity: opac }, source: true };
          case 'fegaussianblur':
            std = num(e, 'stdDeviation');
            if (a(e, 'in') === 'SourceAlpha') alphaSource = true;
            break;
          case 'feoffset':
            dx = num(e, 'dx');
            dy = num(e, 'dy');
            if (a(e, 'in') === 'SourceAlpha') alphaSource = true;
            break;
          case 'feflood':
            col = color(e);
            opac = opacityOf(e);
            break;
          case 'fecomposite':
          case 'feblend':
            break;
          case 'fecomponenttransfer': {
            // 影の濃さ (feFuncA の linear の slope・table の最大)
            for (const fn of Array.from(e.childNodes).filter((c) => c.nodeType === 1 && nm(c) === 'fefunca')) {
              const t = a(fn, 'type');
              if (t === 'linear') opac *= num(fn, 'slope', 1);
              else if (t === 'table' || t === 'discrete') opac *= Math.max(...a(fn, 'tableValues').split(/[\s,]+/).filter(Boolean).map(Number), 0);
              else throw new Unsupported('filter');
            }
            break;
          }
          case 'femerge':
            merged = true;
            for (const mn of Array.from(e.childNodes).filter((c) => c.nodeType === 1)) if (a(mn, 'in') === 'SourceGraphic') source = true;
            break;
          default:
            throw new Unsupported(`filter ${nm(e)}`);
        }
      }
      if (!merged) {
        // 合わせない filter: ぼかしだけ (ずらしも影の色も無い) なら元の図形をそのまま描き、ほかは扱えない
        if (dx || dy || col) throw new Unsupported('filter');
        return { source: true };
      }
      if (alphaSource && !col) col = '#000000';
      return { shadow: { dx, dy, std, color: col, opacity: opac }, source };
    };
    /**
     * 影: 図形の写しを (ox, oy) ずらし、ぼかしの幅 std (ルートの座標) を、少しずつ太らせた半透明の写し (5 枚) の重ねで表す。
     * color が無ければ図形の色のまま
     */
    const blurredCopies = (shapes: SvgShape[], ox: number, oy: number, std: number, color: string | undefined, opacity: number): SvgShape[] => {
      // 太らせる量 (外の層から) と、そこまで重ねたときの濃さ (ガウスぼかしの縁の外の濃さ: 縁で約半分、2σ でほぼ 0)
      const steps = std > 0 ? [2, 1.5, 1, 0.5, 0].map((k) => k * std) : [0];
      const cum = std > 0 ? [0.03, 0.08, 0.17, 0.32, 0.6].map((c) => c * opacity) : [opacity];
      const alphas = cum.map((c, k) => 1 - (1 - c) / (1 - (k ? cum[k - 1] : 0)));
      const out: SvgShape[] = [];
      // 画像は輪郭を太らせられないので、色を変えないぼかしでは、ぼかさずにそのまま (ずらして) 描く。影 (色を付けた写し) には使わない
      if (color === undefined)
        for (const sh of shapes) {
          if (!sh.image) continue;
          const [a, b, c, d, e, f] = sh.image.matrix;
          out.push({ ...sh, image: { ...sh.image, matrix: [a, b, c, d, e + ox, f + oy] }, fillOpacity: sh.fillOpacity * opacity, strokeOpacity: sh.strokeOpacity * opacity });
        }
      steps.forEach((grow, k) => {
        const alpha = alphas[k];
        for (const sh of shapes) {
          if (sh.image) continue;
          const filled = sh.fill !== undefined || !!sh.fillPaint || !!sh.fillPattern;
          const fillColor = color ?? sh.fill;
          const strokeColor = color ?? sh.stroke ?? sh.fill;
          const width = (sh.stroke !== undefined ? sh.strokeWidth : 0) + 2 * grow;
          out.push({
            segs: sh.segs.map((g) => (g.op === 'Z' ? g : g.op === 'C' ? { ...g, x1: g.x1 + ox, y1: g.y1 + oy, x2: g.x2 + ox, y2: g.y2 + oy, x: g.x + ox, y: g.y + oy } : { ...g, x: g.x + ox, y: g.y + oy })),
            ...(filled && fillColor ? { fill: fillColor } : {}),
            ...(sh.clips ? { clips: sh.clips } : {}),
            ...(sh.masks ? { masks: sh.masks } : {}),
            evenOdd: sh.evenOdd,
            ...(width > 0 && strokeColor ? { stroke: strokeColor } : {}),
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
     * mix-blend-mode (multiply・screen・difference) の付いた要素は、その要素の図形に描画モードを付ける。重ね方は図形ごとなので、
     * 子を持つ要素 (g など。子をまとめて重ねる) のものと、ほかの値は扱わず、描画モード無しで描く (対応する前と同じ)
     */
    const walk = (n: XmlNode, st: Style, m: M, op: number, isRoot: boolean, clips: SvgClip[] = [], depth = 0) => {
      const bm = n.nodeType === 1 ? (props(n)['mix-blend-mode'] ?? 'normal').trim() : 'normal';
      if (!['multiply', 'screen', 'difference'].includes(bm) || ['g', 'svg', 'a', 'use', 'switch', 'text'].includes(nm(n))) return walk0(n, st, m, op, isRoot, clips, depth);
      const before = target.length;
      walk0(n, st, m, op, isRoot, clips, depth);
      for (let i = before; i < target.length; i++) target[i] = { ...target[i], blend: bm as 'multiply' | 'screen' | 'difference' };
    };
    const walk0 = (n: XmlNode, st: Style, m: M, op: number, isRoot: boolean, clips: SvgClip[] = [], depth = 0) => {
      const name = nm(n);
      if (IGNORED.has(name) || IGNORED.has(n.nodeName.toLowerCase()) || foreign(n)) return;
      if (DEFINITIONS.has(name)) return;
      // switch: 条件を満たす最初の子だけを描く (requiredExtensions の付いた子 (Illustrator の foreignObject など) は満たさない)
      if (name === 'switch') {
        const pick = Array.from(n.childNodes).find((c) => c.nodeType === 1 && !foreign(c) && !c.getAttribute?.('requiredExtensions') && nm(c) !== 'foreignobject');
        if (pick) walk(pick, st, m, op, false, clips, depth + 1);
        return;
      }
      if (UNSUPPORTED.has(name)) throw new Unsupported(name);
      if (depth > 32) throw new Unsupported('too deep');
      const p = props(n);
      if (p.display === 'none' || p.visibility === 'hidden') return;
      if (p.filter && p.filter !== 'none' && !(opts.approximateFilters && filtering.has(n))) {
        if (!opts.approximateFilters) throw new Unsupported('filter');
        const fx = filterOf(p.filter);
        // 要素の図形を集めてから、影 (ずらしてぼかした写し) を先に、元の図形を後に足す
        const savedTarget = target;
        const own: SvgShape[] = [];
        target = own;
        filtering.add(n);
        try {
          walk(n, st, m, op, isRoot, clips, depth);
        } finally {
          filtering.delete(n);
          target = savedTarget;
        }
        if (fx.shadow) {
          const tr0 = isRoot ? ID : parseTransform(n.getAttribute?.('transform')) ?? ID;
          const lm = mul(m, tr0);
          // ずらす量は要素の座標系で (移動を除いた変換を掛ける)、ぼかしの幅は拡大率を掛ける
          const ox = lm[0] * fx.shadow.dx + lm[2] * fx.shadow.dy;
          const oy = lm[1] * fx.shadow.dx + lm[3] * fx.shadow.dy;
          const scale = Math.sqrt(Math.abs(lm[0] * lm[3] - lm[1] * lm[2]));
          target.push(...blurredCopies(own, ox, oy, fx.shadow.std * scale, fx.shadow.color, fx.shadow.opacity));
        }
        if (fx.source) target.push(...own);
        return;
      }
      const tr = isRoot ? ID : parseTransform(n.getAttribute?.('transform'));
      if (!tr) throw new Unsupported('transform');
      const mm = mul(m, tr);
      // マスク: 中身をこの要素の座標系 (transform 適用後) で図形にし、この要素の図形すべてに付けて、もう一度この要素を描く
      // (マスクの領域 x・y・width・height は見ない)
      if (p.mask && p.mask !== 'none' && !masking.has(n)) {
        const u = /url\(\s*['"]?#([^'")\s]+)/.exec(p.mask);
        const mk = u ? byId.get(u[1]) : undefined;
        if (!mk || nm(mk) !== 'mask') throw new Unsupported('mask');
        if ((mk.getAttribute?.('maskContentUnits') ?? 'userSpaceOnUse') !== 'userSpaceOnUse') throw new Unsupported('maskContentUnits');
        const savedTarget = target;
        const savedMasks = masks;
        const content: SvgShape[] = [];
        target = content;
        masks = [];
        try {
          const ms = inherit(ROOT_STYLE, props(mk));
          for (const c of Array.from(mk.childNodes)) if (c.nodeType === 1) walk(c, ms, mm, 1, false, [], depth + 1);
        } finally {
          target = savedTarget;
        }
        masks = [...savedMasks, { shapes: content }];
        masking.add(n);
        try {
          walk(n, st, m, op, isRoot, clips, depth);
        } finally {
          masks = savedMasks;
          masking.delete(n);
        }
        return;
      }
      visit(); // (filter・mask でこの要素を描き直す分は、ここまで来ないので 1 回と数える)
      const s = inherit(st, p);
      const o = op * s.opacity;
      // 切り抜き: この要素の座標系 (transform 適用後) で clipPath の形を作る
      let cl = clips;
      if (p['clip-path'] && p['clip-path'] !== 'none') {
        const u = /url\(\s*['"]?#([^'")\s]+)/.exec(p['clip-path']);
        const c = u ? clipOf(u[1], mm) : null;
        if (!c) throw new Unsupported('clip-path');
        cl = [...clips, c];
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
        for (const c of Array.from(n.childNodes)) if (c.nodeType === 1) walk(c, s, mm, o, false, cl, depth + 1);
        return;
      }
      if (name === 'use') {
        // 参照先を、use の位置 (x, y) に描く。symbol は g と同じに扱う (viewBox は未対応)
        const ref = byId.get(hrefOf(n));
        if (!ref) return;
        const ux = ulen(n.getAttribute?.('x') ?? '0', vp.w);
        const uy = ulen(n.getAttribute?.('y') ?? '0', vp.h);
        const at = mul(mm, [1, 0, 0, 1, ux, uy]);
        if (nm(ref) === 'symbol') {
          const kids = (m2: M, cl2: SvgClip[]) => {
            for (const c of Array.from(ref.childNodes)) if (c.nodeType === 1) walk(c, s, m2, o, false, cl2, depth + 1);
          };
          // viewBox のある symbol: use の枠 (width・height。既定は 100%) に viewBox を合わせる
          if (ref.getAttribute?.('viewBox')) inViewport(ref, ux, uy, ulen(n.getAttribute?.('width') ?? '100%', vp.w), ulen(n.getAttribute?.('height') ?? '100%', vp.h), mm, cl, kids);
          else kids(at, cl);
        } else walk(ref, s, at, o, false, cl, depth + 1);
        return;
      }
      if (name === 'image') {
        // data: の PNG・JPEG を、枠 (x・y・width・height) に引き伸ばして描く
        const href = (n.getAttribute?.('href') ?? n.getAttribute?.('xlink:href') ?? '').trim();
        const d = /^data:image\/(png|jpeg);base64,([\s\S]*)$/.exec(href);
        if (!d) throw new Unsupported('image');
        const a = (k: string, def: string) => n.getAttribute?.(k) ?? def;
        let ix = ulen(a('x', '0'), vp.w);
        let iy = ulen(a('y', '0'), vp.h);
        let iw = ulen(a('width', '0'), vp.w);
        let ih = ulen(a('height', '0'), vp.h);
        if (!(iw > 0 && ih > 0)) return;
        const bin = atob(d[2].replace(/\s+/g, ''));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // preserveAspectRatio (SVG 1.1 §7.8。既定は xMidYMid meet): 画像の縦横比を保って枠に収め、揃えの位置に置く。
        // slice (はみ出しを切る) は描けないので、描けないものとして扱う
        const par = (n.getAttribute?.('preserveAspectRatio') ?? 'xMidYMid meet').trim().split(/\s+/);
        if (par[0] !== 'none') {
          if (par[1] === 'slice') throw new Unsupported('image');
          const nat = imagePixelSize(bytes, d[1] as 'png' | 'jpeg');
          if (!nat) throw new Unsupported('image');
          const k = Math.min(iw / nat.w, ih / nat.h);
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
        target.push({
          segs: [],
          evenOdd: false,
          strokeWidth: 0,
          lineCap: 0,
          lineJoin: 0,
          fillOpacity: o,
          strokeOpacity: o,
          ...(cl.length ? { clips: cl } : {}),
          ...(masks.length ? { masks } : {}),
          image: { kind: d[1] as 'png' | 'jpeg', bytes, matrix: mul(mm, [iw, 0, 0, -ih, ix, iy + ih]) },
        });
        return;
      }
      if (name === 'text') {
        textShapes(n, s, mm, o, cl);
        return;
      }
      if (name === 'tspan') throw new Unsupported('tspan');
      const segs = geometryOf(n, name);
      if (!segs || !segs.length) return; // 未知の要素 (メタデータ等) は描かない
      pushShape(name, segs, s, mm, o, cl);
      if (/^(path|line|polyline|polygon)$/.test(name) && (s.markerStart || s.markerMid || s.markerEnd)) markers(segs, s, mm, o, cl, depth);
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
        const ms = inherit(ROOT_STYLE, props(mk));
        inViewport(mk, -(vb[0] * rx + vb[2] * ry + vb[4]), -(vb[1] * rx + vb[3] * ry + vb[5]), mw, mh, base, cl, (m2, cl2) => {
          for (const c of Array.from(mk.childNodes)) if (c.nodeType === 1) walk(c, ms, m2, o, false, cl2, depth + 1);
        }, !!opts.markerOverflowVisible && props(mk).overflow === undefined);
      };
      verts.forEach((v, k) => place(k === 0 ? s.markerStart : k === verts.length - 1 ? s.markerEnd : s.markerMid, v, k === 0));
    };

    /** 図形 (ローカル座標の形) を、塗り・線の指定とともに shapes へ足す */
    const pushShape = (name: string, segs: Seg[], s: Style, mm: M, o: number, cl: SvgClip[], evenOdd = s.evenOdd, text?: { chars?: TextChars; size: number; t: M }) => {
      const det = Math.abs(mm[0] * mm[3] - mm[1] * mm[2]);
      const fillable = name !== 'line';
      let fill: string | undefined;
      let fillPaint: SvgGradient | undefined;
      let fillPattern: SvgPattern | undefined;
      if (fillable && s.fill) {
        if (typeof s.fill === 'string') fill = s.fill;
        else if (nm(byId.get(s.fill.ref) ?? root) === 'pattern') {
          const pt = patternOf(s.fill.ref, segs, mm);
          if (pt) fillPattern = pt;
        } else {
          const gr = gradientOf(s.fill.ref, segs, mm);
          if (typeof gr === 'string') fill = gr;
          else if (gr) fillPaint = gr;
        }
      }
      let stroke: string | undefined;
      let strokePaint: SvgGradient | undefined;
      if (s.stroke) {
        if (typeof s.stroke === 'string') stroke = s.stroke;
        else {
          const gr = gradientOf(s.stroke.ref, segs, mm);
          if (typeof gr === 'string') stroke = gr;
          else if (gr) strokePaint = gr;
        }
      }
      // non-scaling-size: 要素の原点だけを変換で写し、形は元の大きさのまま、その点の周りに置く
      const anchor: [number, number] | undefined = s.nonScalingSize ? [mm[4], mm[5]] : undefined;
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
        fillOpacity: o * s.fillOpacity,
        strokeOpacity: o * s.strokeOpacity,
        ...(text?.chars?.length && !anchor ? { text: { chars: text.chars, size: text.size, matrix: mul(mm, text.t) } } : {}),
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
    const spaced = (t: string, st: Style) => (st.preserveSpace ? t.replace(/\r\n|[\n\r\t]/g, ' ') : t.replace(/\s+/g, ' '));
    const textOnPath = (tp: XmlNode, st: Style, mm: M, o: number, cl: SvgClip[], parentSpacing = 0) => {
      const outline = opts.outline!;
      const ref = byId.get(hrefOf(tp));
      if (!ref) return;
      const geo = geometryOf(ref, nm(ref));
      if (!geo || !geo.length) return;
      const rt = parseTransform(ref.getAttribute?.('transform'));
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
      const total = pts[pts.length - 1].d;
      if (!(total > 0)) return;
      /** 長さ d の点と向き */
      const at = (d: number) => {
        let i = 1;
        while (i < pts.length - 1 && pts[i].d < d) i++;
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
      const glyphs = chars.map((c) => {
        const ol = outline(c.ch, c.st.fontFamily, c.st.fontWeight, c.st.fontSize);
        if (!ol) throw new Unsupported('text outline');
        return { ...c, ol };
      });
      // letter-spacing は textPath のもの (無ければ text 要素のもの)
      const ls = letterSpacingOf(tp) || parentSpacing;
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
        const t: M = mul([c, sn, -sn, c, p.x, p.y], [1, 0, 0, 1, -g.ol.advance / 2, 0]);
        pushShape('text', transformSegs(g.ol.segs, t), g.st, mm, o, cl, false, { chars: g.ol.chars, size: g.st.fontSize, t });
      }
    };

    const textShapes = (n: XmlNode, s: Style, mm: M, o: number, cl: SvgClip[]) => {
      const outline = opts.outline;
      if (!outline) throw new Unsupported('text');
      // 並びの最初の長さ (em・ex はその要素の字の大きさに対して。Visio の dy="1.2em" など)
      const first = (v: string | null | undefined, fs: number) => {
        const t = v?.trim().split(/[\s,]+/)[0];
        if (!t) return NaN;
        const m = /^(-?[\d.]+(?:e-?\d+)?)(em|ex)$/i.exec(t);
        if (m) return parseFloat(m[1]) * fs * (m[2].toLowerCase() === 'ex' ? 0.5 : 1);
        return /[a-z%]$/i.test(t) ? ulen(t, 0) : parseFloat(t);
      };
      interface Run {
        text: string;
        st: Style;
        x?: number;
        y?: number;
        dx: number;
        dy: number;
      }
      const runs: Run[] = [];
      /** パスに沿う文字 (textPath) */
      const onPath: Array<{ el: XmlNode; st: Style }> = [];
      const collect = (el: XmlNode, st: Style) => {
        let x = first(el.getAttribute?.('x'), st.fontSize);
        let y = first(el.getAttribute?.('y'), st.fontSize);
        let dx = first(el.getAttribute?.('dx'), st.fontSize);
        let dy = first(el.getAttribute?.('dy'), st.fontSize);
        for (const c of Array.from(el.childNodes)) {
          if (c.nodeType === 3 || c.nodeType === 4) {
            const t = spaced(c.textContent ?? '', st);
            if (!t) continue;
            runs.push({ text: t, st, ...(Number.isFinite(x) ? { x } : {}), ...(Number.isFinite(y) ? { y } : {}), dx: Number.isFinite(dx) ? dx : 0, dy: Number.isFinite(dy) ? dy : 0 });
            x = y = dx = dy = NaN; // 位置の指定は最初の文字だけ
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
            if (c.getAttribute?.('transform')) throw new Unsupported('tspan transform');
            collect(c, inherit(st, p));
          }
        }
      };
      collect(n, s);
      for (const tp of onPath) textOnPath(tp.el, tp.st, mm, o, cl, letterSpacingOf(n));
      if (!runs.length) return;
      if (!runs[0].st.preserveSpace) runs[0].text = runs[0].text.replace(/^ /, '');
      if (!runs[runs.length - 1].st.preserveSpace) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ $/, '');
      // 塊 (x / y の指定で始まる) ごとに置く
      let px = runs[0].x ?? 0;
      let py = runs[0].y ?? 0;
      let chunk: Array<{ run: Run; segs: Seg[]; at: number; y: number; adv: number; chars?: TextChars }> = [];
      // textLength・lengthAdjust (SVG 1.1 §10.5): 文字列の長さを textLength にそろえる。spacingAndGlyphs は字ごと横に伸び縮みさせ、
      // spacing は字の間を空ける (詰める)。text-decoration (underline・overline・line-through) は字の色の線を引く
      const textLength = parseFloat(n.getAttribute?.('textLength') ?? '');
      const lengthAdjust = n.getAttribute?.('lengthAdjust') === 'spacingAndGlyphs' ? 'glyphs' : 'spacing';
      const decoText = `${n.getAttribute?.('text-decoration') ?? ''} ${/text-decoration\s*:\s*([^;]+)/i.exec(n.getAttribute?.('style') ?? '')?.[1] ?? ''}`;
      const deco = { under: /underline/.test(decoText), over: /overline/.test(decoText), through: /line-through/.test(decoText) };
      // data-kendot (Kumiori の拡張。CGM の TEXT SCORE TYPE の kendot): 字ごとに、字の下に点を打つ
      // data-kendot="over" は字の上に打つ (CGM の left の path では、右側が字の上になる)
      const kendotAttr = n.getAttribute?.('data-kendot');
      const kendot = kendotAttr === 'true' || kendotAttr === 'over';
      // data-fit="uniform" (Kumiori の拡張。CGM の RESTRICTED TEXT の isotropic): data-max-length を超えるとき、縦横同じ比で縮める
      const uniform = n.getAttribute?.('data-fit') === 'uniform';
      // letter-spacing (SVG 1.1 §10.11。text 要素のもの): 字ごとに、字の後に足す
      const letterSpacing = letterSpacingOf(n);
      const flush = () => {
        if (!chunk.length) return;
        const anchor = chunk[0].run.st.textAnchor;
        const last = chunk[chunk.length - 1];
        let width = last.at + last.adv - chunk[0].at;
        // 字の間を空ける (textLength の spacing・letter-spacing): 字ごとに輪郭を作り直して、間に足す
        const spread = Number.isFinite(textLength) && textLength > 0 && lengthAdjust === 'spacing';
        if (spread || letterSpacing) {
          const glyphs: typeof chunk = [];
          let extra = 0;
          for (const c of chunk) {
            let at = c.at + extra;
            for (const ch of [...c.run.text]) {
              const ol = outline(ch, c.run.st.fontFamily, c.run.st.fontWeight, c.run.st.fontSize);
              if (!ol) continue;
              glyphs.push({ run: c.run, segs: ol.segs, at, y: c.y, adv: ol.advance, ...(ol.chars ? { chars: ol.chars } : {}) });
              at += ol.advance + letterSpacing;
              extra += letterSpacing;
            }
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
        const placed: Array<{ x: number; adv: number; y: number; fs: number }> = [];
        for (const c of chunk) {
          const t: M = [k, 0, 0, ky, x0 + (c.at - x0) * k + shift, c.y];
          pushShape('text', transformSegs(c.segs, t), c.run.st, mm, o, cl, false, { chars: c.chars, size: c.run.st.fontSize, t });
          placed.push({ x: t[4], adv: c.adv * k, y: c.y, fs: c.run.st.fontSize * ky });
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
        const xa = placed[0].x;
        const xb = placed[placed.length - 1].x + placed[placed.length - 1].adv;
        const yb = placed[0].y;
        if (deco.under) lineSegs.push(...rect(xa, yb + fsMax * 0.12, xb - xa, th));
        if (deco.over) lineSegs.push(...rect(xa, yb - fsMax * 0.85 - th, xb - xa, th));
        if (deco.through) lineSegs.push(...rect(xa, yb - fsMax * 0.3 - th / 2, xb - xa, th));
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
      for (const r of runs) {
        if (r.x !== undefined || r.y !== undefined) {
          flush();
          if (r.x !== undefined) px = r.x;
          if (r.y !== undefined) py = r.y;
        }
        px += r.dx;
        py += r.dy;
        if (!r.text) continue;
        const ol = outline(r.text, r.st.fontFamily, r.st.fontWeight, r.st.fontSize);
        if (!ol) throw new Unsupported('text outline');
        chunk.push({ run: r, segs: ol.segs, at: px, y: py, adv: ol.advance, ...(ol.chars ? { chars: ol.chars } : {}) });
        px += ol.advance;
      }
      flush();
    };

    walk(root, ROOT_STYLE, ID, 1, true);
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

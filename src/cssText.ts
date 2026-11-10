/**
 * cssText — CSS の値の文字列を扱う共通の補助関数。
 *
 *  - 区切り: 括弧・文字列の外の区切り文字で分ける (splitTop)、括弧の外の空白で分ける (splitWords)
 *  - 長さ: 絶対の長さの単位の表 (px と pt)、計算値の長さ (px) → pt (cssLen)
 *  - 色: CSS の色 (名前・#rgb・rgb()・hsl()) → RGBA (parseColor)、計算値の rgb() → Kumiori の色 #rrggbb (cssColor・cssColorAlpha)
 *
 * cssCascade・htmlPaged・htmlImport・cssGradient・cssSelector が使う (それぞれが持っていた同じ役割の関数を寄せたもの)
 */
import { NAMED_COLORS } from './color';

// ───────────────────────── 区切り ─────────────────────────

/** 文字列 (i は引用符の位置) の終わりの次の位置。逃がし (\) の次の字は読み飛ばす */
export function skipString(s: string, i: number): number {
  const q = s[i];
  let k = i + 1;
  // 逃がしていない改行で文字列は終わる (CSS Syntax 3 §4.3.5: bad-string。残りのスタイルシートを飲み込まない)
  while (k < s.length && s[k] !== q && s[k] !== '\n') k += s[k] === '\\' ? 2 : 1;
  return s[k] === '\n' ? k : k + 1;
}

export interface SplitTopOptions {
  /** 空の片 (区切りが続くところ) も残す (引数の位置が意味を持つ並び) */
  keepEmpty?: boolean;
  /** [ ] の中でも分けない (セレクタの属性の条件) */
  brackets?: boolean;
}

/**
 * 区切り文字 sep で分ける (括弧・文字列の中では分けない)。片は前後の空白を除き、空の片は捨てる (keepEmpty で残す)。
 * sep が ' ' なら、続く空白をまとめて 1 つの区切りにする
 */
export function splitTop(s: string, sep: string, opts: SplitTopOptions = {}): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  const push = () => {
    const t = cur.trim();
    if (t || opts.keepEmpty) out.push(t);
    cur = '';
  };
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'") {
      const j = skipString(s, k);
      cur += s.slice(k, j);
      k = j - 1;
    } else if (c === '(' || (opts.brackets && c === '[')) (depth++, (cur += c));
    else if (c === ')' || (opts.brackets && c === ']')) (depth--, (cur += c));
    else if (depth <= 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) {
      // 空白の区切りは、続く空白をまとめる (空の片を作らない)
      if (sep !== ' ' || cur.trim() || opts.keepEmpty) push();
    } else cur += c;
  }
  push();
  return out;
}

/** 括弧の外の空白 (split に使う。url(a b) の中では分けない) */
export const WS_OUTSIDE_PARENS = /\s+(?![^(]*\))/;

/** 値を、括弧の外の空白で語に分ける */
export const splitWords = (v: string): string[] => v.trim().split(WS_OUTSIDE_PARENS);

// ───────────────────────── 長さ ─────────────────────────

/** 絶対の長さの単位 → px (CSS Values 4 §6.2。q は 1/4 mm) */
export const UNIT_PX: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 25.4 / 4 };

/** 絶対の長さの単位 → pt (Kumiori の長さ) */
export const UNIT_PT: Record<string, number> = { px: 0.75, pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, q: 72 / 25.4 / 4 };

/** 計算値の長さ (px。pt・mm・cm・in・pc・q も読む。単位の無い数は px) → pt。読めなければ undefined */
export function cssLen(v: string | undefined): number | undefined {
  const m = /^(-?[\d.]+)(px|pt|mm|cm|in|pc|q)?$/i.exec((v ?? '').trim());
  if (!m) return undefined;
  return parseFloat(m[1]) * UNIT_PT[(m[2] ?? 'px').toLowerCase()];
}

// ───────────────────────── 色 ─────────────────────────

/** システムの色 (Chrome の既定の値)。古いシステムの色は、Color 4 の付録 A (Deprecated CSS System Colors) の写し先の色 (ThreeDFace → ButtonFace、Window → Canvas、WindowText → CanvasText) */
const SYSTEM_COLORS: Record<string, string> = { canvas: 'ffffff', canvastext: '000000', linktext: '0000ee', visitedtext: '551a8b', buttonface: 'efefef', buttontext: '000000', buttonborder: '767676', field: 'ffffff', fieldtext: '000000', graytext: '808080', highlight: 'b5d5ff', highlighttext: '000000', threedface: 'efefef', windowtext: '000000', window: 'ffffff' };

export type RGBA = [number, number, number, number];

/** CSS の色 (名前・システムの色・#rgb(a)・#rrggbb(aa)・rgb()・rgba()・hsl()・hsla()) を読む (currentcolor は undefined ではなく 'current') */
export function parseColor(v: string): RGBA | 'current' | undefined {
  const s = v.trim().toLowerCase();
  if (s === 'currentcolor') return 'current';
  if (s === 'transparent') return [0, 0, 0, 0];
  const hexName = Object.hasOwn(NAMED_COLORS, s) ? NAMED_COLORS[s].slice(1) : SYSTEM_COLORS[s];
  const hex = hexName ?? (/^#([0-9a-f]{3,8})$/.exec(s)?.[1] ?? '');
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = [0, 2, 4, 6].map((k) => parseInt(full.slice(k, k + 2) || 'ff', 16));
    return [n[0], n[1], n[2], n[3] / 255];
  }
  const m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!m) return undefined;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  // 成分は数か百分率 (Color 4 §5.1・§7)。数として読めない成分 (rgb(1, 2, 3, foo) など) があれば、色として読めない
  const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/;
  if (!parts.slice(1).every((p) => NUM.test(p))) return undefined;
  // alpha は、範囲 [0, 1] の外でも不正ではなく、範囲に丸める (Color 4 §4.2)
  const alpha = Math.min(1, Math.max(0, parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])));
  if (m[1].startsWith('rgb')) {
    if (!NUM.test(parts[0])) return undefined;
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    return [...ch.map((x) => Math.round(Math.min(255, Math.max(0, x)))), alpha] as RGBA;
  }
  // 色相の単位 (CSS Values 4 §7.1 の <angle>): deg (既定)・grad・rad・turn
  const hm = /^(-?[\d.]+(?:e[-+]?\d+)?)(deg|grad|rad|turn)?$/i.exec(parts[0]);
  if (!hm) return undefined;
  const hv = parseFloat(hm[1]) * ({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[(hm[2] ?? 'deg').toLowerCase() as 'deg'] ?? 1);
  if (!Number.isFinite(hv)) return undefined;
  const h = ((hv % 360) + 360) % 360;
  // 彩度は 0% より小さければ 0% に丸める (Color 4 §7)。範囲の外の彩度・明度で sRGB の範囲を出た成分は、0〜255 に丸める
  // (計算値は 8 ビットの rgb()。Color 4 §16.2)
  const sat = Math.max(0, parseFloat(parts[1]) / 100);
  const l = parseFloat(parts[2]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(Math.min(255, Math.max(0, x * 255)))).concat(alpha) as RGBA;
}

/** RGBA → ブラウザの計算値の形 (rgb(r, g, b)、半透明なら rgba(r, g, b, a)) */
export const fmtColor = (c: RGBA) => (c[3] >= 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+c[3].toFixed(3)})`);

/** 計算値の rgb(r, g, b) / rgba(r, g, b, a) (a は数か %) を読む。alpha が無ければ 1。読めなければ undefined */
export function parseRgbFn(v: string): { r: number; g: number; b: number; a: number } | undefined {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v.trim());
  if (!m) return undefined;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a };
}

/** 0〜255 の値 → 2 桁の 16 進 */
export const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** 色の成分 (0〜255) → #rrggbb */
export const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** 計算値の rgb(a) / #rgb → Kumiori の色 #rrggbb。半透明は白い紙の上に重ねた色にする (Kumiori の色は不透明)。透明なら undefined */
export function cssColor(v: string): string | undefined {
  const s = v.trim();
  const c = parseRgbFn(s);
  if (c) {
    if (c.a === 0) return undefined;
    return rgbHex(255 - c.a * (255 - c.r), 255 - c.a * (255 - c.g), 255 - c.a * (255 - c.b));
  }
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  if (s === 'transparent' || s === '') return undefined;
  return s;
}

/** 計算値の rgb(a) → #rrggbb、半透明なら #rrggbbaa (箱の背景。描くときに下の色と重ねる)。透明なら undefined */
export function cssColorAlpha(v: string): string | undefined {
  const c = parseRgbFn(v);
  if (!c || c.a >= 1) return cssColor(v);
  if (c.a <= 0) return undefined;
  return `${rgbHex(c.r, c.g, c.b)}${hex2(c.a * 255)}`;
}

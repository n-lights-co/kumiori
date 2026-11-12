/**
 * cssText — CSS の値の文字列を扱う共通の補助関数。
 *
 *  - 区切り: 括弧・文字列の外の区切り文字で分ける (splitTop)、括弧の外の空白で分ける (splitWords)
 *  - 長さ: 絶対の長さの単位の表 (px と pt)、計算値の長さ (px) → pt (cssLen)
 *  - 色: CSS の色 (名前・#rgb・rgb()・hsl()、cssColorFunctions の hwb()・lab()・color()・color-mix() など) → RGBA (parseColor)、
 *    計算値の rgb() → Kumiori の色 #rrggbb (cssColor・cssColorAlpha)
 *
 * cssCascade・htmlPaged・htmlImport・cssGradient・cssSelector が使う (それぞれが持っていた同じ役割の関数を寄せたもの)
 */
import { NAMED_COLORS } from './color';
import { hasNoneComponent, isColorFunction, parseColorFunction } from './cssColorFunctions';

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

/**
 * 値の末尾の !important を除き、前後の空白を除く。between が真なら「!」と「important」の間の空白も認める (CSS Syntax 3 §5.4.4 の読み方)。
 * value.replace(/\s*!\s*important\s*$/i, '').trim() と同じ結果。その正規表現は、空白の並びのどの位置からも照合を始めるので、
 * 空白の長い並びを含む値 (color: red + 空白 10 万個 + x) で、並びの長さの 2 乗の時間がかかった。末尾の空白を先に除いてから、「!」の位置だけで調べる
 */
export function stripImportant(value: string, between = true): string {
  const t = value.trimEnd();
  const m = (between ? /!\s*important$/i : /!important$/i).exec(t);
  return (m ? t.slice(0, m.index) : t).trim();
}

/**
 * 値の中の url(…) を、f の返す字に置き換える。f の引数は url() の中身 (引用符を外し、前後の空白を除いたもの)。
 * value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g, …) と同じ結果。その正規表現は、後ろに「)」の無い「url(」が並ぶ値
 * (url( を 5 万個。600KB) で、「url(」ごとに末尾まで探すので、長さの 2 乗の時間がかかった。「)」は最後のものより後ろには無いので、
 * そこまでだけを調べる (後ろの「url(」は、元の正規表現でも合わない)。引用符の無い中身は、最初の「)」までを取ってから空白を除く
 */
export function replaceUrls(value: string, f: (url: string, whole: string) => string, ignoreCase = false): string {
  const last = value.lastIndexOf(')');
  if (last < 0) return value;
  const re = ignoreCase ? /url\(\s*(?:"([^"]*)"\s*\)|'([^']*)'\s*\)|([^)]*)\))/gi : /url\(\s*(?:"([^"]*)"\s*\)|'([^']*)'\s*\)|([^)]*)\))/g;
  return value.slice(0, last + 1).replace(re, (m, a?: string, b?: string, c?: string) => f((a ?? b ?? c ?? '').trim(), m)) + value.slice(last + 1);
}

/** 値の中の url(…) の中身 (引用符を外し、前後の空白を除いたもの) を、現れた順に並べる (replaceUrls と同じ読み方。url は大文字でもよい) */
export function urlsIn(value: string): string[] {
  const out: string[] = [];
  replaceUrls(value, (u) => (out.push(u), ''), true);
  return out;
}

/**
 * 値を、括弧・文字列の外の空白で語に分ける (url(a b)・入れ子の括弧 calc(1mm + (2mm * 2)) の中では分けない。括弧の深さを数える)。
 * 空の値は、空の語 1 つを返す
 */
export const splitWords = (v: string): string[] => {
  const out = splitTop(v, ' ');
  return out.length ? out : [''];
};

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

/**
 * CSS の色 (名前・システムの色・#rgb(a)・#rrggbb(aa)・rgb()・rgba()・hsl()・hsla() と、Color 4 の hwb()・lab()・lch()・oklab()・oklch()・color()、
 * Color 5 の color-mix()) を読む (currentcolor は undefined ではなく 'current')。
 * Color 4・5 の関数は、sRGB の色域に収めた 8 ビットの sRGB にする (cssColorFunctions)。current は、color-mix() の中の currentcolor の色
 * (無ければ color の初期値の黒)
 */
export function parseColor(v: string, current?: RGBA): RGBA | 'current' | undefined {
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
  // light-dark(<color>, <color>) (CSS Color 5 §7): 要素の色の組 (color-scheme) が light なら前の色、dark なら後ろの色。
  // ここでは light の色にする (印刷の利用者の好みは light。dark の要素の値は、カスケードが resolveLightDark で先に選ぶ)。
  // 2 つとも色として読めなければ、色として読めない
  const ld = lightDarkArgs(s);
  if (ld) {
    const [l, d] = ld.map((x) => parseColor(x, current));
    return l === undefined || d === undefined ? undefined : l;
  }
  // none の成分 (Color 4 §4.4。新しい構文だけ) を書いた rgb()・hsl() は、Color 4 の関数と同じに読む (欠けた成分は 0)
  if (hasNoneComponent(s)) return parseColorFunction(s, (x) => parseColor(x), current ?? [0, 0, 0, 1]);
  const m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!m) return isColorFunction(s) ? parseColorFunction(s, (x) => parseColor(x), current ?? [0, 0, 0, 1]) : undefined;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  // 成分は数か百分率 (Color 4 §5.1・§7)。数として読めない成分 (rgb(1, 2, 3, foo) など) があれば、色として読めない
  const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/;
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

/** light-dark(a, b) の 2 つの引数 (括弧の外のカンマで分ける)。light-dark() でなければ undefined。s は小文字で前後の空白の無い値 */
function lightDarkArgs(s: string): [string, string] | undefined {
  if (!s.startsWith('light-dark(') || !s.endsWith(')')) return undefined;
  const args = splitTop(s.slice(11, -1), ',').map((x) => x.trim());
  return args.length === 2 && args.every(Boolean) ? (args as [string, string]) : undefined;
}

/**
 * 値の中の light-dark(<color>, <color>) (CSS Color 5 §7) を、要素の色の組 (dark が偽なら light) の側の色に置き換える。
 * 入れ子の light-dark() も、内側まで置き換える。引数の数が違うものは、そのまま残す (色として読めない値になる)
 */
export function resolveLightDark(v: string, dark: boolean): string {
  const re = /light-dark\(/gi;
  let out = '';
  let pos = 0;
  for (let m = re.exec(v); m; m = re.exec(v)) {
    // 名前の一部 (my-light-dark( など) は関数ではない
    if (m.index > 0 && /[-\w]/.test(v[m.index - 1])) continue;
    let depth = 0;
    let end = -1;
    for (let i = m.index + 10; i < v.length; i++) {
      const ch = v[i];
      if (ch === '"' || ch === "'") i = skipString(v, i) - 1;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    const args = splitTop(v.slice(m.index + 11, end), ',').map((x) => x.trim());
    if (args.length !== 2) continue;
    out += v.slice(pos, m.index) + resolveLightDark(args[dark ? 1 : 0], dark);
    pos = end + 1;
    re.lastIndex = pos;
  }
  return out + v.slice(pos);
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
  // 計算値を通らない値 (ページの文脈の宣言など) の、Color 4・5 の色の関数は、ここで sRGB にする
  if (isColorFunction(s.toLowerCase())) {
    const fc = parseColor(s);
    if (Array.isArray(fc)) return cssColor(fmtColor(fc));
  }
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

/**
 * 色指定のパース。#rgb / #rrggbb / rgb() / cmyk(c,m,y,k) (0-1 or 0-100%) / gray(g) (0 が黒、1 が白) / spot(濃度,c,m,y,k,名前)。
 * spot は特色 (PDF の Separation)。c,m,y,k は濃度 100% のときの代わりの CMYK、名前は encodeURIComponent したもの。
 * 特色の CMYK は、濃度を掛けた値 (Separation の濃度の変換を線形にしたものと同じ) で、spot に元の値を持つ
 */
export type ParsedColor =
  | { mode: 'rgb'; r: number; g: number; b: number }
  | { mode: 'cmyk'; c: number; m: number; y: number; k: number; spot?: SpotColor; gray?: boolean };

/** 特色 (PDF の Separation 色空間) */
export interface SpotColor {
  name: string;
  /** 濃度 (0〜1) */
  tint: number;
  /** 濃度 100% の代わりの CMYK (0〜1) */
  cmyk: [number, number, number, number];
}

/** 特色の色の文字列 (spot(濃度,c,m,y,k,名前)) */
export function spotColor(name: string, tint: number, cmyk: [number, number, number, number]): string {
  const t = Math.min(1, Math.max(0, tint));
  return `spot(${+t.toFixed(5)},${cmyk.map((x) => +x.toFixed(5)).join(',')},${encodeURIComponent(name).replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29'))})`;
}

/**
 * CSS / XSL-FO で使われる色名 (named colors) と値。
 * 出典: W3C「CSS Color Module Level 4」§6.1 Named Colors の表
 * (https://www.w3.org/TR/css-color-4/ 。取得した版は https://www.w3.org/TR/2026/CRD-css-color-4-20261029/ 、取得日 2026-10-31)。
 * 仕様の HTML の表をスクリプトで読み取って生成した (手で書き写していない)。148 の名前 (gray と grey などの別名を含む)。
 */
export const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc',
  bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc', crimson: '#dc143c', cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
  darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222',
  floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0',
  hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899',
  lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
  magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
  orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
  palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
  silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
  turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

export const isColorName = (s: string) => Object.hasOwn(NAMED_COLORS, s.trim().toLowerCase());

export function parseColor(input: string): ParsedColor {
  const s = (Object.hasOwn(NAMED_COLORS, input.trim().toLowerCase()) ? NAMED_COLORS[input.trim().toLowerCase()] : input).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = [...m[1]].map((h) => parseInt(h + h, 16) / 255);
    return { mode: 'rgb', r, g, b };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { mode: 'rgb', r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => parseFloat(v) / 255);
    return { mode: 'rgb', r, g, b };
  }
  m = /^spot\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',');
    const [t, c, mm, y, k] = p.slice(0, 5).map(Number);
    let name = p.slice(5).join(',');
    try {
      name = decodeURIComponent(name);
    } catch {
      /* 不正な % の並びは、そのまま */
    }
    return { mode: 'cmyk', c: c * t, m: mm * t, y: y * t, k: k * t, spot: { name, tint: t, cmyk: [c, mm, y, k] } };
  }
  // グレースケール (アンテナハウスの rgb-icc(#Grayscale, g))。墨の量 k = 1 − g の CMYK として扱い、PDF では DeviceGray で書く (gray)
  m = /^gray\(([^)]+)\)$/i.exec(s);
  if (m) {
    const g = Math.min(1, Math.max(0, parseFloat(m[1])));
    return { mode: 'cmyk', c: 0, m: 0, y: 0, k: 1 - (Number.isFinite(g) ? g : 0), gray: true };
  }
  m = /^cmyk\(([^)]+)\)$/i.exec(s);
  if (m) {
    const v = m[1].split(',').map((t) => {
      const x = parseFloat(t);
      return t.includes('%') || x > 1 ? x / 100 : x;
    });
    return { mode: 'cmyk', c: v[0], m: v[1], y: v[2], k: v[3] };
  }
  return { mode: 'rgb', r: 0, g: 0, b: 0 };
}

/** Canvas 用の CSS 色 (CMYK は単純変換) */
export function toCss(input: string): string {
  const c = parseColor(input);
  if (c.mode === 'rgb') return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  const r = 255 * (1 - c.c) * (1 - c.k);
  const g = 255 * (1 - c.m) * (1 - c.k);
  const b = 255 * (1 - c.y) * (1 - c.k);
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

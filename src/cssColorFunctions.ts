/**
 * cssColorFunctions — CSS Color 4 の色の関数 hwb()・lab()・lch()・oklab()・oklch()・color() と、CSS Color 5 の color-mix() を読み、
 * sRGB の色 (8 ビットの RGBA) にする。cssText の parseColor から呼ぶ (名前・16 進・rgb()・hsl() は cssText が読む)。
 *
 * 仕様 (原文を取得して読んだ版):
 *  - CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/ 。取得した版は W3C Candidate Recommendation Draft
 *    https://www.w3.org/TR/2026/CRD-css-color-4-20261103/ 、取得日 2026-11-10)
 *      §4.1.1 新しい構文 (成分は空白で区切り、alpha は / の後。none を書ける。カンマは使えない)、§4.2 alpha、§4.3 色相、§4.4 欠けた成分 (none)、
 *      §8 hwb()、§9.3 lab()・lch()、§9.4 oklab()・oklch()、§10 color() と定義済みの色空間、§11.2 色の変換の手順、
 *      §13 色の補間 (欠けた成分の引き継ぎ §13.4、alpha の前乗算 §13.5、色相の補間 §13.6)、§14.2 色域に収める手順、§20.3 ΔEOK
 *  - CSS Color Module Level 5 (https://www.w3.org/TR/css-color-5/ 。取得した版は W3C Working Draft
 *    https://www.w3.org/TR/2026/WD-css-color-5-20261029/ 、取得日 2026-11-10) §3 color-mix()
 *  - 百分率の正規化 (normalize mix percentages) は CSS Values 5 の編集者の草案 §6.1 (https://drafts.csswg.org/css-values-5/ 、
 *    2026-11-06 の版、取得日 2026-11-10。Color 5 §3.3 が参照する)
 *
 * 変換の行列・伝達関数・白色点の値と、HSL・HWB・Lab・Oklab の変換の式は、CSS Color 4 の本文の見本のコード
 * (§7.1・§7.2・§8.1・§8.2・§19 Sample code for Color Conversions、§20.3) の値と式を写したもの。
 * This software includes material copied from or derived from CSS Color Module Level 4
 * (https://www.w3.org/TR/2026/CRD-css-color-4-20261103/). Copyright © 2026 World Wide Web Consortium.
 * https://www.w3.org/copyright/software-license-2023/ (ライセンスの本文は THIRD_PARTY_NOTICES.md の 4 節。この文書については 11 節)
 *
 * Kumiori の出力の色は sRGB (PDF の DeviceRGB) なので、読んだ色は、その場で sRGB に直す (計算値を元の色空間のまま持たない)。
 * sRGB の色域の外の色は、Color 4 §14.2.1・§14.2.2 の「Binary Search Gamut Mapping with Local MINDE」(OkLCh で明るさと色相を保ち、
 * 彩度を下げる。仕様が挙げる 3 つの手順のうちの 1 つ) で色域に収める。
 * 成分の中の calc() と、相対色の構文 (Color 5 §4。lab(from …)) は読まない (色として読めない値になる)。
 */

/** 8 ビットの sRGB の色 (r・g・b は 0〜255 の整数、alpha は 0〜1)。cssText の RGBA と同じ形 */
type Rgba8 = [number, number, number, number];

type Space =
  | 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear' | 'a98-rgb' | 'prophoto-rgb' | 'rec2020' | 'xyz-d50' | 'xyz-d65'
  | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch';
type Vec = [number, number, number];
/** 成分 (null は欠けた成分 = none) */
type Comp = number | null;
interface Col {
  space: Space;
  c: [Comp, Comp, Comp];
  alpha: Comp;
}

// ───────────────────────── 変換 (Color 4 §19 の見本のコードの値) ─────────────────────────

type Mat = [Vec, Vec, Vec];
const mul = (m: Mat, v: Vec): Vec => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const map3 = (v: Vec, f: (x: number) => number): Vec => [f(v[0]), f(v[1]), f(v[2])];

/** 白色点 (CIE の x, y の 4 桁の値から) */
const D50: Vec = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];

const LIN_SRGB_TO_XYZ: Mat = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LIN_SRGB: Mat = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const LIN_P3_TO_XYZ: Mat = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LIN_P3: Mat = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];
/** prophoto-rgb は D50 の XYZ との間の行列 */
const LIN_PROPHOTO_TO_XYZ50: Mat = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const XYZ50_TO_LIN_PROPHOTO: Mat = [
  [1.3457868816471583, -0.25557208737979464, -0.05110186497554526],
  [-0.5446307051249019, 1.5082477428451468, 0.02052744743642139],
  [0, 0, 1.2119675456389452],
];
const LIN_A98_TO_XYZ: Mat = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];
const XYZ_TO_LIN_A98: Mat = [
  [1829569 / 896150, -506331 / 896150, -308931 / 896150],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040],
];
const LIN_2020_TO_XYZ: Mat = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
];
const XYZ_TO_LIN_2020: Mat = [
  [30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100],
  [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200],
  [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125],
];
/** Bradford の色順応 (D65 ↔ D50) */
const D65_TO_D50: Mat = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_TO_D65: Mat = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const XYZ_TO_LMS: Mat = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: Mat = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ: Mat = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS: Mat = [
  [1.0, 0.3963377773761749, 0.2158037573099136],
  [1.0, -0.1055613458156586, -0.0638541728258133],
  [1.0, -0.0894841775298119, -1.2914855480194092],
];

/** 伝達関数 (負の値にも広げたもの)。sRGB と display-p3 は同じ */
const linSrgb = (v: number) => (Math.abs(v) <= 0.04045 ? v / 12.92 : Math.sign(v) * Math.pow((Math.abs(v) + 0.055) / 1.055, 2.4));
const gamSrgb = (v: number) => (Math.abs(v) > 0.0031308 ? Math.sign(v) * (1.055 * Math.pow(Math.abs(v), 1 / 2.4) - 0.055) : 12.92 * v);
const linProPhoto = (v: number) => (Math.abs(v) <= 16 / 512 ? v / 16 : Math.sign(v) * Math.pow(Math.abs(v), 1.8));
const gamProPhoto = (v: number) => (Math.abs(v) >= 1 / 512 ? Math.sign(v) * Math.pow(Math.abs(v), 1 / 1.8) : 16 * v);
const powSigned = (e: number) => (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const linA98 = powSigned(563 / 256);
const gamA98 = powSigned(256 / 563);
const lin2020 = powSigned(2.4);
const gam2020 = powSigned(1 / 2.4);

/** HSL → sRGB (Color 4 §7.1)。sat・light は 0〜100、返す成分は 0〜1 */
function hslToRgb(hue: number, sat: number, light: number): Vec {
  const s = sat / 100;
  const l = light / 100;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
/** sRGB → 色相 (度。無彩色は NaN。Color 4 §8.2 の rgbToHue) */
function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = NaN;
  if (d !== 0) {
    hue = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    if (hue >= 360) hue -= 360;
  }
  return hue;
}
/** sRGB → HSL (Color 4 §7.2。色域の外の色の、負の彩度は色相を 180° 回して正にする)。色相の無い色は NaN */
function rgbToHsl(r: number, g: number, b: number): Vec {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (min + max) / 2;
  const d = max - min;
  const epsilon = 1 / 100000;
  let hue = NaN;
  let sat = 0;
  if (d !== 0) {
    sat = Math.abs(light) <= epsilon || Math.abs(1 - light) < epsilon ? 0 : (max - light) / Math.min(light, 1 - light);
    hue = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  if (sat < 0) {
    hue += 180;
    sat = Math.abs(sat);
  }
  if (hue >= 360) hue -= 360;
  if (sat <= epsilon) {
    hue = NaN;
    sat = 0;
  }
  return [hue, sat * 100, light * 100];
}
/** HWB → sRGB (Color 4 §8.1)。白と黒の和が 100 以上なら無彩色 */
function hwbToRgb(hue: number, white: number, black: number): Vec {
  const w = white / 100;
  const b = black / 100;
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  return map3(hslToRgb(hue, 100, 50), (x) => x * (1 - w - b) + w);
}
/** sRGB → HWB (Color 4 §8.2) */
function rgbToHwb(r: number, g: number, b: number): Vec {
  const white = Math.min(r, g, b);
  const black = 1 - Math.max(r, g, b);
  return [white + black >= 1 - 1 / 100000 ? NaN : rgbToHue(r, g, b), white * 100, black * 100];
}
/** Lab (D50) ↔ XYZ (D50)。ε = 6³/29³、κ = 29³/3³ */
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;
function labToXyz50(lab: Vec): Vec {
  const l116 = lab[0] / 116;
  const a500 = lab[1] / 500;
  const b200 = lab[2] / 200;
  const f1 = l116 + 16 / 116;
  const f0 = f1 + a500;
  const f2 = f1 - b200;
  const xyz: Vec = [
    Math.pow(f0, 3) > LAB_E ? Math.pow(f0, 3) : (l116 + a500) * (116 / LAB_K),
    lab[0] > LAB_K * LAB_E ? Math.pow((lab[0] + 16) / 116, 3) : lab[0] / LAB_K,
    Math.pow(f2, 3) > LAB_E ? Math.pow(f2, 3) : (l116 - b200) * (116 / LAB_K),
  ];
  return [xyz[0] * D50[0], xyz[1] * D50[1], xyz[2] * D50[2]];
}
function xyz50ToLab(xyz: Vec): Vec {
  const f = map3([xyz[0] / D50[0], xyz[1] / D50[1], xyz[2] / D50[2]], (v) => (v > LAB_E ? Math.cbrt(v) : (LAB_K * v + 16) / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const oklabToXyz = (lab: Vec): Vec => mul(LMS_TO_XYZ, map3(mul(OKLAB_TO_LMS, lab), (c) => c ** 3));
const xyzToOklab = (xyz: Vec): Vec => mul(LMS_TO_OKLAB, map3(mul(XYZ_TO_LMS, xyz), Math.cbrt));
/** 直交 (L, a, b) ↔ 極 (L, C, H。H は度、[0, 360)) (Color 4 §9.5・§9.6) */
const polarToRect = (lch: Vec): Vec => [lch[0], lch[1] * Math.cos((lch[2] * Math.PI) / 180), lch[1] * Math.sin((lch[2] * Math.PI) / 180)];
function rectToPolar(lab: Vec): Vec {
  const hue = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  return [lab[0], Math.sqrt(lab[1] ** 2 + lab[2] ** 2), hue < 0 ? hue + 360 : hue];
}

/** 色 → XYZ (D65)。欠けた成分は 0 (Color 4 §4.4・§11.2) */
function toXyz(col: Col): Vec {
  const v = col.c.map((x) => (x === null || Number.isNaN(x) ? 0 : x)) as Vec;
  switch (col.space) {
    case 'hsl':
      return mul(LIN_SRGB_TO_XYZ, map3(hslToRgb(v[0], v[1], v[2]), linSrgb));
    case 'hwb':
      return mul(LIN_SRGB_TO_XYZ, map3(hwbToRgb(v[0], v[1], v[2]), linSrgb));
    case 'srgb':
      return mul(LIN_SRGB_TO_XYZ, map3(v, linSrgb));
    case 'srgb-linear':
      return mul(LIN_SRGB_TO_XYZ, v);
    case 'display-p3':
      return mul(LIN_P3_TO_XYZ, map3(v, linSrgb));
    case 'display-p3-linear':
      return mul(LIN_P3_TO_XYZ, v);
    case 'a98-rgb':
      return mul(LIN_A98_TO_XYZ, map3(v, linA98));
    case 'prophoto-rgb':
      return mul(D50_TO_D65, mul(LIN_PROPHOTO_TO_XYZ50, map3(v, linProPhoto)));
    case 'rec2020':
      return mul(LIN_2020_TO_XYZ, map3(v, lin2020));
    case 'xyz-d50':
      return mul(D50_TO_D65, v);
    case 'xyz-d65':
      return v;
    case 'lab':
      return mul(D50_TO_D65, labToXyz50(v));
    case 'lch':
      return mul(D50_TO_D65, labToXyz50(polarToRect(v)));
    case 'oklab':
      return oklabToXyz(v);
    case 'oklch':
      return oklabToXyz(polarToRect(v));
  }
}
/** XYZ (D65) → 色空間の成分 (色域には収めない。Color 4 §11.1: 変換の結果は切り詰めない) */
function fromXyz(space: Space, xyz: Vec): Vec {
  switch (space) {
    case 'hsl':
      return rgbToHsl(...map3(mul(XYZ_TO_LIN_SRGB, xyz), gamSrgb));
    case 'hwb':
      return rgbToHwb(...map3(mul(XYZ_TO_LIN_SRGB, xyz), gamSrgb));
    case 'srgb':
      return map3(mul(XYZ_TO_LIN_SRGB, xyz), gamSrgb);
    case 'srgb-linear':
      return mul(XYZ_TO_LIN_SRGB, xyz);
    case 'display-p3':
      return map3(mul(XYZ_TO_LIN_P3, xyz), gamSrgb);
    case 'display-p3-linear':
      return mul(XYZ_TO_LIN_P3, xyz);
    case 'a98-rgb':
      return map3(mul(XYZ_TO_LIN_A98, xyz), gamA98);
    case 'prophoto-rgb':
      return map3(mul(XYZ50_TO_LIN_PROPHOTO, mul(D65_TO_D50, xyz)), gamProPhoto);
    case 'rec2020':
      return map3(mul(XYZ_TO_LIN_2020, xyz), gam2020);
    case 'xyz-d50':
      return mul(D65_TO_D50, xyz);
    case 'xyz-d65':
      return xyz;
    case 'lab':
      return xyz50ToLab(mul(D65_TO_D50, xyz));
    case 'lch':
      return rectToPolar(xyz50ToLab(mul(D65_TO_D50, xyz)));
    case 'oklab':
      return xyzToOklab(xyz);
    case 'oklch':
      return rectToPolar(xyzToOklab(xyz));
  }
}

// ───────────────────────── 色域に収める (Color 4 §14.2.1・§14.2.2) ─────────────────────────

const inSrgb = (rgb: Vec) => rgb.every((x) => x >= 0 && x <= 1);
const clip01 = (rgb: Vec): Vec => map3(rgb, (x) => Math.min(1, Math.max(0, x)));
const oklchToSrgb = (lch: Vec): Vec => map3(mul(XYZ_TO_LIN_SRGB, oklabToXyz(polarToRect(lch))), gamSrgb);
/** ΔEOK (Color 4 §20.3): Oklab での距離 */
const deltaEOK = (a: Vec, b: Vec) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/**
 * XYZ (D65) の色を、sRGB の色域に収めた sRGB の成分 (0〜1) にする。「Binary Search Gamut Mapping with Local MINDE」の見本の擬似コードのとおり:
 * OkLCh の明るさが 1 以上なら白、0 以下なら黒。色域の中ならそのまま。外なら、明るさと色相を保って彩度を二分探索で下げ、
 * 切り詰めた色との差 (ΔEOK) が、見分けられる差 (JND = 0.02) より小さくなった所の、切り詰めた色を返す
 */
export function gamutMapToSrgb(xyz: Vec): Vec {
  const origin = rectToPolar(xyzToOklab(xyz));
  if (origin[0] >= 1) return [1, 1, 1];
  if (origin[0] <= 0) return [0, 0, 0];
  const direct = map3(mul(XYZ_TO_LIN_SRGB, xyz), gamSrgb);
  if (inSrgb(direct)) return direct;
  const JND = 0.02;
  const EPSILON = 0.0001;
  const current: Vec = [origin[0], origin[1], origin[2]];
  const delta = (clippedRgb: Vec) => deltaEOK(xyzToOklab(mul(LIN_SRGB_TO_XYZ, map3(clippedRgb, linSrgb))), polarToRect(current));
  let clipped = clip01(direct);
  if (delta(clipped) < JND) return clipped;
  let min = 0;
  let max = origin[1];
  let minInGamut = true;
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2;
    current[1] = chroma;
    const rgb = oklchToSrgb(current);
    if (minInGamut && inSrgb(rgb)) {
      min = chroma;
      continue;
    }
    clipped = clip01(rgb);
    const e = delta(clipped);
    if (e < JND) {
      if (JND - e < EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else max = chroma;
  }
  return clipped;
}

/**
 * 色 → 8 ビットの sRGB。alpha の none は 0 (Color 4 §4.4)。
 * legacy は、sRGB に解決する色 (rgb()・hsl()・hwb()。§4.1・§15.1) か: 色域に収めずに成分を切り詰める
 */
function toRgba8(col: Col, legacy: boolean): Rgba8 {
  // sRGB の成分のままで色域の中にある色は、XYZ を経由しない (往復の誤差で 8 ビットの丸めが変わらないように)
  const own = col.space === 'srgb' ? (col.c.map((x) => x ?? 0) as Vec) : undefined;
  const [c0, c1, c2] = col.c.map((x) => x ?? 0);
  const legacyRgb = (): Vec => clip01(col.space === 'hwb' ? hwbToRgb(c0, c1, c2) : col.space === 'hsl' ? hslToRgb(c0, c1, c2) : [c0, c1, c2]);
  const rgb = legacy ? legacyRgb() : own && inSrgb(own) ? own : gamutMapToSrgb(toXyz(col));
  const to8 = (x: number) => Math.round(Math.min(255, Math.max(0, (Number.isFinite(x) ? x : 0) * 255)));
  return [to8(rgb[0]), to8(rgb[1]), to8(rgb[2]), Math.min(1, Math.max(0, col.alpha ?? 0))];
}

// ───────────────────────── 構文 ─────────────────────────

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const NUM_RE = new RegExp(`^${NUMBER}$`);
const PCT_RE = new RegExp(`^${NUMBER}%$`);
const HUE_RE = new RegExp(`^(${NUMBER})(deg|grad|rad|turn)?$`);

/** 括弧の外の区切り文字で分ける (前後の空白は除く。空の片も残す) */
function splitOuter(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (sep !== ' ' || cur) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (sep !== ' ' || cur) out.push(cur.trim());
  return out;
}

/** 数か百分率の成分 (none は null)。pctRef は 100% の値。読めなければ undefined */
function component(t: string, pctRef: number): Comp | undefined {
  if (t === 'none') return null;
  if (NUM_RE.test(t)) return parseFloat(t);
  if (PCT_RE.test(t)) return (parseFloat(t) / 100) * pctRef;
  return undefined;
}
/** 色相 (数は度。<angle> の単位は deg・grad・rad・turn。[0, 360) に正規化する。Color 4 §4.3)。none は null */
function hueComponent(t: string): Comp | undefined {
  if (t === 'none') return null;
  const m = HUE_RE.exec(t);
  if (!m) return undefined;
  const deg = parseFloat(m[1]) * { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[(m[2] ?? 'deg') as 'deg'];
  return Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0;
}
/** alpha (数か百分率。[0, 1] に丸める。Color 4 §4.2)。none は null */
function alphaComponent(t: string): Comp | undefined {
  const a = component(t, 1);
  return a === null || a === undefined ? a : Math.min(1, Math.max(0, a));
}
const clampComp = (v: Comp | undefined, lo: number, hi: number): Comp | undefined => (v === null || v === undefined ? v : Math.min(hi, Math.max(lo, v)));

const COLOR_SPACES: Record<string, Space> = {
  srgb: 'srgb', 'srgb-linear': 'srgb-linear', 'display-p3': 'display-p3', 'display-p3-linear': 'display-p3-linear', 'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb', rec2020: 'rec2020', xyz: 'xyz-d65', 'xyz-d50': 'xyz-d50', 'xyz-d65': 'xyz-d65',
};

/**
 * 新しい構文の色の関数 (hwb()・lab()・lch()・oklab()・oklch()・color()) を読む。s は小文字で、前後の空白は無い。読めなければ undefined。
 * 成分は空白で区切り、alpha は / の後 (Color 4 §4.1.1)。カンマは使えない。値の範囲:
 *  - hwb(): 白・黒は数か百分率 (100% = 100)
 *  - lab(): L は 0〜100 に丸める (100% = 100)、a・b の 100% = 125。lch(): C は 0 以上に丸める (100% = 150)
 *  - oklab(): L は 0〜1 に丸める (100% = 1)、a・b の 100% = 0.4。oklch(): C は 0 以上に丸める (100% = 0.4)
 *  - color(): 成分は数か百分率 (100% = 1)。範囲の外の値もそのまま持つ (§10.1)
 */
function parseFunction(s: string): Col | undefined {
  const m = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/s.exec(s);
  if (!m || m[2].includes(',') || /[()]/.test(m[2])) return undefined;
  const halves = m[2].split('/');
  if (halves.length > 2) return undefined;
  const parts = halves[0].trim().split(/\s+/).filter(Boolean);
  let alpha: Comp = 1;
  if (halves.length === 2) {
    const a = alphaComponent(halves[1].trim());
    if (a === undefined) return undefined;
    alpha = a;
  }
  const fn = m[1];
  if (fn === 'color') {
    const space = COLOR_SPACES[parts[0] ?? ''];
    if (!space || parts.length !== 4) return undefined;
    const c = parts.slice(1).map((t) => component(t, 1));
    return c.some((x) => x === undefined) ? undefined : { space, c: c as [Comp, Comp, Comp], alpha };
  }
  if (parts.length !== 3) return undefined;
  let c: Array<Comp | undefined>;
  // rgb()・hsl() の新しい構文 (Color 4 §5.1・§7.1。成分は数・百分率・none)。範囲の外の値は、読むときに範囲に丸める
  //  - rgb(): 成分は 0〜255 (100% = 255)。sRGB の 0〜1 にする
  //  - hsl(): 彩度・明度は数か百分率 (100% = 100)。彩度は 0 以上、明度は 0〜100 に丸める
  if (fn === 'rgb' || fn === 'rgba') {
    c = parts.map((t) => {
      const v = clampComp(component(t, 255), 0, 255);
      return v === null || v === undefined ? v : v / 255;
    });
    if (c.some((x) => x === undefined)) return undefined;
    return { space: 'srgb', c: c as [Comp, Comp, Comp], alpha };
  }
  if (fn === 'hsl' || fn === 'hsla') {
    c = [hueComponent(parts[0]), clampComp(component(parts[1], 100), 0, Infinity), clampComp(component(parts[2], 100), 0, 100)];
    if (c.some((x) => x === undefined)) return undefined;
    return { space: 'hsl', c: c as [Comp, Comp, Comp], alpha };
  }
  if (fn === 'hwb') c = [hueComponent(parts[0]), component(parts[1], 100), component(parts[2], 100)];
  else if (fn === 'lab') c = [clampComp(component(parts[0], 100), 0, 100), component(parts[1], 125), component(parts[2], 125)];
  else if (fn === 'lch') c = [clampComp(component(parts[0], 100), 0, 100), clampComp(component(parts[1], 150), 0, Infinity), hueComponent(parts[2])];
  else if (fn === 'oklab') c = [clampComp(component(parts[0], 1), 0, 1), component(parts[1], 0.4), component(parts[2], 0.4)];
  else c = [clampComp(component(parts[0], 1), 0, 1), clampComp(component(parts[1], 0.4), 0, Infinity), hueComponent(parts[2])];
  if (c.some((x) => x === undefined)) return undefined;
  return { space: fn as Space, c: c as [Comp, Comp, Comp], alpha };
}

// ───────────────────────── 補間 (Color 4 §13) と color-mix() (Color 5 §3) ─────────────────────────

/**
 * 成分の類 (Color 4 §13.4 の Analogous components の表)。XYZ は RGB の仲間として扱う。HWB の白・黒は、ほかの色空間に仲間が無い
 */
function categories(space: Space): [string, string, string] {
  switch (space) {
    case 'hsl':
      return ['hue', 'colorfulness', 'lightness'];
    case 'hwb':
      return ['hue', 'whiteness', 'blackness'];
    case 'lab':
    case 'oklab':
      return ['lightness', 'a', 'b'];
    case 'lch':
    case 'oklch':
      return ['lightness', 'colorfulness', 'hue'];
    default:
      return ['red', 'green', 'blue'];
  }
}
const isPolar = (space: Space) => space === 'hsl' || space === 'hwb' || space === 'lch' || space === 'oklch';
const hueIndex = (space: Space) => (space === 'hsl' || space === 'hwb' ? 0 : 2);

/**
 * 力の無い成分を欠けた成分にする (Color 4 §4.4.1 と §19 の powerlessToMissing。色相が意味を持たない色の色相を none にする):
 * hsl は S ≤ 0.001、hwb は W + B ≥ 99.999、lch は C ≤ 0.0015、oklch は C ≤ 0.000004
 */
function powerlessToMissing(c: [Comp, Comp, Comp], space: Space): [Comp, Comp, Comp] {
  const out: [Comp, Comp, Comp] = [c[0], c[1], c[2]];
  if (space === 'hsl' || space === 'lch' || space === 'oklch') {
    const k = 1; // 彩度 (hsl の S、lch・oklch の C)
    const h = hueIndex(space);
    const eps = space === 'hsl' ? 0.001 : space === 'lch' ? 0.0015 : 0.000004;
    if ((out[k] ?? 0) <= eps) {
      out[h] = null;
      if (out[k] !== null && out[k]! > 0) out[k] = 0;
    }
  } else if (space === 'hwb') {
    const white = out[1] ?? 0;
    const black = out[2] ?? 0;
    if (white + black >= 99.999) {
      out[0] = null;
      if (white + black < 100) {
        if (out[1] === null) out[2] = 100;
        else if (out[2] === null) out[1] = 100;
        else out[2] = 100 - out[1];
      }
    }
  }
  return out;
}

/**
 * 色を補間の色空間に直す (Color 4 §13 の手順の前半と §13.4):
 * 欠けた成分のうち、補間の色空間に仲間の成分があるものは、欠けたまま引き継ぐ。仲間の無い成分の組が、元の色ですべて欠けていれば、
 * 補間の色空間の残りの成分の組もすべて欠けた成分にする。色空間が同じなら、何も変えない
 */
function toInterpolationSpace(col: Col, space: Space): Col {
  if (col.space === space) return col;
  const src = powerlessToMissing(col.c, col.space);
  const from = categories(col.space);
  const to = categories(space);
  const xyz = toXyz({ space: col.space, c: src, alpha: col.alpha });
  const converted = fromXyz(space, xyz).map((x) => (Number.isNaN(x) ? null : x)) as [Comp, Comp, Comp];
  const c = isPolar(space) ? powerlessToMissing(converted, space) : converted;
  const restFrom = from.map((cat, k) => (to.includes(cat) ? -1 : k)).filter((k) => k >= 0);
  const restMissing = restFrom.length > 0 && restFrom.every((k) => src[k] === null);
  to.forEach((cat, k) => {
    const j = from.indexOf(cat);
    if (j >= 0 ? src[j] === null : restMissing) c[k] = null;
  });
  return { space, c, alpha: col.alpha };
}

type HueMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing';

/** 2 つの色 (同じ色空間) を、進み具合 p (b の割合) で補間する (Color 4 §13.2・§13.4〜§13.6) */
function interpolate(a: Col, b: Col, p: number, hue: HueMethod): Col {
  const space = a.space;
  // 一方だけが欠けた成分は、もう一方の値にする (alpha も同じ)。両方とも欠けていれば、結果も欠ける
  const fill = (x: Comp, y: Comp): [Comp, Comp] => (x === null ? [y, y] : y === null ? [x, x] : [x, y]);
  const ca: Comp[] = [];
  const cb: Comp[] = [];
  for (let k = 0; k < 3; k++) [ca[k], cb[k]] = fill(a.c[k], b.c[k]);
  const [aa, ab] = fill(a.alpha, b.alpha);
  const h = isPolar(space) ? hueIndex(space) : -1;
  // 色相の調整 (§13.6)
  if (h >= 0 && ca[h] !== null && cb[h] !== null) {
    let t1 = ca[h]!;
    let t2 = cb[h]!;
    const d = t2 - t1;
    if (hue === 'shorter') {
      if (d > 180) t1 += 360;
      else if (d < -180) t2 += 360;
    } else if (hue === 'longer') {
      if (d > 0 && d < 180) t1 += 360;
      else if (d > -180 && d <= 0) t2 += 360;
    } else if (hue === 'increasing') {
      if (t2 < t1) t2 += 360;
    } else if (t1 < t2) t1 += 360;
    ca[h] = t1;
    cb[h] = t2;
  }
  // 前乗算 (§13.5): alpha が none ならそのまま。色相には掛けない
  const pre = (c: Comp[], alpha: Comp) => c.map((x, k) => (x === null || alpha === null || k === h ? x : x * alpha));
  const pa = pre(ca, aa);
  const pb = pre(cb, ab);
  const mix = (x: Comp, y: Comp): Comp => (x === null || y === null ? null : x * (1 - p) + y * p);
  const alpha = mix(aa, ab);
  const c = pa.map((x, k) => {
    const v = mix(x, pb[k]);
    return v === null || alpha === null || alpha === 0 || k === h ? v : v / alpha;
  });
  if (h >= 0 && c[h] !== null) c[h] = ((c[h]! % 360) + 360) % 360;
  return { space, c: c as [Comp, Comp, Comp], alpha };
}

const MIX_SPACES: Record<string, Space> = { ...COLOR_SPACES, hsl: 'hsl', hwb: 'hwb', lab: 'lab', lch: 'lch', oklab: 'oklab', oklch: 'oklch' };

/**
 * color-mix( [in <色空間> [<色相の補間> hue]? ,]? [<色> && <百分率>?]# ) (Color 5 §3)。s は小文字。読めなければ undefined。
 *  - 色空間を書かなければ oklab (§3.1)。極座標の色空間の色相の補間は、書かなければ shorter
 *  - 百分率は 0%〜100% (範囲の外は不正)。正規化 (CSS Values 5 §6.1): 書いていない項目に残りを等分し、合計が 100% になるように
 *    掛け直す。合計が 100% に足りない分は、結果の alpha に掛ける (§3.3)
 *  - 3 つ以上の色は、先頭から順に 2 つずつ混ぜる (§3.3)
 */
function parseColorMix(s: string, parseAny: (v: string) => Col | undefined): Col | undefined {
  const m = /^color-mix\((.*)\)$/s.exec(s);
  if (!m) return undefined;
  const args = splitOuter(m[1], ',');
  let space: Space = 'oklab';
  let hue: HueMethod = 'shorter';
  if (/^in\s/.test(args[0] ?? '')) {
    const w = args.shift()!.split(/\s+/);
    const sp = MIX_SPACES[w[1] ?? ''];
    if (!sp) return undefined;
    space = sp;
    if (w.length === 4 && isPolar(sp) && /^(shorter|longer|increasing|decreasing)$/.test(w[2]) && w[3] === 'hue') hue = w[2] as HueMethod;
    else if (w.length !== 2) return undefined;
  }
  if (!args.length) return undefined;
  const items: Array<{ col: Col; pct?: number }> = [];
  for (const arg of args) {
    const words = splitOuter(arg, ' ');
    const pcts = words.filter((t) => PCT_RE.test(t));
    const rest = words.filter((t) => !PCT_RE.test(t));
    if (pcts.length > 1 || rest.length !== 1) return undefined;
    const pct = pcts.length ? parseFloat(pcts[0]) : undefined;
    if (pct !== undefined && (pct < 0 || pct > 100)) return undefined;
    const col = parseAny(rest[0]);
    if (!col) return undefined;
    items.push({ col: toInterpolationSpace(col, space), ...(pct !== undefined ? { pct } : {}) });
  }
  // 百分率の正規化 (CSS Values 5 §6.1。force normalization の旗あり)
  const specified = items.filter((it) => it.pct !== undefined);
  const specifiedSum = Math.min(100, specified.reduce((sum, it) => sum + it.pct!, 0));
  const omitted = items.length - specified.length;
  const pct = items.map((it) => it.pct ?? (100 - specifiedSum) / omitted);
  const total = pct.reduce((sum, x) => sum + x, 0);
  const leftover = total < 100 ? 100 - total : 0;
  const weights = total > 0 ? pct.map((x) => (x * 100) / total) : pct;
  // 先頭から順に混ぜる (Color 5 §3.3)
  let col = items[0].col;
  let acc = weights[0];
  for (let k = 1; k < items.length; k++) {
    const combined = acc + weights[k];
    col = interpolate(col, items[k].col, combined > 0 ? weights[k] / combined : 0.5, hue);
    acc = combined;
  }
  return { space: col.space, c: col.c, alpha: col.alpha === null ? null : col.alpha * (1 - leftover / 100) };
}

/** sRGB の成分 (0〜1) → OkLCh (L, C, H)。色域に収めた結果を確かめるためのもの */
export const srgbToOklch = (rgb: Vec): Vec => rectToPolar(xyzToOklab(mul(LIN_SRGB_TO_XYZ, map3(rgb, linSrgb))));

/** 色の関数の名前で始まる値か (cssText の parseColor が、ここへ回すかを決める) */
export const isColorFunction = (s: string) => /^(hwb|lab|lch|oklab|oklch|color|color-mix)\(/.test(s);

/**
 * hwb()・lab()・lch()・oklab()・oklch()・color()・color-mix() を読み、sRGB の色 (8 ビットの RGBA) にする。読めなければ undefined。
 * s は小文字にして前後の空白を除いた値。legacy は、ほかの色 (名前・16 進・rgb()・hsl()・transparent) の読み手 (color-mix() の中の色に使う)。
 * current は currentcolor の色 (color-mix() の中の currentcolor に使う)
 */
export function parseColorFunction(s: string, legacy: (v: string) => Rgba8 | 'current' | undefined, current: Rgba8): Rgba8 | undefined {
  const fromRgba = (c: Rgba8): Col => ({ space: 'srgb', c: [c[0] / 255, c[1] / 255, c[2] / 255], alpha: c[3] });
  const parseAny = (v: string, depth = 0): Col | undefined => {
    if (depth > 8) return undefined;
    if (v.startsWith('color-mix(')) return parseColorMix(v, (x) => parseAny(x, depth + 1));
    // 欠けた成分 (none) のある rgb()・hsl() は、欠けたまま混ぜる (Color 4 §13.4: 欠けた成分は、もう一方の色の成分を引き継ぐ)
    if (isColorFunction(v) || hasNoneComponent(v)) return parseFunction(v);
    const c = legacy(v);
    return c === undefined ? undefined : fromRgba(c === 'current' ? current : c);
  };
  const col = parseAny(s);
  return col ? toRgba8(col, /^(rgba?|hsla?|hwb)\(/.test(s)) : undefined;
}

/**
 * none の成分を書いた rgb()・rgba()・hsl()・hsla() か (新しい構文。Color 4 §4.4)。cssText の parseColor が、ここ (parseColorFunction) へ回すかを決める。
 * 欠けた成分は、色を描くときは 0 にする (§4.4.1「treat it as zero」)
 */
export const hasNoneComponent = (s: string) => /^(rgba?|hsla?)\(/.test(s) && /(^|[\s(/])none([\s)/]|$)/.test(s);

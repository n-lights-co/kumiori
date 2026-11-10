/**
 * 色の関数 (NC-07): CSS Color 4 の hwb()・lab()・lch()・oklab()・oklch()・color() と、CSS Color 5 の color-mix()。
 * 期待値は、仕様の本文の例の値 (CSS Color 4 https://www.w3.org/TR/2026/CRD-css-color-4-20261103/ 、
 * CSS Color 5 https://www.w3.org/TR/2026/WD-css-color-5-20261029/ )。出力は 8 ビットの sRGB
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { gamutMapToSrgb, srgbToOklch } from '../src/cssColorFunctions';
import { gradientSvg } from '../src/cssGradient';
import { cssColor, parseColor, type RGBA } from '../src/cssText';
import { shadowsOf } from '../src/htmlImport';

const rgba = (v: string, current?: RGBA) => parseColor(v, current) as RGBA;
/** 百分率の rgb (仕様の例の書き方) → 8 ビット */
const pct = (r: number, g: number, b: number, a = 1): RGBA => [Math.round(r * 2.55), Math.round(g * 2.55), Math.round(b * 2.55), a];
/** 各成分の差が tol 以下 (仕様の例の値は 4〜5 桁に丸めてあるので、8 ビットで 1 の差を許す) */
const near = (got: RGBA | undefined, want: RGBA, tol = 1) => {
  expect(got, 'color').toBeDefined();
  for (let k = 0; k < 3; k++) expect(Math.abs(got![k] - want[k]), `${got} ≒ ${want}`).toBeLessThanOrEqual(tol);
  expect(got![3]).toBeCloseTo(want[3], 3);
};

describe('hwb() (CSS Color 4 §8)', () => {
  it('仕様の例: hwb(150 20% 10%) = rgb(20% 90% 55%)、白と黒の和が 100% 以上なら無彩色', () => {
    near(rgba('hwb(150 20% 10%)'), pct(20, 90, 55));
    near(rgba('hwb(45 40% 80%)'), pct(33.33, 33.33, 33.33));
    expect(rgba('hwb(0 0% 0%)')).toEqual([255, 0, 0, 1]);
    expect(rgba('hwb(120 0 0)')).toEqual([0, 255, 0, 1]);
  });
  it('色相の単位・none・alpha (§4.2〜§4.4)', () => {
    expect(rgba('hwb(0.5turn 0% 0%)')).toEqual(rgba('hwb(180 0% 0%)'));
    expect(rgba('hwb(200grad 0% 0%)')).toEqual(rgba('hwb(180deg 0% 0%)'));
    expect(rgba('hwb(-120 0% 0%)')).toEqual([0, 0, 255, 1]);
    expect(rgba('hwb(none none none)')).toEqual([255, 0, 0, 1]);
    expect(rgba('HWB(0 0% 0% / 50%)')).toEqual([255, 0, 0, 0.5]);
    expect(rgba('hwb(0 0% 0% / 2)')[3]).toBe(1);
    expect(rgba('hwb(0 0% 0% / none)')[3]).toBe(0);
  });
  it('カンマで区切った書き方・成分の数の違いは読めない (§8: Using commas inside hwb() is an error)', () => {
    for (const v of ['hwb(0, 0%, 0%)', 'hwb(0 0%)', 'hwb(0 0% 0% 0%)', 'hwb(0 0% 0% / )', 'hwb(red 0% 0%)', 'hwb(0 0% 0% / 1 / 1)']) expect(parseColor(v), v).toBeUndefined();
  });
});

describe('lab()・lch()・oklab()・oklch() (CSS Color 4 §9)', () => {
  it('仕様の例 (§10.9): #7654cd = lab(44.36% 36.05 -58.99)', () => {
    near(rgba('lab(44.36% 36.05 -58.99)'), [0x76, 0x54, 0xcd, 1]);
    near(rgba('lab(44.36 36.05 -58.99)'), [0x76, 0x54, 0xcd, 1]);
    // a・b の百分率は 100% = 125 (§9.3)
    near(rgba('lab(44.36% 28.84% -47.192%)'), [0x76, 0x54, 0xcd, 1]);
  });
  it('仕様の例 (§11.1): oklch(65% 0.15 270) = lab(57.9% 11.4 -53.7) = #6c88ea', () => {
    near(rgba('oklch(65% 0.15 270)'), [0x6c, 0x88, 0xea, 1]);
    near(rgba('oklch(0.65 37.5% 270deg)'), [0x6c, 0x88, 0xea, 1]);
    near(rgba('lab(57.9% 11.4 -53.7)'), [0x6c, 0x88, 0xea, 1]);
  });
  it('仕様の例 (Color 5 §3.3・§3.4): teal・olive・blue の LCH・OkLCh・Oklab の値', () => {
    near(rgba('lch(47.9855% 31.6903 196.4524)'), [0, 128, 128, 1]);
    near(rgba('lch(52.1496% 56.8124 99.5746)'), [128, 128, 0, 1]);
    near(rgba('lch(29.5683% 131.201 301.364)'), [0, 0, 255, 1]);
    near(rgba('oklch(45.201% 0.31321 264.052)'), [0, 0, 255, 1]);
    near(rgba('oklab(54.31% -0.0896 -0.0236)'), [0, 128, 128, 1], 2);
    near(rgba('oklab(45.20% -0.0325 -0.3115)'), [0, 0, 255, 1], 2);
  });
  it('明るさは範囲に丸め、彩度は 0 以上に丸める。none は 0 (§9.3・§9.4・§4.4)', () => {
    expect(rgba('lab(100 0 0)')).toEqual([255, 255, 255, 1]);
    expect(rgba('lab(150% 0 0)')).toEqual([255, 255, 255, 1]);
    expect(rgba('lab(-10 0 0)')).toEqual([0, 0, 0, 1]);
    expect(rgba('oklab(1 0 0)')).toEqual([255, 255, 255, 1]);
    expect(rgba('oklab(0 0 0)')).toEqual([0, 0, 0, 1]);
    expect(rgba('lch(50% -20 30)')).toEqual(rgba('lch(50% 0 30)'));
    expect(rgba('oklch(0.5 none none)')).toEqual(rgba('oklab(0.5 0 0)'));
    expect(rgba('lab(none none none / 0.25)')).toEqual([0, 0, 0, 0.25]);
  });
  it('カンマ・単位の付いた成分は読めない', () => {
    for (const v of ['lab(50%, 0, 0)', 'lch(50% 10px 0)', 'oklab(0.5 0)', 'oklch(0.5 0.1 red)', 'lab(50% 0 0 / foo)']) expect(parseColor(v), v).toBeUndefined();
  });
});

describe('color() (CSS Color 4 §10)', () => {
  it('仕様の例 (§10.9): #7654cd = color(xyz-d50 …) = color(xyz-d65 …)、白', () => {
    near(rgba('color(xyz-d50 0.2005 0.14089 0.4472)'), [0x76, 0x54, 0xcd, 1]);
    near(rgba('color(xyz-d65 0.21661 0.14602 0.59452)'), [0x76, 0x54, 0xcd, 1]);
    near(rgba('color(xyz 0.21661 0.14602 0.59452)'), [0x76, 0x54, 0xcd, 1]);
    near(rgba('color(xyz-d50 0.9643 1 0.8251)'), [255, 255, 255, 1]);
    near(rgba('color(xyz-d65 0.9505 1 1.089)'), [255, 255, 255, 1]);
  });
  it('仕様の例 (§11.1): #6c88ea = color(display-p3 0.445 0.529 0.891) = color(rec2020 0.522 0.557 0.892)', () => {
    near(rgba('color(display-p3 0.445 0.529 0.891)'), [0x6c, 0x88, 0xea, 1]);
    near(rgba('color(rec2020 0.522 0.557 0.892)'), [0x6c, 0x88, 0xea, 1]);
  });
  it('srgb・srgb-linear・百分率・alpha・none', () => {
    expect(rgba('color(srgb 1 0.4 0)')).toEqual([255, 102, 0, 1]);
    expect(rgba('color(srgb 100% 40% 0% / 25%)')).toEqual([255, 102, 0, 0.25]);
    expect(rgba('color(srgb none 1 none)')).toEqual([0, 255, 0, 1]);
    // 伝達関数 (§10.2): 1.055 × 0.3^(1/2.4) − 0.055
    const g = Math.round((1.055 * Math.pow(0.3, 1 / 2.4) - 0.055) * 255);
    expect(rgba('color(srgb-linear 0.3 0.3 0.3)')).toEqual([g, g, g, 1]);
    expect(rgba('color(srgb-linear 1 1 1)')).toEqual([255, 255, 255, 1]);
    // 白はどの色空間でも白
    for (const sp of ['display-p3', 'display-p3-linear', 'a98-rgb', 'prophoto-rgb', 'rec2020']) expect(rgba(`color(${sp} 1 1 1)`), sp).toEqual([255, 255, 255, 1]);
    for (const sp of ['display-p3', 'display-p3-linear', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50']) expect(rgba(`color(${sp} 0 0 0)`), sp).toEqual([0, 0, 0, 1]);
  });
  it('知らない色空間・カンマ・成分の数の違いは読めない (§10.1)', () => {
    for (const v of ['color(profoto-rgb 0.4835 0.9167 0.2188)', 'color(srgb 1, 0, 0)', 'color(srgb 1 0)', 'color(1 0 0)', 'color(srgb 1 0 0 0)', 'color(lab 50 0 0)']) expect(parseColor(v), v).toBeUndefined();
  });
});

describe('sRGB の色域に収める (CSS Color 4 §14.2.1・§14.2.2)', () => {
  it('色域の中の色は変えない。色域の外の色は、明るさと色相を保って彩度を下げる', () => {
    // color(display-p3 0 1 0) は sRGB の外 (Color 5 §3.4 の例: color(srgb -0.5116 1.01827 -0.3107))
    // 明るさと色相は、元の色 oklch(0.8486 0.3659 145.6) から、見分けられる差 (JND = 0.02) の程度しか動かない
    const g = rgba('color(display-p3 0 1 0)');
    const [gl, gc, gh] = srgbToOklch([g[0] / 255, g[1] / 255, g[2] / 255]);
    expect(Math.abs(gl - 0.8486)).toBeLessThan(0.03);
    expect(Math.abs(gh - 145.6)).toBeLessThan(4);
    expect(gc).toBeLessThan(0.3659);
    // §11.1 の例: oklch(65% 0.25 270) = color(srgb 0.3475 0.4707 1.146) は色域の外
    const b = rgba('oklch(65% 0.25 270)');
    const [bl, bc, bh] = srgbToOklch([b[0] / 255, b[1] / 255, b[2] / 255]);
    expect(Math.abs(bl - 0.65)).toBeLessThan(0.03);
    expect(Math.abs(bh - 270)).toBeLessThan(4);
    expect(bc).toBeLessThan(0.25);
    // 色域の中の色は、そのまま (§14.2: relative colorimetric)
    expect(rgba('color(srgb 0.2 0.4 0.6)')).toEqual([51, 102, 153, 1]);
    near(rgba('oklch(0.628 0.2577 29.23)'), [255, 0, 0, 1]);
  });
  it('明るさが 100% 以上なら白、0% 以下なら黒 (彩度があっても)', () => {
    expect(rgba('oklch(1 0.4 30)')).toEqual([255, 255, 255, 1]);
    expect(rgba('oklch(0 0.4 30)')).toEqual([0, 0, 0, 1]);
    expect(rgba('color(xyz-d65 2 2 2)')).toEqual([255, 255, 255, 1]);
    expect(gamutMapToSrgb([0.5, 0.5, 0.5]).every((x) => x >= 0 && x <= 1)).toBe(true);
  });
});

describe('color-mix() (CSS Color 5 §3)', () => {
  it('仕様の例 (§3.2): 百分率の正規化。どの書き方も purple と plum の半々 = rgb(68.51% 36.01% 68.29%)', () => {
    const want = pct(68.51, 36.01, 68.29);
    for (const v of ['purple 50%, plum 50%', 'purple 50%, plum', 'purple, plum 50%', 'purple, plum', 'plum, purple', 'purple 80%, plum 80%', '50% purple, plum']) near(rgba(`color-mix(in lch, ${v})`), want);
    // 合計が 100% に足りない分は alpha に掛ける
    near(rgba('color-mix(in lch, purple 30%, plum 30%)'), pct(68.51, 36.01, 68.29, 0.6));
  });
  it('仕様の例 (§3.3): color-mix(in lch, teal 65%, olive) = rgb(7.7377% 52.5730% 37.3213%)', () => {
    near(rgba('color-mix(in lch, teal 65%, olive)'), pct(7.7377, 52.573, 37.3213));
  });
  it('仕様の例 (§3.3): 0% と 0% は半々で、alpha が 0。3 つの色は 3 等分', () => {
    expect(rgba('color-mix(in oklch, teal 0%, olive 0%)')[3]).toBe(0);
    near(rgba('color-mix(in oklab, teal, olive, blue)'), rgba('oklab(52.53% -0.0550 -0.0720)'), 2);
  });
  it('仕様の例 (§3.4): 色空間による違い。xyz-d50 の混色、白と青の混色', () => {
    near(rgba('color-mix(in xyz-d50, rgb(82.02% 30.21% 35.02%) 75.23%, rgb(5.64% 55.94% 85.31%))'), pct(72.3, 38.639, 53.557));
    near(rgba('color-mix(in lch, white, blue)'), rgba('lch(64.7841% 65.6008 301.364)'));
    near(rgba('color-mix(in oklch, white, blue)'), rgba('oklch(72.601% 0.15661 264.052)'));
    expect(rgba('color-mix(in srgb, white, blue)')).toEqual([128, 128, 255, 1]); // rgb(50% 50% 100%)
    // 白と黒: LCH では L = 50% の灰色、sRGB では rgb(50% 50% 50%)
    near(rgba('color-mix(in lch, white, black)'), rgba('lch(50% 0 none)'));
    expect(rgba('color-mix(in srgb, white, black)')).toEqual([128, 128, 128, 1]);
    near(rgba('color-mix(in xyz, white, black)'), rgba('lch(76% 0 none)'), 2);
  });
  it('仕様の例 (§3.5): alpha は前乗算して混ぜる。color(srgb 0.53846 0.46154 0 / 0.325)、百分率の合計が 80% なら alpha は 0.26', () => {
    near(rgba('color-mix(in srgb, rgb(100% 0% 0% / 0.7) 25%, rgb(0% 100% 0% / 0.2))'), [Math.round(0.53846 * 255), Math.round(0.46154 * 255), 0, 0.325]);
    near(rgba('color-mix(in srgb, rgb(100% 0% 0% / 0.7) 20%, rgb(0% 100% 0% / 0.2) 60%)'), [Math.round(0.53846 * 255), Math.round(0.46154 * 255), 0, 0.26]);
    // transparent との混色は、色を変えずに薄くする
    expect(rgba('color-mix(in srgb, red 40%, transparent)')).toEqual([255, 0, 0, 0.4]);
  });
  it('色空間を書かなければ oklab (§3.1)。色相の補間 (Color 4 §13.6)', () => {
    expect(rgba('color-mix(firebrick, goldenrod)')).toEqual(rgba('color-mix(in oklab, firebrick, goldenrod)'));
    // §13.6.1・§13.6.2 の例: oklch(0.6 0.24 30) と oklch(0.8 0.15 90) の中間は、shorter で色相 60、longer で 240
    near(rgba('color-mix(in oklch, oklch(0.6 0.24 30), oklch(0.8 0.15 90))'), rgba('oklch(0.7 0.195 60)'));
    near(rgba('color-mix(in oklch longer hue, oklch(0.6 0.24 30), oklch(0.8 0.15 90))'), rgba('oklch(0.7 0.195 240)'));
    // §13.6.3・§13.6.4 の例: oklch(0.5 0.1 30) と oklch(0.7 0.1 190) の中間は、increasing で 110、decreasing で 290
    near(rgba('color-mix(in oklch increasing hue, oklch(0.5 0.1 30), oklch(0.7 0.1 190))'), rgba('oklch(0.6 0.1 110)'));
    near(rgba('color-mix(in oklch decreasing hue, oklch(0.5 0.1 30), oklch(0.7 0.1 190))'), rgba('oklch(0.6 0.1 290)'));
  });
  it('欠けた成分は、もう一方の色の値を使う (Color 4 §13.4 の例)', () => {
    // oklch(78.3% 0.108 326.5) と oklch(39.2% 0.4 none): 色相は 326.5 のまま
    near(rgba('color-mix(in oklch, oklch(78.3% 0.108 326.5), oklch(39.2% 0.4 none))'), rgba('oklch(58.75% 0.254 326.5)'));
    // 白は hsl で色相が無い (§4.4 の例): white と green の混色は、緑の色相のまま明るくなる
    near(rgba('color-mix(in hsl, white 30%, green 70%)'), rgba('hsl(120 70% 47.57%)'));
    // alpha の none も、もう一方の値
    expect(rgba('color-mix(in oklch, oklch(0.783 0.108 326.5 / 0.5), oklch(0.392 0.4 0 / none))')[3]).toBeCloseTo(0.5, 6);
    // 両方とも欠けた成分は、結果でも欠ける (0 として描く)
    near(rgba('color-mix(in oklch, oklch(0.5 none none), oklch(0.7 none none))'), rgba('oklab(0.6 0 0)'));
  });
  it('currentcolor は、渡した色 (無ければ黒)。入れ子の color-mix()', () => {
    expect(rgba('color-mix(in srgb, currentcolor 50%, white)', [255, 0, 0, 1])).toEqual([255, 128, 128, 1]);
    expect(rgba('color-mix(in srgb, currentColor 50%, white)')).toEqual([128, 128, 128, 1]);
    expect(rgba('color-mix(in srgb, color-mix(in srgb, red, blue), white)')).toEqual([191, 128, 191, 1]);
  });
  it('読めない値: 範囲の外の百分率・知らない色空間・色でない引数・直交の色空間の色相の補間', () => {
    for (const v of ['color-mix(in srgb, red 120%, blue)', 'color-mix(in srgb, red -1%, blue)', 'color-mix(in foo, red, blue)', 'color-mix(in srgb, red, notacolor)', 'color-mix(in srgb longer hue, red, blue)', 'color-mix(in srgb)', 'color-mix()', 'color-mix(in srgb, red 10% 20%, blue)'])
      expect(parseColor(v), v).toBeUndefined();
  });
});

describe('文書の CSS で使う', () => {
  const computed = (css: string, sel = 'p') => {
    const d = new DOMParser().parseFromString('<html><head><title>t</title></head><body><div><p>a</p></div></body></html>', 'text/html') as unknown as Document;
    const src = cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } });
    return src.style(d.getElementsByTagName(sel)[0] as unknown as Element);
  };
  it('color・background-color・罫線の一括指定の中の色の関数', () => {
    const s = computed('p { color: oklch(65% 0.15 270); background-color: color(srgb 1 0.5 0 / 50%); border: 1px solid hwb(120 0% 0%); text-decoration-color: lab(100 0 0) }');
    expect(s.getPropertyValue('color')).toMatch(/^rgb\(10[789], 13[567], 23[345]\)$/);
    expect(s.getPropertyValue('background-color')).toBe('rgba(255, 128, 0, 0.5)');
    expect(s.getPropertyValue('border-top-color')).toBe('rgb(0, 255, 0)');
    expect(s.getPropertyValue('border-top-style')).toBe('solid');
    expect(s.getPropertyValue('text-decoration-color')).toBe('rgb(255, 255, 255)');
  });
  it('color-mix() の中の currentcolor: color では親の color、ほかの性質ではその要素の color (CSS Color 4 §15.5)', () => {
    const s = computed('div { color: rgb(255, 0, 0) } p { color: color-mix(in srgb, currentcolor, blue); background-color: color-mix(in srgb, currentColor 50%, black) }');
    expect(s.getPropertyValue('color')).toBe('rgb(128, 0, 128)');
    expect(s.getPropertyValue('background-color')).toBe('rgb(64, 0, 64)');
  });
  it('読めない色の関数の宣言は捨てる (前の宣言が残る)。var() の中の色の関数', () => {
    expect(computed('p { color: red; color: color(nosuch 1 0 0) }').getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(computed(':root { --c: color(srgb 0 0 1) } p { color: var(--c) }').getPropertyValue('color')).toBe('rgb(0, 0, 255)');
  });
  it('@supports', () => {
    expect(supportsCssDeclaration('color', 'oklch(0.5 0.1 30)')).toBe(true);
    expect(supportsCssDeclaration('background-color', 'color-mix(in oklab, red, blue)')).toBe(true);
    expect(supportsCssDeclaration('color', 'color(nosuch 1 0 0)')).toBe(false);
  });
  it('グラデーションの色の止まり・box-shadow の色', () => {
    const g = gradientSvg('linear-gradient(to right, color(srgb 1 0 0), oklab(1 0 0))', 100, 10);
    expect(g).toContain('#ff0000');
    expect(g).toContain('#ffffff');
    // 計算値を通らない値 (ページの文脈の宣言) の色: 半透明は白い紙に重ねた色
    expect(cssColor('color(srgb 0 0 1)')).toBe('#0000ff');
    expect(cssColor('Color-Mix(in srgb, red 40%, transparent)')).toBe('#ff9999');
    expect(cssColor('color(nosuch 0 0 1)')).toBe('color(nosuch 0 0 1)');
    // currentcolor を含む color-mix() の止まりは、currentcolor の止まりと同じく読まない
    expect(gradientSvg('linear-gradient(to right, color-mix(in srgb, currentcolor, red), blue)', 100, 10)).toBeUndefined();
    expect(shadowsOf('1px 2px 3px color(srgb 0 0 1 / 0.5)')).toEqual([{ dx: 0.75, dy: 1.5, color: '#0000ff', blur: 2.25, opacity: 0.5 }]);
    expect(shadowsOf('color-mix(in srgb, red, blue) 1px 2px')).toEqual([{ dx: 0.75, dy: 1.5, color: '#800080' }]);
  });
});

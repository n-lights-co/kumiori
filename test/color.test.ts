import { describe, expect, it } from 'vitest';
import { isColorName, parseColor, spotColor } from '../src/color';

/** '#rrggbb' を parseColor の rgb (0〜1) にする */
const rgbOf = (hex: string) => ({
  mode: 'rgb',
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
});

describe('色名 (src/color.ts)', () => {
  // 期待値は W3C の CSS Color Module Level 4 §6.1 Named Colors の表の値
  // (https://www.w3.org/TR/2026/CRD-css-color-4-20261029/ 、2026-10-31 取得)
  const SPEC: Array<[string, string]> = [
    ['rebeccapurple', '#663399'],
    ['slateblue', '#6a5acd'],
    ['dodgerblue', '#1e90ff'],
    ['lightgoldenrodyellow', '#fafad2'],
    ['darkslategrey', '#2f4f4f'],
  ];

  it('仕様の表から足した色名は、表の値になる', () => {
    for (const [name, hex] of SPEC) {
      expect(isColorName(name)).toBe(true);
      expect(parseColor(name)).toEqual(rgbOf(hex));
    }
  });

  it('色名の大文字・小文字と前後の空白は区別しない (これまでと同じ)', () => {
    expect(parseColor(' RebeccaPurple ')).toEqual(parseColor('rebeccapurple'));
    expect(isColorName('DodgerBlue')).toBe(true);
  });
});

describe('特色 (spot)', () => {
  it('spotColor の文字列を parseColor で読むと、濃度を掛けた CMYK と元の値になる (名前の括弧・コンマも戻る)', () => {
    const name = 'Ink (A), 2';
    const s = spotColor(name, 0.5, [0.2, 0.4, 0.6, 0.8]);
    const c = parseColor(s);
    expect(c.mode).toBe('cmyk');
    if (c.mode !== 'cmyk') return;
    expect([c.c, c.m, c.y, c.k].map((x) => +x.toFixed(5))).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(c.spot).toEqual({ name, tint: 0.5, cmyk: [0.2, 0.4, 0.6, 0.8] });
  });

  it('濃度は 0〜1 に収める', () => {
    expect(spotColor('x', 2, [0, 0, 0, 1])).toBe('spot(1,0,0,0,1,x)');
  });
});

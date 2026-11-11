/**
 * CSS のグラデーション (CSS Images 3 §3) を SVG にするところと、SVG の spreadMethod・fr の読み込みのテスト
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { firstGradient, gradientSvg, readGradientSvg } from '../src/cssGradient';
import { parseSvg } from '../src/svg';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const paintOf = (svgText: string) => parseSvg(svgText, parse)!.shapes[0].fillPaint!;

describe('CSS のグラデーション → SVG', () => {
  it('firstGradient: 括弧の入れ子を数えて、最初のグラデーションだけを取り出す', () => {
    expect(firstGradient('linear-gradient(rgb(1, 2, 3), red), url(a.png)')).toBe('linear-gradient(rgb(1, 2, 3), red)');
    expect(firstGradient('none')).toBeUndefined();
  });
  it('to right: 左端から右端への線。止まりは 0〜1', () => {
    const p = paintOf(gradientSvg('linear-gradient(to right, red, blue)', 200, 40)!);
    expect(p.kind).toBe('linear');
    const [x1, y1, x2, y2] = p.coords;
    expect([x1, x2]).toEqual([0, 200]);
    expect(y1).toBeCloseTo(y2, 6);
    expect(p.stops.map((s) => [s.offset, s.color])).toEqual([[0, '#ff0000'], [1, '#0000ff']]);
  });
  it('角度: 線の長さは |W sin θ| + |H cos θ| (§3.1.1)', () => {
    const p = paintOf(gradientSvg('linear-gradient(45deg, red, blue)', 200, 40)!);
    const [x1, y1, x2, y2] = p.coords;
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo((200 + 40) * Math.SQRT1_2, 3);
  });
  it('止まりの補正 (§3.4.3): 前の位置より小さい位置は前の位置に、位置の無い止まりは等分', () => {
    const p = paintOf(gradientSvg('linear-gradient(to right, red 50%, lime 20%, blue)', 100, 10)!);
    expect(p.stops.map((s) => s.offset)).toEqual([0.5, 0.5, 1]);
    const q = paintOf(gradientSvg('linear-gradient(to right, red, lime, blue, black)', 90, 10)!);
    expect(q.stops.map((s) => s.offset.toFixed(3))).toEqual(['0.000', '0.333', '0.667', '1.000']);
  });
  it('透明への補間は乗算済みの色で (§3.4.4): 途中の色は相手の色の色味のまま', () => {
    const p = paintOf(gradientSvg('linear-gradient(to right, yellow, transparent)', 100, 10)!);
    for (const s of p.stops) expect(s.color).toBe('#ffff00');
    expect(p.stops[p.stops.length - 1].opacity).toBe(0);
  });
  it('radial-gradient: circle at 位置、大きさは farthest-corner', () => {
    const p = paintOf(gradientSvg('radial-gradient(circle at 0 0, red, blue)', 30, 40)!);
    expect(p.kind).toBe('radial');
    const [, , , cx, cy, r] = p.coords;
    expect([cx, cy]).toEqual([0, 0]);
    expect(r).toBeCloseTo(50, 3);
  });
  it('repeating-linear-gradient: 箱を覆うまで止まりを繰り返す', () => {
    const p = paintOf(gradientSvg('repeating-linear-gradient(to right, red 0 10px, blue 10px 20px)', 60, 10)!);
    expect(p.stops.filter((s) => s.color === '#ff0000').length).toBeGreaterThanOrEqual(8);
  });
  it('読めない書き方は undefined', () => {
    expect(gradientSvg('linear-gradient(to nowhere, red, blue)', 10, 10)).toBeUndefined();
  });
});

describe('SVG の spreadMethod・fr', () => {
  const svg = (grad: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" viewBox="0 0 100 20"><defs>${grad}</defs><rect width="100" height="20" fill="url(#g)"/></svg>`;
  const stops = '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>';
  it('repeat: 図形を覆うまで止まりを繰り返し、座標を広げる', () => {
    const p = paintOf(svg(`<linearGradient id="g" x1="0" x2="0.25" spreadMethod="repeat">${stops}</linearGradient>`));
    expect(p.coords[0]).toBeCloseTo(0, 6);
    expect(p.coords[2]).toBeCloseTo(1, 6);
    expect(p.stops.map((s) => [Number(s.offset.toFixed(3)), s.color])).toEqual([
      [0, '#000000'], [0.25, '#ffffff'], [0.25, '#000000'], [0.5, '#ffffff'], [0.5, '#000000'], [0.75, '#ffffff'], [0.75, '#000000'], [1, '#ffffff'],
    ]);
  });
  it('reflect: 1 つおきに止まりを逆に並べる', () => {
    const p = paintOf(svg(`<linearGradient id="g" x1="0" x2="0.5" spreadMethod="reflect">${stops}</linearGradient>`));
    expect(p.stops.map((s) => [Number(s.offset.toFixed(3)), s.color])).toEqual([[0, '#000000'], [0.5, '#ffffff'], [0.5, '#ffffff'], [1, '#000000']]);
  });
  it('pad (既定): そのまま', () => {
    const p = paintOf(svg(`<linearGradient id="g" x1="0" x2="0.5">${stops}</linearGradient>`));
    expect(p.coords).toEqual([0, 0, 0.5, 0]);
    expect(p.stops.length).toBe(2);
  });
  it('fr: 焦点の円の半径を始めの円の半径にする', () => {
    const p = paintOf(svg(`<radialGradient id="g" r="0.5" fr="0.2">${stops}</radialGradient>`));
    expect(p.coords).toEqual([0.5, 0.5, 0.2, 0.5, 0.5, 0.5]);
  });
  it('円形の repeat: 半径 0 から図形を覆う半径まで', () => {
    const p = paintOf(svg(`<radialGradient id="g" r="0.25" spreadMethod="repeat">${stops}</radialGradient>`));
    const [, , r0, , , r1] = p.coords;
    expect(r0).toBe(0);
    // 外接矩形の角 (グラデーションの空間で中心から √0.5) を覆う
    expect(r1).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-9);
    expect(p.stops.filter((s) => s.color === '#000000').length).toBeGreaterThanOrEqual(3);
  });
});

describe('グラデーションの SVG を読み戻す (Canvas が、PDF と同じ線・同じ止まりで描くため。OUT-19)', () => {
  it('線形: 線の両端と止まりが、SVG を図形として読んだもの (PDF の道) と同じ', () => {
    const text = gradientSvg('linear-gradient(45deg, #ff0 0%, #0a0 50%, rgba(0, 0, 255, 0.5) 100%)', 200, 40)!;
    const g = readGradientSvg(text)!;
    const p = paintOf(text);
    expect(g.kind).toBe('linear');
    if (g.kind !== 'linear') return;
    expect([g.width, g.height]).toEqual([200, 40]);
    g.coords.forEach((v, i) => expect(v).toBeCloseTo(p.coords[i], 6));
    expect(g.stops.map((s) => [s.offset, s.color, s.opacity])).toEqual(p.stops.map((s) => [s.offset, s.color, s.opacity ?? 1]));
  });
  it('放射: 円は中心と半径、楕円は縦の倍率が付く', () => {
    const c = readGradientSvg(gradientSvg('radial-gradient(circle closest-side at 30% 50%, white, black)', 200, 40)!)!;
    expect(c).toMatchObject({ kind: 'radial', cx: 60, cy: 20, r: 20, scaleY: 1 });
    const e = readGradientSvg(gradientSvg('radial-gradient(ellipse closest-side, red, blue)', 200, 40)!)!;
    expect(e).toMatchObject({ kind: 'radial', cx: 100, cy: 20, r: 100, scaleY: 0.2 });
    expect(e.kind === 'radial' && e.stops.map((s) => s.color)).toEqual(['#ff0000', '#0000ff']);
  });
  it('繰り返し: 並べた止まりをそのまま読む。繰り返しの長さが 0 のものは一色', () => {
    const text = gradientSvg('repeating-linear-gradient(to right, red 0 10pt, blue 10pt 20pt)', 100, 10)!;
    const g = readGradientSvg(text)!;
    expect(g.kind === 'linear' && g.stops.length).toBe(paintOf(text).stops.length);
    expect(readGradientSvg(gradientSvg('repeating-linear-gradient(red 5pt, blue 5pt)', 100, 10)!)).toEqual({ kind: 'solid', width: 100, height: 10, color: '#0000ff' });
  });
  it('gradientSvg の形でない SVG は読まない', () => {
    expect(readGradientSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle r="5"/></svg>')).toBeUndefined();
    expect(readGradientSvg('')).toBeUndefined();
  });
});

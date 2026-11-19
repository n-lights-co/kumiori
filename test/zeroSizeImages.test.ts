/**
 * 大きさ 0 の画像 (幅だけ 0・高さだけ 0・両方 0・本来の大きさが 0) に、最小・最大の幅と高さ・aspect-ratio・object-fit を当てても、
 * 0 で割らない (Area Tree と PDF に NaN・Infinity を出さない)。
 *  - CSS 2.1 §10.4 の表は、幅と高さの両方が auto のときのもの。片方が決まっていれば、その値に、その向きの最小・最大を当て、
 *    もう一方は縦横比から出して、その向きの最小・最大を当てる (§10.3.2・§10.6.2)。両方が決まっていれば、それぞれに当てる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { constrainReplaced } from '../src/htmlImport';
import { encodePngStored } from '../src/pixels';
import { DEFAULT_FONTS, typesetHtml, walkAreaTree } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const PNG = encodePngStored({ width: 40, height: 20, rgba: new Uint8Array(40 * 20 * 4).fill(200) });
const SVG0 = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10" viewBox="0 0 0 10"><rect width="5" height="5"/></svg>');
const SVGV0 = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><rect width="5" height="5"/></svg>');
const SVGH0 = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="0"><rect width="5" height="5"/></svg>');
const files = [
  { name: 'h.svg', data: SVGH0 },
  { name: 'a.png', data: PNG },
  { name: 'z.svg', data: SVG0 },
  { name: 'v.svg', data: SVGV0 },
];
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 40pt } html { font-size: 10pt } body { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont: loadCachedFont, files });
const images = (t: AreaTree) => {
  const out: Area[] = [];
  walkAreaTree(t, (a) => {
    if (a.type === 'image') out.push(a);
  });
  return out;
};
/** Area Tree の数が、どれも有限 (NaN・Infinity・null の座標が無い) */
const finite = (t: AreaTree) => {
  const s = JSON.stringify(t.sheets, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `BAD:${v}` : v));
  return !/BAD:|"(x|y|width|height)":null/.test(s);
};

describe('constrainReplaced: 大きさ 0 では、縦横比で割らない', () => {
  it('幅か高さが 0 なら、それぞれの向きに最小・最大を当てる', () => {
    expect(constrainReplaced(0, 0, 10, Infinity, 0, Infinity)).toEqual([10, 0]);
    expect(constrainReplaced(0, 20, 10, Infinity, 0, 5)).toEqual([10, 5]);
    expect(constrainReplaced(30, 0, 0, 20, 4, Infinity)).toEqual([20, 4]);
    for (const [w, h] of [[0, 0], [0, 7], [7, 0]])
      for (const [a, b, c, d] of [[5, Infinity, 5, Infinity], [0, 3, 0, 3], [5, 3, 0, 9]]) for (const v of constrainReplaced(w, h, a, b, c, d)) expect(Number.isFinite(v)).toBe(true);
  });
  it('0 でない大きさは、これまでどおり縦横比を保つ', () => {
    expect(constrainReplaced(40, 20, 0, 20, 0, Infinity)).toEqual([20, 10]);
    expect(constrainReplaced(40, 20, 80, Infinity, 0, Infinity)).toEqual([80, 40]);
  });
});

describe('大きさ 0 の画像に、最小・最大の幅と高さを当てる (CSS 2.1 §10.4)', () => {
  const img = async (tag: string, css = '') => {
    const r = await set(page(`<p>a${tag}b</p>`, css));
    expect(finite(r.areaTree), tag).toBe(true);
    const i = images(r.areaTree)[0];
    return i && { width: Math.round(i.width * 100) / 100, height: Math.round(i.height * 100) / 100 };
  };
  it('height="0" と min-width: 高さは 0 のまま、幅は最小の幅', async () => {
    expect(await img('<img src="a.png" height="0" style="min-width:10px">')).toEqual({ width: 7.5, height: 0 });
    expect(await img('<img src="a.png" style="height:0;min-width:10pt">')).toEqual({ width: 10, height: 0 });
  });
  it('width="0" と min-height: 幅は 0 のまま、高さは最小の高さ', async () => {
    expect(await img('<img src="a.png" width="0" style="min-height:10pt">')).toEqual({ width: 0, height: 10 });
  });
  it('両方 0 と、最小・最大の幅と高さ', async () => {
    expect(await img('<img src="a.png" width="0" height="0" style="min-width:8pt;min-height:6pt">')).toEqual({ width: 8, height: 6 });
    expect(await img('<img src="a.png" width="0" height="0" style="max-width:8pt;max-height:6pt">')).toEqual({ width: 0, height: 0 });
  });
  it('片方の大きさを決めた画像は、決めた向きを最小・最大でだけ変え、もう一方を縦横比から出す', async () => {
    // 本来 40×20 (縦横比 2:1)。幅 40pt と max-height 10pt: 幅は 40pt のまま、高さは 20pt → 10pt
    expect(await img('<img src="a.png" style="width:40pt;max-height:10pt">')).toEqual({ width: 40, height: 10 });
    // 高さ 10pt と max-width 10pt: 幅は 20pt → 10pt、高さは 10pt のまま
    expect(await img('<img src="a.png" style="height:10pt;max-width:10pt">')).toEqual({ width: 10, height: 10 });
    // 幅 40pt と max-width 20pt: 幅は 20pt、高さは縦横比から 10pt
    expect(await img('<img src="a.png" style="width:40pt;max-width:20pt">')).toEqual({ width: 20, height: 10 });
  });
  it('aspect-ratio・object-fit・背景の画像・本来の大きさが 0 の SVG でも、NaN・Infinity を出さない', async () => {
    for (const tag of [
      '<img src="a.png" width="0" style="aspect-ratio:2/1;min-height:5pt">',
      '<img src="a.png" height="0" style="aspect-ratio:0/1;min-width:5pt">',
      '<img src="a.png" width="0" height="0" style="object-fit:contain">',
      '<img src="a.png" width="0" height="10" style="object-fit:cover">',
      '<img src="a.png" width="10" height="0" style="object-fit:scale-down">',
      '<img src="a.png" width="0" height="10" style="object-fit:none">',
      '<img src="z.svg" style="min-width:10pt">',
      '<img src="z.svg" style="max-height:5pt">',
      '<img src="v.svg" style="min-width:10pt;min-height:3pt">',
      '<img src="v.svg">',
      '<img src="z.svg" width="10">',
      '<img src="z.svg" height="10">',
      '<img src="z.svg" width="10" height="10">',
      '<img src="v.svg" width="10">',
      '<img src="v.svg" width="10" height="10">',
      '<img src="v.svg" width="10" height="10" style="object-fit:contain">',
      '<img src="h.svg" width="10">',
      '<img src="h.svg" width="10" height="10">',
      '<span style="display:inline-block;width:0;height:10pt;background:url(a.png);background-size:contain"></span>',
      '<span style="display:inline-block;width:10pt;height:0;background:url(a.png);background-size:cover"></span>',
      '<span style="display:inline-block;width:10pt;height:10pt;background:url(a.png);background-size:0 auto"></span>',
      '<span style="display:inline-block;width:10pt;height:10pt;background:url(v.svg);background-size:contain"></span>',
    ]) {
      const r = await set(page(`<p>a${tag}b</p>`));
      expect(finite(r.areaTree), tag).toBe(true);
    }
  });
  it('ページの背景・XSL-FO の画像でも、NaN・Infinity を出さない', async () => {
    for (const [css, body] of [
      ['@page { background: url(v.svg) no-repeat; background-size: 10pt auto }', 'a'],
      ['@page { background: url(h.svg) no-repeat; background-size: auto 10pt }', 'a'],
      ['@page { background: url(z.svg) no-repeat; background-size: auto 10pt }', 'a'],
      ['@page { background: url(h.svg) no-repeat; background-size: 50% auto }', 'a'],
    ]) {
      const r = await set(page(`<p>${body}</p>`, css));
      expect(finite(r.areaTree), css).toBe(true);
    }
  });
});

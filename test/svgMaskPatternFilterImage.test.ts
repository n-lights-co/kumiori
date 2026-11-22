/**
 * SVG の模様・filter の回帰テスト:
 *  - mask を付けたグループの中にある模様 (pattern) の塗りが、外のマスクを模様の中身に持ち込み、「pattern content」で読めなかった。
 *    pattern の中身は、参照する要素の状態 (切り抜き・マスク) を受け継がない (SVG 2 §14.3.1)
 *  - 画像・模様に色を変える filter (feColorMatrix・feComponentTransfer) を付けると、図形に当てる段で「filter color」になり、
 *    画素の計算に回らずに SVG ごと仮の枠になった。図形で色を変えられないときも、画素で計算する (Filter Effects 1 §9.6・§9.7)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseSvg, type SvgShape } from '../src/svg';
import { rasterFilter } from '../src/svgFilterRaster';
import { encodePngStored } from '../src/pixels';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`;
const opts = { approximateFilters: true, rasterFilter, filterResolution: 1 };
/** 赤一色の 4×4 の PNG の data: URL */
const RED = `data:image/png;base64,${Buffer.from(encodePngStored({ width: 4, height: 4, rgba: new Uint8Array(4 * 4 * 4).map((_, k) => (k % 4 === 0 || k % 4 === 3 ? 255 : 0)) })).toString('base64')}`;
/** 図形の並び (グループの中も) */
const all = (shapes: SvgShape[]): SvgShape[] => shapes.flatMap((s) => [s, ...all(s.group?.shapes ?? [])]);
/** 画素で計算した結果の画像の、真ん中の画素 */
const center = (shapes: SvgShape[]) => {
  const px = all(shapes).find((x) => x.image?.pixels)?.image?.pixels;
  if (!px) return undefined;
  const k = (Math.floor(px.height / 2) * px.width + Math.floor(px.width / 2)) * 4;
  return Array.from(px.rgba.subarray(k, k + 4));
};

describe('mask を付けたグループの中の模様の塗り', () => {
  const PATTERN = '<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#f00"/></pattern>';
  const MASK = '<mask id="m"><rect width="100" height="100" fill="#fff"/></mask>';
  it('模様の中身はマスクを持たず、マスクは模様で塗った図形に当たる (直す前は「pattern content」で読めなかった)', () => {
    const d = parseSvg(svg(`${PATTERN}${MASK}<g mask="url(#m)"><rect width="50" height="50" fill="url(#p)"/></g>`), parse);
    expect(d).not.toBeNull();
    const sh = all(d!.shapes).find((x) => x.fillPattern)!;
    expect(sh).toBeDefined();
    expect(sh.fillPattern!.shapes.some((x) => x.masks)).toBe(false);
    expect(sh.masks?.length).toBe(1);
  });
  it('模様の中身の mask は、これまでどおり描けない (タイルの中ではマスクを描けない)', () => {
    const why: string[] = [];
    const d = parseSvg(svg(`${MASK}<pattern id="q" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#f00" mask="url(#m)"/></pattern><rect width="50" height="50" fill="url(#q)"/>`), parse, { onUnsupported: (m) => why.push(m) });
    expect(d).toBeNull();
    expect(why).toEqual(['pattern content']);
  });
});

describe('画像・模様に色を変える filter は、画素で計算する', () => {
  const GRAY = '<filter id="g"><feColorMatrix type="saturate" values="0"/></filter>';
  it('画像を灰色にする (直す前は「filter color」で仮の枠)', () => {
    const d = parseSvg(svg(`${GRAY}<image width="40" height="40" href="${RED}" filter="url(#g)"/>`), parse, opts);
    const c = center(d!.shapes)!;
    expect(c).toBeDefined();
    // 赤 (1, 0, 0) の彩度を 0 にすると、輝度 0.213 の灰色 (Filter Effects 1 §9.6。color-interpolation-filters の既定の linearRGB で
    // 計算するので、sRGB では 127 ほど。図形の色の変換 (下の #7f7f7f) と同じ)
    expect(Math.abs(c[0] - c[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(c[1] - c[2])).toBeLessThanOrEqual(2);
    expect(Math.abs(c[0] - 127)).toBeLessThanOrEqual(3);
    expect(c[3]).toBe(255);
  });
  it('模様の塗りに feComponentTransfer を当てる', () => {
    const f = '<filter id="t"><feComponentTransfer><feFuncR type="linear" slope="0"/><feFuncG type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>';
    const p = '<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#f00"/></pattern>';
    const d = parseSvg(svg(`${f}${p}<rect width="40" height="40" fill="url(#p)" filter="url(#t)"/>`), parse, opts);
    // 赤 → 赤の成分を 0、緑の成分を 1: 緑
    expect(center(d!.shapes)).toEqual([0, 255, 0, 255]);
  });
  it('mask の中のグループに feColorMatrix (アイコンの塗り替え)', () => {
    const d = parseSvg(svg(`${GRAY}<mask id="m"><g filter="url(#g)"><image width="100" height="100" href="${RED}"/></g></mask><rect width="100" height="100" fill="#00f" mask="url(#m)"/>`), parse, opts);
    expect(d).not.toBeNull();
    const sh = all(d!.shapes).find((x) => x.masks)!;
    expect(all(sh.masks![0].shapes).some((x) => x.image?.pixels)).toBe(true);
  });
  it('図形の色の変換は、これまでどおり図形で描く (画素にしない)', () => {
    const d = parseSvg(svg(`${GRAY}<rect width="40" height="40" fill="#f00" filter="url(#g)"/>`), parse, opts);
    expect(all(d!.shapes).some((x) => x.image)).toBe(false);
    expect(all(d!.shapes).find((x) => x.fill)?.fill).toBe('#7f7f7f');
  });
});

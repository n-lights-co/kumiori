/**
 * 右から左へ進む本 (根元の要素が vertical-rl) の float: inside・outside (アンテナハウス互換の組み方): 奇数ページは左ページで、綴じ側は右
 * (CSS Paged Media 3 §3.3。@page の :left・:right と同じ決まり)。前は、奇数ページの綴じ側を左にしていたので、inside が小口側に出た
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの、背景のある箱の x (pt) */
const xs = async (wm: string, side: string) => {
  const html = `<!DOCTYPE html><html style="writing-mode:${wm}"><head><style>@page{size:300pt 200pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} .f{float:${side};width:20pt;height:20pt;background:#f00}</style></head><body><div class="f"></div><p>本文</p><p style="break-before:page">本文</p><div class="f"></div><p>本文</p></body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont, style: 'ah' });
  return r.areaTree.sheets.map((s) => {
    const out: number[] = [];
    const rec = (a: Area, ox: number) => {
      const x = ox + (a.x ?? 0);
      if (a.type === 'block' && (a as { backgroundColor?: string }).backgroundColor) out.push(Math.round(x) + 0);
      for (const c of childrenOf(a)) rec(c as Area, x);
    };
    rec(s.page as unknown as Area, 0);
    return out;
  });
};

describe('右から左へ進む本の float: inside・outside', () => {
  it('奇数ページ (左ページ) の inside は右 (綴じ側)、偶数ページ (右ページ) の inside は左', async () => {
    expect(await xs('vertical-rl', 'inside')).toEqual([[280], [0]]);
    expect(await xs('vertical-rl', 'outside')).toEqual([[0], [280]]);
  });
  it('左から右へ進む本 (vertical-lr) は、前のとおり奇数ページの綴じ側が左', async () => {
    expect(await xs('vertical-lr', 'inside')).toEqual([[0], [280]]);
  });
});

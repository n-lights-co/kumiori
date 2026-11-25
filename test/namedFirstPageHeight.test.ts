/**
 * 文書の最初のページが名前付きのページのときの、根元の要素の百分率の高さ (CSS Paged Media 3 §3.3: 根元の要素の包含ブロックは、
 * 最初のページのページ領域)。前は、名前の無いページ (@page) の領域の高さで決め、body { page: 表紙 } の表紙の height: 100% が、
 * 表紙のページからはみ出していた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページの数と、背景のあるブロックの高さ (pt) */
const run = async (css: string) => {
  const html = `<!DOCTYPE html><html><head><style>@page{size:300pt 400pt;margin:0} @page cover{size:300pt 200pt;margin:10pt} html,body{height:100%;margin:0} body{font-size:10pt;line-height:10pt} div{height:50%;background:#f00} ${css}</style></head><body><div>A</div></body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const hs: number[] = [];
  const rec = (a: Area) => {
    if (a.type === 'block' && (a as { backgroundColor?: string }).backgroundColor) hs.push(Math.round(a.height));
    for (const c of childrenOf(a)) rec(c as Area);
  };
  for (const s of r.areaTree.sheets) rec(s.page as unknown as Area);
  return { pages: r.areaTree.sheets.length, hs };
};

describe('名前付きの最初のページの、根元の要素の百分率の高さ', () => {
  it('body の page の名前のページの領域の高さで決める', async () => {
    expect(await run('body{page:cover}')).toEqual({ pages: 1, hs: [90] });
    expect(await run('html{page:cover}')).toEqual({ pages: 1, hs: [90] });
  });
  it('名前の無いページは、前のとおり @page の領域の高さ', async () => {
    expect(await run('')).toEqual({ pages: 1, hs: [200] });
  });
});

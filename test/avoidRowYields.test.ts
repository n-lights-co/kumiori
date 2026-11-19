/**
 * break-inside: avoid の表の行・リストの項目が、新しいページにも入らない高さなら、avoid を緩めて行の中で分ける
 * (CSS Fragmentation 3 §4.4: 区切りを避ける指定は、ほかに区切れる所が無ければ守らない)。前は分けずにページの下へはみ出させていた
 * (PostgreSQL の文書の印刷用の CSS の tr { break-inside: avoid } で、関数の表の長い行がはみ出した)。
 * アンテナハウス互換のスタイル (--style ah) では、これまでどおりはみ出させる (avoidRowOverflowAh)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea, type HtmlDefaults } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const LINES = Array.from({ length: 40 }, (_, k) => `<p>L${k + 1}</p>`).join('');
/** ページの数と、ページごとの最後の行 (L1〜L40) */
async function run(css: string, body: string, style: HtmlDefaults = 'browser') {
  const r = await typesetHtml(`<!doctype html><html><head><style>@page { size: 120mm 80mm; margin: 10mm } p { margin: 0 } ${css}</style></head><body><p>Intro</p>${body}</body></html>`, {
    loadFont: loadCachedFont,
    style,
  });
  const lasts = r.areaTree.sheets.map((s) => {
    const ls: string[] = [];
    const rec = (a: AreaNode) => {
      if (a.type === 'line') ls.push('');
      if (a.type === 'glyph') ls[ls.length - 1] += (a as GlyphArea).text;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s);
    return ls.filter((x) => /^L\d+$/.test(x)).pop();
  });
  return { pages: r.areaTree.sheets.length, lasts };
}

describe('1 ページに入らない break-inside: avoid の行', () => {
  it('表の行: 行の中で分け、全部の行がページの中に入る', async () => {
    const plain = await run('', `<table><tr><td>${LINES}</td></tr></table>`);
    const avoid = await run('tr { break-inside: avoid }', `<table><tr><td>${LINES}</td></tr></table>`);
    expect(avoid.pages).toBe(plain.pages);
    expect(avoid.lasts[avoid.lasts.length - 1]).toBe('L40');
    expect(avoid.pages).toBeGreaterThan(2);
  });
  it('リストの項目も同じ', async () => {
    const plain = await run('', `<ul><li>${LINES}</li></ul>`);
    const avoid = await run('li { break-inside: avoid }', `<ul><li>${LINES}</li></ul>`);
    expect(avoid.pages).toBe(plain.pages);
  });
  it('入る行は、これまでどおり分けずに次のページへ送る', async () => {
    const short = Array.from({ length: 8 }, (_, k) => `<p>L${k + 1}</p>`).join('');
    const r = await run('tr { break-inside: avoid }', `${'<p>x</p>'.repeat(10)}<table><tr><td>${short}</td></tr></table>`);
    // 行は 2 ページ目にまとめて置く
    expect(r.lasts).toEqual([undefined, 'L8']);
  });
  it('アンテナハウス互換のスタイルでは、これまでどおり分けない', async () => {
    const avoid = await run('tr { break-inside: avoid }', `<table><tr><td>${LINES}</td></tr></table>`, 'ah');
    expect(avoid.pages).toBe(2);
  });
});

/**
 * 既定のスタイル (kumiori) の書体 (font-family) と行揃え (text-align) は、body ではなく html に当てる (htmlPrepare.ts の KUMIORI_BOOK_CSS)。
 * 作成者が html (:root) に書いた書体・行揃えは、作成者スタイルシートが既定のスタイルに勝ち (CSS Cascade 4 §6.1・§6.2)、body に既定の値が
 * 無いので、文書の中へ受け継がれる (§7.2)。前は body に当てていたので、作成者の html { font-family: … } が body で既定の値に上書きされた
 * (Sphinx の印刷用の CSS のように html に書体を書く文書で、本文が既定の書体になった。ブラウザの既定のスタイルは body に当てないので、
 * ブラウザでは作成者の書体になる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import type { AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const page = (css: string, body: string) => `<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 10mm } ${css}</style></head><body>${body}</body></html>`;
const glyphs = (t: AreaTree) => {
  const out: Array<GlyphArea & { absX: number }> = [];
  // 字の位置 (ページの左からの x)。親の位置と、余白・罫線の内側を足していく
  const rec = (a: AreaNode, ox: number) => {
    const x = ox + a.x;
    if (a.type === 'glyph') out.push(Object.assign(a, { absX: x }));
    const inner = x + a.padding.left + (a.border.left?.width ?? 0);
    for (const c of childrenOf(a)) rec(c, inner);
  };
  for (const s of t.sheets) rec(s, 0);
  return out;
};
const run = async (css: string, body = '<p>Short line.</p>') => glyphs((await typesetHtml(page(css, body), { loadFont: loadCachedFont })).areaTree);

describe('既定のスタイル (kumiori): 作成者が html に書いた書体・行揃えが、文書の中に届く', () => {
  it('何も書かない文書は、これまでどおり serif (Tinos) で、両端揃え (1 行の段落は行頭に寄る)', async () => {
    const g = await run('');
    expect(g[0].fontFamily).toBe('Tinos');
    // 段落の字下げ (1em = 10pt) の分だけ右から始まる。ページの左の余白は 10mm
    expect(g[0].absX).toBeLessThan(((10 + 10) * 72) / 25.4 + 15);
  });

  it('html { font-family } は、段落の書体になる (前は body の既定の serif に上書きされた)', async () => {
    expect((await run('html { font-family: sans-serif }'))[0].fontFamily).toBe('Arimo');
    expect((await run(':root { font-family: sans-serif }'))[0].fontFamily).toBe('Arimo');
  });

  it('html { text-align } は、段落の行揃えになる', async () => {
    const g = await run('html { text-align: right }');
    const right = Math.max(...g.map((x) => x.absX + x.advance));
    // 本文の右の端 (ページの幅 120mm − 余白 10mm) にそろう
    expect(Math.abs(right - ((120 - 10) * 72) / 25.4)).toBeLessThan(1);
  });

  it('body に書いた作成者の指定は、html の指定に勝つ (これまでどおり)', async () => {
    expect((await run('html { font-family: sans-serif } body { font-family: serif }'))[0].fontFamily).toBe('Tinos');
  });
});

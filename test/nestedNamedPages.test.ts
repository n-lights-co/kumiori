/**
 * 名前付きページ (page) は、body の直下より深い所のブロックにも効く (CSS Paged Media 3 §8.1: page は class A の区切りを作る流れの中の箱に、
 * どの深さでも効き、auto の箱は親の値を使う)。前は body の直下のブロックだけを見ていて、文書全体を 1 つの箱で包む文書
 * (DocBook の HTML の div.book など) では、前付け・部の扉・索引の名前付きページが効かなかった。
 * 包む箱は、切り替えの所で分けた断片にする (上の飾りは最初の断片、下の飾りは最後の断片だけ。box-decoration-break: slice と同じ)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import type { AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの字 (行ごとにつないだもの) と、罫線のある箱の上下の罫線の有無 */
function pages(t: AreaTree) {
  return t.sheets.flatMap((s) =>
    childrenOf(s).map((p) => {
      const lines: string[] = [];
      const borders: Array<{ top: boolean; bottom: boolean }> = [];
      const rec = (a: AreaNode) => {
        if (a.type === 'line') lines.push('');
        if (a.type === 'glyph') lines[lines.length - 1] += (a as GlyphArea).text;
        if ((a.border?.left?.width ?? 0) > 1) borders.push({ top: !!a.border.top, bottom: !!a.border.bottom });
        for (const c of childrenOf(a)) rec(c);
      };
      rec(p);
      return { text: lines.filter(Boolean), borders };
    }),
  );
}
const CSS = `@page { size: 120mm 80mm; margin: 15mm; @bottom-center { content: "D" counter(page) } }
  @page front { @bottom-center { content: "F" counter(page, lower-roman) } }
  @page part { @bottom-center { content: none } }
  p { margin: 0 }`;
const run = async (body: string, css = '') =>
  pages((await typesetHtml(`<!doctype html><html lang="en"><head><style>${CSS} ${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont, style: 'browser' })).areaTree);

describe('入れ子の名前付きページ', () => {
  it('包む箱の中のブロックの page で、ページの名前が変わる (auto の箱は親の値)', async () => {
    const ps = await run('<div class="book"><div style="page: front"><p>Title</p></div><div style="page: front"><p>Contents</p></div><section><p>Body</p></section></div>');
    expect(ps.map((p) => p.text.join(' '))).toEqual(['Title Contents Fi', 'Body D2']);
  });
  it('2 段の入れ子と、左右の改ページ (部の扉は右のページから)', async () => {
    const ps = await run(
      '<div class="book"><section><p>One</p></section><div class="part"><div class="tp" style="page: part; break-before: right"><p>Part</p></div><section><p>Two</p></section></div></div>',
      'section { break-before: page }',
    );
    const texts = ps.map((p) => p.text.join(' '));
    // 1 ページ目 (右) の次の部の扉は、左のページを空けて 3 ページ目 (右) に
    expect(texts[0]).toBe('One D1');
    expect(texts[2]).toBe('Part');
    expect(texts[3]).toBe('Two D4');
  });
  it('包む箱の罫線は、上は最初の断片、下は最後の断片だけ', async () => {
    const ps = await run('<div style="border: 2pt solid black"><p>A</p><div style="page: front"><p>B</p></div><p>C</p></div>');
    expect(ps.map((p) => p.text.join(' '))).toEqual(['A D1', 'B Fii', 'C D3']);
    expect(ps.map((p) => p.borders)).toEqual([[{ top: true, bottom: false }], [{ top: false, bottom: false }], [{ top: false, bottom: true }]]);
  });
  it('包む箱の id は、最初の断片に残る (ページ番号の参照が引ける)', async () => {
    const ps = await run(
      '<p class="r"><a href="#book">x</a></p><div id="book" style="page: front"><p>B</p></div>',
      '.r { page: front } .r a::after { content: target-counter(attr(href url), page) } #book { break-before: page }',
    );
    // 参照先は 2 ページ目 (target-counter() の数え方は、書かなければ decimal。参照先のページのローマ数字ではない)
    expect(ps[0].text[0]).toBe('x2');
  });
  it('表・flex の中の page は、ページの名前を変えない', async () => {
    const ps = await run('<div style="display: flex"><div style="page: front"><p>A</p></div></div><p>B</p>');
    expect(ps).toHaveLength(1);
  });
});

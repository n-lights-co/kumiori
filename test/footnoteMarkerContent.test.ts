/**
 * 脚注の参照の印 (::footnote-call) と本文の頭の印 (::footnote-marker) の content は、別の書式 (CSS GCPM 3 §2.5・§2.6)。
 * 前は ::footnote-call の content があれば、本文の頭の印にもそれを使い、::footnote-marker { content: counter(footnote) ". " } の
 * 「. 」が抜けた (PostgreSQL の文書の印刷用の CSS)。また、前に選択子の付いた規則 (span.fn::footnote-call) を読み落としていた。
 * 書式は脚注の要素ごと: その要素に当たる規則を、詳細度と書いた順で重ねる (前は文書全体で 1 つの書式だった)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 1 ページ目の行ごとの字 */
async function lines(css: string, body = '<p>Text<span class="fn">Note</span> end.</p>'): Promise<string[]> {
  const t = (
    await typesetHtml(
      `<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 10mm } p { margin: 0 } .fn { float: footnote } ${css}</style></head><body>${body}</body></html>`,
      { loadFont: loadCachedFont, style: 'browser' },
    )
  ).areaTree;
  const out: string[] = [];
  const rec = (a: AreaNode) => {
    if (a.type === 'line') out.push('');
    if (a.type === 'glyph') out[out.length - 1] += (a as GlyphArea).text;
    for (const c of childrenOf(a)) rec(c);
  };
  rec(t.sheets[0]);
  return out.filter(Boolean);
}

describe('脚注の参照の印と本文の頭の印の書式', () => {
  it('::footnote-call と ::footnote-marker の content が違えば、それぞれの書式', async () => {
    const ls = await lines('.fn::footnote-call { content: counter(footnote) } .fn::footnote-marker { content: counter(footnote) ". " }');
    expect(ls[0]).toBe('Text1 end.');
    expect(ls[ls.length - 1]).toBe('1. Note');
  });
  it('::footnote-marker だけなら、これまでどおり両方に使う', async () => {
    const ls = await lines('.fn::footnote-marker { content: "[" counter(footnote) "]" }');
    expect(ls[0]).toBe('Text[1] end.');
    expect(ls[ls.length - 1]).toBe('[1]Note');
  });
  it('前に選択子の付いた規則 (.fn::footnote-call) も読む。脚注の要素に当たらない選択子の規則は読まない', async () => {
    expect((await lines('.fn::footnote-call { content: "(" counter(footnote) ")" }'))[0]).toBe('Text(1) end.');
    expect((await lines('.other::footnote-call { content: "(" counter(footnote) ")" }'))[0]).toBe('Text1 end.');
  });
  it('書式は脚注の要素ごと (種類の違う脚注に、それぞれの書式)', async () => {
    const ls = await lines(
      '.fn::footnote-call { content: counter(footnote) } .fn::footnote-marker { content: counter(footnote) ". " } .tr::footnote-call { content: "[" counter(footnote, lower-roman) "]" }',
      '<p>A<span class="fn">One</span> B<span class="fn tr">Two</span> C.</p>',
    );
    expect(ls[0]).toBe('A1 B[ii] C.');
    // 2 つめの脚注の本体の頭は、::footnote-marker (.fn に当たる) の「番号. 」で、番号の書式は参照記号 (.tr) のローマ数字
    expect(ls.slice(1)).toEqual(['1. One', 'ii. Two']);
  });
});


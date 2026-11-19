/**
 * target-counter() の飛び先は、URL の fragment (最初の # の後ろ全部。URL Standard §4.4 の fragment state) の id。
 * href="#a#b" の fragment は "a#b" で、id="b" ではない (リンクの飛び先と同じ)。前は最後の # の後ろで引き、
 * Sphinx の 1 ファイルの HTML の目次 (href="#document-x#section") で、リンクの飛べない項目にページ番号が出ていた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 1 ページ目の行ごとの字 */
async function firstPageLines(html: string): Promise<string[]> {
  const t = (await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' })).areaTree;
  const out: string[] = [];
  const rec = (a: AreaNode) => {
    if (a.type === 'line') out.push('');
    if (a.type === 'glyph') out[out.length - 1] += (a as GlyphArea).text;
    for (const c of childrenOf(a)) rec(c);
  };
  rec(t.sheets[0]);
  return out.filter(Boolean);
}

describe('target-counter() の飛び先の fragment', () => {
  it('最初の # の後ろ全部を id として引く', async () => {
    const lines = await firstPageLines(`<!doctype html><html lang="en"><head><style>
      @page { size: 120mm 80mm; margin: 10mm } .toc a::after { content: " p" target-counter(attr(href url), page) }
      h1 { break-before: page; margin: 0 }</style></head><body>
      <p class="toc"><a href="#b">One</a></p><p class="toc"><a href="#a#b">Two</a></p><p class="toc"><a href="#x#y">Three</a></p>
      <h1 id="b">B</h1><h1 id="x#y">XY</h1></body></html>`);
    expect(lines).toContain('One p2');
    // "a#b" という id は無いので、飛び先の無い参照の印 (?) になる (前は id="b" のページの 2 が出た)
    expect(lines).toContain('Two p?');
    expect(lines).toContain('Three p3');
  });

  it('ページの数え方: 書かなければ decimal、3 つめの引数があればその数え方 (参照先のページの表記によらない)', async () => {
    const lines = await firstPageLines(`<!doctype html><html lang="en"><head><style>
      @page { size: 120mm 80mm; margin: 10mm } @page roman { @bottom-center { content: counter(page, lower-roman) } }
      .a::after { content: " p" target-counter(attr(href url), page) } .b::after { content: " p" target-counter(attr(href url), page, upper-roman) }
      h1 { break-before: page; margin: 0; page: roman }</style></head><body>
      <p><a class="a" href="#t">One</a></p><p><a class="b" href="#t">Two</a></p><h1 id="t">T</h1></body></html>`);
    expect(lines).toContain('One p2');
    expect(lines).toContain('Two pII');
  });
});


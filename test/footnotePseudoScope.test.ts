/**
 * 脚注の疑似要素 (::footnote-call・::footnote-marker) の書式は、その脚注の要素に当たる規則だけで決まる (CSS GCPM 3 §2.6・§2.7)。
 * 要素を名指しした規則 (.a::footnote-call) は、ほかの脚注 (.b) に付けない。選択子の無い規則 (::footnote-call) は、どの脚注にも当たる。
 * 番号の前後の文字・数え方・参照の印の字の大きさ・本文の頭の印の置き方 (list-style-position) を確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const MM = 72 / 25.4;
interface Line { text: string; x: number; sizes: number[] }

/** 1 ページ目の行ごとの字と、行の最初の字の左端 (ページの左からの位置) と、字ごとの大きさ */
async function lines(css: string, style: 'browser' | 'ah' = 'browser', body = '<p>X<span class="a">One</span> Y<span class="b">Two</span> Z.</p>'): Promise<Line[]> {
  const t = (
    await typesetHtml(
      `<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 10mm } p { margin: 0 } .a, .b { float: footnote } ${css}</style></head><body>${body}</body></html>`,
      { loadFont: loadCachedFont, style },
    )
  ).areaTree;
  const out: Line[] = [];
  const rec = (a: AreaNode, ox: number) => {
    const x = ox + a.x;
    if (a.type === 'line') out.push({ text: '', x: Infinity, sizes: [] });
    if (a.type === 'glyph') {
      const l = out[out.length - 1];
      l.text += (a as GlyphArea).text;
      l.x = Math.min(l.x, x);
      l.sizes.push((a as GlyphArea).fontSize);
    }
    for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0));
  };
  rec(t.sheets[0], 0);
  return out.filter((l) => l.text);
}
const texts = (ls: Line[]) => ls.map((l) => l.text);

describe('脚注の疑似要素の規則は、当たる脚注の要素にだけ効く', () => {
  it('当たる規則の無い脚注は、既定の書式 (名指しした規則の書式を付けない)', async () => {
    const ls = await lines('.a::footnote-call { content: "[" counter(footnote) "]" } .a::footnote-marker { content: "[" counter(footnote) "] " }');
    expect(texts(ls)).toEqual(['X[1] Y2 Z.', '[1] One', '2Two']);
  });
  it('名指しした ::footnote-call の字の大きさは、ほかの脚注の参照の印に付けない', async () => {
    const [body] = await lines('.a::footnote-call { content: counter(footnote); font-size: 3pt }');
    const k1 = body.text.indexOf('1');
    const k2 = body.text.indexOf('2');
    expect(body.sizes[k1]).toBeCloseTo(3, 1);
    // .b は既定の大きさ (本文の 0.7 倍。3pt ではない)
    expect(body.sizes[k2]).toBeGreaterThan(5);
  });
  it('選択子の無い ::footnote-call・*::footnote-marker は、全部の脚注に効く', async () => {
    expect(texts(await lines('::footnote-call { content: "(" counter(footnote) ")" }'))).toEqual(['X(1) Y(2) Z.', '(1)One', '(2)Two']);
    expect(texts(await lines('*::footnote-call { content: counter(footnote) } *::footnote-marker { content: counter(footnote) ". " }'))).toEqual([
      'X1 Y2 Z.',
      '1. One',
      '2. Two',
    ]);
  });
  it('.a と .b の規則を別々に書けば、それぞれに効く', async () => {
    const ls = await lines('.a::footnote-call { content: "[" counter(footnote) "]" } .b::footnote-call { content: "<" counter(footnote, lower-roman) ">" }');
    expect(texts(ls)).toEqual(['X[1] Y<ii> Z.', '[1]One', '<ii>Two']);
  });
  it('選択子の無い規則と名指しした規則の両方があれば、詳細度と書いた順で決まる', async () => {
    // 名指しした規則 (詳細度が高い) が、後に書いた選択子の無い規則に勝つ。当たらない .b は選択子の無い規則
    const ls = await lines('.a::footnote-call { content: "[" counter(footnote) "]" } ::footnote-call { content: "(" counter(footnote) ")" }');
    expect(texts(ls)).toEqual(['X[1] Y(2) Z.', '[1]One', '(2)Two']);
    // 詳細度が同じなら後勝ち
    const ls2 = await lines(
      '.a::footnote-call { content: "[" counter(footnote) "]" } .x::footnote-call { content: "{" counter(footnote) "}" }',
      'browser',
      '<p>X<span class="a x">One</span> Y<span class="b">Two</span> Z.</p>',
    );
    expect(texts(ls2)).toEqual(['X{1} Y2 Z.', '{1}One', '2Two']);
  });
  it('::footnote-marker の list-style-position は、当たる脚注の要素にだけ効く', async () => {
    const left = 10 * MM;
    // .a だけ outside (番号を本文の始めの外にぶら下げる)。.b は既定の inside
    const ls = await lines('.a::footnote-marker { list-style-position: outside }');
    const [a, b] = ls.slice(1);
    expect(a.text).toBe('1One');
    expect(a.x).toBeLessThan(left - 1);
    expect(b.text).toBe('2Two');
    expect(b.x).toBeCloseTo(left, 0);
    // 選択子の無い規則は、両方に
    const all = (await lines('::footnote-marker { list-style-position: outside }')).slice(1);
    expect(all.map((l) => l.x < left - 1)).toEqual([true, true]);
  });
  it('既定のスタイル (--style ah) の脚注の書式 (番号を外にぶら下げる) は、これまでどおり。名指しした規則は、その要素だけ変える', async () => {
    const left = 10 * MM;
    const def = (await lines('', 'ah')).slice(1);
    expect(def.map((l) => l.x < left - 1)).toEqual([true, true]);
    const ls = (await lines('.a::footnote-marker { list-style-position: inside }', 'ah')).slice(1);
    expect(ls[0].x).toBeCloseTo(left, 0);
    expect(ls[1].x).toBeLessThan(left - 1);
  });
});

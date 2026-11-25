/**
 * ページの残りに入らない段組: いまのページから始めると、中の分けない指定のブロック (break-inside: avoid) を分けるが、次のページの頭からなら
 * 分けずに入るなら、段組の前で改ページする (CSS Fragmentation 3 §4.4: 区切りは、避ける指定を破るものの少ない所を選ぶ。Chrome も同じ)。
 * 枠の無い段組 (ページをまたいで段を続けるもの) も、padding・罫線のある段組 (1 つの箱) も同じ。箱の中の絶対配置の箱は、送った先のページに置く。
 * 次のページの高さは、ページの型 (:first など) から求める (次のページが低くて入らなければ、前のとおりいまのページで分ける)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const run = (body: string, css = '') =>
  typesetHtml(`<!DOCTYPE html><html><head><style>@page{size:300pt 200pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} p{margin:0;text-indent:0} .k{break-inside:avoid} ${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont });
/** ページごとの字 */
const texts = (t: AreaTree) =>
  t.sheets.map((s) => {
    let out = '';
    const rec = (a: Area) => {
      if (a.type === 'glyph') out += (a as unknown as { text?: string }).text ?? '';
      for (const c of childrenOf(a)) rec(c as Area);
    };
    rec(s.page as unknown as Area);
    return out;
  });
const keep = (k: string) => `<div class="k">${[1, 2, 3, 4, 5, 6].map((n) => `${k}${n}`).join('<br>')}</div>`;

describe('入らない段組を次のページへ送る', () => {
  it('枠の無い段組', async () => {
    const t = texts((await run(`<div style="height:150pt">x</div><div style="columns:2">${keep('A')}${keep('B')}</div><p>Z</p>`)).areaTree);
    expect(t[0]).not.toContain('A1');
    expect(t[1]).toContain('A1A2A3A4A5A6');
    expect(t[1]).toContain('B6');
  });
  it('padding のある段組 (中の絶対配置の箱も送った先のページに置く)', async () => {
    const t = texts((await run(`<div style="height:150pt">x</div><div style="position:relative;columns:2;padding:3pt">${keep('C').replace('C6', 'C6<div style="position:absolute;top:0;right:0">Q</div>')}</div><p>Z</p>`)).areaTree);
    expect(t[0]).not.toContain('C1');
    expect(t[0]).not.toContain('Q');
    expect(t[1]).toContain('C1C2C3C4C5C6');
    expect(t[1]).toContain('Q');
  });
  it('前の見出しとつながる (keep-with-next) 段組は送らない: 見出しの後ろの section の中の最初の段組も、見出しの直後の段組と同じ', async () => {
    const h = '<h2 style="margin:0;font-size:10pt;line-height:10pt">HEAD</h2>';
    const cols = `<div style="columns:2">${keep('A')}${keep('B')}</div>`;
    const direct = texts((await run(`<div style="height:150pt">x</div>${h}${cols}`)).areaTree);
    // 見出しだけをページの末尾に残さない
    expect(direct[0]).toContain('HEAD');
    expect(direct[0]).toContain('A1');
    for (const wrap of [(x: string) => `<section>${x}</section>`, (x: string) => `<section><div>${x}</div></section>`]) {
      const nested = texts((await run(`<div style="height:150pt">x</div>${h}${wrap(cols)}`)).areaTree);
      expect(nested).toEqual(direct);
    }
  });
  it('次のページが低くて入らなければ、いまのページで分ける', async () => {
    const t = texts((await run(`<div style="height:150pt">x</div><div style="columns:2;padding:3pt">${keep('C')}</div>`, '@page{size:300pt 40pt} @page:first{size:300pt 200pt}')).areaTree);
    expect(t[0]).toContain('C1');
  });
});

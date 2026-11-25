/**
 * リストの最初の項目の、最初の子の上の余白 (CSS 2.1 §8.3.1): 項目 (li) に上の罫線・padding が無ければ、最初の子の上の余白は項目の余白と重なって
 * リストの外へ抜け、前のブロックの下の余白・リストの上の余白とも重なる。ページの頭のリストでも空ける (前は、本文のセルの先頭の余白として捨てていた)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 字 → 行の上端の位置 (pt。0.1 に丸める) */
const tops = async (body: string) => {
  const html = `<!DOCTYPE html><html><head><style>@page{size:300pt 300pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} ul,ol{margin:0} p{margin:20pt 0}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out: Record<string, number> = {};
  const rec = (a: Area, oy: number) => {
    const y = oy + (a.y ?? 0);
    const t = (a as unknown as { text?: string }).text;
    if (a.type === 'glyph' && t && /^[A-Z]$/.test(t)) out[t] = Math.round(y * 10) / 10;
    for (const c of childrenOf(a)) rec(c as Area, y);
  };
  rec(r.areaTree.sheets[0].page as unknown as Area, 0);
  return out;
};

describe('リストの最初の項目の最初の子の上の余白', () => {
  it('ページの頭のリストでも、最初の子 (入れ子の最初の子も) の上の余白を空ける', async () => {
    expect((await tops('<ul><li><p>A</p></li></ul>')).A).toBeCloseTo(19.6, 0);
    expect((await tops('<ul><li><div><p>A</p></div></li></ul>')).A).toBeCloseTo(19.6, 0);
  });
  it('項目の余白・リストの余白・前のブロックの下の余白と重なる (いちばん大きい余白)', async () => {
    const t = await tops('<p style="margin-bottom:5pt">Z</p><ul style="margin-top:16pt"><li><p>A</p><p>B</p></li><li><p>C</p></li></ul>');
    expect(t.A - t.Z).toBeCloseTo(30, 0);
    expect(t.B - t.A).toBeCloseTo(30, 0);
    expect(t.C - t.B).toBeCloseTo(30, 0);
    const u = await tops('<ol><li style="margin-top:30pt"><p>A</p></li></ol>');
    expect(u.A).toBeCloseTo(29.6, 0);
  });
  it('2 つ目からの項目: 前の項目の余白・最後の子の下の余白と、項目の余白・最初の子の上の余白が重なる', async () => {
    // D の後ろの E: 前の項目に下の余白が無くても、最初の子の上の余白を空ける (前は捨てていた)
    const t = await tops('<ul><li><p>A</p></li><li>D</li><li><p>E</p></li></ul>');
    expect(t.E - t.D).toBeCloseTo(30, 0);
    // 前の項目の下の余白と、最後の子の下の余白は足さずに重ねる (前は足していた)。項目の上の余白・入れ子の最初の子の上の余白とも重なる
    const u = await tops('<ul><li style="margin-bottom:10pt"><p>I</p></li><li><p>J</p></li><li style="margin-top:30pt"><div><p>K</p></div></li><li style="margin-top:5pt">L</li></ul>');
    expect(u.J - u.I).toBeCloseTo(30, 0);
    expect(u.K - u.J).toBeCloseTo(40, 0);
    expect(u.L - u.K).toBeCloseTo(30, 0);
  });
});

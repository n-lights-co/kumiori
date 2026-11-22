/**
 * 行内の要素の中の、流れの外の箱 (float・絶対配置):
 *  - 行内の要素 (em・span・割注) の中の float も組む (CSS 2.1 §9.5: float は行内の要素の中にも置ける)。前は行内の節の子に入り、
 *    組版が読まずに、中身ごと警告なしに消えていた
 *  - 行内の要素の中の float・絶対配置の箱は、文書の木の親 (行内の要素) の書式を受け継ぐ (CSS 2.1 §6.2)。前は包むブロックの
 *    書式から受け継ぎ、行内の要素の字の大きさなどが抜けていた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf } from '../src/areaTree';
import { DEFAULT_FONTS, typeset } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const opts = { loadFont: loadCachedFont, fetchImages: false } as const;
type Tree = Awaited<ReturnType<typeof typeset>>['areaTree'];
type Node = Parameters<typeof childrenOf>[0];

/** 字の紙面の上の位置 (x) と大きさ */
function glyphs(tree: Tree): Array<{ text: string; x: number; size: number }> {
  const out: Array<{ text: string; x: number; size: number }> = [];
  for (const sheet of tree.sheets) {
    const visit = (a: Node, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') out.push({ text: a.text, x, size: a.fontSize });
      for (const c of childrenOf(a)) visit(c, x);
    };
    visit(sheet, 0);
  }
  return out;
}
const html = (body: string) =>
  `<!DOCTYPE html><html lang="ja"><head><style>@page { size: 120mm 80mm; margin: 10mm } body { margin: 0; font-size: 12pt } .w { -kumiori-warichu: auto; font-size: 6pt }</style></head><body>${body}</body></html>`;
const of = (gs: ReturnType<typeof glyphs>, t: string) => gs.find((g) => g.text === t);

describe('行内の要素の中の float', () => {
  it('em の中の float: right を、中身ごと右に組む (前は消えていた)', async () => {
    const r = await typeset(html('<p>本文<em>強調<span style="float:right">浮</span>続き</em>終わり</p>'), opts);
    const gs = glyphs(r.areaTree);
    const f = of(gs, '浮');
    expect(f).toBeTruthy();
    // 右の端 (120mm - 10mm の余白 ≒ 311.8pt) に寄る
    expect(f!.x).toBeGreaterThan(280);
    expect(gs.map((g) => g.text).join('')).toContain('本文強調続き終わり');
  });

  it('em の字の大きさ・割注の字の大きさを、中の float が受け継ぐ', async () => {
    const r = await typeset(html('<p>本文<em style="font-size:8pt">強調<span style="float:right">浮</span></em>、<span class="w">割注<span style="float:left">左</span>中身</span></p>'), opts);
    const gs = glyphs(r.areaTree);
    expect(of(gs, '浮')?.size).toBeCloseTo(8, 3);
    expect(of(gs, '左')?.size).toBeCloseTo(6, 3);
  });
});

describe('行内の要素の中の絶対配置の箱', () => {
  it('親の行内の要素の字の大きさを受け継ぐ (中で直に指定した大きさも効く)', async () => {
    const r = await typeset(html('<p><span style="font-size:6pt">外<span style="position:absolute">絶<span style="font-size:6pt">内</span><span style="font-size:200%">倍</span></span></span></p>'), opts);
    const gs = glyphs(r.areaTree);
    expect(of(gs, '外')?.size).toBeCloseTo(6, 3);
    expect(of(gs, '絶')?.size).toBeCloseTo(6, 3);
    expect(of(gs, '内')?.size).toBeCloseTo(6, 3);
    expect(of(gs, '倍')?.size).toBeCloseTo(12, 3);
  });
});

/** 字の紙面の上の位置 (x・y) と大きさ */
function glyphsXY(tree: Tree): Array<{ text: string; x: number; y: number; size: number }> {
  const out: Array<{ text: string; x: number; y: number; size: number }> = [];
  for (const sheet of tree.sheets) {
    const visit = (a: Node, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') out.push({ text: a.text, x, y, size: a.fontSize });
      for (const c of childrenOf(a)) visit(c, x, y);
    };
    visit(sheet, 0, 0);
  }
  return out;
}
const all = (gs: ReturnType<typeof glyphsXY>, t: string) => gs.filter((g) => g.text === t);
const page = (body: string) =>
  `<!DOCTYPE html><html lang="ja"><head><style>@page { size: 120mm 80mm; margin: 10mm } body { margin: 0; font-size: 12pt }</style></head><body>${body}</body></html>`;

/**
 * 1 つのブロックの中身として組む要素 (脚注の本体・柱に出す要素・flex・grid の項目にした行内の要素) の中の
 * float は、その要素の中に組む (包むブロックの並びに出すと、脚注・柱・項目の外の本文に組まれる)
 */
describe('脚注・柱・flex の項目の中の float', () => {
  for (const tag of ['span', 'div']) {
    it(`脚注 (${tag} の float: footnote) の中の float は、脚注の領域に組む`, async () => {
      const r = await typeset(page(`<p>本文<${tag} style="float:footnote">脚注甲<span style="float:right">浮</span>脚注乙</${tag}>続き</p>`), opts);
      const gs = glyphsXY(r.areaTree);
      const note = all(gs, '甲')[0];
      const body = all(gs, '本')[0];
      const fl = all(gs, '浮');
      expect(fl).toHaveLength(1);
      // 脚注の領域 (ページの下。本文より下) にあり、脚注の字と同じ大きさ
      expect(fl[0].y).toBeGreaterThan(body.y + 40);
      expect(Math.abs(fl[0].y - note.y)).toBeLessThan(20);
      expect(fl[0].size).toBeCloseTo(note.size, 3);
    });
  }

  it('脚注の中の em の中の float も、脚注の領域に組む', async () => {
    const r = await typeset(page('<p>本文<span style="float:footnote">脚注甲<em>強<span style="float:right">浮</span></em>脚注乙</span>続き</p>'), opts);
    const gs = glyphsXY(r.areaTree);
    const note = all(gs, '甲')[0];
    const body = all(gs, '本')[0];
    const fl = all(gs, '浮');
    expect(fl).toHaveLength(1);
    expect(fl[0].y).toBeGreaterThan(body.y + 40);
    expect(fl[0].size).toBeCloseTo(note.size, 3);
  });

  it('柱に出す行内の要素 (position: running()) の中の float は、柱に組み、本文に出さない', async () => {
    const r = await typeset(page('<style>@page { @top-center { content: element(hd) } } .hd { position: running(hd); font-size: 8pt }</style><p>本文<span class="hd">柱甲<span style="float:right">浮</span>柱乙</span>続き</p>'), opts);
    const gs = glyphsXY(r.areaTree);
    const body = all(gs, '本')[0];
    // 柱 (上の余白。本文の上) にだけ出る
    expect(all(gs, '浮')).toHaveLength(1);
    expect(all(gs, '甲')).toHaveLength(1);
    expect(all(gs, '乙')).toHaveLength(1);
    for (const g of [...all(gs, '甲'), ...all(gs, '乙'), ...all(gs, '浮')]) expect(g.y).toBeLessThan(body.y);
    // 柱に出す要素の字の大きさを受け継ぐ
    expect(all(gs, '浮')[0].size).toBeCloseTo(8, 3);
  });

  it('flex の項目にした行内の要素の中の float は、項目の中に組む (容器の後の段落に出さない)', async () => {
    const r = await typeset(page('<div style="display:flex"><span>項目<span style="float:right">浮</span>後</span></div><p>次</p>'), opts);
    const gs = glyphsXY(r.areaTree);
    const next = all(gs, '次')[0];
    const item = all(gs, '目')[0];
    const fl = all(gs, '浮');
    expect(fl).toHaveLength(1);
    expect(fl[0].y).toBeLessThan(next.y - 5);
    expect(Math.abs(fl[0].y - item.y)).toBeLessThan(5);
  });

  it('inline-flex の項目の中の float は、項目の中に組む (容器の後の段落に出さない)', async () => {
    const r = await typeset(page('<p>前<span style="display:inline-flex"><span>項目<span style="float:right">浮</span>後</span></span>終</p><p>次</p>'), opts);
    const gs = glyphsXY(r.areaTree);
    const next = all(gs, '次')[0];
    const end = all(gs, '終')[0];
    const fl = all(gs, '浮');
    expect(fl).toHaveLength(1);
    expect(fl[0].y).toBeLessThan(next.y - 5);
    // 項目の中 (容器の後の「終」より左)。外の段落の行の右の端 (≒ 311.8pt) に寄せない
    expect(fl[0].x).toBeLessThan(end.x);
  });
});

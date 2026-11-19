/**
 * @page の padding (CSS Paged Media 3 §3: ページの領域は、ページの箱の内容の領域)。padding は本文の領域を狭め、
 * 余白の箱 (ページの余白の中に置く) は動かさない。前は padding を読まず、本文がページの余白のすぐ内側から始まっていた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import type { AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const MM = 72 / 25.4;
/** 字ごとの、ページの左上からの位置 (pt) */
function glyphs(t: AreaTree) {
  const out: Array<{ text: string; x: number; y: number }> = [];
  const rec = (a: AreaNode, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ text: (a as GlyphArea).text, x, y });
    for (const c of childrenOf(a)) rec(c, x + a.padding.left + (a.border.left?.width ?? 0), y + a.padding.top + (a.border.top?.width ?? 0));
  };
  for (const s of t.sheets) rec(s, 0, 0);
  return out;
}
const run = async (pageCss: string) =>
  glyphs(
    (
      await typesetHtml(
        `<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 10mm; ${pageCss} @top-left { content: "H" } } p { margin: 0 }</style></head><body><p>B</p></body></html>`,
        { loadFont: loadCachedFont, style: 'browser' },
      )
    ).areaTree,
  );
const at = (g: Array<{ text: string; x: number; y: number }>, text: string) => g.find((x) => x.text === text)!;

describe('@page の padding', () => {
  it('padding-top・padding-left は本文を下・右へずらし、余白の箱は動かさない', async () => {
    const plain = await run('');
    const pad = await run('padding-top: 5mm; padding-left: 1em;');
    expect(at(pad, 'B').y - at(plain, 'B').y).toBeCloseTo(5 * MM, 1);
    // em は @page の字の大きさ (根の要素の 16px = 12pt)
    expect(at(pad, 'B').x - at(plain, 'B').x).toBeCloseTo(12, 1);
    expect(at(pad, 'H').x).toBeCloseTo(at(plain, 'H').x, 2);
    expect(at(pad, 'H').y).toBeCloseTo(at(plain, 'H').y, 2);
  });

  it('padding の一括指定・百分率 (上下は用紙の高さに対して)', async () => {
    const plain = await run('');
    expect(at(await run('padding: 10% 0 0;'), 'B').y - at(plain, 'B').y).toBeCloseTo(8 * MM, 1);
  });

  it('負の padding は無効', async () => {
    const plain = await run('');
    expect(at(await run('padding-top: -5mm;'), 'B').y).toBeCloseTo(at(plain, 'B').y, 2);
  });
});

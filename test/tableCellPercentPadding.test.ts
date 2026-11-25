/**
 * 幅の決まらない表 (width: auto) のセルの百分率の padding: 列の幅を測るときは百分率の部分を 0 とし (CSS Sizing 3 §5.2.1: 循環する百分率)、
 * 表の幅が決まってから、その幅で解く (Chrome と同じ)。前は、読み込みのときの包含ブロックの幅 (本文の幅) で解いていたので、表が広がった
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const boxes = async (table: string) => {
  const html = `<!DOCTYPE html><html><head><style>@page{size:300pt 400pt;margin:0} body{margin:0;font-size:10pt;line-height:10pt} td{padding:10%;border:0} table{border-spacing:0;margin:0}</style></head><body>${table}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out: Array<{ type: string; w: number; h: number; pad: number }> = [];
  const rec = (a: Area) => {
    if (a.type === 'table' || a.type === 'table-cell') out.push({ type: a.type, w: Math.round(a.width * 10) / 10, h: Math.round(a.height * 10) / 10, pad: Math.round(((a as { padding?: { top?: number } }).padding?.top ?? 0) * 10) / 10 });
    for (const c of childrenOf(a)) rec(c as Area);
  };
  rec(r.areaTree.sheets[0].page as unknown as Area);
  return out;
};

describe('幅の決まらない表のセルの百分率の padding', () => {
  it('列の幅は中身の幅で決め、padding は表の幅で解く', async () => {
    const b = await boxes('<table><tr><td>AAAA</td><td>B</td></tr></table>');
    const t = b.find((x) => x.type === 'table')!;
    const cells = b.filter((x) => x.type === 'table-cell');
    // 表の幅は中身の幅の和 (padding の百分率を数えない)
    expect(t.w).toBeCloseTo(cells[0].w + cells[1].w, 1);
    expect(t.w).toBeLessThan(40);
    // padding は表の幅の 10%
    expect(cells[0].pad).toBeCloseTo(t.w * 0.1, 0);
  });
  it('幅を書いた表は、前のとおり表の幅で解く', async () => {
    const b = await boxes('<table style="width:200pt"><tr><td>A</td><td>B</td></tr></table>');
    expect(b.filter((x) => x.type === 'table-cell').map((x) => x.pad)).toEqual([20, 20]);
  });
});

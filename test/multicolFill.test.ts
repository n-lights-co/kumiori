/**
 * column-fill (CSS Multi-column 1 §7.1) の回帰テスト: 高さの指定の無い段組でも、column-fill: auto なら、ページの残りを段の高さにして
 * 段を順に埋める (balance (初期値) は段の高さを釣り合わせる)。ページをまたぐ段組も、最後のページの段を釣り合わせない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの、"L<番号>" の行の位置 (x・y を整数に丸める) */
function lines(tree: AreaTree): Array<Map<string, [number, number]>> {
  return tree.sheets.map((sh) => {
    const out = new Map<string, [number, number]>();
    const rec = (a: Area, ox: number, oy: number, line?: { s: string; x: number; y: number }) => {
      const x = ox + (a.x ?? 0);
      const y = oy + (a.y ?? 0);
      if (a.type === 'line') {
        const l = { s: '', x, y };
        for (const c of childrenOf(a)) rec(c as Area, x, y, l);
        if (/^L\d+$/.test(l.s)) out.set(l.s, [Math.round(l.x), Math.round(l.y)]);
        return;
      }
      if (a.type === 'glyph' && line) line.s += (a as unknown as { text?: string }).text ?? '';
      for (const c of childrenOf(a)) rec(c as Area, x, y, line);
    };
    rec(sh.page as unknown as Area, 0, 0);
    return out;
  });
}
const run = async (fill: string, count: number) => {
  const body = `<p>Z</p><div class="m">${Array.from({ length: count }, (_, k) => `<p>L${k}</p>`).join('')}</div><p>E</p>`;
  const css = `@page { size: 300pt 300pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 10pt } p { margin: 0 } .m { columns: 2; column-gap: 0; column-fill: ${fill} }`;
  return (await typesetHtml(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont })).areaTree;
};

describe('column-fill (CSS Multi-column 1 §7.1)', () => {
  it('balance は 2 段に釣り合わせ、auto は最初の段から順に埋める', async () => {
    const bal = lines(await run('balance', 8))[0];
    const auto = lines(await run('auto', 8))[0];
    expect(bal.get('L4')![0]).toBeGreaterThan(bal.get('L0')![0]);
    expect(bal.get('L4')![1]).toBe(bal.get('L0')![1]);
    for (let k = 0; k < 8; k++) expect(auto.get(`L${k}`)).toEqual([auto.get('L0')![0], auto.get('L0')![1] + k * 10]);
  });
  it('auto でページをまたぐ段組は、どのページも段を順に埋め、最後のページの段も釣り合わせない', async () => {
    // 1 ページは 30 行。前置きの 1 行の後の 29 行 × 2 段 = 58 行がこのページ、残りの 6 行は次のページの最初の段
    const pages = lines(await run('auto', 64));
    expect(pages.length).toBe(2);
    expect(pages[0].get('L28')![0]).toBe(pages[0].get('L0')![0]);
    expect(pages[0].get('L29')![0]).toBeGreaterThan(pages[0].get('L0')![0]);
    const p1 = pages[1];
    expect([...p1.keys()]).toEqual(['L58', 'L59', 'L60', 'L61', 'L62', 'L63']);
    expect(new Set([...p1.values()].map((v) => v[0])).size).toBe(1);
  });
});

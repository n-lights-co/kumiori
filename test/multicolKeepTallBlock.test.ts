/**
 * 段組の残り:
 *  - 段より高い分けない指定のブロック (break-inside: avoid) の前に中身のある段組: 段の取れる高さ (ページの残り) を超えない高さで釣り合わせ、
 *    そのブロックは段の境目で分ける (CSS Fragmentation 3 §3.3・§4.4: 避ける指定は、ほかに区切れる所が無ければ守らない)。前は、ブロックを
 *    分けずに 1 段に積んで、段組がページの下へはみ出した
 *  - 次のページへ送った段組の前の余白は、強制でない区切りに接するので切り詰め (CSS Fragmentation 3 §5.2)、1 行目の段の高さからも引かない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const br = (k: string, n: number) => Array.from({ length: n }, (_, i) => `${k}${i + 1}`).join('<br>');
/** ページごとの、行の字と位置 (x・y。本文領域の左上から) */
const lines = async (body: string, page = '300pt 200pt') => {
  const r = await typesetHtml(`<!DOCTYPE html><html><head><style>@page{size:${page};margin:0} body{margin:0;font-size:10pt;line-height:10pt} p{margin:0;text-indent:0}</style></head><body>${body}</body></html>`, { loadFont: loadCachedFont });
  return {
    warnings: r.warnings,
    pages: r.areaTree.sheets.map((s) => {
      const out: Array<{ t: string; x: number; y: number }> = [];
      const rec = (a: Area, ox: number, oy: number) => {
        const x = ox + (a.x ?? 0), y = oy + (a.y ?? 0);
        if (a.type === 'line') {
          let t = '';
          const g = (b: Area) => {
            if (b.type === 'glyph') t += (b as unknown as { text?: string }).text ?? '';
            for (const c of childrenOf(b)) g(c as Area);
          };
          g(a);
          out.push({ t, x: Math.round(x), y: Math.round(y) });
          return;
        }
        for (const c of childrenOf(a)) rec(c as Area, x, y);
      };
      rec(s.page as unknown as Area, 0, 0);
      return out;
    }),
  };
};

describe('段組の残り', () => {
  it('段より高い分けない指定のブロックは、段の境目で分け、段組はページからはみ出さない', async () => {
    const r = await lines(`<div style="columns:2;column-gap:10pt"><p>${br('a', 6)}</p><p style="break-inside:avoid">${br('k', 25)}</p><p>${br('z', 6)}</p></div>`);
    expect(r.pages.length).toBe(1);
    expect(Math.max(...r.pages[0].map((l) => l.y))).toBeLessThan(200);
    expect(r.pages[0].find((l) => l.t === 'z6')!.x).toBeGreaterThan(100);
    expect(r.warnings.some((w) => /溢れ|fit/.test(w))).toBe(false);
  });
  it('次のページへ送った段組の前の余白は切り詰め、1 行目の段はページの高さいっぱい', async () => {
    const r = await lines(`<div style="height:205pt">x</div><div style="margin-top:20pt;columns:2;column-gap:10pt"><p>${br('a', 35)}</p><p>${br('b', 35)}</p></div>`, '300pt 210pt');
    const p2 = r.pages[1];
    expect(p2.find((l) => l.t === 'a1')!.y).toBe(0);
    // 1 段目は 21 行 (a1〜a21)
    expect(p2.find((l) => l.t === 'a21')!.x).toBe(0);
    expect(p2.find((l) => l.t === 'a22')!.x).toBeGreaterThan(100);
  });
});

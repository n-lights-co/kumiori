/**
 * ページの段組 (body の column-count) の最後のページの段を釣り合わせるとき、空の段の先頭でも入らずにはみ出させた行のある高さを、
 * 収まるとみなさない。前は、短い中身 (1 行の段落) の段の高さを 0 近くまで下げて、本番の組版で行が段からはみ出させ、
 * 字は組まれるのに「行がページに収まりません」と警告していた (段の箱の高さも、行より低くなった)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const page = (body: string, css = '') =>
  `<!doctype html><html><head><style>@page { size: A5; margin: 15mm } ${css}</style></head><body style="column-count: 2">${body}</body></html>`;

const lines = (a: AreaNode, oy = 0, ox = 0, out: Array<{ x: number; y: number; h: number }> = []) => {
  const y = oy + a.y;
  const x = ox + a.x;
  if (a.type === 'line') out.push({ x, y, h: a.height });
  for (const c of childrenOf(a)) lines(c, y + a.padding.top + (a.border.top?.width ?? 0), x + a.padding.left + (a.border.left?.width ?? 0), out);
  return out;
};

describe('ページの段組の釣り合わせと、はみ出す行', () => {
  for (const style of ['browser', 'ah'] as const) {
    it(`1 行の段落を釣り合わせても警告しない (--style ${style})`, async () => {
      const r = await typesetHtml(page('<p>One.</p>'), { loadFont: loadCachedFont, style });
      expect(r.warnings.filter((w) => /収まり/.test(w))).toEqual([]);
      expect(r.areaTree.sheets).toHaveLength(1);
    });
    it(`2 つの段落を 2 段に分けても警告しない (--style ${style})`, async () => {
      const r = await typesetHtml(page('<p>One.</p><p>Two.</p>'), { loadFont: loadCachedFont, style });
      expect(r.warnings.filter((w) => /収まり/.test(w))).toEqual([]);
    });
    it(`80 個の段落を釣り合わせても警告しない (--style ${style})`, async () => {
      const body = Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i + 1}.</p>`).join('');
      const r = await typesetHtml(page(body), { loadFont: loadCachedFont, style });
      expect(r.warnings.filter((w) => /収まり/.test(w))).toEqual([]);
    });
  }
  it('釣り合わせた段の高さは、段の中の行より低くならない', async () => {
    const r = await typesetHtml(page('<p>One.</p><p>Two.</p>'), { loadFont: loadCachedFont, style: 'browser' });
    const ls = lines(r.areaTree.sheets[0]);
    // 2 つの段落は、1 段に 1 つずつ
    expect(new Set(ls.map((l) => Math.round(l.x))).size).toBe(2);
    // 段 (本文の領域の子の箱) の高さは、行の高さ以上 (前は 0 近くまで下げていた)
    let body: AreaNode | undefined;
    const rec = (a: AreaNode) => {
      if (a.type === 'region-body') body = a;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(r.areaTree.sheets[0]);
    const cols = childrenOf(body!);
    expect(cols).toHaveLength(2);
    for (const c of cols) expect(c.height).toBeGreaterThanOrEqual(ls[0].h - 0.01);
  });
});

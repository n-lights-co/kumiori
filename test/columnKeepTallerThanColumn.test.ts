/**
 * 段組の中の、分けない指定のブロックが、段に入る高さより高いとき。
 * - XSL-FO: keep-together は、満たせなければ破る (XSL 1.1 §7.20.3。段組のコンテナ axf:column-count の段も同じ)。
 *   1 段より高いブロックは、どの段の高さでも分かれるので、釣り合わせは、それを分けた高さも収まるとみなす (1 段に積んでページの下へ
 *   はみ出させない)。段に入る高さのブロックは、これまでどおり分けない
 * - HTML: break-inside: avoid・avoid-column も、避けられない区切りは避けない (CSS Fragmentation 3 §3.3・§4.4)
 * (https://www.w3.org/TR/xsl11/・https://www.w3.org/TR/css-break-3/ 2026-11-19 取得)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const words = (t: string, n: number) => Array.from({ length: n }, (_, k) => `${t}${k}`).join(' ');
/** ページは 300pt 四方、余白 20pt (本文の高さは 260pt)。字は 10pt、行の高さは 12pt。段の幅は 124pt (段間 12pt) */
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-family="serif" font-size="10pt" line-height="12pt" xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const BC = (inner: string) => `<fo:block-container axf:column-count="2" axf:column-gap="12pt">${inner}</fo:block-container>`;
const html = (css: string, body: string) =>
  `<!doctype html><html lang="en"><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif} .c{columns:2;column-gap:12pt} ${css}</style></head><body>${body}</body></html>`;

interface Line { page: number; x: number; y: number; bottom: number; t: string }
async function lay(text: string, opts: Record<string, string>) {
  const r = await typeset(text, { name: opts.compat ? 't.fo' : 't.html', loadFont: loadCachedFont, ...opts } as never);
  const lines: Line[] = [];
  const textOf = (a: AreaNode): string => (a.type === 'glyph' ? ((a as unknown as { text: string }).text ?? '') : childrenOf(a).map(textOf).join(''));
  r.areaTree.sheets.forEach((s, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const n = a as unknown as { x?: number; y?: number; height?: number; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
      const x = ox + (n.x ?? 0);
      const y = oy + (n.y ?? 0);
      if (a.type === 'line') {
        const t = textOf(a).trim();
        if (t) lines.push({ page, x, y, bottom: y + (n.height ?? 0), t });
        return;
      }
      for (const c of childrenOf(a)) rec(c, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0), y + (n.border?.top?.width ?? 0) + (n.padding?.top ?? 0));
    };
    rec(s.page as unknown as AreaNode, 0, 0);
  });
  return { lines, warnings: r.warnings.map((w) => (typeof w === 'string' ? w : (w as { message: string }).message)).join('\n'), pages: r.areaTree.sheets.length };
}
/** K の行 (分けない指定のブロックの行) の、段ごとの行の数と、いちばん下の行の下端 */
const shape = (ls: Line[], re = /^K/) => {
  const k = ls.filter((l) => re.test(l.t));
  return { left: k.filter((l) => l.x < 150).length, right: k.filter((l) => l.x >= 150).length, bottom: Math.max(...k.map((l) => l.bottom)), pages: new Set(k.map((l) => l.page)).size };
};

describe('段組の中の、1 段より高い分けない指定のブロック (XSL-FO)', () => {
  const kt = (n: number, a = 'keep-together.within-column="always"') => `<fo:block ${a}>${words('K', n)}</fo:block>`;
  for (const compat of ['spec', 'antenna'] as const) {
    it(`1 段より高い keep-together のブロックは、2 つの段に分けて、ページに収める (${compat})`, async () => {
      // 25 行 (300pt) と 37 行 (444pt。2 段なら入る)
      for (const body of [BC(kt(150)), BC(kt(220)), BC(kt(150, 'keep-together.within-page="always"')), BC(`<fo:block>${words('p', 20)}</fo:block>${kt(150)}`)]) {
        const r = await lay(fo(body), { compat });
        const s = shape(r.lines);
        expect(s.pages).toBe(1);
        expect(s.left).toBeGreaterThan(0);
        expect(s.right).toBeGreaterThan(0);
        // ページの本文の下端 (280pt) より下に出ない
        expect(s.bottom).toBeLessThanOrEqual(280.01);
        expect(r.warnings).not.toMatch(/ページより大きい/);
      }
    });

    it(`1 段より高い、分けない指定の表も、2 つの段に分ける (${compat})`, async () => {
      const rows = Array.from({ length: 25 }, (_, i) => `<fo:table-row><fo:table-cell><fo:block>K${i}</fo:block></fo:table-cell></fo:table-row>`).join('');
      const r = await lay(fo(BC(`<fo:table keep-together.within-column="always"><fo:table-body>${rows}</fo:table-body></fo:table>`)), { compat });
      const s = shape(r.lines);
      expect(s.left).toBeGreaterThan(0);
      expect(s.right).toBeGreaterThan(0);
      expect(s.bottom).toBeLessThanOrEqual(280.01);
    });

    it(`入れ子の keep-together (外が 1 段より高い) も、2 つの段に分け、内のブロックは分けない (${compat})`, async () => {
      const inner = (k: number) => `<fo:block-container keep-together.within-column="always"><fo:block>${words(`K${k}x`, 28)}</fo:block></fo:block-container>`;
      const r = await lay(fo(BC(`<fo:block keep-together.within-column="always">${[0, 1, 2, 3, 4, 5].map(inner).join('')}</fo:block>`)), { compat });
      const s = shape(r.lines);
      expect(s.pages).toBe(1);
      expect(s.right).toBeGreaterThan(0);
      expect(s.bottom).toBeLessThanOrEqual(280.01);
      for (let k = 0; k < 6; k++) expect(new Set(r.lines.filter((l) => l.t.startsWith(`K${k}x`)).map((l) => l.x < 150)).size).toBe(1);
    });

    it(`段に入る高さの keep-together のブロックは、これまでどおり分けない (${compat})`, async () => {
      const r = await lay(fo(BC(`<fo:block>${words('p', 20)}</fo:block>${kt(90)}<fo:block>${words('r', 20)}</fo:block>`)), { compat });
      const s = shape(r.lines);
      expect(s.left === 0 || s.right === 0).toBe(true);
    });
  }
});

describe('HTML の段組の中の、1 段より高い break-inside: avoid のブロック', () => {
  for (const style of [undefined, 'ah', 'weasyprint', 'vivliostyle'] as const) {
    const opts: Record<string, string> = style ? { style } : {};
    it(`1 段より高い avoid・avoid-column のブロックは、2 つの段に分けて、ページに収める (${style ?? '既定'})`, async () => {
      for (const v of ['avoid', 'avoid-column'])
        for (const pre of ['', `<p style="margin:0">${words('p', 20)}</p>`]) {
          const r = await lay(html(`.a{break-inside:${v}}`, `<div class="c">${pre}<div class="a">${words('K', 150)}</div></div>`), opts);
          const s = shape(r.lines);
          expect(s.pages).toBe(1);
          expect(s.left).toBeGreaterThan(0);
          expect(s.right).toBeGreaterThan(0);
          expect(s.bottom).toBeLessThanOrEqual(280.01);
        }
    });
  }
});

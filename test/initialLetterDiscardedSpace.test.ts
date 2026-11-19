/**
 * 領域 (ページ・段) の頭で捨てる余白と、頭字 (axf:initial-letters・initial-letter) の位置。
 * 頭で捨てる space-before (XSL 1.1 §4.3.1 の conditionality="discard"。段組のコンテナの段・region-body の段・表のセルも参照領域の頭) は、
 * 行と同じく頭字の箱の位置にも数えない。余白を 0 にしたときと、頭字と行の位置が同じになる。
 * HTML の --style ah の段の頭の margin-top (段の頭で捨てる) も同じ (initial-letter と、段落の頭の float)。
 * (https://www.w3.org/TR/xsl11/ 2026-11-19 取得)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typeset, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const words = (t: string, n: number) => Array.from({ length: n }, (_, k) => `${t}${k}`).join(' ');
const fo = (body: string, rb = '') =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-family="serif" font-size="10pt" line-height="12pt" xml:lang="en"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="20pt"><fo:region-body${rb}/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const BC = (inner: string) => `<fo:block-container axf:column-count="2" axf:column-gap="12pt">${inner}</fo:block-container>`;
const IL = (sb: string, a = '') => `<fo:block axf:initial-letters="2" space-before="${sb}"${a}>${words('v', 30)}</fo:block>`;

/** 頭字 (大きい字) の位置と、その段落の最初の行 (頭字の後ろの行) の位置 */
async function place(text: string, opts: Record<string, string>) {
  const r = await typeset(text, { name: opts.compat ? 't.fo' : 't.html', loadFont: loadCachedFont, ...opts } as never);
  let cap: { page: number; x: number; y: number } | undefined;
  let line: { page: number; x: number; y: number } | undefined;
  r.areaTree.sheets.forEach((s, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const n = a as unknown as { x?: number; y?: number; fontSize?: number; text?: string; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
      const x = ox + (n.x ?? 0);
      const y = oy + (n.y ?? 0);
      if (a.type === 'glyph') {
        if (!cap && (n.fontSize ?? 0) > 15) cap = { page, x, y };
        return;
      }
      // 頭字の後ろの、最初の v の行
      if (a.type === 'line' && cap && !line && JSON.stringify(a).includes('"v"') && x > cap.x + 1) line = { page, x, y };
      for (const c of childrenOf(a)) rec(c, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0), y + (n.border?.top?.width ?? 0) + (n.padding?.top ?? 0));
    };
    rec(s.page as unknown as AreaNode, 0, 0);
  });
  return { cap: cap!, line: line! };
}

const cases: [string, (sb: string) => string, string?][] = [
  ['ページの頭', (sb) => IL(sb)],
  ['強制改ページの後', (sb) => `<fo:block>${words('p', 10)}</fo:block>${IL(sb, ' break-before="page"')}`],
  ['段組のコンテナの最初の段の頭', (sb) => BC(IL(sb))],
  ['段組のコンテナの span="all" の後ろの段の組の頭', (sb) => BC(`<fo:block>${words('p', 20)}</fo:block><fo:block span="all">SPAN</fo:block>${IL(sb)}`)],
  ['段組のコンテナの break-before="column" の後', (sb) => BC(`<fo:block>${words('p', 20)}</fo:block>${IL(sb, ' break-before="column"')}`)],
  ['region-body の段の頭', (sb) => IL(sb), ' column-count="2"'],
  ['表のセルの頭', (sb) => `<fo:block>x</fo:block><fo:table><fo:table-body><fo:table-row><fo:table-cell>${IL(sb)}</fo:table-cell></fo:table-row></fo:table-body></fo:table>`],
];

describe('領域の頭で捨てる space-before と、頭字の位置 (XSL-FO)', () => {
  for (const compat of ['spec', 'antenna'] as const)
    for (const [name, body, rb] of cases) {
      it(`${name}: 頭字も行も、余白を 0 にしたときと同じ位置 (${compat})`, async () => {
        const ref = await place(fo(body('0pt'), rb), { compat });
        const got = await place(fo(body('8pt'), rb), { compat });
        expect(got.line.page).toBe(ref.line.page);
        expect(got.line.y).toBeCloseTo(ref.line.y, 2);
        expect(got.cap.page).toBe(ref.cap.page);
        expect(got.cap.x).toBeCloseTo(ref.cap.x, 2);
        expect(got.cap.y).toBeCloseTo(ref.cap.y, 2);
      });
    }

  it('retain の space-before は、頭字も行も残す (spec)', async () => {
    const ref = await place(fo(BC(IL('0pt'))), { compat: 'spec' });
    const got = await place(fo(BC(IL('8pt', ' space-before.conditionality="retain"'))), { compat: 'spec' });
    expect(got.line.y).toBeCloseTo(ref.line.y + 8, 2);
    expect(got.cap.y).toBeCloseTo(ref.cap.y + 8, 2);
  });
});

describe('HTML の段の頭で捨てる margin-top と、initial-letter の位置', () => {
  const html = (mt: string) =>
    `<!doctype html><html lang="en"><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif} .c{columns:2;column-gap:12pt} p{margin:${mt} 0 0} p::first-letter{initial-letter:2}</style></head><body><div class="c"><p>${words('v', 30)}</p></div></body></html>`;
  it('--style ah: 段の頭の margin-top を捨てるとき、頭字も行と同じく上へ', async () => {
    const ref = await place(html('0'), { style: 'ah' });
    const got = await place(html('8pt'), { style: 'ah' });
    expect(got.line.y).toBeCloseTo(ref.line.y, 2);
    expect(got.cap.y).toBeCloseTo(ref.cap.y, 2);
  });
  it('既定: 段の頭の margin-top は、頭字も行も残す (いまのまま)', async () => {
    const ref = await place(html('0'), {});
    const got = await place(html('8pt'), {});
    expect(got.line.y).toBeCloseTo(ref.line.y + 8, 2);
    expect(got.cap.y).toBeCloseTo(ref.cap.y + 8, 2);
  });

  it('--style ah: 段の頭の margin-top を捨てるとき、段落の頭の float も行と同じ高さ (CSS 2.1 §9.5.1 の規則 4)', async () => {
    const text = `<!doctype html><html lang="en"><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif} .c{columns:2;column-gap:12pt} .f{float:left;width:30pt;height:30pt;background:#f00}</style></head><body><div class="c"><p style="margin:8pt 0 0"><span class="f"></span>${words('v', 40)}</p></div></body></html>`;
    const r = await typeset(text, { name: 't.html', loadFont: loadCachedFont, style: 'ah' } as never);
    let box: number | undefined;
    let line: number | undefined;
    const rec = (a: AreaNode, oy: number) => {
      const n = a as unknown as { y?: number; backgroundColor?: unknown };
      const y = oy + (n.y ?? 0);
      if (box === undefined && n.backgroundColor) box = y;
      if (line === undefined && a.type === 'line') line = y;
      for (const c of childrenOf(a)) rec(c, y);
    };
    rec(r.areaTree.sheets[0].page as unknown as AreaNode, 0);
    expect(line).toBeCloseTo(20, 2);
    expect(box).toBeCloseTo(line!, 2);
  });
});

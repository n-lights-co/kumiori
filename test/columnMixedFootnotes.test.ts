/**
 * 段組のページで、長い脚注 (12〜30 行) と短い脚注が混ざる文書。
 * - 本文の後に足したページで、分けられない続きの脚注を丸ごと積み上げない (脚注の領域を本文領域より高くせず、上の行をページの外へ
 *   出して黙って消さない。もう脚注を置いたページなら、次のページへ送る)
 * - 前のページからの続きを次のページへ送っても、そのページで参照する脚注の頭は、参照のページに置く (XSL 1.1 §6.12.3・CSS GCPM 3 §2。
 *   1 段のページの Flow.pushFootnote と同じ)
 * - 組み直しで、前の回の組版で脚注のあったページに要らない予約を残さない (本文が数行だけで脚注の無いページを作らない)。
 *   予約は、本文のあるページでは本文の 1 行の高さを残す (「行がページに収まりません」を出さない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetFo, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

interface Line {
  text: string;
  top: number;
  bottom: number;
}

/** ページごとの、本文領域の中の行 (字の並びと、ページの上からの位置) */
function pageLines(sheets: AreaNode[]): Line[][] {
  return sheets.map((s) => {
    const out: Line[] = [];
    const text = (a: AreaNode): string => (a.type === 'glyph' ? (a as GlyphArea).text : childrenOf(a).map(text).join(''));
    const rec = (a: AreaNode, oy: number, inBody: boolean) => {
      const y = oy + a.y;
      const body = inBody || a.type === 'region-body';
      if (a.type === 'line') {
        if (body) out.push({ text: text(a).replace(/\s/g, ''), top: y, bottom: y + a.height });
        return;
      }
      for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0), body);
    };
    rec(s, 0, false);
    return out;
  });
}

/** 脚注の 1 行: 「fnNxJ」と「w」を 12 個 */
const item = (n: number, j: number) => `fn${n}x${j} ` + Array(12).fill('w').join(' ');

/** 本文 lines 行 (line N text)。notes の行に、その行数の脚注を付ける (HTML の 2 段) */
const html = (lines: number, notes: Record<number, number>) =>
  `<!doctype html><html><head><style>@page { size: 300pt 300pt; margin: 10pt } ` +
  `body { margin: 0; font-size: 10pt; line-height: 12pt; column-count: 2 } p { margin: 0 } .F { float: footnote } .i { display: block }` +
  `</style></head><body>` +
  Array.from({ length: lines }, (_, i) => {
    const n = i + 1;
    const c = notes[n];
    if (!c) return `<p>line ${n} text</p>`;
    const rest = Array.from({ length: c - 1 }, (_, j) => `<span class=i>${item(n, j + 2)}</span>`).join('');
    return `<p>line ${n} text<span class=F>${item(n, 1)}${rest}</span></p>`;
  }).join('') +
  `</body></html>`;

/** 同じ形の XSL-FO (region-body の 2 段。脚注の 1 行が 1 つの fo:block) */
const fo = (lines: number, notes: Record<number, number>) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format">` +
  `<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="10pt">` +
  `<fo:region-body column-count="2" column-gap="12pt"/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body" font-size="10pt" line-height="12pt">` +
  Array.from({ length: lines }, (_, i) => {
    const n = i + 1;
    const c = notes[n];
    if (!c) return `<fo:block>line ${n} text</fo:block>`;
    const body = Array.from({ length: c }, (_, j) => `<fo:block>${item(n, j + 1)}</fo:block>`).join('');
    return `<fo:block>line ${n} text<fo:footnote><fo:inline baseline-shift="super" font-size="7pt">*</fo:inline><fo:footnote-body>${body}</fo:footnote-body></fo:footnote></fo:block>`;
  }).join('') +
  `</fo:flow></fo:page-sequence></fo:root>`;

const bodyLine = /^line(\d+)text/;

/**
 * 本文と脚注の行が全部あること、脚注の行が本文の行と重ならず本文領域 (ページの上から 10〜290pt) の中にあること、
 * 脚注の頭が参照のページにあるもの・無いものの数を返す
 */
function check(sheets: AreaNode[], lines: number, notes: Record<number, number>) {
  const pages = pageLines(sheets);
  const linePage = new Map<number, number>();
  const notePage = new Map<string, number>();
  pages.forEach((ls, p) => {
    for (const l of ls) {
      const m = bodyLine.exec(l.text);
      if (m) linePage.set(Number(m[1]), p);
      const f = /fn(\d+)x(\d+)/.exec(l.text);
      if (f) notePage.set(`${f[1]}x${f[2]}`, p);
    }
    const body = ls.filter((l) => bodyLine.test(l.text));
    const foot = ls.filter((l) => !bodyLine.test(l.text));
    for (const l of foot) {
      expect(l.top).toBeGreaterThanOrEqual(10 - 0.01);
      expect(l.bottom).toBeLessThanOrEqual(290 + 0.01);
    }
    if (body.length && foot.length) expect(Math.min(...foot.map((l) => l.top))).toBeGreaterThanOrEqual(Math.max(...body.map((l) => l.bottom)) - 0.01);
  });
  for (let n = 1; n <= lines; n++) expect(linePage.has(n), `line ${n}`).toBe(true);
  let away = 0;
  for (const [n, c] of Object.entries(notes)) {
    for (let j = 1; j <= c; j++) expect(notePage.has(`${n}x${j}`), `fn${n}x${j}`).toBe(true);
    if (notePage.get(`${n}x1`) !== linePage.get(Number(n))) away++;
  }
  return { pages, away };
}

const fitWarnings = (ws: string[]) => ws.filter((w) => /収まり|収まら/.test(w));

describe('段組のページの、長い脚注と短い脚注の混ざる文書', () => {
  // 本文の終わりの近くに、長い脚注と短い脚注が続く文書。本文の後に足すページに、前のページからの続きが多く残る
  const tail = { 8: 2, 74: 1, 120: 1, 121: 2, 124: 2, 125: 2, 128: 1, 130: 30, 132: 2, 137: 1, 138: 5, 142: 3, 144: 1, 145: 2, 146: 5, 148: 5, 149: 12 };

  it('本文の後に足したページで、分けられない続きを積み上げず、脚注の行を消さない (XSL-FO の 2 段)', async () => {
    const r = await typesetFo(fo(149, tail), { loadFont: loadCachedFont });
    check(r.areaTree.sheets, 149, tail);
    expect(fitWarnings(r.warnings)).toEqual([]);
  });

  it('同じ形の HTML の 2 段でも、脚注の行を消さない', async () => {
    const r = await typesetHtml(html(149, tail), { loadFont: loadCachedFont });
    check(r.areaTree.sheets, 149, tail);
    expect(fitWarnings(r.warnings)).toEqual([]);
  });

  // 長い脚注 (30 行) の続きが何ページも続くあいだに、短い脚注を参照する文書
  const mixed = { 14: 5, 27: 3, 43: 1, 46: 5, 66: 3, 71: 30, 122: 30, 147: 5, 153: 5, 161: 1, 167: 30, 184: 30, 188: 1, 204: 1 };

  it('長い脚注の続きを次のページへ送っても、そのページで参照する脚注の頭を参照のページに置く (HTML の 2 段)', async () => {
    const r = await typesetHtml(html(215, mixed), { loadFont: loadCachedFont });
    const { pages, away } = check(r.areaTree.sheets, 215, mixed);
    expect(away).toBe(0);
    expect(fitWarnings(r.warnings)).toEqual([]);
    // 要らない予約を残さない (前は 17〜18 ページで、本文が 2 行だけで脚注の無いページがあった)
    expect(pages.length).toBeLessThanOrEqual(13);
    for (const ls of pages.slice(0, -1)) expect(ls.length).toBeGreaterThan(4);
  });

  it('XSL-FO の 2 段でも同じ', async () => {
    const r = await typesetFo(fo(215, mixed), { loadFont: loadCachedFont });
    const { pages, away } = check(r.areaTree.sheets, 215, mixed);
    expect(away).toBe(0);
    expect(fitWarnings(r.warnings)).toEqual([]);
    expect(pages.length).toBeLessThanOrEqual(12);
  });
});

/**
 * 段組のページで、参照の行の下に入りきらない長い脚注。
 * 脚注の本体は、参照のあるページから始め、入りきらない分は行の単位で分けて、続くページの脚注の領域の先頭へ続ける
 * (XSL 1.1 §6.12.3、CSS GCPM 3 §2。1 段のページの Flow.pushFootnote と同じ)。本文の行は、脚注の領域と重ねない。
 * 前は、ページに入る高さの脚注を丸ごと置いて、参照の行を置く高さを残さない予約をしたので、組み直すたびに参照が次のページへ送られ、
 * 1 段に 2 行ずつのページが続き、組み直しの回数の上限で止めたページでは、予約の無い本文の上に脚注を重ねて描いた
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
        if (body) out.push({ text: text(a), top: y, bottom: y + a.height });
        return;
      }
      for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0), body);
    };
    rec(s, 0, false);
    return out;
  });
}

/** 脚注の文: 「fnlineN」と「w」を 20 個並べた語の並びを、N=1〜n まで続けたもの */
const noteText = (n: number) => Array.from({ length: n }, (_, i) => `fnline${i + 1} ` + Array(20).fill('w').join(' ')).join(' ');
const isBody = (l: Line) => /^line\d+text/.test(l.text.replace(/\s/g, ''));

const html = (opts: { cols: number; notes: number; lines?: number; at?: number }) => {
  const n = opts.lines ?? 59;
  const at = opts.at ?? 40;
  const body = Array.from({ length: n }, (_, i) =>
    i + 1 === at ? `<p>line ${i + 1} text<span class=F>${noteText(opts.notes)}</span></p>` : `<p>line ${i + 1} text</p>`,
  ).join('');
  return (
    `<!doctype html><html><head><style>@page { size: 300pt 300pt; margin: 10pt } ` +
    `body { margin: 0; font-size: 10pt; line-height: 12pt${opts.cols > 1 ? `; column-count: ${opts.cols}` : ''} } p { margin: 0 } .F { float: footnote }` +
    `</style></head><body>${body}</body></html>`
  );
};

const fo = (notes: number) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt" line-height="12pt">` +
  `<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="300pt" page-height="300pt" margin="10pt">` +
  `<fo:region-body column-count="2"/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">` +
  Array.from({ length: 59 }, (_, i) =>
    i + 1 === 40
      ? `<fo:block>line 40 text<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>${noteText(notes)}</fo:block></fo:footnote-body></fo:footnote></fo:block>`
      : `<fo:block>line ${i + 1} text</fo:block>`,
  ).join('') +
  `</fo:flow></fo:page-sequence></fo:root>`;

/** 本文の行と脚注の行が重ならないこと、本文と脚注の行が全部あること、脚注が参照のページから始まることを確かめる */
function check(sheets: AreaNode[], opts: { lines?: number; notes: number; at?: number }) {
  const pages = pageLines(sheets);
  const n = opts.lines ?? 59;
  const at = opts.at ?? 40;
  for (const ls of pages) {
    const body = ls.filter(isBody);
    const notes = ls.filter((l) => !isBody(l));
    if (!body.length || !notes.length) continue;
    // 脚注の行は、本文の行より下 (脚注の領域は、本文の行の下端より上に来ない)
    const bodyBottom = Math.max(...body.map((l) => l.bottom));
    const noteTop = Math.min(...notes.map((l) => l.top));
    expect(noteTop).toBeGreaterThanOrEqual(bodyBottom - 0.01);
  }
  const all = pages.flat();
  expect(all.filter(isBody)).toHaveLength(n);
  const joined = pages.map((ls) => ls.map((l) => l.text).join(' '));
  for (let k = 1; k <= opts.notes; k++) expect(joined.join(' ')).toContain(`fnline${k} `);
  const refPage = pages.findIndex((ls) => ls.some((l) => isBody(l) && l.text.replace(/\s/g, '').startsWith(`line${at}text`)));
  const notePage = joined.findIndex((t) => t.includes('fnline1 '));
  expect(notePage).toBe(refPage);
  return pages;
}

describe('段組のページの長い脚注', () => {
  it('参照の行の下に入りきらない脚注は、参照のページに頭を置き、残りを次のページへ続ける (HTML の 2 段)', async () => {
    const r = await typesetHtml(html({ cols: 2, notes: 29 }), { loadFont: loadCachedFont });
    const pages = check(r.areaTree.sheets, { notes: 29 });
    // 1 ページ目の本文は、段の高さいっぱいに組む (前は 1 段に 2 行ずつ)
    expect(pages[0].filter(isBody).length).toBeGreaterThan(30);
    expect(r.warnings.filter((w) => /脚注|収まり/.test(w))).toEqual([]);
  });

  it('1 ページに入りきらない脚注を、続く何ページにも分けて続ける (HTML の 2 段)', async () => {
    const r = await typesetHtml(html({ cols: 2, notes: 80 }), { loadFont: loadCachedFont });
    const pages = check(r.areaTree.sheets, { notes: 80 });
    expect(pages.length).toBeGreaterThan(3);
  });

  it('本文の初めのほうで参照しても、本文を段の高さいっぱいに組む (HTML の 3 段)', async () => {
    const r = await typesetHtml(html({ cols: 3, notes: 29, lines: 120, at: 5 }), { loadFont: loadCachedFont });
    const pages = check(r.areaTree.sheets, { notes: 29, lines: 120, at: 5 });
    expect(pages[0].filter(isBody).length).toBeGreaterThan(3);
  });

  it('XSL-FO の region-body の 2 段でも同じ', async () => {
    const r = await typesetFo(fo(29), { loadFont: loadCachedFont });
    check(r.areaTree.sheets, { notes: 29 });
  });

  it('段組でない本文でも、脚注を本文の行と重ねず、参照のページから続ける', async () => {
    for (const notes of [29, 80]) {
      const r = await typesetHtml(html({ cols: 1, notes }), { loadFont: loadCachedFont });
      check(r.areaTree.sheets, { notes });
    }
  });
});

/** 本文 n 行のうち、every 行ごとに短い脚注 (1 行) を付けた文書。every=0 なら line 5 にだけ付ける */
const shortNotes = (n: number, every: number, cols = 2) =>
  `<!doctype html><html><head><style>@page { size: 300pt 300pt; margin: 10pt } ` +
  `body { margin: 0; font-size: 10pt; line-height: 12pt; column-count: ${cols} } p { margin: 0 } .F { float: footnote }` +
  `</style></head><body>` +
  Array.from({ length: n }, (_, i) =>
    (every ? (i + 1) % every === 0 : i + 1 === 5) ? `<p>line ${i + 1} text<span class=F>short note ${i + 1}</span></p>` : `<p>line ${i + 1} text</p>`,
  ).join('') +
  `</body></html>`;

describe('段組のページの短い脚注 (後ろのページの段を縮めない)', () => {
  it('脚注のあるページの次のページに、要らない脚注の予約を残さない (脚注の無いページは段の高さいっぱいに組む)', async () => {
    const r = await typesetHtml(shortNotes(119, 0), { loadFont: loadCachedFont });
    const pages = pageLines(r.areaTree.sheets);
    // 本文領域 280pt・行送り 12pt で 1 段 23 行。2 ページ目は脚注が無いので 2 段で 46 行
    expect(pages[1].filter(isBody)).toHaveLength(46);
    expect(pages.flat().filter(isBody)).toHaveLength(119);
    expect(r.warnings.filter((w) => /脚注|収まり/.test(w))).toEqual([]);
  });

  it('5 行ごとに短い脚注を付けても、ページが増えず、行がページに収まる', async () => {
    const r = await typesetHtml(shortNotes(119, 5), { loadFont: loadCachedFont });
    const pages = pageLines(r.areaTree.sheets);
    expect(pages.length).toBeLessThanOrEqual(5);
    expect(pages.flat().filter(isBody)).toHaveLength(119);
    for (let k = 5; k <= 115; k += 5) expect(pages.flat().some((l) => l.text.includes(`short note ${k}`))).toBe(true);
    expect(r.warnings.filter((w) => /脚注|収まり/.test(w))).toEqual([]);
    // 参照のページに脚注を置く (どの脚注も、参照の行と同じページ)
    for (let k = 5; k <= 115; k += 5) {
      const ref = pages.findIndex((ls) => ls.some((l) => isBody(l) && l.text.replace(/\s/g, '').startsWith(`line${k}text`)));
      const note = pages.findIndex((ls) => ls.some((l) => l.text.includes(`short note ${k}`)));
      expect(note).toBe(ref);
    }
  });

  it('長い文書 (2999 行・7 行ごとに脚注) でも、行がページに収まる', async () => {
    const r = await typesetHtml(shortNotes(2999, 7), { loadFont: loadCachedFont });
    expect(r.areaTree.sheets.length).toBeLessThanOrEqual(100);
    expect(r.warnings.filter((w) => /脚注|収まり/.test(w))).toEqual([]);
  });
});

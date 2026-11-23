/**
 * 段組のページの脚注の予約 (本文領域の下に空ける高さ) の組み直し。
 * - 脚注の多い長い段組の文書で、本文が数行だけで脚注の無いページを作らず、ページを増やさない (前は、ページの番号ごとに前の回の
 *   要る高さを予約にし、前から 1 ページずつ固めたので、文書の初めの数ページしか固まらず、残りの回が予約を積んで、ページが 4〜5 割増えた)
 * - 脚注の量がページより多いページで、予約を上げると参照が次のページへ移り、下げるとまた戻るところで振れず、ほとんど白いページを残さない
 * - 脚注の頭は参照のページに置く (XSL 1.1 §6.12.3・CSS GCPM 3 §2)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetFo, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { columnFo, columnHtml, overfullHtml, randomNotes } from '../scripts/gen-column-footnotes.mjs';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの、本文領域の中の行の字 (空白を除く) */
function pageLines(sheets: AreaNode[]): string[][] {
  return sheets.map((s) => {
    const out: string[] = [];
    const text = (a: AreaNode): string => (a.type === 'glyph' ? (a as GlyphArea).text : childrenOf(a).map(text).join(''));
    const rec = (a: AreaNode, inBody: boolean) => {
      const body = inBody || a.type === 'region-body';
      if (a.type === 'line') {
        if (body) out.push(text(a).replace(/\s/g, ''));
        return;
      }
      for (const c of childrenOf(a)) rec(c, body);
    };
    rec(s, false);
    return out;
  });
}

const isFoot = (l: string) => /^\d*fn\d+x\d+/.test(l);

/**
 * 本文の行と脚注の行を数える: 最後を除くページのうち、本文が 4 行以下で脚注の無いページの数・参照と別のページに頭を置いた脚注の数、
 * 本文と脚注の行が全部あること
 */
function stats(sheets: AreaNode[], lines: number, notes: Record<number, number>) {
  const pages = pageLines(sheets);
  const linePage = new Map<number, number>();
  const notePage = new Map<string, number>();
  let thin = 0;
  pages.forEach((ls, p) => {
    let body = 0;
    let foot = 0;
    for (const l of ls) {
      const f = /fn(\d+)x(\d+)/.exec(l);
      if (f && isFoot(l)) {
        foot++;
        if (!notePage.has(`${f[1]}x${f[2]}`)) notePage.set(`${f[1]}x${f[2]}`, p);
        continue;
      }
      body++;
      const m = /^line(\d+)text/.exec(l);
      if (m && !linePage.has(Number(m[1]))) linePage.set(Number(m[1]), p);
    }
    if (p < pages.length - 1 && body <= 4 && foot === 0) thin++;
  });
  for (let n = 1; n <= lines; n++) expect(linePage.has(n), `line ${n}`).toBe(true);
  let away = 0;
  for (const [n, c] of Object.entries(notes)) {
    for (let j = 1; j <= c; j++) expect(notePage.has(`${n}x${j}`), `fn${n}x${j}`).toBe(true);
    if (notePage.get(`${n}x1`) !== linePage.get(Number(n))) away++;
  }
  return { pages: pages.length, thin, away };
}

// 文書は scripts/gen-column-footnotes.mjs で作る (種を決めた乱数。node scripts/gen-column-footnotes.mjs <dir> で、3000 行の文書など
// 確かめの一揃いを書き出し、scripts/measure-column-footnotes.mjs で版ごとに組み比べられる)
const html = (lines: number, notes: Record<number, number>) => columnHtml(lines, notes);
const fo = (lines: number, notes: Record<number, number>) => columnFo(lines, notes);

const fitWarnings = (ws: string[]) => ws.filter((w) => /収まり|収まら/.test(w));

describe('段組のページの脚注の予約の組み直し', () => {
  // 1200 行の本文に、長い脚注と短い脚注を乱数で付けた文書 (脚注 83 個・638 行)
  const lines = 1200;
  const notes = randomNotes(lines, 0.08, 7);

  it('脚注の多い長い文書で、本文が数行だけのページを作らず、ページを増やさない (HTML の 2 段)', async () => {
    const r = await typesetHtml(html(lines, notes), { loadFont: loadCachedFont });
    const st = stats(r.areaTree.sheets, lines, notes);
    // 本文 1200 行と脚注 638 行で、55〜57 ページになる。前は 88〜104 ページで、本文が数行だけで脚注の無いページが 9 つあった
    expect(st.thin).toBe(0);
    expect(st.pages).toBeLessThanOrEqual(64);
    expect(st.away).toBeLessThanOrEqual(3);
    expect(fitWarnings(r.warnings)).toEqual([]);
  }, 120_000);

  it('XSL-FO の 2 段でも同じ', async () => {
    const r = await typesetFo(fo(lines, notes), { loadFont: loadCachedFont });
    const st = stats(r.areaTree.sheets, lines, notes);
    expect(st.thin).toBe(0);
    expect(st.pages).toBeLessThanOrEqual(64);
    expect(st.away).toBeLessThanOrEqual(3);
    expect(fitWarnings(r.warnings)).toEqual([]);
  }, 120_000);

  it('脚注の量がページより多いページで、予約が振れて、ほとんど白いページを残さない', async () => {
    // 300×400pt・2 段・9pt の本文。4 行の段落 12 個に、3 行の脚注 (7pt) を 1 つずつ。前は 10 ページで、本文 1 行だけのページが並んだ
    const doc = overfullHtml();
    const r = await typesetHtml(doc.text, { loadFont: loadCachedFont });
    const pages = pageLines(r.areaTree.sheets);
    // 本文の行 (段落の続きの行も数える) がどのページにも 4 行より多い (最後のページを除く)
    for (const ls of pages.slice(0, -1)) expect(ls.filter((l) => !isFoot(l)).length).toBeGreaterThan(4);
    const st = stats(r.areaTree.sheets, doc.lines, doc.notes);
    expect(st.pages).toBeLessThanOrEqual(3);
    expect(st.away).toBe(0);
    expect(fitWarnings(r.warnings)).toEqual([]);
  }, 60_000);
});

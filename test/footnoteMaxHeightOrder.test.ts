/**
 * @footnote の max-height (CSS GCPM 3 §2.4.2) があっても、脚注は文書の順に並ぶ (§2.2: 脚注の領域には文書の順に置く。
 * §2.8: 脚注の本文は参照より後のページへ送ってよいが、前のページには置かない)。
 * 上限で入らない脚注を次のページへ送ったら、そのページの後の脚注も (分けて頭を置けるものも) 次のページへ送る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** ページごとの行の字 (上から) */
async function pageLines(html: string): Promise<string[][]> {
  const t = (await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' })).areaTree;
  const out: string[][] = [];
  for (const s of t.sheets) {
    const ls: Array<{ y: number; text: string }> = [];
    const rec = (a: AreaNode, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'line') ls.push({ y, text: '' });
      if (a.type === 'glyph') ls[ls.length - 1].text += (a as GlyphArea).text;
      for (const c of childrenOf(a)) rec(c, y + a.padding.top + (a.border.top?.width ?? 0));
    };
    rec(s, 0);
    out.push(ls.filter((l) => l.text).sort((a, b) => a.y - b.y).map((l) => l.text));
  }
  return out;
}

/** 段落 n 個。脚注 k (1 始まり) は、long(k) なら 60 語、ほかは 1 行。脚注の本文の語は「w<k>」で、どの脚注の行かが分かる */
function doc(css: string, n: number, long: (k: number) => boolean): string {
  const ps = Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const words = long(k) ? Array.from({ length: 60 }, () => `w${k}`).join(' ') : `w${k}`;
    return `<p>Body text here<span class="f">N${k}: ${words}</span> and more.</p>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><style>p { margin: 0 } .f { float: footnote } ${css}</style></head><body>${ps}</body></html>`;
}

/** 脚注の領域の行ごとの脚注の番号 (全ページを通して、上から) と、脚注ごとの語の数 */
function footRows(pages: string[][]): { order: number[]; words: Map<number, number>; heads: number[] } {
  const order: number[] = [];
  const words = new Map<number, number>();
  const heads: number[] = [];
  for (const p of pages)
    for (const l of p) {
      const ws = [...l.matchAll(/w(\d+)/g)].map((m) => Number(m[1]));
      for (const m of l.matchAll(/N(\d+):/g)) heads.push(Number(m[1]));
      if (!ws.length) continue;
      order.push(ws[0]);
      for (const k of ws) words.set(k, (words.get(k) ?? 0) + 1);
    }
  return { order, words, heads };
}

const PAGE = '@page { size: 120mm 80mm; margin: 15mm; @footnote { max-height: 30pt } }';

describe('@footnote の max-height と脚注の順', () => {
  it('上限で次のページへ送った脚注より後の脚注を、先のページに置かない (番号は全ページを通して文書の順)', async () => {
    const long = (k: number) => k % 3 === 1;
    const pages = await pageLines(doc(PAGE, 12, long));
    const { order, words, heads } = footRows(pages);
    // 脚注の領域の行は、脚注の番号の順 (単調に増える)
    for (let i = 1; i < order.length; i++) expect(order[i], `行 ${i}: ${order.join(',')}`).toBeGreaterThanOrEqual(order[i - 1]);
    expect(heads).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // 脚注の本文が欠けない
    for (let k = 1; k <= 12; k++) expect(words.get(k), `脚注 ${k}`).toBe(long(k) ? 60 : 1);
  });
  it('1 つの脚注が上限より大きくても、分けて続け、止まらない', async () => {
    const pages = await pageLines(doc(PAGE, 3, (k) => k === 1));
    const { order, words } = footRows(pages);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    expect([words.get(1), words.get(2), words.get(3)]).toEqual([60, 1, 1]);
  });
  it('max-height が無ければ、これまでどおり (脚注は参照のページに丸ごと置く)', async () => {
    const pages = await pageLines(doc('@page { size: 120mm 80mm; margin: 15mm }', 6, () => false));
    const { order, words } = footRows(pages);
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...words.values()]).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

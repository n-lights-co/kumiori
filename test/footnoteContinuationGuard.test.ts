/**
 * 本文の終わりの後に、脚注・float の続きのためのページを足す守り。
 * 脚注の続きは、ページが進むかぎり (送る脚注の数か高さが減るかぎり) ページを足して置き、欠けない
 * (CSS GCPM 3 §2.4.2 の @footnote の max-height で、1 ページの脚注の領域が小さいときも、1 つの脚注が長いときも)。
 * 進まない入力 (どのページにも入らないもの) でも、組版は止まる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetFo, typesetHtml, type AreaNode, type GlyphArea } from '../src/index';
import { ContinuationGuard } from '../src/layoutEngine';
import { footUnits, splitEntry } from '../src/footnotes';
import { newNode } from '../src/lnode';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

/** 全ページの字 (ページごと) と警告 */
async function typeset(html: string, fo = false): Promise<{ pages: string[]; warnings: string[] }> {
  const r = fo ? await typesetFo(html, { loadFont: loadCachedFont }) : await typesetHtml(html, { loadFont: loadCachedFont, style: 'browser' });
  const pages: string[] = [];
  for (const s of r.areaTree.sheets) {
    let t = '';
    const rec = (a: AreaNode) => {
      if (a.type === 'line') t += ' ';
      if (a.type === 'glyph') t += (a as GlyphArea).text;
      for (const c of childrenOf(a)) rec(c);
    };
    rec(s);
    pages.push(t);
  }
  return { pages, warnings: r.warnings };
}

/** 段落 n 個。脚注 k (1 始まり) は、long(k) なら words 語、ほかは 1 語。脚注の本文の語は「w<k>」 */
function doc(css: string, n: number, long: (k: number) => boolean, words = 60): string {
  const ps = Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    const ws = long(k) ? Array.from({ length: words }, () => `w${k}`).join(' ') : `w${k}`;
    return `<p>Body text here<span class="f">N${k}: ${ws}</span> and more.</p>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><style>p { margin: 0 } .f { float: footnote } ${css}</style></head><body>${ps}</body></html>`;
}

/** 脚注の頭 (N<k>:) の並び (全ページを通して) と、脚注ごとの語の数 */
function footnotes(pages: string[]): { heads: number[]; words: Map<number, number> } {
  const heads: number[] = [];
  const words = new Map<number, number>();
  for (const p of pages) {
    for (const m of p.matchAll(/N(\d+):/g)) heads.push(Number(m[1]));
    for (const m of p.matchAll(/w(\d+)/g)) words.set(Number(m[1]), (words.get(Number(m[1])) ?? 0) + 1);
  }
  return { heads, words };
}

const dropped = (ws: string[]) => ws.filter((w) => /置きません|not placed|are dropped|欠け/.test(w));

/** 全部の脚注の頭が文書の順に 1 度ずつ出て、本文の語が欠けない */
function expectAll(pages: string[], n: number, long: (k: number) => boolean, words = 60) {
  const { heads, words: got } = footnotes(pages);
  expect(heads).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  for (let k = 1; k <= n; k++) expect(got.get(k), `脚注 ${k}`).toBe(long(k) ? words : 1);
}

const PAGE = (mh: string) => `@page { size: 120mm 80mm; margin: 15mm; @footnote { max-height: ${mh} } }`;

describe('脚注の続きのページの守り', () => {
  it('@footnote の max-height が小さく、続きが本文の終わりから 50 ページを超えても、脚注を欠かさない', async () => {
    const long = (k: number) => k % 5 === 0;
    const r = await typeset(doc(PAGE('12pt'), 40, long));
    expectAll(r.pages, 40, long);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('短い脚注がたくさんあるときも欠かさない (max-height: 30pt)', async () => {
    const r = await typeset(doc(PAGE('30pt'), 300, () => false));
    expectAll(r.pages, 300, () => false);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('長い脚注が多いときも欠かさない (脚注 120 個・max-height: 30pt)', async () => {
    const long = (k: number) => k % 5 === 0;
    const r = await typeset(doc(PAGE('30pt'), 120, long));
    expectAll(r.pages, 120, long);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('縦書きでも、表の中の脚注でも欠かさない', async () => {
    const long = (k: number) => k % 3 === 1;
    const v = await typeset(doc(`html { writing-mode: vertical-rl } ${PAGE('30pt')}`, 30, long));
    expectAll(v.pages, 30, long);
    expect(dropped(v.warnings)).toEqual([]);
    const rows = Array.from({ length: 30 }, (_, i) => `<tr><td>R<span class="f">N${i + 1}: ${long(i + 1) ? Array.from({ length: 60 }, () => `w${i + 1}`).join(' ') : `w${i + 1}`}</span></td></tr>`).join('');
    const t = await typeset(`<!doctype html><html lang="en"><head><style>.f { float: footnote } ${PAGE('12pt')}</style></head><body><table>${rows}</table></body></html>`);
    expectAll(t.pages, 30, long);
    expect(dropped(t.warnings)).toEqual([]);
  }, 120_000);

  it('本文の後に足した、脚注だけのページでは、max-height を当てない (CSS GCPM 3 §2.4.2)', async () => {
    // 本文は 1 ページに収まる。上限 12pt なら脚注は 1 ページに 1 行ほどだが、脚注だけのページには本文の領域の 6 割まで置く
    const long = (k: number) => k <= 2;
    const r = await typeset(doc(PAGE('12pt'), 3, long));
    expectAll(r.pages, 3, long);
    expect(r.pages.length).toBeLessThan(6);
  }, 120_000);

  it('max-height が無くても、1 つの脚注の続きが 50 ページを超えれば、最後まで置く', async () => {
    const one = (k: number) => k === 1;
    const r = await typeset(doc('@page { size: 120mm 80mm; margin: 15mm }', 2, one, 8000));
    expect(r.pages.length).toBeGreaterThan(52);
    expectAll(r.pages, 2, one, 8000);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('段組のページでも、1 つの脚注の続きが 50 ページを超えれば、最後まで置く', async () => {
    const one = (k: number) => k === 1;
    const r = await typeset(doc('@page { size: 120mm 80mm; margin: 15mm } body { columns: 2; column-gap: 6mm }', 2, one, 8000));
    expect(r.pages.length).toBeGreaterThan(52);
    expectAll(r.pages, 2, one, 8000);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('上限が 1 行より小さくても (max-height: 1pt)、本文のページに 1 行ずつ置いて (上限を超えて) 進み、止まる', async () => {
    const long = (k: number) => k % 4 === 0;
    const t0 = Date.now();
    const r = await typeset(doc(PAGE('1pt'), 20, long, 20));
    expect(Date.now() - t0).toBeLessThan(60_000);
    expectAll(r.pages, 20, long, 20);
  }, 120_000);

  it('ページより大きい分けられない画像を持つ脚注・float も、止まる', async () => {
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="#888"/></svg>');
    const img = `<img src="data:image/svg+xml,${svg}" style="width: 100mm; height: 300mm">`;
    const html = `<!doctype html><html lang="en"><head><style>p { margin: 0 } .f { float: footnote } .t { float: top } ${PAGE('20pt')}</style></head><body>`
      + `<p>A<span class="f">N1: ${img}</span> B</p><p>C<span class="f">N2: w2</span> <span class="t">${img}</span> D</p>`
      + `<p>E<span class="f">N3: <span class="f">N4: w4</span> w3</span> F</p></body></html>`;
    const t0 = Date.now();
    const r = await typeset(html);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(r.pages.length).toBeLessThan(60);
    expect(footnotes(r.pages).heads.slice(0, 3)).toEqual([1, 2, 3]);
  }, 120_000);

  // 段組の文書の、本文の途中のページ: 1 つの脚注の残りが次のページへ溢れることが何度あっても (残りの高さがたまたま同じでも)、
  // 本文の途中では止めない。守りは、本文の後に足すページだけで数える
  const WORDS = ['alpha', 'be', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
  const longNote = (k: number, n: number, mix: boolean) => Array.from({ length: n }, (_, i) => (mix ? WORDS[(i * 7 + k * 3) % 10] : `w${k}`)).join(' ') + ` END${k}`;
  const ends = (pages: string[]) => new Set(pages.join('').match(/END\d+/g) ?? []).size;
  const SEC_CSS = 'p { margin: 0 } .f { float: footnote } @page { size: 120mm 80mm; margin: 15mm } body { column-count: 2 }';
  const html = (css: string, body: string) => `<!doctype html><html lang="en"><head><style>${css}</style></head><body>${body}</body></html>`;

  it('段組: 同じ長さの脚注の残りが、本文の途中で何度溢れても、全部置く', async () => {
    const filler = '<p>' + 'Filler text without notes. '.repeat(12) + '</p>';
    const body = Array.from({ length: 6 }, (_, i) => `<section style="break-before: page"><p>Section ${i + 1} body<span class="f">N${i + 1}: ${longNote(i + 1, 250, false)}</span> text.</p>${filler}</section>`).join('');
    const r = await typeset(html(SEC_CSS, body));
    expect(ends(r.pages)).toBe(6);
    expect(footnotes(r.pages).heads).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.pages.length).toBe(18);
    expect(dropped(r.warnings)).toEqual([]);
  }, 120_000);

  it('段組: 中身の違う脚注の残りが、本文の途中で溢れても、全部置く', async () => {
    for (const n of [130, 140, 150]) {
      const body = Array.from({ length: 8 }, (_, i) => `<section style="break-before: page"><p>Intro ${i + 1}<span class="f">N${i + 1}: ${longNote(i + 1, n + i, true)}</span> text.</p><p>${`Filler text number ${i} without notes. `.repeat(10 + i)}</p></section>`).join('');
      const r = await typeset(html(SEC_CSS, body));
      expect(ends(r.pages), `${n} 語`).toBe(8);
      expect(dropped(r.warnings)).toEqual([]);
    }
  }, 120_000);

  it('XSL-FO の段組 (region-body の column-count) でも、本文の途中で溢れる脚注の残りを全部置く', async () => {
    for (const n of [80, 100]) {
      const blocks = Array.from({ length: 8 }, (_, i) => `<fo:block break-before="page">Intro ${i + 1}<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>N${i + 1}: ${longNote(i + 1, n + i, true)}</fo:block></fo:footnote-body></fo:footnote> text.</fo:block><fo:block>${`Filler text number ${i} without notes. `.repeat(10 + i)}</fo:block>`).join('');
      const fo = `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="120mm" page-height="80mm" margin="15mm"><fo:region-body column-count="2"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body">${blocks}</fo:flow></fo:page-sequence></fo:root>`;
      const r = await typeset(fo, true);
      expect(ends(r.pages), `${n} 語`).toBe(8);
      expect(dropped(r.warnings)).toEqual([]);
    }
  }, 120_000);

  it('入れ子の箱の中を分けて続けるあいだ (残りの高さが変わらなくても)、進んでいれば止めない (1 段・段組)', async () => {
    // 脚注の本文: 箱の中に長い段落と、その後ろの段落。長い段落を分けて置くあいだ、後ろの段落の位置は動かないので、残りの高さが変わらない
    const note = `<div style="border: 1pt solid #000; padding: 2pt"><div style="padding: 2pt">${Array.from({ length: 1500 }, () => 'w1').join(' ')}</div><p>tail END1</p></div>`;
    for (const cols of ['', 'body { column-count: 2 }']) {
      const r = await typeset(html(`p { margin: 0 } .f { float: footnote } @page { size: 120mm 80mm; margin: 15mm } ${cols}`, `<p>Body<span class="f">N1: ${note}</span> text.</p><p>After<span class="f">N2: second END2</span></p>`));
      expect(ends(r.pages), cols || '1 段').toBe(2);
      expect(footnotes(r.pages).words.get(1), cols || '1 段').toBe(1500);
      expect(dropped(r.warnings)).toEqual([]);
    }
  }, 120_000);

  it('守り: ページの数の上限は、送る脚注の行 (分けられない単位) と float の数の和の 2 倍 (50 ページより小さくしない)', () => {
    const lines = (n: number) => {
      const root = newNode('block', 'horizontal-tb', { isize: 100, bsize: n * 12 });
      for (let k = 0; k < n; k++) root.children.push(newNode('line', 'horizontal-tb', { isize: 100, b: k * 12, bsize: 12 }));
      return root;
    };
    /** 毎回ちがう高さ (進むと見える) で呼んで、何回目で止まるか */
    const stopAt = (g: ContinuationGuard, entries: (k: number) => Parameters<ContinuationGuard['next']>[1], floats = 0, max = 100_000) => {
      const host = { warn: () => {} };
      for (let k = 1; k <= max; k++) if (!g.next(host, entries(k), floats)) return k;
      return Infinity;
    };
    // 1 行の脚注: 50 ページまで足す
    expect(stopAt(new ContinuationGuard(), (k) => [{ node: lines(1), height: k }])).toBe(51);
    // 行 300 本の脚注と float 20 個: (300 + 20) × 2 = 640 ページまで
    const big = lines(300);
    expect(stopAt(new ContinuationGuard(), (k) => [{ node: big, height: k }], 20)).toBe(641);
    // 分けた残りは、残りの行の数で数える
    const sp = splitEntry({ node: lines(300), height: 3600 }, 12 * 100)!;
    expect(footUnits(sp.rest)).toBe(200);
    expect(stopAt(new ContinuationGuard(), (k) => [{ ...sp.rest, height: k } as never])).toBe(401);
    expect(stopAt(new ContinuationGuard(), (k) => (k === 1 ? [sp.rest] : [{ node: sp.rest.node, height: k }]))).toBe(401);
    // 送るものが増えたら (置いた float の中の脚注を送ったとき)、増えた分の 2 倍を足す: 1 行 → 10 ページめに 200 行 → 50 + 398
    const grow = lines(200);
    expect(stopAt(new ContinuationGuard(), (k) => [{ node: k < 10 ? lines(1) : grow, height: k }])).toBe(449);
  });

  it('守り: 送るものが 3 ページ続けて変わらなければ止め、欠けた脚注・float の数を警告に出す', () => {
    const warns: string[] = [];
    const host = { warn: (d: { message: string }) => warns.push(d.message) };
    const g = new ContinuationGuard();
    const e = (height: number, cont = false) => ({ node: {} as never, height, ...(cont ? { cont } : {}) });
    // 進むあいだは足す
    expect(g.next(host, [e(30), e(10)], 1)).toBe(true);
    expect(g.next(host, [e(20, true), e(10)], 1)).toBe(true);
    // 変わらない: 2 回までは足し (白ページを挟むことがある)、3 回目で止める
    expect(g.next(host, [e(20, true), e(10)], 1)).toBe(true);
    expect(g.next(host, [e(20, true), e(10)], 1)).toBe(true);
    expect(warns).toEqual([]);
    expect(g.next(host, [e(20, true), e(10)], 1)).toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/2 (個|footnote)/);
    expect(warns[0]).toMatch(/1 (個|float|of them)/);
  });
});

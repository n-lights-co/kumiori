/**
 * 先頭から N ページで止める (TypesetOptions.maxPages。src/layoutEngine.ts の notePage・cutPages):
 *  - 後ろを指す参照の無い文書では、残した 1〜N ページの領域の木が、全体を組んだ木の 1〜N ページと同じ
 *    (1 段・段組・脚注・float・表・条件付きのマスター・force-page-count・メモリ節約。N は 1・2・ページ数 − 1・ページ数・ページ数 + 1)
 *  - 文書が N ページ以下なら、渡さないときと同じ木・PDF で、truncated は false
 *  - 段組の脚注の予約の組み直しが、回数の上限で終わる文書でも、1〜N ページは同じ
 *  - N より後ろを指すページ番号の参照・最後のページの番号・総ページ数 (本文と柱)・索引・しおりは決まらず、"?" で組み、
 *    種類ごとに 1 件の layout/beyond-max-pages を出す (文書に無い id は layout/missing-id のまま)
 *  - 止めた文書の結果 (truncated・pageCount・診断・AreaTree.truncated・PDF のページ数)
 *  - 止めた文書は、器の覚えの世代を進めない
 *  - 選択肢の検査
 */
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FONTS, KumioriOptionError, createTypesetter, typeset, typesetToPdf, type AreaNode, type GlyphArea, type TypesetOptions } from '../src/index';
import { childrenOf } from '../src/areaTree';
import { ColumnReservePlan, SharedLineMemo } from '../src/layoutEngine';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const base: TypesetOptions = { loadFont: loadCachedFont };

/** ページの領域の木 (JSON) */
const pageJson = (sheets: readonly unknown[]) => sheets.map((s) => JSON.stringify(s));

/** ページの字 (本文と柱) */
function pageText(s: AreaNode): string {
  const t = (a: AreaNode): string => (a.type === 'glyph' ? (a as GlyphArea).text : childrenOf(a).map(t).join(''));
  return t(s).replace(/\s/g, '');
}

/** 全体と、maxPages を N にした組版の、1〜N ページが同じこと */
async function expectSamePrefix(text: string, options: TypesetOptions = {}) {
  const full = await typeset(text, { ...base, ...options });
  const P = full.pageCount;
  expect(P).toBeGreaterThan(2);
  const all = pageJson(full.areaTree.sheets);
  for (const n of [1, 2, P - 1, P, P + 1]) {
    const r = await typeset(text, { ...base, ...options, maxPages: n });
    expect(r.pageCount, `N=${n}`).toBe(Math.min(n, P));
    expect(r.truncated, `N=${n}`).toBe(n < P);
    const got = pageJson(r.areaTree.sheets);
    const bad = got.findIndex((g, k) => g !== all[k]);
    expect(bad, `N=${n}: ${bad + 1} ページ目が違う`).toBe(-1);
    if (n < P) {
      expect(r.areaTree.truncated).toEqual({ maxPages: n });
      expect(r.diagnostics.some((d) => d.code === 'layout/max-pages-reached' && d.severity === 'info' && d.args?.maxPages === n)).toBe(true);
    } else {
      // 止めないときは、渡さないときと同じ木 (truncated の欄も、止めた診断も無い)
      expect(r.areaTree.truncated).toBeUndefined();
      expect(r.diagnostics).toEqual(full.diagnostics);
      expect(r.warnings).toEqual(full.warnings);
    }
  }
  return full;
}

const para = (i: number) => `<p>段落 ${i}。${'長い文書の初めの数ページだけを組む試しの文です。'.repeat(8)}</p>`;
const htmlDoc = (body: string, css = '') => `<!doctype html><html lang="ja"><head><style>@page { size: A6; margin: 12mm } body { font-size: 9pt } ${css}</style></head><body>${body}</body></html>`;

const fo = (masters: string, sequences: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt" line-height="13pt"><fo:layout-master-set>${masters}</fo:layout-master-set>${sequences}</fo:root>`;
const spm = (name: string, body = '<fo:region-body/>', extra = '') => `<fo:simple-page-master master-name="${name}" page-width="200pt" page-height="200pt" margin="12pt">${body}${extra}</fo:simple-page-master>`;
const blocks = (n: number, f: (i: number) => string = (i) => `<fo:block>行 ${i} の文。${'試しの文。'.repeat(6)}</fo:block>`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('');
const seq = (master: string, flow: string, attrs = '', statics = '') => `<fo:page-sequence master-reference="${master}" ${attrs}>${statics}<fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence>`;

describe('1〜N ページは、全体を組んだときと同じ', () => {
  it('HTML の 1 段の文書 (見出し・表がページをまたぐ・float)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `<tr><td>行 ${i}</td><td>${'表のセルの文。'.repeat(3)}</td></tr>`).join('');
    await expectSamePrefix(
      htmlDoc(`<h1>見出し</h1>${Array.from({ length: 12 }, (_, i) => para(i)).join('')}<table>${rows}</table><div style="float:right;width:30mm;height:20mm;border:1px solid"></div>${Array.from({ length: 8 }, (_, i) => para(i + 20)).join('')}`),
    );
  });

  it('XSL-FO: 脚注・page-sequence が複数・force-page-count・条件付きのマスター (first・rest・last)・柱', async () => {
    const masters =
      spm('first', '<fo:region-body margin-top="20pt"/>', '<fo:region-before extent="15pt"/>') +
      spm('rest', '<fo:region-body margin-top="20pt"/>', '<fo:region-before extent="15pt"/>') +
      spm('last', '<fo:region-body margin-top="40pt"/>', '<fo:region-before extent="15pt"/>') +
      `<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives>` +
      `<fo:conditional-page-master-reference master-reference="first" page-position="first"/>` +
      `<fo:conditional-page-master-reference master-reference="last" page-position="last"/>` +
      `<fo:conditional-page-master-reference master-reference="rest" page-position="rest"/>` +
      `</fo:repeatable-page-master-alternatives></fo:page-sequence-master>`;
    const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block>柱 <fo:page-number/></fo:block></fo:static-content>';
    const withNote = (i: number) =>
      i % 3 === 0
        ? `<fo:block>行 ${i}。${'脚注のある文。'.repeat(5)}<fo:footnote><fo:inline>*${i}</fo:inline><fo:footnote-body><fo:block>脚注 ${i}。${'脚注の文。'.repeat(i % 2 ? 2 : 8)}</fo:block></fo:footnote-body></fo:footnote></fo:block>`
        : `<fo:block>行 ${i}。${'試しの文。'.repeat(6)}</fo:block>`;
    await expectSamePrefix(fo(masters, seq('m', blocks(14, withNote), 'force-page-count="even"', statics) + seq('m', blocks(10), '', statics) + seq('m', blocks(9, withNote), '', statics)));
  });

  it('XSL-FO の段組 (脚注・span="all"・段の釣り合わせ)', async () => {
    const masters = spm('c', '<fo:region-body column-count="2" column-gap="10pt"/>');
    const flow = (i: number) =>
      i % 7 === 0
        ? `<fo:block span="all" font-weight="bold">全幅 ${i}</fo:block>`
        : i % 4 === 0
          ? `<fo:block>行 ${i}。${'段の文。'.repeat(4)}<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>脚注 ${i}。${'脚注の文。'.repeat(6)}</fo:block></fo:footnote-body></fo:footnote></fo:block>`
          : `<fo:block>行 ${i}。${'段の文。'.repeat(5)}</fo:block>`;
    await expectSamePrefix(fo(masters, seq('c', blocks(60, flow))));
  });

  it('段組の脚注の予約の組み直しが、回数の上限で終わる文書でも同じ', async () => {
    // 予約の選び方を、試した数で振らせて、決まらないようにする (組み直しの回数の上限 16 回で終わる)。
    // 選び方は、そのページの始まりまでの組みと、そのページで試した数だけで決まるので、後ろのページは前のページに効かない
    const orig = ColumnReservePlan.prototype.choose;
    let calls = 0;
    const spy = vi.spyOn(ColumnReservePlan.prototype, 'choose').mockImplementation(function (this: ColumnReservePlan, tried, model, maxR) {
      calls++;
      const r = orig.call(this, tried, model, maxR);
      return tried.length % 2 ? Math.min(maxR, r + 13) : r;
    });
    try {
      const masters = spm('c', '<fo:region-body column-count="2" column-gap="10pt"/>');
      const flow = (i: number) =>
        i % 3 === 0
          ? `<fo:block>行 ${i}。${'段の文。'.repeat(4)}<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block>脚注 ${i}。${'脚注の文。'.repeat(5)}</fo:block></fo:footnote-body></fo:footnote></fo:block>`
          : `<fo:block>行 ${i}。${'段の文。'.repeat(5)}</fo:block>`;
      await expectSamePrefix(fo(masters, seq('c', blocks(50, flow))));
      expect(calls).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('typesetToPdf (メモリ節約の有り無し): ページ数と truncated。PDF のページ数も N', async () => {
    const text = htmlDoc(Array.from({ length: 30 }, (_, i) => para(i)).join(''));
    const full = await typesetToPdf(text, base);
    expect(full.truncated).toBe(false);
    for (const lowMemory of [false, true]) {
      const r = await typesetToPdf(text, { ...base, maxPages: 2 }, { lowMemory });
      expect(r.pageCount).toBe(2);
      expect(r.truncated).toBe(true);
      expect((await PDFDocument.load(r.pdf)).getPageCount()).toBe(2);
      expect(r.diagnostics.some((d) => d.code === 'layout/max-pages-reached')).toBe(true);
      // 渡しても、ページ数以上なら止めずに同じ PDF の中身 (日時と識別子のほか)
      const same = await typesetToPdf(text, { ...base, maxPages: full.pageCount }, { lowMemory });
      expect(same.truncated).toBe(false);
      expect(same.pageCount).toBe(full.pageCount);
    }
  });
});

describe('止めたときの警告', () => {
  it('文書がちょうど N + 1 ページで終わるとき、見張りのページを捨てても、page-sequence の layout/not-converged は残す', async () => {
    // 最後のページのマスターの本文領域がほとんど無いと、最後のページを決めるたびにページ数が 1 つ増えては減り、収束しない
    const last = spm('l', '<fo:region-body margin-top="170pt"/>');
    const alts = `<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives><fo:conditional-page-master-reference master-reference="l" page-position="last"/><fo:conditional-page-master-reference master-reference="r"/></fo:repeatable-page-master-alternatives></fo:page-sequence-master>`;
    const d = fo(spm('r') + last + alts, seq('m', blocks(12)));
    const full = await typeset(d, base);
    expect(full.diagnostics.some((x) => x.code === 'layout/not-converged' && x.args?.what === 'last-page-master')).toBe(true);
    const r = await typeset(d, { ...base, maxPages: full.pageCount - 1 });
    expect(r.truncated).toBe(true);
    expect(r.diagnostics.some((x) => x.code === 'layout/not-converged' && x.args?.what === 'last-page-master')).toBe(true);
  });
});

describe('N より後ろを指すものは決まらない', () => {
  const masters = spm('p', '<fo:region-body margin-top="20pt"/>', '<fo:region-before extent="15pt"/>');
  const statics = '<fo:static-content flow-name="xsl-region-before"><fo:block>柱 <fo:page-number/> / <fo:page-number-citation-last ref-id="end"/></fo:block></fo:static-content>';
  const toc = Array.from({ length: 5 }, (_, i) => `<fo:block>章 ${i + 1} ……<fo:page-number-citation ref-id="c${i + 1}"/></fo:block>`).join('');
  const chapters = Array.from({ length: 5 }, (_, i) => `<fo:block id="c${i + 1}" break-before="page">章 ${i + 1}</fo:block>${blocks(4)}`).join('');
  const doc = fo(
    masters,
    seq('p', `<fo:block id="top">目次</fo:block>${toc}<fo:block>無い id: <fo:page-number-citation ref-id="nowhere"/></fo:block>${chapters}<fo:block id="end">終わり</fo:block>`, '', statics),
  ).replace('</fo:layout-master-set>', '</fo:layout-master-set><fo:bookmark-tree><fo:bookmark internal-destination="top"><fo:bookmark-title>初め</fo:bookmark-title></fo:bookmark><fo:bookmark internal-destination="c5"><fo:bookmark-title>章 5</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>');

  it('目次の後ろの章のページ番号・柱の最後のページの番号は "?" で、種類ごとに 1 件の警告。無い id は見つからない id のまま', async () => {
    const full = await typeset(doc, base);
    expect(full.pageCount).toBeGreaterThan(4);
    const r = await typeset(doc, { ...base, maxPages: 2 });
    expect(r.pageCount).toBe(2);
    const p1 = pageText(r.areaTree.sheets[0]);
    // 章 1 は 2 ページ目 (残したページ) にあるので決まり、章 2〜5 は "?"
    expect(p1).toMatch(/章1……2/);
    for (const k of [2, 3, 4, 5]) expect(p1).toMatch(new RegExp(`章${k}……\\?`));
    expect(p1).toMatch(/柱1\/\?/);
    const beyond = r.diagnostics.filter((d) => d.code === 'layout/beyond-max-pages');
    expect(beyond.map((d) => d.args?.kind).sort()).toEqual(['bookmark', 'page-number-citation', 'page-number-citation-last']);
    expect(beyond.find((d) => d.args?.kind === 'page-number-citation')?.args).toMatchObject({ maxPages: 2, count: 4 });
    expect(beyond.every((d) => d.severity === 'warning')).toBe(true);
    // 文書に無い id は、いまのとおり見つからない id
    expect(r.diagnostics.some((d) => d.code === 'layout/missing-id' && d.args?.id === 'nowhere')).toBe(true);
    expect(r.diagnostics.some((d) => d.code === 'layout/missing-id' && d.args?.id !== 'nowhere')).toBe(false);
    // しおり: 残したページの飛び先はそのまま、後ろの飛び先は飛び先の無いしおり
    expect(r.areaTree.bookmarks?.map((b) => b.sheet)).toEqual([0, -1]);
    expect(Object.keys(r.areaTree.destinations ?? {})).not.toContain('c5');
    // 止めないときは、同じ文書で警告が無い
    expect(full.diagnostics.some((d) => d.code === 'layout/beyond-max-pages')).toBe(false);
  });

  it('WeasyPrint の組み方では、決まらない参照は空', async () => {
    const pages = Array.from({ length: 6 }, (_, i) => `<h2 id="s${i}" style="break-before:page">節 ${i}</h2>${para(i)}`).join('');
    const text = htmlDoc(`<p>目次 <a href="#s5" class="t"></a></p>${pages}`, 'a.t::after { content: "p" target-counter(attr(href), page) }');
    const r = await typeset(text, { ...base, style: 'weasyprint', maxPages: 2 });
    expect(pageText(r.areaTree.sheets[0])).toMatch(/目次p(?!\d)/);
    expect(r.diagnostics.find((d) => d.code === 'layout/beyond-max-pages')?.message).toMatch(/空|empty/);
    const k = await typeset(text, { ...base, maxPages: 2 });
    expect(pageText(k.areaTree.sheets[0])).toMatch(/目次p\?/);
  });

  it('HTML の総ページ数 (余白の箱と本文の counter(pages)) と、後ろへ続く要素の最後のページ', async () => {
    const text = htmlDoc(`<p>全 <span class="n"></span> ページ</p>${Array.from({ length: 20 }, (_, i) => para(i)).join('')}`, '@page { @bottom-center { content: counter(page) " / " counter(pages) } } .n::after { content: counter(pages) }');
    const r = await typeset(text, { ...base, maxPages: 2 });
    const p1 = pageText(r.areaTree.sheets[0]);
    expect(p1).toMatch(/全\?ページ/);
    expect(p1).toMatch(/1\/\?/);
    const kinds = r.diagnostics.filter((d) => d.code === 'layout/beyond-max-pages').map((d) => d.args?.kind);
    expect(kinds).toEqual(['total-pages']);
  });

  it('使い回した page-sequence の中の、後ろの page-sequence へ続く要素の最後のページも "?" (メモリ節約の有り無しで同じ)', async () => {
    // 1 つ目の page-sequence (2 ページ) の本文から、2 つ目 (3〜5 ページ) の全体を包む要素の最後のページを引く (「全 N ページ」の型)
    const d = fo(
      spm('p'),
      seq('p', '<fo:block>全 <fo:page-number-citation-last ref-id="s2"/> ページ</fo:block><fo:block break-before="page">二</fo:block>') +
        seq('p', '<fo:block id="s2"><fo:block>三</fo:block><fo:block break-before="page">四</fo:block><fo:block break-before="page">五</fo:block></fo:block>'),
    );
    const full = await typeset(d, base);
    expect(full.pageCount).toBe(5);
    expect(pageText(full.areaTree.sheets[0])).toMatch(/全5ページ/);
    for (const n of [1, 2, 3, 4]) {
      const r = await typeset(d, { ...base, maxPages: n });
      expect(pageText(r.areaTree.sheets[0]), `maxPages ${n}`).toMatch(/全\?ページ/);
      const kinds = (diags: readonly { code: string; args?: Record<string, unknown> }[]) => diags.filter((x) => x.code === 'layout/beyond-max-pages').map((x) => x.args?.kind);
      expect(kinds(r.diagnostics), `maxPages ${n}`).toEqual(['page-number-citation-last']);
      for (const lowMemory of [false, true]) {
        const p = await typesetToPdf(d, { ...base, maxPages: n }, { lowMemory });
        expect(kinds(p.diagnostics), `maxPages ${n} lowMemory ${lowMemory}`).toEqual(['page-number-citation-last']);
      }
    }
  });

  it('索引は、止めたページまでの所だけを並べ、警告を出す', async () => {
    const entry = (i: number) => `<fo:block>語 ${i} <fo:inline index-key="k${i % 3}">鍵</fo:inline>。${'索引の試しの文。'.repeat(6)}</fo:block>`;
    const index = Array.from({ length: 3 }, (_, k) => `<fo:block>鍵 ${k}: <fo:index-page-citation-list><fo:index-key-reference ref-index-key="k${k}"/></fo:index-page-citation-list></fo:block>`).join('');
    const d = fo(spm('p'), seq('p', `<fo:block>索引</fo:block>${index}${blocks(30, entry)}`));
    const r = await typeset(d, { ...base, maxPages: 2 });
    expect(r.diagnostics.some((x) => x.code === 'layout/beyond-max-pages' && x.args?.kind === 'index')).toBe(true);
  });
});

describe('器と選択肢', () => {
  it('止めた文書は、器の覚えの世代を進めない', async () => {
    const start = vi.spyOn(SharedLineMemo.prototype, 'startDocument');
    const cancel = vi.spyOn(SharedLineMemo.prototype, 'cancelDocument');
    const t = await createTypesetter(base);
    const text = htmlDoc(Array.from({ length: 30 }, (_, i) => para(i)).join(''));
    await t.typeset(text);
    expect(cancel).not.toHaveBeenCalled();
    const r = await t.typeset(text, { maxPages: 1 });
    expect(r.truncated).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    // 止めない (ページ数以上の) maxPages は、ふつうの文書と同じに世代を進める
    await t.typeset(text, { maxPages: 1000 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(3);
    start.mockRestore();
    cancel.mockRestore();
  });

  it('maxPages は 1 以上の整数', async () => {
    for (const v of [0, -1, 1.5, Infinity, NaN, '3']) {
      const e = await typeset('<p>a</p>', { ...base, maxPages: v as number }).catch((x: unknown) => x);
      expect(e, String(v)).toBeInstanceOf(KumioriOptionError);
      expect((e as KumioriOptionError).option).toBe('maxPages');
    }
  });
});

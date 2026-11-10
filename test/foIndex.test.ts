/**
 * XSL-FO の索引 (XSL 1.1 §6.10 Formatting Objects for Indexing・§7.24 Properties for Indexing)。
 *
 *  - index-key・index-class (§7.24.2・§7.24.1) の付いた要素と、fo:index-range-begin〜fo:index-range-end (§6.10.4・§6.10.5) の置かれたページを集め、
 *    fo:index-page-citation-list (§6.10.7) の所に、ページ番号の並びを作る
 *  - 期待値は、仕様の例 (§6.10.1.1〜§6.10.1.3 の「Eiffel Tower」) の表と、§6.10.6・§6.10.7 の手順から決める
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { citedPageItems, collateCitedPages, type IndexSource } from '../src/indexCitation';
import { makeEngine, walk } from './helpers';
import type { Area, AreaTree, LBlock, LInline } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const PM = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="120mm" page-height="60mm" margin="5mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>`;
const seqXml = (attrs: string, flow: string, folio = '') => `<fo:page-sequence master-reference="m" ${attrs}>${folio}<fo:flow flow-name="xsl-region-body" font-size="8pt">${flow}</fo:flow></fo:page-sequence>`;
const imp = (...seqs: string[]) => importXslFo(`<?xml version="1.0"?><fo:root ${NS}>${PM}${seqs.join('')}</fo:root>`, parse, { compat: 'spec' });
/** ページごとに 1 つのブロック (中身は pages[k])。2 つ目からは改ページして始める */
const pagesXml = (pages: string[]) => pages.map((c, k) => `<fo:block${k ? ' break-before="page"' : ''}>p${c}</fo:block>`).join('');
const glyphs = (areas: Area[]) => {
  const g: string[] = [];
  for (const a of areas) walk(a, (n) => n.type === 'glyph' && g.push(n.text));
  return g.join('');
};
/** id="ix" のブロック (索引の項目) の字 */
const indexText = (tree: AreaTree, id = 'ix') => {
  const out: Area[] = [];
  for (const s of tree.sheets) walk(s.page.regionBody as unknown as Area, (a) => a.type === 'block' && a.sourceId === id && out.push(a));
  return glyphs(out);
};
/** そのシートの本文の、リンクの領域の飛び先 (文書の中の id) */
const links = (tree: AreaTree, sheet: number) => {
  const out: string[] = [];
  walk(tree.sheets[sheet].page.regionBody as unknown as Area, (a) => {
    const l = (a as { link?: { internal?: string } }).link;
    if (l?.internal) out.push(l.internal);
  });
  return out;
};
const layout = (...seqs: string[]) => {
  const r = imp(...seqs);
  return { r, tree: E.engine.layout(r.document) };
};
const list = (refs: string, attrs = '', seps = '') => `<fo:block id="ix">項目 <fo:index-page-citation-list ${attrs}>${seps}${refs}</fo:index-page-citation-list></fo:block>`;
const ref = (key: string, attrs = '', kids = '') => `<fo:index-key-reference ref-index-key="${key}" ${attrs}>${kids}</fo:index-key-reference>`;
const W = (key: string, cls = '') => `<fo:wrapper index-key="${key}"${cls ? ` index-class="${cls}"` : ''}/>`;

describe('索引のページの集め方と並べ方 (§6.10.6・§6.10.7 の手順)', () => {
  // 仕様の例 (§6.10.1.2) の項目。ページは文書の先頭からの通し番号 (ordinal page number)
  const src = (first: number, last: number, cls: string, order: number, range = false): IndexSource => ({ first, last, cls, order, range, id: `s${order}` });
  const cls = (p: number, same: boolean) => (same ? 'x' : p <= 10 ? 'preface' : p >= 35 ? 'glossary' : 'chapter');
  const example = (same: boolean) => {
    const plain = [9, 10, 11, 15, 27, 29, 30, 31, 32, 33, 34, 37];
    const xx = [...plain.map((p) => src(p, p, cls(p, same), p * 10)), src(13, 16, cls(13, same), 130, true), src(18, 21, cls(18, same), 180, true)].sort((a, b) => a.order - b.order);
    const xb = [src(19, 19, cls(19, same), 191), src(23, 23, cls(23, same), 230)];
    const xi = [src(15, 15, cls(15, same), 151), src(25, 25, cls(25, same), 250)];
    return [citedPageItems(xb, 0), citedPageItems(xi, 1), citedPageItems(xx, 2)];
  };
  // ページの通し番号を、例の番号 (ix・x・1〜24・G-3) にして、[図] の鍵 (XI) は角括弧で囲む
  const label = (p: number) => (p <= 10 ? ['vii', 'viii', 'ix', 'x'][p - 7] : p >= 35 ? `G-${p - 34}` : String(p - 10));
  const show = (same: boolean, pages: boolean, ranges: boolean) =>
    collateCitedPages(example(same), { mergePagesAcrossReferences: pages, mergeRangesAcrossReferences: ranges })
      .map((o) => [o.first, ...(o.last ? [o.last] : [])].map((it) => (it.ref === 1 ? `[${label(it.page)}]` : label(it.page))).join('-'))
      .join(', ');

  it('鍵ごとに、範囲をページの並びに開いて、同じページの重複を除く (§6.10.6・§6.10.1.2 の表)', () => {
    const [xb, xi, xx] = example(false);
    expect(xb.map((i) => i.page)).toEqual([19, 23]);
    expect(xi.map((i) => i.page)).toEqual([15, 25]);
    expect(xx.map((i) => i.page)).toEqual([9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21, 27, 29, 30, 31, 32, 33, 34, 37]);
    // 15 ページは、範囲 (13〜16) の途中の項目が残る (例の [J]。fo:wrapper の [Y] は除かれる)
    expect(xx.find((i) => i.page === 15)!.rank).toBe(1);
  });
  it('仕様の例の表: 分類 (index-class) が前書き・章・用語集で違うとき (§6.10.1.3)', () => {
    expect(show(false, false, false)).toBe('ix, x, 1, 3-6, [5], 8-11, 9, 13, [15], 17, 19-24, G-3');
    expect(show(false, false, true)).toBe('ix, x, 1, 3-6, 8-11, 13, [15], 17, 19-24, G-3');
    expect(show(false, true, false)).toBe('ix, x, 1, 3, 4, [5], 6, 8, 9, 10, 11, 13, [15], 17, 19-24, G-3');
    expect(show(false, true, true)).toBe('ix, x, 1, 3-6, 8-11, 13, [15], 17, 19-24, G-3');
  });
  it('仕様の例の表: 分類がすべて同じとき (§6.10.1.3)', () => {
    expect(show(true, false, false)).toBe('ix-1, 3-6, [5], 8-11, 9, 13, [15], 17, 19-24, G-3');
    expect(show(true, false, true)).toBe('ix-1, 3-6, 8-11, 13, [15], 17, 19-24, G-3');
    expect(show(true, true, false)).toBe('ix-1, 3, 4, [5], 6, 8, 9, 10, 11, 13, [15], 17, 19-24, G-3');
    expect(show(true, true, true)).toBe('ix-1, 3-6, 8-11, 13, [15], 17, 19-24, G-3');
  });
  it('続いた 2 ページは範囲にしない。3 ページから範囲 (§6.10.7 Step B: three or more)', () => {
    const two = collateCitedPages([citedPageItems([src(1, 1, '', 1), src(2, 2, '', 2)], 0)]);
    expect(two.map((o) => [o.first.page, o.last?.page])).toEqual([[1, undefined], [2, undefined]]);
    const three = collateCitedPages([citedPageItems([src(1, 1, '', 1), src(2, 2, '', 2), src(3, 3, '', 3)], 0)]);
    expect(three.map((o) => [o.first.page, o.last?.page])).toEqual([[1, 3]]);
  });
  it('merge-sequential-page-numbers="leave-separate" は範囲にまとめない (§7.24.5)', () => {
    const out = collateCitedPages([citedPageItems([src(1, 4, '', 1, true)], 0)], { mergeSequential: false });
    expect(out.map((o) => [o.first.page, o.last?.page])).toEqual([[1, undefined], [2, undefined], [3, undefined], [4, undefined]]);
  });
});

describe('fo:index-page-citation-list (§6.10.7): ページ番号の並び', () => {
  // 仕様の例 (§6.10.1.1) の文書: 前付け 6 ページ (i〜vi)・前書き 4 ページ (vii〜x)・章 24 ページ (1〜24)・用語集 4 ページ (G-1〜G-4)・索引
  const ET = 'Eiffel Tower;;';
  const body: Record<number, string> = {
    9: W(ET), 10: W(ET), 11: W(ET),
    13: `<fo:index-range-begin id="ei.idx" index-key="${ET}"/>`,
    15: W(ET) + W(`${ET};figure`),
    16: `<fo:index-range-end ref-id="ei.idx"/>`,
    18: `<fo:index-range-begin id="ei2.idx" index-key="${ET}"/>`,
    19: W(`${ET};preferred`),
    21: `<fo:index-range-end ref-id="ei2.idx"/>`,
    23: W(`${ET};preferred`), 25: W(`${ET};figure`),
    27: W(ET), 29: W(ET), 30: W(ET), 31: W(ET), 32: W(ET), 33: W(ET), 34: W(ET), 37: W(ET),
  };
  const part = (from: number, to: number, cls: string) => {
    const out: string[] = [];
    for (let p = from; p <= to; p++) out.push((body[p] ?? '').replace(/index-key="/g, cls ? `index-class="${cls}" index-key="` : 'index-key="'));
    return pagesXml(out);
  };
  const example = (attrs: string, classes: boolean) => [
    seqXml('format="i"', part(1, 6, '')),
    seqXml('format="i"', part(7, 10, classes ? 'preface' : '')),
    seqXml('initial-page-number="1"', part(11, 34, classes ? 'chapter' : '')),
    seqXml('initial-page-number="1"', part(35, 38, classes ? 'glossary' : ''), `<fo:folio-prefix>G-</fo:folio-prefix>`),
    seqXml(
      'initial-page-number="1"',
      list(
        ref(`${ET};preferred`, 'font-weight="bold"') +
          ref(`${ET};figure`, 'font-style="italic"', `<fo:index-page-number-prefix>[</fo:index-page-number-prefix><fo:index-page-number-suffix>]</fo:index-page-number-suffix>`) +
          ref(ET),
        attrs,
      ),
    ),
  ];
  const run = (pages: string, ranges: string, classes: boolean) => {
    const { r, tree } = layout(...example(`merge-pages-across-index-key-references="${pages}" merge-ranges-across-index-key-references="${ranges}"`, classes));
    expect(r.report.unsupported).toEqual({});
    expect(tree.warnings).toEqual([]);
    expect(tree.sheets.length).toBe(39);
    return indexText(tree);
  };

  it('仕様の例 (§6.10.1.3): 分類が違うとき。範囲の区切りは U+2013、並びの区切りは「, 」(§6.10.7)', () => {
    expect(run('leave-separate', 'leave-separate', true)).toBe('項目 ix, x, 1, 3–6, [5], 8–11, 9, 13, [15], 17, 19–24, G-3');
    expect(run('leave-separate', 'merge', true)).toBe('項目 ix, x, 1, 3–6, 8–11, 13, [15], 17, 19–24, G-3');
    expect(run('merge', 'leave-separate', true)).toBe('項目 ix, x, 1, 3, 4, [5], 6, 8, 9, 10, 11, 13, [15], 17, 19–24, G-3');
    expect(run('merge', 'merge', true)).toBe('項目 ix, x, 1, 3–6, 8–11, 13, [15], 17, 19–24, G-3');
  });
  it('仕様の例 (§6.10.1.3): 分類が同じとき (前書きから章へ続く範囲 ix–1)', () => {
    expect(run('leave-separate', 'leave-separate', false)).toBe('項目 ix–1, 3–6, [5], 8–11, 9, 13, [15], 17, 19–24, G-3');
    expect(run('merge', 'leave-separate', false)).toBe('項目 ix–1, 3, 4, [5], 6, 8, 9, 10, 11, 13, [15], 17, 19–24, G-3');
  });
  it('初期値は 3 つとも merge (§7.24.4〜§7.24.6)', () => {
    const { tree } = layout(...example('', true));
    expect(indexText(tree)).toBe('項目 ix, x, 1, 3–6, 8–11, 13, [15], 17, 19–24, G-3');
  });
  it('ページ番号の書式は、引いた fo:index-key-reference のもの (太字・斜体)。前後の字も同じ書式', () => {
    const { tree } = layout(...example('merge-pages-across-index-key-references="leave-separate" merge-ranges-across-index-key-references="leave-separate"', true));
    const bold: string[] = [];
    const italic: string[] = [];
    walk(tree.sheets[38].page.regionBody as unknown as Area, (a) => {
      if (a.type !== 'glyph') return;
      if (a.fontWeight >= 700 || a.fakeBold) bold.push(a.text);
      if (a.italic) italic.push(a.text);
    });
    expect(bold.join('')).toBe('913'); // 9 と 13 (preferred)
    expect(italic.join('')).toBe('[5][15]'); // 図の中の項目
  });
});

describe('索引の要素と性質', () => {
  const body = (pages: string[]) => seqXml('', pagesXml(pages));
  const idx = (inner: string) => seqXml('', inner);

  it('同じページを引く項目は 1 つにする。続いた 2 ページはまとめない', () => {
    const { tree } = layout(body([W('a') + W('a'), W('a'), '', W('a')]), idx(list(ref('a'))));
    expect(indexText(tree)).toBe('項目 1, 2, 4');
  });
  it('merge-sequential-page-numbers: merge (初期値) は 3 ページから範囲、leave-separate は 1 つずつ (§7.24.5)', () => {
    const b = body([W('a'), W('a'), W('a'), '', W('a')]);
    expect(indexText(layout(b, idx(list(ref('a')))).tree)).toBe('項目 1–3, 5');
    expect(indexText(layout(b, idx(list(ref('a'), 'merge-sequential-page-numbers="leave-separate"'))).tree)).toBe('項目 1, 2, 3, 5');
  });
  it('索引の性質は継承される (祖先に書いた merge-sequential-page-numbers・page-number-treatment)', () => {
    const b = body([W('a'), W('a'), W('a')]);
    const r = imp(b, idx(`<fo:block id="ix" merge-sequential-page-numbers="leave-separate" page-number-treatment="link"><fo:index-page-citation-list>${ref('a')}</fo:index-page-citation-list></fo:block>`));
    const l = (r.document.sequences[1].flow.children[0] as LBlock).children[0] as { mergeSequential?: boolean; references: Array<{ link?: boolean }> };
    expect(l.mergeSequential).toBe(false);
    expect(l.references[0].link).toBe(true);
    expect(indexText(E.engine.layout(r.document))).toBe('1, 2, 3');
  });
  it('fo:index-range-begin〜fo:index-range-end: 間のページすべてを引く (§6.10.4・§6.10.6)。同じページなら 1 ページ', () => {
    const b = body([`<fo:index-range-begin id="r1" index-key="a"/>`, '', '', `<fo:index-range-end ref-id="r1"/>`, '', `<fo:index-range-begin id="r2" index-key="a"/>x<fo:index-range-end ref-id="r2"/>`]);
    const { r, tree } = layout(b, idx(list(ref('a'))));
    expect(r.report.unsupported).toEqual({});
    expect(indexText(tree)).toBe('項目 1–4, 6');
    expect(indexText(layout(b, idx(list(ref('a'), 'merge-sequential-page-numbers="leave-separate"'))).tree)).toBe('項目 1, 2, 3, 4, 6');
  });
  it('範囲の印は、ブロックの間にも置ける (行を作らず、前後のブロックの位置を変えない)', () => {
    const blocks = (mark1: string, mark2: string) => `<fo:block space-after="5pt">A</fo:block>${mark1}<fo:block space-before="3pt" keep-with-previous.within-page="always">B</fo:block>${mark2}<fo:block>C</fo:block>`;
    const tops = (xml: string) => {
      const t = E.engine.layout(imp(seqXml('', xml)).document);
      return (t.sheets[0].page.regionBody.children as Area[]).map((a) => [a.y, a.height]);
    };
    expect(tops(blocks(`<fo:index-range-begin id="r" index-key="a"/>`, `<fo:index-range-end ref-id="r"/>`))).toEqual(tops(blocks('', '')));
  });
  it('領域を作らない目印 (中身の無い fo:wrapper・fo:index-range-begin) は、次に置かれる中身のページを引く。後ろに中身が無ければ前の中身のページ (§6.10.6)', () => {
    // 1 ページ目の終わり (改ページするブロックの前) に置いた目印は、2 ページ目。範囲の終わりの印は、その前の中身のページ (3 ページ目)
    const flow =
      `<fo:block>p1</fo:block>${W('a')}<fo:index-range-begin id="r" index-key="b"/>` +
      `<fo:block break-before="page">p2</fo:block><fo:block break-before="page">p3</fo:block><fo:index-range-end ref-id="r"/>` +
      `<fo:block break-before="page">p4</fo:block>${W('c')}`;
    const { tree } = layout(seqXml('', flow), idx(list(ref('a') + ref('b') + ref('c'), 'merge-pages-across-index-key-references="leave-separate" merge-sequential-page-numbers="leave-separate"')));
    expect(indexText(tree)).toBe('項目 2, 2, 3, 4');
    // 目印を置いても、ブロックの位置は変わらない
    const plain = E.engine.layout(imp(seqXml('', flow.replace(/<fo:(wrapper|index-range-begin|index-range-end)[^>]*\/>/g, ''))).document);
    const tops = (t: AreaTree) => t.sheets.slice(0, 4).map((sh) => (sh.page.regionBody.children as Area[]).filter((a) => a.height > 0).map((a) => a.y));
    expect(tops(tree)).toEqual(tops(plain));
  });
  it('表のセル・リストの項目の中の、ブロックの間に置いた目印も引ける', () => {
    const cell = `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row><fo:table-cell>${W('t')}<fo:block>セル</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const li = `<fo:list-block><fo:list-item><fo:list-item-label><fo:block>・</fo:block></fo:list-item-label><fo:list-item-body start-indent="5mm">${W('l')}<fo:block>項目</fo:block></fo:list-item-body></fo:list-item></fo:list-block>`;
    const bc = `<fo:block-container>${W('c')}<fo:block>箱</fo:block></fo:block-container>`;
    const { tree } = layout(seqXml('', `<fo:block>p1</fo:block><fo:block break-before="page">p2</fo:block>${cell}<fo:block break-before="page">p3</fo:block>${li}<fo:block break-before="page">p4</fo:block>${bc}`), idx(list(ref('t') + ref('l') + ref('c'), 'merge-sequential-page-numbers="leave-separate"')));
    expect(indexText(tree)).toBe('項目 2, 3, 4');
  });
  it('表のセルの中のブロックの間に置いた範囲 (始まりと終わりの印) も引ける', () => {
    const row = (inner: string, brk = '') => `<fo:table-row${brk}><fo:table-cell>${inner}</fo:table-cell></fo:table-row>`;
    const brk = ' break-before="page"';
    const tbl = `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="50mm"/><fo:table-body>${row(`<fo:index-range-begin id="r" index-key="a"/><fo:block>始め</fo:block>`)}${row(`<fo:block>中</fo:block>`, brk)}${row(`<fo:block>終わり</fo:block><fo:index-range-end ref-id="r"/>`, brk)}</fo:table-body></fo:table>`;
    const { tree } = layout(seqXml('', tbl), idx(list(ref('a'))));
    expect(tree.sheets.length).toBe(4);
    expect(indexText(tree)).toBe('項目 1–3');
  });
  it('組になる fo:index-range-end が無い範囲は、文書の終わりまで (§6.10.4)。組の無い fo:index-range-end は無視 (§6.10.5)', () => {
    const { r, tree } = layout(body(['', `<fo:index-range-begin id="r" index-key="a"/>`, '', `<fo:index-range-end ref-id="nothing"/>`]), idx(list(ref('a'))));
    expect(indexText(tree)).toBe('項目 2–5');
    expect(r.report.notes.some((n) => n.includes('fo:index-range-begin id="r"'))).toBe(true);
    expect(r.report.notes.some((n) => n.includes('fo:index-range-end ref-id="nothing"'))).toBe(true);
  });
  it('id か index-key の無い fo:index-range-begin は、読まずに報告する (§6.10.4 の Constraints)', () => {
    const r = imp(body([`<fo:index-range-begin index-key="a"/>`]));
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:index-range-begin'))).toBe(true);
  });
  it('index-key の付いたブロックがページをまたぐと、領域のあるページすべてを引く (§6.10.6 の注)', () => {
    const long = `<fo:block index-key="a">${'長い段落の文。'.repeat(300)}</fo:block>`;
    const { tree } = layout(seqXml('', `<fo:block>前</fo:block>${long}`), idx(list(ref('a'))));
    const n = tree.sheets.length - 1;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(indexText(tree)).toBe(`項目 1–${n}`);
  });
  it('index-key の付いた行内の要素がページをまたぐと、最初から最後のページまでを引く', () => {
    const long = `<fo:block>前<fo:inline index-key="a">${'行内の長い文。'.repeat(300)}</fo:inline>後</fo:block>`;
    const { tree } = layout(seqXml('', long), idx(list(ref('a'))));
    const n = tree.sheets.length - 1;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(indexText(tree)).toBe(`項目 1–${n}`);
  });
  it('index-key の付いた行内の要素の中身は、付けないときと同じ位置に組む', () => {
    const para = (attr: string) => `<fo:block>これは、<fo:inline ${attr}>索引</fo:inline>の語、(<fo:inline ${attr}>Index</fo:inline>)、and <fo:inline ${attr}>ty</fo:inline>pe To.</fo:block>`;
    const pos = (xml: string) => {
      const out: Array<[string, number, number]> = [];
      const t = E.engine.layout(imp(seqXml('', xml)).document);
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => a.type === 'glyph' && out.push([a.text, a.x, a.y]));
      return out;
    };
    expect(pos(para('index-key="a"'))).toEqual(pos(para('color="#000000"')));
  });
  it('表・表の行・セル・リストの項目に付けた index-key も引ける', () => {
    const tbl = `<fo:table table-layout="fixed" width="100%" index-key="t"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row index-key="r"><fo:table-cell index-key="c"><fo:block>セル</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const lst = `<fo:list-block><fo:list-item index-key="l"><fo:list-item-label><fo:block>・</fo:block></fo:list-item-label><fo:list-item-body start-indent="5mm"><fo:block>項目</fo:block></fo:list-item-body></fo:list-item></fo:list-block>`;
    const { r, tree } = layout(seqXml('', `<fo:block>p1</fo:block><fo:block break-before="page">p2</fo:block>${tbl}<fo:block break-before="page">p3</fo:block>${lst}`), idx(list(ref('t') + ref('r') + ref('c') + ref('l'), 'merge-pages-across-index-key-references="leave-separate"')));
    expect(r.report.unsupported).toEqual({});
    expect(indexText(tree)).toBe('項目 2, 2, 2, 3');
  });
  it('index-class の違うページは、続いていても範囲にまとめない (§7.24.1)', () => {
    const b = body([W('a', 'x'), W('a', 'x'), W('a', 'y'), W('a', 'y'), W('a', 'y')]);
    expect(indexText(layout(b, idx(list(ref('a')))).tree)).toBe('項目 1, 2, 3–5');
    const same = body([W('a', 'x'), W('a', 'x'), W('a', 'x'), W('a', 'x'), W('a', 'x')]);
    expect(indexText(layout(same, idx(list(ref('a')))).tree)).toBe('項目 1–5');
  });
  it('index-key の無い要素の index-class は無視する (§7.24.1)', () => {
    const r = imp(body([`<fo:wrapper index-class="x"/>`]));
    expect(r.document.indexEntries).toBeUndefined();
  });
  it('区切りの字を差し替える (fo:index-page-citation-list-separator・-range-separator。§6.10.8・§6.10.9)。字の書式は区切りの要素のもの', () => {
    const b = body([W('a'), W('a'), W('a'), '', W('a')]);
    const seps = `<fo:index-page-citation-list-separator>・</fo:index-page-citation-list-separator><fo:index-page-citation-range-separator font-weight="bold">〜</fo:index-page-citation-range-separator>`;
    const { r, tree } = layout(b, idx(list(ref('a'), '', seps)));
    expect(r.report.unsupported).toEqual({});
    expect(indexText(tree)).toBe('項目 1〜3・5');
    const bold: string[] = [];
    walk(tree.sheets[5].page.regionBody as unknown as Area, (a) => a.type === 'glyph' && (a.fontWeight >= 700 || a.fakeBold) && bold.push(a.text));
    expect(bold.join('')).toBe('〜');
  });
  it('前後に付ける字 (fo:index-page-number-prefix・-suffix。§6.10.2・§6.10.3) は、範囲の最初と最後の番号のそれぞれに付く (§6.10.7)', () => {
    const b = body([W('a'), W('a'), W('a'), '', W('a')]);
    const ps = `<fo:index-page-number-prefix>p.</fo:index-page-number-prefix><fo:index-page-number-suffix><fo:inline font-weight="bold">頁</fo:inline></fo:index-page-number-suffix>`;
    expect(indexText(layout(b, idx(list(ref('a', '', ps)))).tree)).toBe('項目 p.1頁–p.3頁, p.5頁');
  });
  it('ページ番号の書式は、引いたページの page-sequence の format (ローマ数字)。fo:folio-prefix・fo:folio-suffix も付く (§6.6.10)', () => {
    // 前付けは 4 ページ (i〜iv)。次の page-sequence が 1 から始まるので、偶数のページ数で終える
    const front = seqXml('format="i"', pagesXml([W('a'), '', W('a'), W('a')]));
    const main = seqXml('initial-page-number="1" format="1"', pagesXml([W('a'), W('a'), W('a')]));
    const app = seqXml('initial-page-number="1" format="A"', pagesXml(['', W('a')]), `<fo:folio-prefix>付録<fo:inline font-weight="bold">-</fo:inline></fo:folio-prefix><fo:folio-suffix>頁</fo:folio-suffix>`);
    const { r, tree } = layout(front, main, app, idx(list(ref('a', 'page-number-treatment="link"'))));
    expect(r.report.unsupported).toEqual({});
    expect(indexText(tree)).toBe('項目 i, iii–3, 付録-B頁');
  });
  it('page-number-treatment="link" は、引いた所へのリンクにする。no-link (初期値) はリンクにしない (§7.24.3)', () => {
    const b = body([W('a'), `<fo:block id="here" index-key="a">x</fo:block>`]);
    const { tree } = layout(b, idx(list(ref('a', 'page-number-treatment="link"'))));
    const ls = links(tree, 2);
    expect(ls.length).toBe(2);
    expect(ls[1]).toBe('here');
    // 飛び先は、引いた所のあるページ
    expect(tree.destinations![ls[0]]).toBe(0);
    expect(tree.destinations!.here).toBe(1);
    expect(links(layout(b, idx(list(ref('a')))).tree, 2)).toEqual([]);
  });
  it('リンク: 範囲の途中のページ・ページをまたぐ所の続きのページは、そのページを飛び先にする', () => {
    const b = body([`<fo:index-range-begin id="r" index-key="a"/>`, '', `<fo:index-range-end ref-id="r"/>`]);
    const { tree } = layout(b, idx(list(ref('a', 'page-number-treatment="link"'), 'merge-sequential-page-numbers="leave-separate"')));
    expect(indexText(tree)).toBe('項目 1, 2, 3');
    expect(links(tree, 3).map((t) => tree.destinations![t])).toEqual([0, 1, 2]);
  });
  it('PDF では、リンクのページ番号がリンク注釈になる', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    const b = body([W('a'), '', W('a')]);
    const { tree } = layout(b, idx(list(ref('a', 'page-number-treatment="link"') + ref('nothing'))));
    const pdf = await PDFDocument.load(await renderPdf(tree, E.fonts, { subset: false }));
    expect(pdf.getPages().map((p) => p.node.Annots()?.size() ?? 0)).toEqual([0, 0, 0, 2]);
  });
  it('存在しない鍵の fo:index-key-reference は無視して、警告する (§6.10.6)。項目が 1 つも無ければ何も組まない', () => {
    const { tree } = layout(body([W('a')]), idx(list(ref('nothing') + ref('a'))));
    expect(indexText(tree)).toBe('項目 1');
    expect(tree.warnings.some((w) => w.includes('"nothing"'))).toBe(true);
    const none = layout(body([W('a')]), idx(list(ref('nothing'))));
    expect(indexText(none.tree)).toBe('項目');
  });
  it('ref-index-key の無い fo:index-key-reference・知らない子は、読まずに報告する', () => {
    const r = imp(body([W('a')]), idx(`<fo:block><fo:index-page-citation-list><fo:index-key-reference/><fo:block>x</fo:block>${ref('a')}</fo:index-page-citation-list></fo:block>`));
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:index-key-reference'))).toBe(true);
    expect(Object.keys(r.report.unsupported).some((k) => k.startsWith('fo:block (fo:index-page-citation-list'))).toBe(true);
  });
  it('id を組版へ渡さない要素の index-key は、読み込みの報告に出す', () => {
    const r = imp(body([`<fo:leader index-key="a" leader-length="5mm"/>`]), idx(list(ref('a'))));
    expect(r.report.unsupported['index-key (fo:leader)']).toBe(1);
  });
  it('索引が本文と同じ page-sequence にあっても引ける', () => {
    const { tree } = layout(seqXml('', pagesXml([W('a'), '', W('a')]) + `<fo:block break-before="page"/>` + list(ref('a'))));
    expect(indexText(tree)).toBe('項目 1, 3');
    expect(tree.warnings).toEqual([]);
  });
  it('索引が本文より前にあっても引ける (組み直して決める)', () => {
    const { tree } = layout(idx(list(ref('a'))), seqXml('', pagesXml([W('a'), '', W('a'), W('a'), W('a')])));
    expect(indexText(tree)).toBe('項目 2, 4–6');
    expect(tree.warnings).toEqual([]);
  });
  it('表のセル・脚注・ページの柱 (static-content) の中の fo:index-page-citation-list も組める', () => {
    const l = `<fo:index-page-citation-list>${ref('a')}</fo:index-page-citation-list>`;
    const cell = `<fo:table table-layout="fixed" width="100%"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row><fo:table-cell><fo:block id="ix">セル ${l}</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
    const fn = `<fo:block>本文<fo:footnote><fo:inline>*</fo:inline><fo:footnote-body><fo:block id="fn">注 ${l}</fo:block></fo:footnote-body></fo:footnote></fo:block>`;
    const pm = `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="120mm" page-height="60mm" margin="5mm"><fo:region-body margin-top="8mm"/><fo:region-before extent="6mm"/></fo:simple-page-master></fo:layout-master-set>`;
    const head = `<fo:static-content flow-name="xsl-region-before"><fo:block>柱 ${l}</fo:block></fo:static-content>`;
    const xml = `<?xml version="1.0"?><fo:root ${NS}>${pm}<fo:page-sequence master-reference="m">${head}<fo:flow flow-name="xsl-region-body" font-size="8pt">${pagesXml([W('a'), '', W('a')])}<fo:block break-before="page"/>${cell}${fn}</fo:flow></fo:page-sequence></fo:root>`;
    const r = importXslFo(xml, parse, { compat: 'spec' });
    const tree = E.engine.layout(r.document);
    expect(tree.warnings).toEqual([]);
    expect(indexText(tree)).toBe('セル 1, 3');
    expect(indexText(tree, 'fn')).toBe('注 1, 3');
    expect(tree.sheets.map((sh) => glyphs(sh.page.absoluteAreas as Area[]))).toEqual(Array(4).fill('柱 1, 3'));
  });
  it('縦書きでも組める', () => {
    const { tree } = layout(body([W('a'), W('a'), W('a'), '', W('a')]), seqXml('writing-mode="tb-rl"', list(ref('a'))));
    expect(indexText(tree)).toBe('項目 1–3, 5');
  });
  it('索引を使わない文書には、索引の欄を作らない', () => {
    const r = imp(body(['a', 'b']));
    expect(r.document.indexEntries).toBeUndefined();
    expect(r.document.sequences[0].folioKey).toBeUndefined();
    const withFolio = imp(seqXml('', pagesXml(['a']), `<fo:folio-prefix>G-</fo:folio-prefix>`));
    expect(withFolio.document.sequences[0].folioKey).toBeUndefined();
  });
});

describe('索引とページ数の収束', () => {
  const mk = (n: number, key = 'a') => `<fo:block>${`${W(key)}語 `.repeat(n)}</fo:block>`;

  it('索引がページを増やす: 索引の中の鍵が、索引の伸びで次のページへ送られても、決まるまで組み直す', () => {
    // 索引の page-sequence の中に、鍵の付いた所 (z) がある。索引の並びが伸びると、z は次のページへ送られ、引くページが変わる
    const many = Array.from({ length: 30 }, (_, k) => W(`k${k}`));
    const entries = many.map((_, k) => `<fo:block>項 <fo:index-page-citation-list>${ref(`k${k}`)}${ref('z')}</fo:index-page-citation-list></fo:block>`).join('');
    const { tree } = layout(seqXml('', pagesXml(many)), seqXml('', `${entries}<fo:block id="z" index-key="z">末尾</fo:block>` + list(ref('z'))));
    expect(tree.warnings).toEqual([]);
    // z のあるページの番号と、索引が引いた番号が合っている
    const zSheet = tree.destinations!.z;
    expect(indexText(tree)).toBe(`項目 ${zSheet + 1}`);
    expect(zSheet).toBeGreaterThan(30);
  });
  it('索引だけの組み直しでは、索引の無い page-sequence を組み直さない (組んだ回数で確かめる)', () => {
    const front = imp(seqXml('', list(ref('a'))), seqXml('', pagesXml([mk(3), '', mk(2)])));
    E.engine.layout(front.document);
    const twoPass = E.engine.stats.flows;
    // 本文だけの文書 (索引の page-sequence の無いもの) を 1 回組む回数と、索引の page-sequence を 2 回組む回数の和を超えない
    const bodyOnly = imp(seqXml('', pagesXml([mk(3), '', mk(2)])));
    E.engine.layout(bodyOnly.document);
    const bodyFlows = E.engine.stats.flows;
    const indexOnly = imp(seqXml('', list(ref('a'))));
    E.engine.layout(indexOnly.document);
    const indexFlows = E.engine.stats.flows;
    expect(twoPass).toBeLessThanOrEqual(bodyFlows + indexFlows * 2);
  });
  it('索引が本文の後ろにあれば、1 回の組版で決まる (組み直さない)', () => {
    const d = imp(seqXml('', pagesXml([mk(3), '', mk(2)])), seqXml('', list(ref('a'))));
    E.engine.layout(d.document);
    const withIndex = E.engine.stats.flows;
    const plain = imp(seqXml('', pagesXml([mk(3).replace(/index-key="a"/g, 'id="x"'), '', mk(2).replace(/index-key="a"/g, 'id="x"')])), seqXml('', `<fo:block id="ix">項目 1, 3</fo:block>`));
    E.engine.layout(plain.document);
    expect(withIndex).toBe(E.engine.stats.flows);
  });
  it('索引を使わない文書は、組む回数が変わらない (索引の仕組みを通らない)', () => {
    const d = imp(seqXml('', pagesXml(['a', 'b', 'c'])));
    const tree = E.engine.layout(d.document);
    expect(E.engine.stats.flows).toBe(1);
    expect(Object.keys(tree.destinations ?? {})).toEqual([]);
  });
  it('収束しないときは、上限の回数で止めて警告する', () => {
    // 範囲 q は、1 ページ目から、索引の並びの後ろの印まで。並びは範囲のページを 1 つずつ並べ (leave-separate)、どの番号にも 1 ページより長い字が後ろに付く。
    // 範囲が n ページなら並びは n ページより長くなり、印は n + 1 ページ目より後ろへ出るので、組み直すたびに範囲が伸びて決まらない
    const long = 'が'.repeat(700);
    const flip = `<fo:block><fo:index-page-citation-list merge-sequential-page-numbers="leave-separate">${ref('q', '', `<fo:index-page-number-suffix>${long}</fo:index-page-number-suffix>`)}</fo:index-page-citation-list></fo:block>`;
    const d = imp(seqXml('', `<fo:block><fo:index-range-begin id="q" index-key="q"/>始め</fo:block>${flip}<fo:block><fo:index-range-end ref-id="q"/>終わり</fo:block>`));
    const tree = E.engine.layout(d.document);
    expect(tree.warnings.filter((w) => w.includes('索引のページ番号の並びが収束しませんでした')).length).toBe(1);
    // 組み直しは上限 (最初の 1 回 + 4 回) で止まる: 並びの項目は、1 回ごとに 1〜2 つしか増えない (1 項目は 1.3 ページほど)
    const items = (glyphs(tree.sheets.flatMap((s) => s.page.regionBody.children as Area[])).match(/が{700}/g) ?? []).length;
    expect(items).toBeGreaterThanOrEqual(2);
    expect(items).toBeLessThanOrEqual(10);
  });
});

describe('索引の読み込みの形', () => {
  it('fo:index-page-citation-list は、引く鍵・書式・区切り・前後の字を持つ節になる', () => {
    const r = imp(
      seqXml('', `<fo:block>${W('a')}x</fo:block>`),
      seqXml('', `<fo:block><fo:index-page-citation-list color="#ff0000"><fo:index-page-citation-list-separator>; </fo:index-page-citation-list-separator>${ref('a', 'font-weight="bold"', '<fo:index-page-number-prefix>p</fo:index-page-number-prefix>')}</fo:index-page-citation-list></fo:block>`),
    );
    const wrap = (r.document.sequences[1].flow.children[0] as LBlock).children[0] as LInline;
    expect(wrap.color).toBe('#ff0000');
    expect(wrap.children[0]).toMatchObject({ type: 'index-page-citation-list', listSeparator: ['; '], references: [{ refKey: 'a', style: { fontWeight: 700 }, prefix: ['p'] }] });
    expect(r.document.indexEntries).toMatchObject([{ key: 'a' }]);
    expect(r.document.indexEntries![0].id).toMatch(/^kumiori-index-/);
  });
  it('鍵の付いた所は、文書の中の順に並ぶ。id があればそれを使う', () => {
    const r = imp(seqXml('', `<fo:block index-key="b" id="B"><fo:inline index-key="c">x<fo:wrapper index-key="d"/></fo:inline></fo:block><fo:block index-key="a" index-class="k">y</fo:block>`));
    expect(r.document.indexEntries!.map((e) => e.key)).toEqual(['b', 'c', 'd', 'a']);
    expect(r.document.indexEntries![0].id).toBe('B');
    expect(r.document.indexEntries![3].indexClass).toBe('k');
  });
});

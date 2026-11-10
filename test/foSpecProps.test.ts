/**
 * XSL-FO の、読んで組版へ渡すだけの性質:
 *  - 一括指定 (font・background・page-break-before/after/inside・size。XSL 1.1 §7.31・§5.2) と、上限・下限 (min-height・max-height・min-width・max-width。§7.15.8〜§7.15.11・§5.3.3)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine } from './helpers';
import type { LBlock, LBlockContainer, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string, master = 'page-width="100mm" page-height="100mm" margin="10mm"', seq = '') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="m" ${master}><fo:region-body/><fo:region-before extent="8mm"/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m" ${seq}><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const imp = (body: string, compat: 'spec' | 'antenna' = 'spec', master?: string, seq?: string) => importXslFo(fo(body, master, seq), parse, { compat });
const kids = (body: string, compat: 'spec' | 'antenna' = 'spec', seq?: string) => imp(body, compat, undefined, seq).document.sequences[0].flow.children;
const first = (body: string, compat: 'spec' | 'antenna' = 'spec', seq?: string) => kids(body, compat, seq)[0] as LBlock;
const MM = 72 / 25.4;

describe('XSL-FO の一括指定 (§7.31・§5.2)', () => {
  it('font: 字の形・太さ・大きさ・行送り・書体に分ける (§7.31.13)', () => {
    const b = first(`<fo:block font="italic bold 12pt/18pt serif">a</fo:block>`);
    expect(b.fontStyle).toBe('italic');
    expect(b.fontWeight).toBe(700);
    expect(b.fontSize).toBe(12);
    expect(b.lineHeightPt).toBe(18);
  });
  it('font: 書いていない部分は初期値に戻す (親の太字・斜体を打ち消す)', () => {
    const outer = first(`<fo:block font-weight="bold" font-style="italic"><fo:block font="10pt serif">a</fo:block></fo:block>`);
    const b = outer.children[0] as LBlock;
    expect(b.fontWeight).toBe(400);
    expect(b.fontStyle).toBe('normal');
    expect(b.fontSize).toBe(10);
  });
  it('font: 個別の性質を一緒に書いたら、個別の性質が勝つ (§5.2)', () => {
    const b = first(`<fo:block font="italic 12pt serif" font-size="20pt" font-style="normal">a</fo:block>`);
    expect(b.fontSize).toBe(20);
    expect(b.fontStyle).toBe('normal');
  });
  it('font: 行送りの数値・書体の並び (引用符・カンマ) を読む', () => {
    const fams: string[][] = [];
    const r = importXslFo(fo(`<fo:block font="9pt / 1.5 'My Font', serif">a</fo:block>`), parse, {
      compat: 'spec',
      mapFont: (list) => {
        fams.push(list);
        return undefined;
      },
    });
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontSize).toBe(9);
    expect(b.lineHeight).toBe(1.5);
    expect(fams).toContainEqual(['My Font', 'serif']);
  });
  it('font: システムの書体の語 (caption など)・読めない値は、何もせずに報告する', () => {
    const r = imp(`<fo:block font="caption">a</fo:block><fo:block font="bold">b</fo:block>`);
    const b = r.document.sequences[0].flow.children[0] as LBlock;
    expect(b.fontSize).toBeUndefined();
    expect(r.report.unsupported['font:caption']).toBe(1);
    expect(r.report.unsupported['font:bold']).toBe(1);
  });
  it('background: 色・画像・繰り返し・位置に分ける (§7.31.1)', () => {
    const b = first(`<fo:block background="#ff0000 url(a.png) no-repeat right top">a</fo:block>`);
    expect(b.backgroundColor).toBe('#ff0000');
    expect(b.backgroundImage).toMatchObject({ src: 'a.png', repeat: 'no-repeat', x: 'right', y: 'top' });
    // 色だけ・括弧の中に空白のある色
    expect(first(`<fo:block background="rgb(0, 128, 0)">a</fo:block>`).backgroundColor).toBe('rgb(0, 128, 0)');
    // 個別の性質が勝つ
    expect(first(`<fo:block background="red" background-color="#0000ff">a</fo:block>`).backgroundColor).toBe('#0000ff');
  });
  it('page-break-before・page-break-after: §7.31.16・§7.31.17 の対応の表のとおりに写す', () => {
    const of = (attrs: string) => first(`<fo:block ${attrs}>a</fo:block>`);
    expect(of('page-break-before="always"').breakBefore).toBe('page');
    expect(of('page-break-before="left"').breakBefore).toBe('even-page');
    expect(of('page-break-before="right"').breakBefore).toBe('odd-page');
    expect(of('page-break-before="avoid"')).toMatchObject({ keepWithPrevious: true });
    expect(of('page-break-before="avoid"').breakBefore).toBeUndefined();
    expect(of('page-break-before="auto"').breakBefore).toBeUndefined();
    expect(of('page-break-after="always"').breakAfter).toBe('page');
    expect(of('page-break-after="left"').breakAfter).toBe('even-page');
    expect(of('page-break-after="right"').breakAfter).toBe('odd-page');
    expect(of('page-break-after="avoid"')).toMatchObject({ keepWithNext: true });
    // 個別の性質が勝つ
    expect(of('page-break-before="always" break-before="column"').breakBefore).toBe('column');
  });
  it('page-break-inside: avoid は keep-together="always" (§7.31.18)', () => {
    expect(first(`<fo:block page-break-inside="avoid">a</fo:block>`).keepTogether).toBe(true);
    expect(first(`<fo:block page-break-inside="auto">a</fo:block>`).keepTogether).toBeUndefined();
  });
  it('page-break-before="always" のブロックは、次のページから始まる (表の行も)', () => {
    const doc = imp(`<fo:block>a</fo:block><fo:block page-break-before="always">b</fo:block>`).document;
    expect(E.engine.layout(doc).sheets.length).toBe(2);
    const row = (t: string) => `<fo:table-row ${t}><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row>`;
    const doc2 = imp(`<fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body>${row('')}${row('page-break-before="always"')}</fo:table-body></fo:table>`).document;
    expect(E.engine.layout(doc2).sheets.length).toBe(2);
  });
  it('page-break-* の読めない値は報告する', () => {
    const r = imp(`<fo:block page-break-before="sometimes">a</fo:block>`);
    expect(r.report.unsupported['page-break-before:sometimes']).toBe(1);
  });
  it('size: page-width・page-height に写す (§7.31.21。長さ 1 つは正方形、2 つは幅・高さ)', () => {
    const m = (size: string) => imp('<fo:block>a</fo:block>', 'spec', `size="${size}" margin="10mm"`).document.sequences[0].master;
    expect(m('120mm 80mm').width).toBeCloseTo(120, 6);
    expect(m('120mm 80mm').height).toBeCloseTo(80, 6);
    expect(m('90mm').width).toBeCloseTo(90, 6);
    expect(m('90mm').height).toBeCloseTo(90, 6);
    // auto・portrait は用紙の大きさ (A4 縦)、landscape は長い辺を横に
    expect(m('auto').width).toBeCloseTo(210, 1);
    expect(m('portrait').height).toBeCloseTo(297, 1);
    expect(m('landscape').width).toBeCloseTo(297, 1);
    expect(m('landscape').height).toBeCloseTo(210, 1);
    // 個別の性質が勝つ
    const both = imp('<fo:block>a</fo:block>', 'spec', `size="120mm 80mm" page-width="50mm"`).document.sequences[0].master;
    expect(both.width).toBeCloseTo(50, 6);
    expect(both.height).toBeCloseTo(80, 6);
  });
});

describe('XSL-FO の寸法の上限・下限 (§7.15.8〜§7.15.11・§5.3.3)', () => {
  it('横書き: min-height は block 方向の下限、max-width・min-width は inline 方向の上限・下限', () => {
    expect(first(`<fo:block min-height="30mm">a</fo:block>`).minBlockSize).toBeCloseTo(30 * MM, 6);
    // 本文の幅は 80mm: 上限がそれより狭ければ上限の幅、下限がそれより広ければ下限の幅
    expect(first(`<fo:block max-width="40mm">a</fo:block>`).width).toBeCloseTo(40 * MM, 6);
    expect(first(`<fo:block max-width="200mm">a</fo:block>`).width).toBeUndefined();
    expect(first(`<fo:block max-width="none">a</fo:block>`).width).toBeUndefined();
    expect(first(`<fo:block min-width="120mm">a</fo:block>`).width).toBeCloseTo(120 * MM, 6);
    expect(first(`<fo:block min-width="20mm">a</fo:block>`).width).toBeUndefined();
  });
  it('min-height のブロックは、中身が少なくてもその高さを取る', () => {
    const doc = imp(`<fo:block min-height="30mm" id="a">a</fo:block><fo:block id="b">b</fo:block>`).document;
    const page = E.engine.layout(doc).sheets[0];
    const ys: number[] = [];
    const visit = (n: unknown, oy: number) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => visit(c, oy));
      const a = n as { type?: string; y?: number; text?: string };
      const y = oy + (a.y ?? 0);
      if (a.type === 'glyph' && (a.text === 'a' || a.text === 'b')) ys.push(y);
      for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, y);
    };
    visit(page, 0);
    expect(ys.length).toBe(2);
    expect(ys[1] - ys[0]).toBeCloseTo(30 * MM, 3);
  });
  it('縦書きの箱の上限・下限は、読まずに報告する (組版に受け皿が無い)', () => {
    const r = imp(`<fo:block-container writing-mode="tb-rl" max-height="40mm" min-width="10mm"><fo:block>a</fo:block></fo:block-container>`);
    expect(r.report.unsupported['max-height']).toBe(1);
    expect(r.report.unsupported['min-width']).toBe(1);
    const bc = r.document.sequences[0].flow.children[0] as LBlockContainer;
    expect(bc.height).toBeUndefined();
    expect(bc.minBlockSize).toBeUndefined();
  });
  it('縦書きの表の行: block 方向の下限・上限は min-width・max-width (§5.3.3)', () => {
    const t = first(
      `<fo:block-container writing-mode="tb-rl"><fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row min-width="12mm" max-width="20mm"><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:block-container>`,
    ) as unknown as LBlockContainer;
    const row = (t.children[0] as LTable).body.rows[0];
    expect(row.minHeight).toBeCloseTo(12 * MM, 6);
    expect(row.maxHeight).toBeCloseTo(20 * MM, 6);
  });
  it('表の行: min-height は高さの下限、max-height は上限 (仕様モード)', () => {
    const t = first(
      `<fo:table table-layout="fixed" width="50mm"><fo:table-column column-width="50mm"/><fo:table-body><fo:table-row min-height="12mm" max-height="20mm"><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`,
    ) as unknown as LTable;
    const row = t.body.rows[0];
    expect(row.minHeight).toBeCloseTo(12 * MM, 6);
    expect(row.maxHeight).toBeCloseTo(20 * MM, 6);
  });
  it('受け皿の無い向き (ブロックの block 方向の上限) は報告する', () => {
    const r = imp(`<fo:block max-height="20mm">a</fo:block>`);
    expect(r.report.unsupported['max-height']).toBe(1);
    expect((r.document.sequences[0].flow.children[0] as LBlock).height).toBeUndefined();
  });
});

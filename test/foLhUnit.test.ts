/**
 * NF-21 XSL-FO の lh の単位 (行の高さ。XSL 1.1 §5.9.13 に無い単位で、CSS Values 4 §6.1.1 の単位。アンテナハウスが読む)。
 * 互換モード (--compat antenna) では、どの長さでも、その要素の行の高さを基準に読む (前は罫線の太さ・baseline-shift だけで、
 * space-before="0.5lh" などは未対応の長さとして捨てていた)。仕様モードでは読まず、互換の指定のときだけの値として警告に出す
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import type { LBlock } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
const fo = (flow: string) => `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const imp = (flow: string, compat: ImportOptions['compat']) => {
  const r = importXslFo(fo(flow), parse, { compat });
  return { kids: r.document.sequences[0].flow.children as LBlock[], unsupported: r.report.unsupported };
};
const top = (b: LBlock) => (b.margin as { top?: number } | undefined)?.top;

describe('XSL-FO の lh の単位', () => {
  it('互換モード: space-before・space-after は、その要素の行の高さが基準 (12pt・line-height 1.5 なら 1lh = 18pt)', () => {
    const r = imp('<fo:block font-size="12pt" line-height="1.5" space-before="0.5lh" space-after="1lh">a</fo:block>', 'antenna');
    expect(top(r.kids[0])).toBeCloseTo(9, 3);
    expect((r.kids[0].margin as { bottom?: number }).bottom).toBeCloseTo(18, 3);
    expect(Object.keys(r.unsupported).filter((k) => k.includes('lh'))).toEqual([]);
  });
  it('互換モード: 子の行の高さは、親の後の長さの基準にならない', () => {
    const r = imp('<fo:block font-size="10pt" line-height="2"><fo:block font-size="20pt" line-height="1">big</fo:block></fo:block><fo:block font-size="10pt" line-height="2" space-before="1lh">b</fo:block>', 'antenna');
    expect(top(r.kids[1])).toBeCloseTo(20, 3);
  });
  it('互換モード: 罫線の一括指定の太さも読む', () => {
    const r = imp('<fo:block font-size="10pt" line-height="1.2" border="0.1lh solid red">a</fo:block>', 'antenna');
    expect((r.kids[0].border as { top: { width: number } }).top.width).toBeCloseTo(1.2, 3);
  });
  it('仕様モード: 読まずに、互換の指定のときだけの値として警告に出す (罫線の太さも)', () => {
    const r = imp('<fo:block font-size="12pt" line-height="1.5" space-before="0.5lh" border-top="0.1lh solid red">a</fo:block>', 'spec');
    expect(top(r.kids[0]) ?? 0).toBe(0);
    expect(r.unsupported['単位 lh (長さ "0.5lh"。--compat antenna のときだけ解釈する値)']).toBe(1);
    expect(Object.keys(r.unsupported).some((k) => k.startsWith('単位 lh (長さ "0.1lh"'))).toBe(true);
  });
  it('互換モード: 前の兄弟の行の高さは、lh の基準にならない (text-indent・letter-spacing は自分、font-size・line-height は親の行の高さ)', () => {
    const wrap = (prev: string, b: string) => imp(`<fo:block font-size="10pt" line-height="1.2">${prev}${b}</fo:block>`, 'antenna').kids[0].children[1] as LBlock;
    for (const prev of ['<fo:block>a</fo:block>', '<fo:block line-height="3">a</fo:block>', '<fo:block font-size="30pt">a</fo:block>']) {
      expect(wrap(prev, '<fo:block text-indent="1lh">b</fo:block>').textIndent).toBeCloseTo(12, 3);
      expect(wrap(prev, '<fo:block letter-spacing="0.1lh">b</fo:block>').letterSpacing).toBeCloseTo(1.2, 3);
      // font-size の lh は親の行の高さ (12pt)。text-indent は、字の大きさが 12pt になった自分の行の高さ (14.4pt)
      const f = wrap(prev, '<fo:block font-size="1lh" text-indent="1lh">b</fo:block>');
      expect(f.fontSize).toBeCloseTo(12, 3);
      expect(f.textIndent).toBeCloseTo(14.4, 3);
    }
  });
  it('互換モード: 自分の line-height で決まった行の高さが、自分の text-indent の基準', () => {
    const r = imp('<fo:block font-size="10pt" line-height="1.2"><fo:block line-height="2" text-indent="1lh">a</fo:block></fo:block>', 'antenna');
    expect((r.kids[0].children[0] as LBlock).textIndent).toBeCloseTo(20, 3);
  });
  it('互換モード: line-height に lh の単位は使えない (読まずに知らせる)', () => {
    const r = imp('<fo:block font-size="10pt" line-height="1.2"><fo:block line-height="2lh">a</fo:block></fo:block>', 'antenna');
    const b = r.kids[0].children[0] as LBlock;
    expect(b.lineHeightPt).toBeUndefined();
    expect(Object.keys(r.unsupported).some((k) => k.startsWith('line-height:2lh'))).toBe(true);
  });
});

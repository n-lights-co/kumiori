/**
 * リストの 2 つ目からの項目の fo:list-item-body の start-indent (長さ) を読む (台帳の FO-25 の (4))。
 * XSL 1.1 §7.11.7 start-indent (本体の内容の始端の、参照領域の始端からの距離)・§6.8.4 fo:list-item-body。
 * リストは「ラベルの列 + 本体の列」の表にして組む。本体の列の始端は、最初に start-indent を書いた本体の値 (body-start() なら
 * provisional-distance-between-starts) で決まるので、ほかの項目の本体は、それより大きい分をセルの始端の余白にする。
 * https://www.w3.org/TR/xsl11/ (2026-11-11 取得)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import type { LTable } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
const item = (body: string, n: number) => `<fo:list-item><fo:list-item-label><fo:block>${n}</fo:block></fo:list-item-label><fo:list-item-body ${body}><fo:block>x</fo:block></fo:list-item-body></fo:list-item>`;
const imp = (bodies: string[], compat: 'spec' | 'antenna', list = '') => {
  const r = importXslFo(`<?xml version="1.0"?><fo:root ${NS} font-size="10pt">${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:list-block ${list}>${bodies.map(item).join('')}</fo:list-block></fo:flow></fo:page-sequence></fo:root>`, parse, { compat });
  const t = r.document.sequences[0].flow.children[0] as LTable;
  return { labelWidth: t.columns![0].width, pads: t.body.rows.map((row) => (row.cells[1].padding as { left?: number } | undefined)?.left), unsupported: r.report.unsupported };
};
const BOTH = ['spec', 'antenna'] as const;

describe('fo:list-item-body の start-indent (2 つ目からの項目。FO-25 (4))', () => {
  it('どの項目も同じ長さ: 本体の列の始端はその長さ。読まなかった属性として報告しない', () => {
    for (const c of BOTH) {
      const r = imp(['start-indent="4em"', 'start-indent="4em"', 'start-indent="40pt"'], c);
      expect(r.labelWidth).toBe(40);
      expect(r.pads).toEqual([undefined, undefined, undefined]);
      expect(r.unsupported).toEqual({});
    }
  });

  it('最初の項目より大きい長さ: その差を、本体のセルの始端の余白にする', () => {
    for (const c of BOTH) {
      const r = imp(['start-indent="4em"', 'start-indent="6em"', 'start-indent="4em"'], c);
      expect(r.labelWidth).toBe(40);
      expect(r.pads).toEqual([undefined, 20, undefined]);
      expect(r.unsupported).toEqual({});
    }
  });

  it('最初が body-start() で、後の項目が長さ: body-start() の位置 (provisional-distance-between-starts) との差を余白にする', () => {
    for (const c of BOTH) {
      const r = imp(['start-indent="body-start()"', 'start-indent="50pt"', 'start-indent="30pt"'], c, 'provisional-distance-between-starts="30pt"');
      expect(r.labelWidth).toBe(30);
      expect(r.pads).toEqual([undefined, 20, undefined]);
      expect(r.unsupported).toEqual({});
    }
  });

  it('最初の項目より小さい長さ (本体の列の始端より手前) は置けないので、読まなかった属性として報告する', () => {
    const r = imp(['start-indent="4em"', 'start-indent="2em"'], 'spec');
    expect(r.pads).toEqual([undefined, undefined]);
    expect(r.unsupported).toEqual({ 'start-indent (fo:list-item-body)': 1 });
  });
});

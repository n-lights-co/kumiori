/**
 * fo:table-and-caption の text-align で寄せる、罫線をつぶした表 (border-collapse="collapse") の位置の回帰テスト。
 * 寄せるのは外周のグリッド線 (罫線の中心) の間の箱で、表の箱の幅は表が罫線を持つ辺では外へ出る罫線の半分を除いた幅 (CSS 2.1 §17.6.2)。
 * 前は寄せの空きにその半分を戻していなかったので、表が外へ出る罫線の半分だけ左にずれた (アンテナハウスの見本の
 * axf-justify-rowspan-height-1 の、3pt の二重線の表も、外枠が見本より 1.5pt 左にあった)。
 * 本文の幅 260pt (左の余白 20pt)、40pt の列 2 つの表で、表の箱 (外枠) の位置を見る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { childrenOf } from '../src/areaTree';
import type { Area } from '../src/types';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});
const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="300pt" page-height="300pt" margin-left="20pt" margin-right="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
/** 2 列の表 (table の属性 attrs、セルの属性 cell) を text-align で寄せる */
const table = (align: string, attrs: string, cell = '') =>
  `<fo:table-and-caption text-align="${align}"><fo:table border-collapse="collapse" ${attrs}><fo:table-column column-width="40pt"/><fo:table-column column-width="40pt"/><fo:table-body><fo:table-row><fo:table-cell ${cell}><fo:block>a</fo:block></fo:table-cell><fo:table-cell ${cell}><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table></fo:table-and-caption>`;
/** 表の箱 (外枠) の左端と幅 (ページの座標) */
const tableBox = (flow: string, compat: 'spec' | 'antenna') => {
  let out: { x: number; w: number } | undefined;
  const visit = (n: Area, ox: number) => {
    const x = ox + n.x;
    if (n.type === 'table' && !out) out = { x, w: (n as { width: number }).width };
    for (const c of childrenOf(n)) visit(c as Area, x + (n.border?.left?.width ?? 0) + (n.padding?.left ?? 0));
  };
  visit(E.engine.layout(importXslFo(fo(flow), parse, { compat }).document).sheets[0].page.regionBody as Area, 0);
  return out!;
};

describe('fo:table-and-caption の text-align="center" で寄せる、罫線をつぶした表は、本文の中央に置く', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`${compat}: 表の罫線・セルの罫線・幅を書いた表 (外枠 86pt の中心が、本文の中心 150pt)`, () => {
      for (const [attrs, cell] of [
        ['border="6pt solid"', ''],
        ['border="6pt solid" width="80pt"', ''],
        ['', 'border="6pt solid"'],
        ['width="80pt"', 'border="6pt solid"'],
      ]) {
        const b = tableBox(table('center', attrs, cell), compat);
        expect(b.w, `${attrs} ${cell}`).toBeCloseTo(86, 2);
        // 直す前は、表が罫線を持つ表で 104 (外へ出る半分の 3pt だけ左)
        expect(b.x + b.w / 2, `${attrs} ${cell}`).toBeCloseTo(150, 2);
      }
    });
  }
  it('罫線を分ける表は、これまでどおり', () => {
    const b = tableBox(table('center', 'border="6pt solid"').replace('border-collapse="collapse"', 'border-collapse="separate"'), 'spec');
    expect(b.w).toBeCloseTo(92, 2);
    expect(b.x + b.w / 2).toBeCloseTo(150, 2);
  });
  it('text-align="end" は、外周のグリッド線を本文の終わりに置く (表の罫線の無い表)', () => {
    const b = tableBox(table('end', '', 'border="6pt solid"'), 'spec');
    // グリッド線は外枠の 3pt 内側
    expect(b.x + b.w - 3).toBeCloseTo(280, 2);
  });
});

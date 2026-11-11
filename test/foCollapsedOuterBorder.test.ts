/**
 * 罫線をつぶした表 (border-collapse="collapse") の、外側の罫線の外へ出る半分 (台帳の FO-22 の H)。
 * 仕様: XSL 1.1 §6.7.3 (collapse の表の罫線は、セルの段階で決める)・§7.28.3 (border-collapse は CSS2 の定義を引く)、
 * CSS2 (1998) §17.6.2「Borders are centered on the grid lines between the cells」「only half of the two exterior borders are counted in
 * the table width; the other half of these two borders lies in the margin area」(https://www.w3.org/TR/xsl11/・
 * https://www.w3.org/TR/1998/REC-CSS2-19980512/tables.html 2026-11-11 取得)。
 * 表の箱の端は罫線の中央なので、前後の余白が罫線の半分より小さくても、表の位置は変わらない (外の半分は前後の内容の側へ出る)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine } from './helpers';
import { childrenOf } from '../src/areaTree';
import type { Area } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const BOTH = ['spec', 'antenna'] as const;
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
/** 罫線 4pt のセル 1 つの表 (外へ出る半分は 2pt) */
const table = (attrs = '', collapse = 'collapse') =>
  `<fo:table border-collapse="${collapse}" table-layout="fixed" width="100%" ${attrs}><fo:table-column column-width="40mm"/><fo:table-body><fo:table-row><fo:table-cell border="4pt solid black" background-color="yellow"><fo:block>セル</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
const block = (color: string, attrs = '') => `<fo:block background-color="${color}" ${attrs}>文</fo:block>`;
/** 最初のページの、背景の色ごとの箱と、表の箱 (ページの中の位置) */
const boxes = (xml: string, compat: 'spec' | 'antenna') => {
  const tree = E.engine.layout(importXslFo(xml, parse, { compat }).document);
  const out: Record<string, { y: number; bottom: number }> = {};
  const visit = (n: Area, oy: number) => {
    const y = oy + n.y;
    const key = n.type === 'table' ? 'table' : n.backgroundColor;
    if (key && !out[key]) out[key] = { y, bottom: y + n.height };
    for (const c of childrenOf(n)) visit(c as Area, y);
  };
  visit(tree.sheets[0].page.regionBody as Area, 0);
  return out;
};

describe('FO-22 H: collapse の表の外側の罫線の半分は、余白の量に関わらず表の箱の外 (CSS2 §17.6.2)', () => {
  it('前後に余白が無くても、罫線の中央が前後のブロックの端に来る (表の箱は罫線の半分だけ前後へ出る)', () => {
    for (const c of BOTH) {
      const b = boxes(fo(block('red') + table() + block('blue')), c);
      expect(b.table.y - b.red.bottom).toBeCloseTo(-2, 3);
      expect(b.blue.y - b.table.bottom).toBeCloseTo(-2, 3);
    }
  });

  it('余白が罫線の半分より小さいとき: 罫線の中央は、余白の分だけ離れる', () => {
    for (const c of BOTH) {
      const b = boxes(fo(block('red') + table('space-before="1pt" space-after="1pt"') + block('blue')), c);
      expect(b.table.y - b.red.bottom).toBeCloseTo(-1, 3);
      expect(b.blue.y - b.table.bottom).toBeCloseTo(-1, 3);
    }
  });

  it('余白が罫線の半分より大きいときは、今までどおり (余白に重なる)', () => {
    for (const c of BOTH) {
      const b = boxes(fo(block('red') + table('space-before="10pt" space-after="10pt"') + block('blue')), c);
      expect(b.table.y - b.red.bottom).toBeCloseTo(8, 3);
      expect(b.blue.y - b.table.bottom).toBeCloseTo(8, 3);
    }
  });

  it('参照領域の先頭 (ページの頭・span の後の領域の頭) でも、外の半分は領域の外へ出る (余白ではないので、先頭で捨てる対象でない)', () => {
    for (const c of BOTH) {
      const tree = E.engine.layout(importXslFo(fo(table()), parse, { compat: c }).document);
      const body = tree.sheets[0].page.regionBody;
      expect(boxes(fo(table()), c).table.y - body.y).toBeCloseTo(-2, 3);
    }
    // 互換モードの 1 段の本文: span="all" の囲み (space-after は retain) の後の領域の頭の表。囲みの下端 + 10pt が罫線の中央
    const b = boxes(fo('<fo:block span="all" background-color="red" space-after="10pt" space-after.conditionality="retain">囲み</fo:block>' + table()), 'antenna');
    expect(b.table.y - b.red.bottom).toBeCloseTo(8, 3);
  });

  it('次のページへ続く表の断片の頭でも、外の半分は領域の外へ出る (最初の断片と同じ位置にそろう)', () => {
    const rows = Array.from({ length: 30 }, (_, k) => `<fo:table-row><fo:table-cell border="4pt solid black"><fo:block>行${k}</fo:block></fo:table-cell></fo:table-row>`).join('');
    const xml = fo(`<fo:table border-collapse="collapse" table-layout="fixed" width="100%"><fo:table-column column-width="40mm"/><fo:table-body>${rows}</fo:table-body></fo:table>`);
    for (const c of BOTH) {
      const tree = E.engine.layout(importXslFo(xml, parse, { compat: c }).document);
      expect(tree.sheets.length).toBeGreaterThan(1);
      const tops = tree.sheets.slice(0, 2).map((s) => {
        let y: number | undefined;
        const visit = (n: Area, oy: number) => {
          if (n.type === 'table' && y === undefined) y = oy + n.y;
          for (const k of childrenOf(n)) visit(k as Area, oy + n.y);
        };
        visit(s.page.regionBody as Area, 0);
        return y! - s.page.regionBody.y;
      });
      expect(tops[0]).toBeCloseTo(-2, 3);
      expect(tops[1]).toBeCloseTo(-2, 3);
    }
  });

  it('罫線を分ける表 (separate) は、罫線の全部が表の箱の中 (変わらない)', () => {
    for (const c of BOTH) {
      const b = boxes(fo(block('red') + table('', 'separate') + block('blue')), c);
      expect(b.table.y - b.red.bottom).toBeCloseTo(0, 3);
      expect(b.blue.y - b.table.bottom).toBeCloseTo(0, 3);
    }
  });
});

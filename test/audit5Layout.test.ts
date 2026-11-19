/**
 * 脆弱性検査 (5 回目) の組版: 小さな入力で時間・メモリを使い切らせる入力への備え。
 *  - 段組のコンテナ (axf:column-count) の中の、深い入れ子のブロックの一番下にある多くの span="all"
 *    (包むブロックを span の前後で分けた断片が、入れ子の深さ × span の数に膨らまない)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import type { LBlock, LBlockContainer } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master>` +
  `</fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body" font-size="10pt">${body}</fo:flow></fo:page-sequence></fo:root>`;
/** D 段の入れ子の fo:block の一番下に、ふつうのブロックと span="all" のブロックを S 組置いた、段組のコンテナ */
const nested = (D: number, S: number) => {
  let b = Array.from({ length: S }, (_, j) => `<fo:block>a${j}</fo:block><fo:block span="all">s${j}</fo:block>`).join('');
  for (let d = 0; d < D; d++) b = `<fo:block>${b}</fo:block>`;
  return fo(`<fo:block-container axf:column-count="2">${b}</fo:block-container>`);
};
/** 組むブロックの数 (コンテナの中の、ブロックを数える) */
const countBlocks = (k: unknown): number => {
  if (typeof k !== 'object' || k === null || !('children' in k)) return 0;
  return ((k as LBlock).type === 'block' ? 1 : 0) + (k as LBlock).children.reduce((n: number, c) => n + countBlocks(c), 0);
};

describe('段組のコンテナの中の、深い入れ子の中の多くの span="all"', () => {
  it('入れ子 200 段・span 2000 個を、すぐに読み込める。断片の数に上限があり、後ろの span は段の中に組む (報告する)', () => {
    const t0 = Date.now();
    const im = importXslFo(nested(200, 2000), parse);
    expect(Date.now() - t0).toBeLessThan(5000);
    const box = im.document.sequences[0].flow.children[0] as LBlockContainer;
    // 入力のブロックは 200 + 4000。断片を足しても、入力の数 + 上限 (2 万) ほどまで
    expect(countBlocks(box)).toBeLessThan(4200 + 20000 + 1000);
    // 先頭の span は今までどおり外へ出す
    const spans = box.children.filter((c) => typeof c !== 'string' && c.type === 'block' && c.span === 'all');
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.length).toBeLessThan(2000);
    expect(im.report.notes.some((n) => /span="all"/.test(n))).toBe(true);
  });
  it('浅い入れ子の span は、今までどおり、すべてコンテナの直下へ出す (報告しない)', () => {
    const im = importXslFo(nested(3, 5), parse);
    const box = im.document.sequences[0].flow.children[0] as LBlockContainer;
    // span の前後で分けた断片: ふつうのブロックの断片と span の断片が交互に 10 個
    expect(box.children.length).toBe(10);
    expect(box.children.map((c) => (typeof c !== 'string' && c.type === 'block' && c.span === 'all' ? 'S' : 'b')).join('')).toBe('bSbSbSbSbS');
    expect(im.report.notes.some((n) => /span="all"/.test(n))).toBe(false);
  });
});

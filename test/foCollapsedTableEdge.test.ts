/**
 * 罫線をつぶした表 (border-collapse の初期値 collapse。XSL 1.1 §7.28.3) の、表の罫線の位置。
 * 表の内容の矩形は外周のグリッド線の間 (§6.7.3)、罫線はグリッド線を中心に描く (§6.7.10)、start-indent は内容の矩形の始めの辺の位置
 * (§5.3.2)。よって start-indent="0" の表は、外周のグリッド線が本文の端にあり、表の罫線の半分が本文の外に出る。
 * 前は、表の罫線の太さだけ始めの側にずれていた (6pt の罫線で、外枠が本文の端より 9pt 外)。
 * 互換モードも同じ (アンテナハウスの見本の PDF: サンプル FO 集の table-border-conflict-resolution-1 で、外枠は罫線の半分だけ外)
 */
import { describe, expect, it } from 'vitest';
import { typesetFo, type Area } from '../src/index';
import { childrenOf } from '../src/areaTree';

const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const table = (attrs: string) =>
  `<fo:table ${attrs} width="200pt" border="6pt solid black"><fo:table-column column-width="100pt"/><fo:table-column column-width="100pt"/>` +
  `<fo:table-body><fo:table-row><fo:table-cell border="1pt solid black"><fo:block>a</fo:block></fo:table-cell><fo:table-cell border="1pt solid black"><fo:block>b</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`;
const doc = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="300pt" page-height="200pt" margin="0">` +
  `<fo:region-body margin-left="20pt" margin-right="20pt" margin-top="20pt"/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** ページの上の、表の領域の罫線の箱の左右 (pt) */
async function tableEdges(body: string, compat: 'spec' | 'antenna'): Promise<Array<[number, number]>> {
  const r = await typesetFo(doc(body), { compat });
  const out: Array<[number, number]> = [];
  const walk = (a: Area, ox: number, inner: boolean) => {
    const x = ox + a.x;
    if (a.type === 'table') out.push([x, x + a.width]);
    for (const c of childrenOf(a)) walk(c, inner ? x + (a.border?.left?.width ?? 0) + a.padding.left : 0, true);
  };
  for (const c of childrenOf(r.areaTree.sheets[0].page)) walk(c, 0, true);
  return out;
}

describe('罫線をつぶした表の外枠', () => {
  for (const compat of ['spec', 'antenna'] as const) {
    it(`${compat}: start-indent="0" と、書かない (受け継いだ 0) 表は、外周のグリッド線が本文の端 (20pt) にあり、外枠は 17〜223pt`, async () => {
      const edges = await tableEdges(table('start-indent="0"') + table(''), compat);
      expect(edges).toHaveLength(2);
      for (const [l, r] of edges) {
        expect(l).toBeCloseTo(17, 3);
        expect(r).toBeCloseTo(223, 3);
      }
    });
  }

  it('罫線を分ける表 (separate) は、これまでどおり罫線が内容の矩形の外 (外枠は 14〜226pt)', async () => {
    const [[l, r]] = await tableEdges(table('border-collapse="separate" start-indent="0"'), 'spec');
    expect(l).toBeCloseTo(14, 3);
    expect(r).toBeCloseTo(226, 3);
  });

  it('border-collapse は継承する性質 (§7.28.3): 祖先の fo:block に separate を書いた表は罫線を分ける表。祖先の border-collapse は未対応の警告にしない', async () => {
    const body = `<fo:block border-collapse="separate"><fo:block>${table('start-indent="0"')}</fo:block>${table('start-indent="0" border-collapse="collapse"')}</fo:block>`;
    const edges = await tableEdges(body, 'spec');
    expect(edges).toHaveLength(2);
    expect(edges[0][0]).toBeCloseTo(14, 3);
    expect(edges[0][1]).toBeCloseTo(226, 3);
    // 表の要素に書いた値が勝つ
    expect(edges[1][0]).toBeCloseTo(17, 3);
    const r = await typesetFo(doc(body), { compat: 'spec' });
    expect(r.diagnostics.filter((d) => d.code === 'fo/unsupported')).toEqual([]);
    expect(r.areaTree.sheets[0].page).toBeDefined();
    // inherit は親の値
    const [[l]] = await tableEdges(`<fo:block border-collapse="separate">${table('start-indent="0" border-collapse="inherit"')}</fo:block>`, 'spec');
    expect(l).toBeCloseTo(14, 3);
  });

  it('表を中に持たない fo:block の border-collapse も報告しないが、値の表に無い値は無視したことを報告する', async () => {
    const ok = await typesetFo(doc('<fo:block border-collapse="separate">a</fo:block>'), { compat: 'spec' });
    expect(ok.diagnostics.filter((d) => d.code === 'fo/unsupported')).toEqual([]);
    const bad = await typesetFo(doc('<fo:block border-collapse="seperate">a</fo:block>'), { compat: 'spec' });
    expect(bad.diagnostics.filter((d) => d.code === 'fo/unsupported').map((d) => d.message).join('\n')).toMatch(/border-collapse="seperate"/);
  });
});

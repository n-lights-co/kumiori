/**
 * XSL-FO の段組のコンテナ (axf:column-count) の、段の釣り合わせと分けない指定、参照領域の頭・終わりの余白。
 * - keep-together.within-column="always" のブロック (ブロックコンテナ) は、1 つの段に収める (XSL 1.1 §7.20.3)。釣り合わせで段を低くして分けない
 * - 段と、span="all" のブロックの領域は、それぞれ参照領域 (コンテナは §6.5.3。region-body の段と span の領域は §6.4.13・§6.4.14) で、
 *   その頭と終わりの conditionality="discard" の余白は捨て、retain の余白は残す (§4.3.1)
 * (https://www.w3.org/TR/xsl11/ 2026-11-18 取得)
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
/** ページは 400pt 四方、余白 20pt (本文は 360pt 四方で、左上が 20pt・20pt)。字は 10pt、行の高さは 12pt */
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-size="10pt" line-height="1.2"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="400pt" page-height="400pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
/** 2 段 (段間 10pt。段の幅は 175pt で、1 段目は x = 20〜195、2 段目は x = 205〜380) の段組のコンテナ */
const columns = (body: string) => `<fo:block-container axf:column-count="2" axf:column-gap="10pt"><fo:block>${body}</fo:block></fo:block-container>`;
type Line = { page: number; x: number; y: number; bottom: number; text: string };
/** 行 (ページの中の位置と字) を、文書の順に並べる */
const linesOf = (xml: string, compat: 'spec' | 'antenna'): Line[] => {
  const tree = E.engine.layout(importXslFo(xml, parse, { compat }).document);
  const out: Line[] = [];
  tree.sheets.forEach((sheet, page) => {
    const visit = (n: Area, ox: number, oy: number) => {
      const x = ox + n.x;
      const y = oy + n.y;
      if (n.type === 'line') {
        let text = '';
        const collect = (m: Area) => {
          text += (m as { text?: string }).text ?? '';
          for (const c of childrenOf(m)) collect(c as Area);
        };
        collect(n);
        out.push({ page, x, y, bottom: y + n.height, text });
        return;
      }
      for (const c of childrenOf(n)) visit(c as Area, x, y);
    };
    visit(sheet.page.regionBody as Area, 0, 0);
  });
  return out;
};
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce sit amet risus ut sapien vehicula aliquam molestie vitae lacus.';
const col = (l: Line) => (l.x < 200 ? 1 : 2);

describe('段組のコンテナの keep-together.within-column (XSL 1.1 §7.20.3)', () => {
  it('span="all" の間の段の組の、分けない指定のブロックは、釣り合わせで 2 つの段に分けず、1 段目に収める', () => {
    for (const c of BOTH) {
      const ls = linesOf(
        fo(
          columns(
            `<fo:block span="all">Span one.</fo:block><fo:block keep-together.within-column="always" border="solid thin gray" padding="3pt">${LOREM}</fo:block><fo:block span="all">Span two.</fo:block>`,
          ),
        ),
        c,
      );
      const kept = ls.filter((l) => !/^Span/.test(l.text));
      expect(kept.length).toBe(4);
      expect(kept.map(col)).toEqual([1, 1, 1, 1]);
      // 行は続けて積む (12pt ずつ)。後ろの span は、ブロックの下
      expect(kept.map((l) => Math.round(l.y - kept[0].y))).toEqual([0, 12, 24, 36]);
      expect(ls[ls.length - 1].text).toBe('Span two.');
      expect(ls[ls.length - 1].y).toBeGreaterThan(kept[3].bottom);
    }
  });

  it('分けない指定のブロックコンテナも、1 段目に収める', () => {
    for (const c of BOTH) {
      const ls = linesOf(
        fo(
          columns(
            `<fo:block span="all">Span one.</fo:block><fo:block-container keep-together.within-column="always" border="solid thin gray" padding="3pt"><fo:block>${LOREM}</fo:block></fo:block-container><fo:block span="all">Span two.</fo:block>`,
          ),
        ),
        c,
      );
      const kept = ls.filter((l) => !/^Span/.test(l.text));
      expect(kept.length).toBe(4);
      expect(kept.map(col)).toEqual([1, 1, 1, 1]);
    }
  });

  it('分けない指定のブロックが 2 つなら、段ごとに 1 つずつ置く (どちらも分けない)', () => {
    for (const c of BOTH) {
      const kt = (t: string) => `<fo:block keep-together.within-column="always">${t} ${LOREM}</fo:block>`;
      const ls = linesOf(fo(columns(`<fo:block>Head.</fo:block>${kt('A')}${kt('B')}`)), c);
      const a = ls.findIndex((l) => l.text.startsWith('A '));
      const b = ls.findIndex((l) => l.text.startsWith('B '));
      expect(new Set(ls.slice(a, b).map(col)).size).toBe(1);
      expect(new Set(ls.slice(b).map(col)).size).toBe(1);
      expect(col(ls[a])).toBe(1);
      expect(col(ls[b])).toBe(2);
    }
  });

  it('ページをまたぐ段組の最後の行でも、分けない指定のブロックを 2 つの段に分けない', () => {
    for (const c of BOTH) {
      const fill = Array.from({ length: 70 }, (_, k) => `<fo:block>Row ${k + 1}</fo:block>`).join('');
      const ls = linesOf(fo(columns(`${fill}<fo:block keep-together.within-column="always">K ${LOREM}</fo:block>`)), c);
      const k = ls.findIndex((l) => l.text.startsWith('K '));
      const kept = ls.slice(k);
      expect(kept.length).toBe(4);
      expect(new Set(kept.map((l) => `${l.page}/${col(l)}`)).size).toBe(1);
    }
  });
});

describe('段組のコンテナの段と span="all" の領域の、頭と終わりの余白 (XSL 1.1 §4.3.1)', () => {
  const body = (before = '', after = '') =>
    `<fo:block space-before="5pt" ${before}>A1</fo:block><fo:block>A2</fo:block><fo:block>A3</fo:block><fo:block>A4</fo:block>` +
    `<fo:block span="all" space-after="15pt" ${after}>Span</fo:block>` +
    `<fo:block space-before="15pt" ${before}>B1</fo:block><fo:block>B2</fo:block>`;
  const at = (ls: Line[], t: string) => ls.find((l) => l.text === t)!;

  it('最初の段の頭の space-before (discard) は捨てる: 1 段目と 2 段目の最初の行が、同じ高さ', () => {
    for (const c of BOTH) {
      const ls = linesOf(fo(columns(body())), c);
      expect(col(at(ls, 'A3'))).toBe(2);
      expect(at(ls, 'A1').y).toBeCloseTo(20, 3);
      expect(at(ls, 'A3').y).toBeCloseTo(20, 3);
    }
  });

  it('span="all" の space-after (discard) と、続く段の組の最初のブロックの space-before (discard) は捨てる', () => {
    for (const c of BOTH) {
      const ls = linesOf(fo(columns(body())), c);
      expect(at(ls, 'Span').y).toBeCloseTo(at(ls, 'A2').bottom, 3);
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom, 3);
      expect(at(ls, 'B2').y).toBeCloseTo(at(ls, 'B1').y, 3);
    }
  });

  it('conditionality="retain" の余白は残す', () => {
    for (const c of BOTH) {
      const ls = linesOf(fo(columns(body('space-before.conditionality="retain"', 'space-after.conditionality="retain"'))), c);
      expect(at(ls, 'A1').y).toBeCloseTo(25, 3);
      // span の後ろの 15pt と、段の頭の 15pt は、別の参照領域の余白なので重ねない (§4.2.5)
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom + 30, 3);
    }
  });

  it('span="all" の margin-top・margin-bottom は、retain の余白 (§5.3.2) なので残す (どのモードでも)', () => {
    for (const c of BOTH) {
      const ls = linesOf(
        fo(columns(`<fo:block>A1</fo:block><fo:block>A2</fo:block><fo:block span="all" margin-top="7pt" margin-bottom="9pt">Span</fo:block><fo:block>B1</fo:block><fo:block>B2</fo:block>`)),
        c,
      );
      expect(at(ls, 'Span').y).toBeCloseTo(at(ls, 'A1').bottom + 7, 3);
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom + 9, 3);
    }
  });

  it('region-body の段組の span="all" の margin-bottom も、互換モードで残す (retain の余白。§5.3.2)', () => {
    const rb = fo(`<fo:block>A1</fo:block><fo:block>A2</fo:block><fo:block span="all" margin-top="7pt" margin-bottom="9pt">Span</fo:block><fo:block>B1</fo:block><fo:block>B2</fo:block>`).replace(
      '<fo:region-body/>',
      '<fo:region-body column-count="2" column-gap="10pt"/>',
    );
    for (const c of BOTH) {
      const ls = linesOf(rb, c);
      expect(at(ls, 'Span').y).toBeCloseTo(at(ls, 'A1').bottom + 7, 3);
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom + 9, 3);
    }
  });

  it('ページをまたぐ段組でも、span="all" の retain の余白と、後ろの段の組の頭の retain の余白は残す', () => {
    for (const c of BOTH) {
      const fill = Array.from({ length: 70 }, (_, k) => `<fo:block>Row ${k + 1}</fo:block>`).join('');
      const ls = linesOf(
        fo(
          columns(
            `${fill}<fo:block span="all" space-after="15pt" space-after.conditionality="retain">Span</fo:block><fo:block space-before="15pt" space-before.conditionality="retain">B1</fo:block><fo:block>B2</fo:block>`,
          ),
        ),
        c,
      );
      expect(at(ls, 'B1').page).toBe(at(ls, 'Span').page);
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom + 30, 3);
    }
  });

  it('ページをまたぐ段組でも、span="all" の後ろの段の組の頭の space-before (discard) は捨てる', () => {
    for (const c of BOTH) {
      const fill = Array.from({ length: 70 }, (_, k) => `<fo:block>Row ${k + 1}</fo:block>`).join('');
      const ls = linesOf(fo(columns(`${fill}<fo:block span="all" space-after="15pt">Span</fo:block><fo:block space-before="15pt">B1</fo:block><fo:block>B2</fo:block>`)), c);
      expect(at(ls, 'B1').page).toBe(at(ls, 'Span').page);
      expect(at(ls, 'B1').y).toBeCloseTo(at(ls, 'Span').bottom, 3);
    }
  });
});

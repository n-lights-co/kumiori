/**
 * XSL-FO の axf:baseline-grid (行グリッド。アンテナハウスの拡張) を読む。受け皿は HTML の -ah-baseline-grid と同じ LBlock.baselineGrid。
 * 組み方 (行をグリッドに揃える) は、HTML と同じ所 (layoutEngine) が行う
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine } from './helpers';
import { childrenOf } from '../src/areaTree';
import type { Area, LBlock, LBlockContainer } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const fo = (flow: string) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const BOTH = ['spec', 'antenna'] as const;

describe('axf:baseline-grid を読む', () => {
  it('fo:block: new・root・none を LBlock.baselineGrid にする。normal は何もしない。読めない値は報告する', () => {
    for (const compat of BOTH) {
      const r = importXslFo(fo(['new', 'root', 'none', 'normal', 'bogus'].map((v) => `<fo:block axf:baseline-grid="${v}">a</fo:block>`).join('')), parse, { compat });
      expect((r.document.sequences[0].flow.children as LBlock[]).map((b) => b.baselineGrid)).toEqual(['new', 'root', 'none', undefined, undefined]);
      expect(r.report.unsupported).toEqual({ 'axf:baseline-grid:bogus': 1 });
    }
  });

  it('fo:block-container: new・root は、中身をその指定のブロックで包む。none は中身をそのまま (コンテナの中へ外のグリッドは届かない)', () => {
    for (const compat of BOTH) {
      const r = importXslFo(fo(['new', 'none'].map((v) => `<fo:block-container axf:baseline-grid="${v}"><fo:block>a</fo:block></fo:block-container>`).join('')), parse, { compat });
      const [a, b] = r.document.sequences[0].flow.children as LBlockContainer[];
      expect((a.children[0] as LBlock).baselineGrid).toBe('new');
      expect((b.children[0] as LBlock).baselineGrid).toBeUndefined();
      expect(r.report.unsupported).toEqual({});
    }
  });

  it('行グリッドの中の行は、見出しを挟んでも、グリッドの間隔 (line-height) の整数倍の位置に並ぶ', () => {
    const xml = fo(
      '<fo:block axf:baseline-grid="new" line-height="14pt"><fo:block>あ</fo:block><fo:block font-size="16pt" line-height="20pt" space-before="3pt" space-after="5pt">見出し</fo:block><fo:block>い</fo:block><fo:block>う</fo:block></fo:block>',
    );
    for (const compat of BOTH) {
      const tree = E.engine.layout(importXslFo(xml, parse, { compat }).document);
      const ys: Record<string, number> = {};
      const visit = (n: Area, oy: number) => {
        const y = oy + n.y;
        if (n.type === 'glyph' && 'あいう'.includes(n.text)) ys[n.text] = y;
        for (const c of childrenOf(n)) visit(c as Area, y);
      };
      visit(tree.sheets[0].page.regionBody as Area, 0);
      const steps = [(ys['い'] - ys['あ']) / 14, (ys['う'] - ys['い']) / 14];
      for (const s of steps) expect(Math.abs(s - Math.round(s))).toBeLessThan(1e-6);
      expect(steps[1]).toBeCloseTo(1, 6);
      expect(steps[0]).toBeGreaterThanOrEqual(2);
    }
  });
});

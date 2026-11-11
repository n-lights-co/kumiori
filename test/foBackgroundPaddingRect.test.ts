/**
 * XSL-FO の背景は、padding の矩形までに描く (台帳の OUT-22 の (1))。
 * XSL 1.1 §4.9.4 Border, Padding, and Background: “The background, if any, is rendered in the padding-rectangle” (罫線は
 * border-rectangle と padding-rectangle の間に描く)。§7.8.5・§7.8.6 の背景の位置の百分率も padding-rectangle の大きさが基準。
 * https://www.w3.org/TR/xsl11/ (2026-11-11 取得)。互換の指定によらない。
 * 不透明の、すき間の無い罫線 (実線と、立体の線種) は、下の背景を隠すので、border の矩形まで塗っても padding の矩形まで塗っても見た目は同じ: そのときは今までどおりに塗る
 * (背景と罫線の境にすき間を作らない)。罫線の下が見える線種 (破線・点線・二重線など) と半透明の色のときに、塗る範囲を padding の矩形にする。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import type { Area } from '../src/types';
import { makeEngine } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
type Compat = 'spec' | 'antenna';
const xml = (body: string, regions = '<fo:region-body/>', statics = '') =>
  `<?xml version="1.0"?><fo:root ${NS} font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm">${regions}</fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m">${statics}<fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const first = (body: string, compat: Compat) => importXslFo(xml(body), parse, { compat }).document.sequences[0].flow.children[0] as { backgroundClip?: string; backgroundColor?: string };
const BOTH = ['spec', 'antenna'] as const;

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});
/** 組んだ結果から、その背景の色の箱を探す */
const areaOf = (src: string, compat: Compat, color: string): Area => {
  const tree = E.engine.layout(importXslFo(src, parse, { compat }).document);
  let hit: Area | undefined;
  // Area の木のどこにあってもよい (ページ・領域・ブロックの入れ子)
  const walk = (a: unknown) => {
    if (!a || typeof a !== 'object') return;
    if ((a as { backgroundColor?: string }).backgroundColor === color && (a as { border?: unknown }).border) hit ??= a as Area;
    for (const v of Object.values(a as object)) if (v && typeof v === 'object') walk(v);
  };
  walk(tree.sheets);
  return hit!;
};

describe('XSL-FO の背景を塗る範囲 (§4.9.4。OUT-22 (1))', () => {
  it('罫線の下が見える線種 (破線・点線・二重線) の箱は、背景を padding の矩形までに塗る (どのモードでも)', () => {
    for (const c of BOTH)
      for (const style of ['dashed', 'dotted', 'double']) {
        expect(first(`<fo:block border="3pt ${style} #000000" background-color="#ff0000">x</fo:block>`, c).backgroundClip, `${c} ${style}`).toBe('padding-box');
        expect(first(`<fo:block-container border="3pt ${style} #000000" background-color="#ff0000"><fo:block>x</fo:block></fo:block-container>`, c).backgroundClip).toBe('padding-box');
        expect(first(`<fo:table border="3pt ${style} #000000" background-color="#ff0000" border-collapse="separate"><fo:table-body><fo:table-row><fo:table-cell><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>`, c).backgroundClip).toBe('padding-box');
      }
  });

  it('1 辺だけが破線でも、透明の色の実線でも、padding の矩形までに塗る', () => {
    for (const c of BOTH) {
      expect(first('<fo:block border="2pt solid #000000" border-top-style="dashed" background-color="#ff0000">x</fo:block>', c).backgroundClip).toBe('padding-box');
      expect(first('<fo:block border="2pt solid transparent" background-color="#ff0000">x</fo:block>', c).backgroundClip).toBe('padding-box');
    }
  });

  it('不透明の実線・立体の線種の罫線・罫線の無い箱は、見た目が同じなので、今までどおりに塗る (塗る範囲の指定を付けない)', () => {
    for (const c of BOTH) {
      expect(first('<fo:block border="2pt solid #000000" background-color="#ff0000">x</fo:block>', c).backgroundClip).toBeUndefined();
      expect(first('<fo:block padding="2pt" background-color="#ff0000">x</fo:block>', c).backgroundClip).toBeUndefined();
      // 立体の線種 (groove・ridge・inset・outset) も、すき間が無く不透明
      for (const st of ['groove', 'ridge', 'inset', 'outset']) expect(first(`<fo:block border="3pt ${st} #008000" background-color="#ff0000">x</fo:block>`, c).backgroundClip, st).toBeUndefined();
      // 背景の無い箱にも付けない
      expect(first('<fo:block border="2pt dashed #000000">x</fo:block>', c).backgroundClip).toBeUndefined();
    }
  });

  it('表のセル (罫線を分ける表) も同じ', () => {
    for (const c of BOTH) {
      const t = first('<fo:table border-collapse="separate"><fo:table-body><fo:table-row><fo:table-cell border="3pt double #000000" background-color="#ff0000"><fo:block>x</fo:block></fo:table-cell></fo:table-row></fo:table-body></fo:table>', c) as unknown as { body: { rows: Array<{ cells: Array<{ backgroundClip?: string }> }> } };
      expect(t.body.rows[0].cells[0].backgroundClip).toBe('padding-box');
    }
  });

  it('組んだ結果: 背景の矩形は、罫線の内側の端から内側の端まで (箱の Area に塗る範囲が付く)', () => {
    for (const c of BOTH) {
      const a = areaOf(xml('<fo:block border="3pt dotted #000000" padding="2pt" background-color="#ff0000" start-indent="5pt" end-indent="5pt">x</fo:block>'), c, '#ff0000') as Area & { backgroundClip?: string; border: { top?: { width: number } } };
      expect(a.backgroundClip).toBe('padding-box');
      expect(a.border.top?.width).toBe(3);
    }
  });

  it('互換モードの領域の罫線 (fo:region-after の点線) と背景: 背景は罫線の内側', () => {
    const r = importXslFo(xml('<fo:block>x</fo:block>', '<fo:region-body margin-bottom="15mm"/><fo:region-after extent="40pt" background-color="#efefef" border-style="dotted" border-width="medium"/>'), parse, { compat: 'antenna' });
    const bg = (r.document.sequences[0].staticContent as Array<{ layer?: string; backgroundColor?: string; backgroundClip?: string }>).find((s) => s.layer === 'behind' && s.backgroundColor === '#efefef')!;
    expect(bg.backgroundClip).toBe('padding-box');
  });
});

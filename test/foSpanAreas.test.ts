/**
 * span="all" のブロックの切り替わりで分かれる参照領域 (台帳の FO-22 の G・B)。
 * 仕様は XSL 1.1 (https://www.w3.org/TR/xsl11/ 2026-11-11 取得) で確かめた:
 *  - §6.4.14: 本文の領域 (main-reference-area) は span-reference-area の並び。span="all" のブロックは column-count が 1 の、
 *    そうでないブロックは column-count が region-body の値の span-reference-area の中の normal-flow-reference-area に入る
 *    (領域の数は「precisely enough」: 1 段の本文は、領域が 1 つで足りる)
 *  - §4.2.5: 参照領域の前後には fence があり、block-stacking constraint (余白の並び) は参照領域をまたがない
 *  - §4.3.1: 参照領域の先頭・終わりの conditional (discard) な余白は捨てる。retain の余白は残る
 *  - §7.6.1: absolute-position="absolute" の箱の top などは、最も近い祖先の参照領域から測る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine } from './helpers';
import { childrenOf } from '../src/areaTree';
import type { Area, LPageSequence } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
type Compat = 'spec' | 'antenna';
const BOTH = ['spec', 'antenna'] as const;
/** 100mm 角・余白 10mm のページ (本文 80mm 角)。cols = region-body の段の数 */
const fo = (flow: string, cols = 1) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body ${cols > 1 ? `column-count="${cols}" column-gap="10mm"` : ''}/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const layout = (xml: string, compat: Compat) => {
  const r = importXslFo(xml, parse, { compat });
  return { r, tree: E.engine.layout(r.document) };
};
/** 背景の色ごとの、最初のページの箱 (ページの中の位置。領域の木の x・y は親の箱からの位置なので、足し合わせる) */
const boxes = (xml: string, compat: Compat) => {
  const { tree } = layout(xml, compat);
  const out: Record<string, { y: number; bottom: number; x: number; height: number }> = {};
  const page = tree.sheets[0].page;
  const visit = (n: Area, ox: number, oy: number) => {
    const x = ox + n.x;
    const y = oy + n.y;
    if (n.backgroundColor && !out[n.backgroundColor]) out[n.backgroundColor] = { y, bottom: y + n.height, x, height: n.height };
    for (const c of childrenOf(n)) visit(c as Area, x, y);
  };
  visit(page.regionBody as Area, 0, 0);
  for (const a of page.absoluteAreas) visit(a as Area, 0, 0);
  return { out, top: page.regionBody.y };
};
const gap = (xml: string, compat: Compat, a: string, b: string) => {
  const { out } = boxes(xml, compat);
  return out[b].y - out[a].bottom;
};
const head = (attrs: string) => `<fo:block span="all" background-color="red" ${attrs}>見出し</fo:block>`;
const body = (attrs: string) => `<fo:block background-color="blue" ${attrs}>本文</fo:block>`;

describe('FO-22 G: span="all" のブロックの前後の余白 (§4.2.5・§4.3.1・§6.4.14)', () => {
  it('段組の本文: span の後のブロックの space-before (discard) は領域の先頭なので捨て、span のブロックの space-after (retain) だけが残る', () => {
    const xml = fo(head('space-after="10pt" space-after.conditionality="retain"') + body('space-before="12pt"'), 2);
    for (const c of BOTH) expect(gap(xml, c, 'red', 'blue')).toBeCloseTo(10, 3);
  });

  it('段組の本文: space-after も space-before も discard なら、どちらも捨てる (間は 0)', () => {
    const xml = fo(head('space-after="10pt"') + body('space-before="12pt"'), 2);
    for (const c of BOTH) expect(gap(xml, c, 'red', 'blue')).toBeCloseTo(0, 3);
  });

  it('段組の本文: 両方 retain なら、相殺せずに両方が残る (参照領域の境は余白の並びを断つ)', () => {
    const xml = fo(head('space-after="10pt" space-after.conditionality="retain"') + body('space-before="12pt" space-before.conditionality="retain"'), 2);
    for (const c of BOTH) expect(gap(xml, c, 'red', 'blue')).toBeCloseTo(22, 3);
  });

  it('段組の本文: span の前の側も同じ (前のブロックの space-after と span のブロックの space-before は、retain の分だけが残る)', () => {
    const pre = (a: string) => `<fo:block background-color="lime" ${a}>前</fo:block>`;
    for (const c of BOTH) {
      expect(gap(fo(pre('space-after="5pt"') + head('space-before="8pt"'), 2), c, 'lime', 'red')).toBeCloseTo(0, 3);
      expect(gap(fo(pre('space-after="5pt" space-after.conditionality="retain"') + head('space-before="8pt"'), 2), c, 'lime', 'red')).toBeCloseTo(5, 3);
      expect(gap(fo(pre('space-after="5pt"') + head('space-before="8pt" space-before.conditionality="retain"'), 2), c, 'lime', 'red')).toBeCloseTo(8, 3);
    }
  });

  it('段組の本文: 続く span="all" のブロックは同じ領域なので、間の余白はふつうに相殺する (大きい方)', () => {
    const xml = fo(head('space-after="20pt" space-after.conditionality="retain"') + `<fo:block span="all" background-color="lime" space-before="10pt" space-before.conditionality="retain">概要</fo:block>` + body(''), 2);
    for (const c of BOTH) expect(gap(xml, c, 'red', 'lime')).toBeCloseTo(20, 3);
  });

  it('段組の本文: 末尾の retain の余白より後ろの discard の余白は捨て、前の余白は retain のものと相殺する (§4.3.1)', () => {
    // 中のブロックの space-after 6pt (retain) と、外のブロックの space-after 9pt (discard): 終わりの 9pt は捨て、6pt が残る
    const a = fo(`<fo:block span="all" space-after="9pt"><fo:block background-color="red" space-after="6pt" space-after.conditionality="retain">見出し</fo:block></fo:block>` + body(''), 2);
    // 中 9pt (discard)・外 6pt (retain): 最後が retain なので捨てず、大きい方の 9pt
    const b = fo(`<fo:block span="all" space-after="6pt" space-after.conditionality="retain"><fo:block background-color="red" space-after="9pt">見出し</fo:block></fo:block>` + body(''), 2);
    for (const c of BOTH) {
      expect(gap(a, c, 'red', 'blue')).toBeCloseTo(6, 3);
      expect(gap(b, c, 'red', 'blue')).toBeCloseTo(9, 3);
    }
  });

  it('1 段の本文: 仕様モードは領域を分けず、相殺する (大きい方の 12pt)。互換モードは span の切り替わりで領域を分ける (10pt)', () => {
    const xml = fo(head('space-after="10pt" space-after.conditionality="retain"') + body('space-before="12pt"'));
    expect(gap(xml, 'spec', 'red', 'blue')).toBeCloseTo(12, 3);
    expect(gap(xml, 'antenna', 'red', 'blue')).toBeCloseTo(10, 3);
    expect((layout(xml, 'spec').r.document.sequences[0] as LPageSequence).spanAreas).toBeUndefined();
    expect((layout(xml, 'antenna').r.document.sequences[0] as LPageSequence).spanAreas).toBe(true);
  });

  it('1 段の本文 (互換モード): 続く span="all" どうしは相殺し、span の無い本文は今までどおり', () => {
    const two = fo(head('space-after="20pt" space-after.conditionality="retain"') + `<fo:block span="all" background-color="lime" space-before="10pt">概要</fo:block>` + body(''));
    expect(gap(two, 'antenna', 'red', 'lime')).toBeCloseTo(20, 3);
    const none = fo(`<fo:block background-color="red" space-after="10pt" space-after.conditionality="retain">a</fo:block>` + body('space-before="12pt"'));
    expect(gap(none, 'antenna', 'red', 'blue')).toBeCloseTo(12, 3);
    expect((layout(none, 'antenna').r.document.sequences[0] as LPageSequence).spanAreas).toBeUndefined();
  });
});

describe('FO-22 B: span="all" のブロックの後の絶対配置の箱の基準 (§7.6.1)', () => {
  const abs = (a: string) => `<fo:block>後<fo:block-container absolute-position="absolute" ${a} width="30mm" background-color="aqua"><fo:block>abs</fo:block></fo:block-container></fo:block>`;
  const pt = (mm: number) => (mm * 72) / 25.4;

  it('段組の本文: top は、span の後の領域の先頭から測る', () => {
    const xml = fo(head('space-after="10pt" space-after.conditionality="retain"') + abs('top="10mm" left="0mm" height="10mm"'), 2);
    for (const c of BOTH) {
      const { out } = boxes(xml, c);
      expect(out.aqua.y - (out.red.bottom + 10)).toBeCloseTo(pt(10), 3);
    }
  });

  it('1 段の本文: 互換モードは span の後の領域の先頭から、仕様モードは本文の領域の先頭から測る', () => {
    const xml = fo(head('') + abs('top="10mm" left="0mm" height="10mm"'));
    const a = boxes(xml, 'antenna');
    expect(a.out.aqua.y - a.out.red.bottom).toBeCloseTo(pt(10), 3);
    const s = boxes(xml, 'spec');
    expect(s.out.aqua.y - s.top).toBeCloseTo(pt(10), 3);
  });

  it('span の前の箱と、fixed の箱は、今までどおり (本文の領域の先頭・ページ)', () => {
    const before = fo(abs('top="10mm" left="0mm" height="10mm"') + head(''));
    const fixed = fo(head('') + abs('top="10mm" left="0mm" height="10mm"').replace('"absolute"', '"fixed"'));
    for (const c of BOTH) {
      const b = boxes(before, c);
      expect(b.out.aqua.y - b.top).toBeCloseTo(pt(10), 3);
      expect(boxes(fixed, c).out.aqua.y).toBeCloseTo(pt(10), 3);
    }
  });

  it('互換モード: top だけの箱 (下端まで伸ばす) は、span の後の領域の下端 (本文の領域の下端) で終わる', () => {
    const xml = fo(head('') + abs('top="10mm" left="0mm"'));
    const a = boxes(xml, 'antenna');
    expect(a.out.aqua.y - a.out.red.bottom).toBeCloseTo(pt(10), 3);
    expect(a.out.aqua.bottom).toBeCloseTo(a.top + pt(80), 3);
  });

  it('bottom で置く箱は、領域の下端 (本文の領域の下端) から測るので変わらない', () => {
    const xml = fo(head('') + abs('bottom="5mm" left="0mm" height="10mm"'));
    for (const c of BOTH) {
      const a = boxes(xml, c);
      expect(a.out.aqua.bottom).toBeCloseTo(a.top + pt(75), 3);
    }
  });
});

/**
 * writing-mode の、横・縦で組んだ後に軸を裏返して表す値 (XSL 1.1 §7.29.7): bt-lr・bt-rl・lr-bt・rl-bt・lr-alternating-*・lr-inverting-*・tb-lr-in-lr-pairs
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo } from '../src/xslfoImport';
import { makeEngine, walk } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const doc = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 字ごとの、ページの上の絶対位置 (左上) と、字を含む箱の向き */
const glyphs = (body: string) => {
  const r = importXslFo(doc(body), parse, { compat: 'spec' });
  const t = E.engine.layout(r.document);
  const out: Array<{ t: string; x: number; y: number; rot: number }> = [];
  const visit = (a: Area, ox: number, oy: number, rot: number) => {
    const ax = ox + (a as { x: number }).x;
    const ay = oy + (a as { y: number }).y;
    const o = (a as { orientation?: number }).orientation ?? 0;
    if (a.type === 'glyph') out.push({ t: (a as GlyphArea).text, x: ax, y: ay, rot: rot + o });
    const kids = (a as { children?: Area[]; glyphs?: Area[] }).children ?? (a as { glyphs?: Area[] }).glyphs ?? [];
    for (const c of kids) visit(c, o ? 0 : ax, o ? 0 : ay, rot + o);
  };
  visit(t.sheets[0].page.regionBody as unknown as Area, 0, 0, 0);
  return { out, miss: Object.keys(r.report.unsupported ?? {}) };
};
const at = (gs: Array<{ t: string; x: number; y: number; rot: number }>, ch: string) => gs.find((g) => g.t === ch)!;

describe('writing-mode の裏返し (S-04)', () => {
  const three = '<fo:block>一</fo:block><fo:block>二</fo:block><fo:block>三</fo:block>';
  it('lr-bt: ブロックを下から上へ積む (一が最も下)', () => {
    const { out, miss } = glyphs(`<fo:block-container writing-mode="lr-bt" height="40mm">${three}</fo:block-container>`);
    expect(miss.filter((m) => m.includes('writing-mode'))).toEqual([]);
    expect(at(out, '一').y).toBeGreaterThan(at(out, '二').y);
    expect(at(out, '二').y).toBeGreaterThan(at(out, '三').y);
    // 一は箱の下端の近く (40mm の箱)
    expect(at(out, '一').y).toBeGreaterThan(80);
  });
  it('lr-tb (既定) は上から下へ', () => {
    const { out } = glyphs(`<fo:block-container height="40mm">${three}</fo:block-container>`);
    expect(at(out, '一').y).toBeLessThan(at(out, '二').y);
  });
  it('bt-lr: 縦書きで、行の中を下から上へ (先の字ほど下)', () => {
    const { out } = glyphs('<fo:block-container writing-mode="bt-lr" height="40mm" width="40mm"><fo:block>上中下</fo:block></fo:block-container>');
    expect(at(out, '上').y).toBeGreaterThan(at(out, '中').y);
    expect(at(out, '中').y).toBeGreaterThan(at(out, '下').y);
    // tb-lr は上から下
    const tb = glyphs('<fo:block-container writing-mode="tb-lr" height="40mm" width="40mm"><fo:block>上中下</fo:block></fo:block-container>').out;
    expect(at(tb, '上').y).toBeLessThan(at(tb, '中').y);
  });
  // 1 行に 4 字入る幅で 8 字: 2 行目は「五六七八」
  const para = '<fo:block font-size="10pt">一二三四五六七八</fo:block>';
  it('lr-alternating-rl-tb: 2 行目は右から左 (五が右端)', () => {
    const { out } = glyphs(`<fo:block-container writing-mode="lr-alternating-rl-tb" width="40pt">${para}</fo:block-container>`);
    expect(at(out, '一').x).toBeLessThan(at(out, '二').x);
    expect(at(out, '五').x).toBeGreaterThan(at(out, '六').x);
    expect(at(out, '五').y).toBeGreaterThan(at(out, '一').y);
  });
  it('lr-inverting-rl-tb: 2 行目は 180 度回す (逆さの字)', () => {
    const { out } = glyphs(`<fo:block-container writing-mode="lr-inverting-rl-tb" width="40pt">${para}</fo:block-container>`);
    expect(at(out, '一').rot).toBe(0);
    expect(at(out, '五').rot).toBe(180);
  });
  it('lr-alternating-rl-bt: 行を下から上へ積み、2 行目は右から左', () => {
    const { out } = glyphs(`<fo:block-container writing-mode="lr-alternating-rl-bt" width="40pt" height="40mm">${para}</fo:block-container>`);
    expect(at(out, '五').y).toBeLessThan(at(out, '一').y);
    expect(at(out, '五').x).toBeGreaterThan(at(out, '六').x);
  });
  it('tb-lr-in-lr-pairs: 2 字ずつの縦中横を縦に積む', () => {
    const r = importXslFo(doc('<fo:block-container writing-mode="tb-lr-in-lr-pairs" height="40mm" width="40mm"><fo:block>ABCD</fo:block></fo:block-container>'), parse, { compat: 'spec' });
    const json = JSON.stringify(r.document.sequences[0].flow.children);
    expect(json).toContain('"type":"tate-chu-yoko","text":"AB"');
    expect(json).toContain('"text":"CD"');
    const t = E.engine.layout(r.document);
    let n = 0;
    walk(t.sheets[0] as unknown as Area, (a) => {
      if (a.type === 'tate-chu-yoko') n++;
    });
    expect(n).toBe(2);
  });
  it('中で書字方向を決め直したコンテナは、外の裏返しを受けない', () => {
    const { out } = glyphs(`<fo:block-container writing-mode="lr-bt" height="60mm"><fo:block>外</fo:block><fo:block-container writing-mode="lr-tb" height="20mm">${three}</fo:block-container></fo:block-container>`);
    expect(at(out, '一').y).toBeLessThan(at(out, '二').y);
    expect(at(out, '外').y).toBeGreaterThan(at(out, '一').y);
  });
  it('region-body の writing-mode="lr-bt": ページの本文を下から上へ積む', () => {
    const x = `<?xml version="1.0"?><fo:root ${NS} xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body writing-mode="lr-bt"/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${three}</fo:flow></fo:page-sequence></fo:root>`;
    const t = E.engine.layout(importXslFo(x, parse, { compat: 'spec' }).document);
    const ys: Record<string, number> = {};
    const visit = (a: Area, oy: number) => {
      const y = oy + (a as { y: number }).y;
      if (a.type === 'glyph') ys[(a as GlyphArea).text] = y;
      for (const c of (a as { children?: Area[] }).children ?? []) visit(c, y);
    };
    visit(t.sheets[0].page.regionBody as unknown as Area, 0);
    expect(ys['一']).toBeGreaterThan(ys['二']);
    expect(ys['二']).toBeGreaterThan(ys['三']);
    // 一は本文の下端の近く (本文の高さ 80mm ≒ 227pt)
    expect(ys['一']).toBeGreaterThan(200);
  });
});

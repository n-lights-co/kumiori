/**
 * 表の無名の箱と、表の字下げ (HTM-30 の (2)・(3)):
 *  - 表・inline-table・行の直下の、表の部分でない中身 (文字・ほかの要素) を、無名の行・無名のセルに包む (CSS 2.1 §17.2・§17.2.1)
 *  - 表に指定した text-indent は、セルの行に効く (継承。CSS Text 3 §8.1)。表の外の text-indent は、表の中へ入らない
 *    (HTML Standard §15.3.10 の既定のスタイル table { text-indent: initial })
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { Area } from '../src/types';
import { childrenOf } from '../src/areaTree';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const BASE = '@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 12pt } td { padding: 0 }';
const imp = (body: string, css = '') => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  const full = `${BASE} ${css}`;
  return importHtml(d, cascadeStyles(d, full, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css: full });
};
/** 字の位置 (用紙の左上から) と、ページの字の並び */
const lay = (body: string, css = '') => {
  const out = new Map<string, { x: number; y: number }>();
  let text = '';
  const rec = (a: Area, ox: number, oy: number) => {
    const g = a as unknown as { x?: number; y?: number; border?: Record<string, { width: number } | undefined>; padding?: Record<string, number> };
    const x = ox + (g.x ?? 0);
    const y = oy + (g.y ?? 0);
    if (a.type === 'glyph') {
      text += a.text;
      if (!out.has(a.text)) out.set(a.text, { x, y });
      return;
    }
    for (const c of childrenOf(a)) rec(c, x + (g.border?.left?.width ?? 0) + (g.padding?.left ?? 0), y + (g.border?.top?.width ?? 0) + (g.padding?.top ?? 0));
  };
  const r = imp(body, css);
  rec(E.engine.layout(r.document).sheets[0].page, 0, 0);
  return { at: (ch: string) => out.get(ch)!, text, report: r.report };
};
const LEFT = (10 * 72) / 25.4;

describe('HTM-30 表の直下の中身を包む無名の行・セル (CSS 2.1 §17.2.1)', () => {
  it('display: inline-table の直下の文字は、無名の行・セルに入る (行の中に並ぶ)', () => {
    const g = lay('<p>a<span style="display: inline-table">MN</span>z</p>');
    expect(g.text).toBe('aMNz');
    expect(g.at('M').x).toBeGreaterThan(g.at('a').x);
    expect(g.at('z').x).toBeGreaterThan(g.at('N').x);
    expect(g.at('z').y).toBeCloseTo(g.at('a').y, 1);
  });

  it('display: table の直下の文字・要素', () => {
    expect(lay('<div style="display: table">MN</div>').text).toBe('MN');
    expect(lay('<div style="display: table">M<b>N</b><p>P</p></div>').text).toBe('MNP');
  });

  it('文字とセルが続くときは、1 つの無名の行に、無名のセルとそのセルが並ぶ', () => {
    const g = lay('<div style="display: table">M<span style="display: table-cell">C</span>N</div>');
    expect(g.text).toBe('MCN');
    expect(g.at('C').y).toBeCloseTo(g.at('M').y, 1);
    expect(g.at('N').y).toBeCloseTo(g.at('M').y, 1);
    expect(g.at('C').x).toBeGreaterThan(g.at('M').x);
    expect(g.at('N').x).toBeGreaterThan(g.at('C').x);
  });

  it('行 (display: table-row) の直下の、セルでない中身は、無名のセルに入る', () => {
    const g = lay('<div style="display: table"><div style="display: table-row">M<span style="display: table-cell">C</span></div><div style="display: table-row">N</div></div>');
    expect(g.text).toBe('MCN');
    expect(g.at('C').y).toBeCloseTo(g.at('M').y, 1);
    expect(g.at('N').y).toBeGreaterThan(g.at('M').y + 5);
  });

  it('行・セルの間の空白だけの文字は、セルを作らない', () => {
    const a = lay('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
    const b = lay('<table>\n <tr>\n  <td>A</td>\n  <td>B</td>\n </tr>\n <tr> <td>C</td> <td>D</td> </tr>\n</table>');
    expect(b.text).toBe('ABCD');
    for (const ch of ['A', 'B', 'C', 'D']) {
      expect(b.at(ch).x).toBeCloseTo(a.at(ch).x, 3);
      expect(b.at(ch).y).toBeCloseTo(a.at(ch).y, 3);
    }
  });

  it('列グループの子は、列だけ (ほかの子は箱を作らない)', () => {
    expect(lay('<div style="display: table"><div style="display: table-column-group">X</div><div style="display: table-row"><div style="display: table-cell">A</div></div></div>').text).toBe('A');
  });
});

describe('HTM-30 表の text-indent (CSS Text 3 §8.1・HTML Standard §15.3.10)', () => {
  it('表に指定した text-indent は、セルの最初の行に効く', () => {
    const g = lay('<table style="text-indent: 20pt; border-spacing: 0"><tr><td>A</td><td><p style="margin: 0">B<br>C</p></td></tr></table>');
    expect(g.at('A').x).toBeCloseTo(LEFT + 20, 3);
    // セルの中の段落も、最初の行だけ下がる
    expect(g.at('B').x - g.at('C').x).toBeCloseTo(20, 3);
  });

  it('表の外の text-indent は、表の中へ入らない (table { text-indent: initial })', () => {
    const g = lay('<div style="text-indent: 20pt"><table style="border-spacing: 0"><tr><td>A</td></tr></table><p style="margin: 0">P</p></div>');
    expect(g.at('A').x).toBeCloseTo(LEFT, 3);
    expect(g.at('P').x).toBeCloseTo(LEFT + 20, 3);
  });

  it('text-indent: inherit を書いた表は、外の字下げを受け継ぐ', () => {
    const g = lay('<div style="text-indent: 20pt"><table style="text-indent: inherit; border-spacing: 0"><tr><td>A</td></tr></table></div>');
    expect(g.at('A').x).toBeCloseTo(LEFT + 20, 3);
  });

  it('字下げの無い表は、これまでどおり', () => {
    expect(lay('<table style="border-spacing: 0"><tr><td>A</td></tr></table>').at('A').x).toBeCloseTo(LEFT, 3);
  });
});

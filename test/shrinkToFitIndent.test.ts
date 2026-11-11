/**
 * 字下げ (text-indent) を受け継いだ、中身に合わせた幅の箱 (OUT-19):
 * text-indent は受け継がれ、inline-block・回り込み・絶対配置の箱の中の最初の行にも効く (CSS Text 3 §8.1 の Note)。
 * 字下げは行の箱の始めの端の余白として扱う (同 §8.1) ので、中身に合わせた幅 (CSS 2.1 §10.3.5・§10.3.7・§10.3.9 の shrink-to-fit) に入る
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

interface Placed {
  a: Area;
  x: number;
  y: number;
}
function areas(body: string, css = ''): Placed[] {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const styles = cascadeStyles(d, css, { viewport: { width: 600, height: 800 } });
  const out: Placed[] = [];
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    out.push({ a, x, y });
    for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
  };
  E.engine.layout(importHtml(d, styles, { css }).document).sheets.forEach((s) => rec(s.page, 0, 0));
  return out;
}
const glyphsOf = (ps: Placed[], text: string) => ps.filter((p) => p.a.type === 'glyph' && text.includes((p.a as GlyphArea).text)) as Array<Placed & { a: GlyphArea }>;
/** 罫線 (3pt の赤) の付いた箱 */
const boxOf = (ps: Placed[]) => ps.find((p) => p.a.type === 'block' && p.a.border?.left?.color === '#ff0000')!;
const P = 'font-size: 10pt; line-height: 20pt; text-indent: 20pt; margin: 0;';
const BOX = 'border: 3pt solid #ff0000;';

/** 箱の中の字 (10pt の字 4 つ) が 1 行に並び、箱の内側に収まり、字下げの分だけ箱が広い */
function expectIndentedBox(ps: Placed[]) {
  const box = boxOf(ps);
  const gs = glyphsOf(ps, '甲乙丙丁');
  expect(gs).toHaveLength(4);
  // 1 行 (折り返さない)
  expect(new Set(gs.map((g) => Math.round(g.y))).size).toBe(1);
  // 最初の字は、箱の内容の左端から字下げ (20pt) の所
  expect(gs[0].x - (box.x + 3)).toBeCloseTo(20, 1);
  // 箱の幅 = 罫線 2 本 + 字下げ + 字 4 つ。最後の字は箱の内側
  expect(box.a.width).toBeCloseTo(6 + 20 + 40, 0);
  expect(gs[3].x + 10).toBeLessThanOrEqual(box.x + box.a.width - 3 + 0.05);
}

describe('字下げを受け継いだ、中身に合わせた幅の箱 (CSS Text 3 §8.1・CSS 2.1 §10.3.9)', () => {
  it('inline-block: 幅に字下げが入り、中の行は折り返さない', () => {
    expectIndentedBox(areas(`<p style="${P}">前<span style="display: inline-block; ${BOX}">甲乙丙丁</span>後</p>`));
  });
  it('回り込み (float) の箱も同じ (§10.3.5)', () => {
    expectIndentedBox(areas(`<div style="${P}"><div style="float: left; ${BOX}">甲乙丙丁</div>横の文</div>`));
  });
  it('絶対配置の箱も同じ (§10.3.7)', () => {
    expectIndentedBox(areas(`<div style="${P} position: relative"><div style="position: absolute; left: 30pt; top: 0; ${BOX}">甲乙丙丁</div></div>`));
  });
  it('字下げの無い箱 (text-indent: 0) の幅は、中身の幅のまま', () => {
    const ps = areas(`<p style="${P}">前<span style="display: inline-block; text-indent: 0; ${BOX}">甲乙丙丁</span>後</p>`);
    expect(boxOf(ps).a.width).toBeCloseTo(6 + 40, 0);
  });
  it('2 行目以降の長い行は、字下げを足さずに比べる (最初の行だけが字下げされる)', () => {
    // 1 行目「甲」(字下げ 20 + 10 = 30pt)、2 行目「乙丙丁戊」(40pt)。箱の幅は長い方の 40pt
    const ps = areas(`<p style="${P}">前<span style="display: inline-block; ${BOX}">甲<br>乙丙丁戊</span>後</p>`);
    expect(boxOf(ps).a.width).toBeCloseTo(6 + 40, 0);
  });
});

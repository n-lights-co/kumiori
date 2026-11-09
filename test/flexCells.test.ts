/**
 * CSS の表のセルと flex の項目 (セルにして組む) の余白と幅:
 *  - セルの先頭・末尾のブロックの margin は捨てない (CSS 2.1 §17.5。XSL の参照領域とは違う)
 *  - flex の項目の幅の余りは比例の列 (N* + 固定) にして、組版時の容器の幅で分ける (読み込み時に見た幅と違う 1 ページ目など)
 *  - align-items: stretch (既定) の項目は行の高さまで伸びる (背景が行いっぱいに広がる)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { makeEngine } from './helpers';
import type { Area, LTable } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

function load(body: string, css: string) {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css });
}

type Box = { type: string; text?: string; x: number; y: number; w: number; h: number; bg?: string };
/** 面積木の箱 (絶対の位置) */
function boxes(root: Area): Box[] {
  const out: Box[] = [];
  const walk = (n: unknown, ox: number, oy: number) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c, ox, oy);
      return;
    }
    const a = n as { type?: string; x?: number; y?: number; width?: number; height?: number; text?: string; backgroundColor?: string };
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    if (a.type) out.push({ type: a.type, text: a.text, x, y, w: a.width ?? 0, h: a.height ?? 0, bg: a.backgroundColor });
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') walk(v, x, y);
  };
  walk(root, 0, 0);
  return out;
}

const PAGE = '@page { size: 400pt 400pt; margin: 0 } body { margin: 0 } p, div { font-size: 10pt; line-height: 12pt }';

describe('表のセルと flex の項目の余白', () => {
  it('<td><p> の上下の margin はセルの中に残る (ブラウザと同じ)', () => {
    const r = load('<table style="border-collapse: collapse"><tr><td style="padding: 0"><p style="margin: 20pt 0">x</p></td></tr></table>', PAGE);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const g = b.find((a) => a.type === 'glyph' && a.text === 'x')!;
    // margin 20pt + 半行間 1pt ((12 − 10) / 2)
    expect(g.y).toBeCloseTo(21, 1);
    const cell = b.find((a) => a.type === 'table-cell' || a.type === 'cell')!;
    expect(cell.h).toBeCloseTo(20 + 12 + 20, 1);
  });
  it('flex の項目の margin-top は残り、stretch の項目は行の高さまで伸びる', () => {
    const r = load(
      '<div style="display: flex; width: 300pt"><div style="margin-top: 30pt; background: #ff0000">a</div><div style="flex: 1; background: #0000ff">b<br>b<br>b</div></div>',
      PAGE,
    );
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const g = b.find((a) => a.type === 'glyph' && a.text === 'a')!;
    expect(g.y).toBeCloseTo(31, 1);
    const red = b.find((a) => a.bg === '#ff0000')!;
    const blue = b.find((a) => a.bg === '#0000ff')!;
    // 青は 3 行 (36pt)。赤は margin 30pt + 1 行 = 42pt の行の高さに、青が伸びる
    expect(blue.h).toBeCloseTo(42, 1);
    expect(red.y + red.h).toBeCloseTo(42, 1);
  });
  it('flex-grow の余りは比例の列: 読み込み時の幅 (600px) と違う容器の幅 (400pt) でも、項目が容器いっぱいに分かれる', () => {
    const r = load('<div style="display: flex"><div style="flex: 1; background: #ff0000">a</div><div style="flex: 1; background: #0000ff">b</div></div>', PAGE);
    const t = (r.document.sequences[0].flow.children[0] as { children: LTable[] }).children[0];
    expect(t.columns.map((c) => c.width)).toEqual(['1*', '1*']);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const red = b.find((a) => a.bg === '#ff0000')!;
    const blue = b.find((a) => a.bg === '#0000ff')!;
    expect([red.x, red.w, blue.x, blue.w].map((v) => Math.round(v))).toEqual([0, 200, 200, 200]);
  });
  it('justify-content: center は両側に比例の空きの列 (伸びる項目が無いとき)', () => {
    const r = load('<div style="display: flex; justify-content: center"><p style="width: 100pt; margin: 0">a</p><p style="width: 100pt; margin: 0">b</p></div>', PAGE);
    const t = (r.document.sequences[0].flow.children[0] as { children: LTable[] }).children[0];
    expect(t.columns.map((c) => (typeof c.width === 'number' ? Math.round(c.width) : c.width))).toEqual(['1*', 100, 100, '1*']);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const g = b.find((a) => a.type === 'glyph' && a.text === 'a')!;
    expect(g.x).toBeCloseTo(100, 1);
  });
});

/** 最初の flex の容器の表 (行ごとに 1 つ) */
function tables(r: ReturnType<typeof load>): LTable[] {
  return (r.document.sequences[0].flow.children[0] as { children: LTable[] }).children;
}
const at = (r: ReturnType<typeof load>, t: string) => boxes(E.engine.layout(r.document).sheets[0] as unknown as Area).find((a) => a.type === 'glyph' && a.text === t)!;

describe('flex の向き・縮め方・揃え (Flexbox 1)', () => {
  it('flex-shrink は flex-shrink × 基準の大きさの比で縮める。0 の項目は縮めない (§9.7)', () => {
    const w = (css: string) => {
      const r = load(`<div style="display: flex; width: 300pt"><p style="margin: 0; width: 200pt; ${css}">a</p><p style="margin: 0; width: 200pt; flex-shrink: 3">b</p></div>`, PAGE);
      return tables(r)[0].columns.map((c) => Math.round(c.width as number));
    };
    // はみ出し 100pt を 200 × 1 : 200 × 3 で分ける
    expect(w('')).toEqual([175, 125]);
    expect(w('flex-shrink: 0')).toEqual([200, 100]);
    // min-width で止まった分は、他の項目が受け持つ
    expect(w('flex-shrink: 0; width: 280pt; min-width: 0')).toEqual([280, 20]);
    expect(w('min-width: 190pt')).toEqual([190, 110]);
  });
  it('row-reverse の flex-start は右へ寄せ、start は左へ寄せる (§5.1・CSS Box Alignment 3 §5.1)', () => {
    const p = '<p style="margin: 0; width: 100pt">a</p><p style="margin: 0; width: 100pt">b</p>';
    const r = load(`<div style="display: flex; flex-direction: row-reverse">${p}</div>`, PAGE);
    expect([at(r, 'a').x, at(r, 'b').x].map(Math.round)).toEqual([300, 200]);
    const s = load(`<div style="display: flex; flex-direction: row-reverse; justify-content: start">${p}</div>`, PAGE);
    expect([at(s, 'a').x, at(s, 'b').x].map(Math.round)).toEqual([100, 0]);
    const e = load(`<div style="display: flex; flex-direction: row-reverse; justify-content: flex-end">${p}</div>`, PAGE);
    expect([at(e, 'a').x, at(e, 'b').x].map(Math.round)).toEqual([100, 0]);
  });
  it('column-reverse は項目を逆の順に積み、高さが決まっていれば下端に寄せる (§5.1)', () => {
    const r = load('<div style="display: flex; flex-direction: column-reverse; height: 200pt"><p style="margin: 0">a</p><p style="margin: 0">b</p></div>', PAGE);
    const a = at(r, 'a');
    const b = at(r, 'b');
    expect(b.y).toBeLessThan(a.y);
    expect(a.y).toBeGreaterThan(180);
  });
  it('wrap-reverse は行を下から上へ積む (§5.2)', () => {
    const r = load('<div style="display: flex; flex-wrap: wrap-reverse"><p style="margin: 0; width: 250pt">a</p><p style="margin: 0; width: 250pt">b</p></div>', PAGE);
    expect(at(r, 'b').y).toBeLessThan(at(r, 'a').y);
  });
  it('align-items: baseline は、項目の最初の行の基線をそろえる (§8.3)', () => {
    const r = load('<div style="display: flex; align-items: baseline"><p style="margin: 0; font-size: 30pt; line-height: 36pt">A</p><p style="margin: 0">b</p></div>', PAGE);
    expect(tables(r)[0].body!.rows[0].cells.map((c) => c.blockAlign)).toEqual(['baseline', 'baseline']);
    const A = at(r, 'A');
    const b = at(r, 'b');
    // 字の箱の下端どうしは、字の大きさに比例した深さだけずれる (基線は同じ)
    expect(b.y).toBeGreaterThan(A.y + 10);
  });
  it('交差軸の margin: auto は、align-items より先に空きを取る (§8.1)', () => {
    const r = load(
      '<div style="display: flex; align-items: flex-start"><p style="margin: 0">x<br>x<br>x</p><p style="margin: auto 0 0">e</p><p style="margin: auto 0">c</p><p style="margin: 0 0 auto">s</p></div>',
      PAGE,
    );
    expect(tables(r)[0].body!.rows[0].cells.map((c) => c.blockAlign ?? (c.stretchContent ? 'stretch' : 'start'))).toEqual(['start', 'end', 'center', 'start']);
  });
  it('高さの決まった 1 行の容器では、行の高さは容器の内側の高さ (§9.4 の 15)。stretch と margin: auto はその中で効く', () => {
    const r = load(
      '<div style="display: flex; height: 100pt"><p style="margin: 0; background: #ff0000">s</p><p style="margin: auto 0 0">e</p></div>',
      PAGE,
    );
    expect(tables(r)[0].body!.rows[0].minHeight).toBeCloseTo(100, 1);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    expect(b.find((a) => a.bg === '#ff0000')!.h).toBeCloseTo(100, 1);
    // 1 行 (12pt) が下端に付く
    expect(at(r, 'e').y).toBeGreaterThan(88);
    // align-content: center の折り返しの容器の行は伸ばさない (容器の揃えで中央に置く)
    const w = load('<div style="display: flex; flex-wrap: wrap; align-content: center; height: 100pt"><p style="margin: 0">c</p></div>', PAGE);
    expect(tables(w)[0].body!.rows[0].minHeight).toBeUndefined();
    expect(at(w, 'c').y).toBeGreaterThan(40);
  });
  it('justify-content の safe・right と、項目が 1 つの space-between (§8.2)', () => {
    const cols = (jc: string, n = 2) => tables(load(`<div style="display: flex; justify-content: ${jc}">${'<p style="margin: 0; width: 100pt">a</p>'.repeat(n)}</div>`, PAGE))[0].columns.map((c) => (typeof c.width === 'number' ? Math.round(c.width) : c.width));
    expect(cols('safe center')).toEqual(['1*', 100, 100, '1*']);
    expect(cols('right')).toEqual(['1*', 100, 100]);
    expect(cols('space-between', 1)).toEqual([100]);
  });
  it('row-gap の % は、高さの決まらない容器では 0 (CSS Box Alignment 3 §8.1)', () => {
    const t = tables(load('<div style="display: flex; flex-wrap: wrap; row-gap: 10%"><p style="margin: 0; width: 250pt">a</p><p style="margin: 0; width: 250pt">b</p></div>', PAGE));
    expect(t.length).toBe(2);
    expect(t[1].margin).toBeUndefined();
  });
});

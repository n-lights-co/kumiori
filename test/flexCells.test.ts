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

/**
 * 幅の決まったブロックの左右の余白 (CSS 2.1 §10.3.3):
 *  - 一方だけが auto なら、残りをその余白に配る
 *  - どちらも auto でなければ (制約が余る)、包含ブロックが ltr なら margin-right を、rtl なら margin-left を捨てる (rtl では右端から置く)
 * 期待の値は Chromium で測ったもの
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const PAGE = '@page { size: 400pt 400pt; margin: 0 } body { margin: 0 } p, div, td { font-size: 10pt; line-height: 12pt }';
const RED = 'background: #ff0000';

/** 赤い背景の箱の [左端, 幅] (pt。ページの左端から) */
function red(body: string): number[] {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const tree = E.engine.layout(importHtml(d, cascadeStyles(d, PAGE, { viewport: { width: 600, height: 800 } }), { css: PAGE }).document);
  let found: number[] | undefined;
  const walk = (n: unknown, ox: number) => {
    if (!n || typeof n !== 'object' || found) return;
    if (Array.isArray(n)) return n.forEach((c) => walk(c, ox));
    const a = n as { x?: number; width?: number; backgroundColor?: string };
    const x = ox + (a.x ?? 0);
    if (a.backgroundColor === '#ff0000') return void (found = [Math.round(x), Math.round(a.width ?? 0)]);
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') walk(v, x);
  };
  walk(tree.sheets[0], 0);
  return found!;
}
const ltr = (inner: string) => red(`<div style="width: 200pt">${inner}</div>`);
const rtl = (inner: string) => red(`<div style="width: 200pt; direction: rtl">${inner}</div>`);

describe('幅の決まったブロックの左右の余白 (CSS 2.1 §10.3.3)', () => {
  it('一方だけが auto の余白は、残りを取る (ltr)', () => {
    expect(ltr(`<div style="width: 100pt; margin-left: auto; ${RED}">x</div>`)).toEqual([100, 100]);
    expect(ltr(`<div style="width: 100pt; margin-right: auto; ${RED}">x</div>`)).toEqual([0, 100]);
    expect(ltr(`<div style="width: 100pt; margin: 0 auto; ${RED}">x</div>`)).toEqual([50, 100]);
    // 余白が auto でなければ、左から置く (margin-right を捨てる)
    expect(ltr(`<div style="width: 100pt; margin-left: 30pt; margin-right: 10pt; ${RED}">x</div>`)).toEqual([30, 100]);
  });
  it('rtl の包含ブロックでは、余白が auto でない箱を右端から置く (margin-left を捨てる)', () => {
    expect(rtl(`<div style="width: 100pt; ${RED}">x</div>`)).toEqual([100, 100]);
    expect(rtl(`<div style="width: 100pt; margin-right: 10pt; margin-left: 30pt; ${RED}">x</div>`)).toEqual([90, 100]);
    // max-width で幅が決まった箱・新しいブロック整形文脈の箱・高さの決まった flex の容器も同じ
    expect(rtl(`<div style="max-width: 100pt; ${RED}">x</div>`)).toEqual([100, 100]);
    expect(rtl(`<div style="width: 100pt; display: flow-root; ${RED}">x</div>`)).toEqual([100, 100]);
    expect(rtl(`<div style="width: 100pt; height: 20pt; display: flex; ${RED}"><p>x</p></div>`)).toEqual([100, 100]);
    // 入りきらない箱は、左へはみ出す
    expect(rtl(`<div style="width: 300pt; ${RED}">x</div>`)).toEqual([-100, 300]);
  });
  it('rtl でも、auto の余白は物理の左右で決まる', () => {
    expect(rtl(`<div style="width: 100pt; margin-left: auto; ${RED}">x</div>`)).toEqual([100, 100]);
    expect(rtl(`<div style="width: 100pt; margin-right: auto; ${RED}">x</div>`)).toEqual([0, 100]);
    expect(rtl(`<div style="width: 100pt; margin: 0 auto; ${RED}">x</div>`)).toEqual([50, 100]);
  });
  it('rtl の表: 幅の決まった表・中身に合わせた幅の表も右端から置く。auto の余白は物理の左右', () => {
    const cell = '<tr><td style="padding: 0; width: 60pt">x</td></tr>';
    expect(rtl(`<table style="width: 100pt; border-spacing: 0; ${RED}">${cell}</table>`)).toEqual([100, 100]);
    expect(rtl(`<table style="border-spacing: 0; ${RED}">${cell}</table>`)).toEqual([140, 60]);
    expect(rtl(`<table style="border-spacing: 0; margin-left: auto; ${RED}">${cell}</table>`)).toEqual([140, 60]);
    expect(rtl(`<table style="border-spacing: 0; margin-right: auto; ${RED}">${cell}</table>`)).toEqual([0, 60]);
  });
});

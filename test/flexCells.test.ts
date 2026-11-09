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

type Box = { type: string; text?: string; x: number; y: number; w: number; h: number; bg?: string; color?: string };
/** 面積木の箱 (絶対の位置) */
function boxes(root: Area): Box[] {
  const out: Box[] = [];
  const walk = (n: unknown, ox: number, oy: number) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c, ox, oy);
      return;
    }
    const a = n as { type?: string; x?: number; y?: number; width?: number; height?: number; text?: string; backgroundColor?: string; color?: string };
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    if (a.type) out.push({ type: a.type, text: a.text, x, y, w: a.width ?? 0, h: a.height ?? 0, bg: a.backgroundColor, color: a.color });
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
  it('align-items: last baseline は、最後の行の基線をそろえ、組を行の下端に寄せる (CSS Box Alignment 3 §4.2: 代わりの揃えは end)', () => {
    const r = load(
      '<div style="display: flex; align-items: last baseline; height: 100pt"><p style="margin: 0; font-size: 20pt; line-height: 24pt">X<br>Y</p><p style="margin: 0">a<br>z</p></div>',
      PAGE,
    );
    expect(tables(r)[0].body!.rows[0].cells.map((c) => c.blockAlign)).toEqual(['last-baseline', 'last-baseline']);
    // 字の基線 (字の領域の y + baselineY) を、絶対の位置で集める
    const base: Record<string, number> = {};
    const walk = (n: unknown, oy: number) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => walk(c, oy));
      const a = n as { type?: string; y?: number; text?: string; baselineY?: number };
      const y = oy + (a.y ?? 0);
      if (a.type === 'glyph') base[a.text!] = y + (a.baselineY ?? 0);
      for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && !['margin', 'padding', 'border'].includes(k)) walk(v, y);
    };
    walk(E.engine.layout(r.document).sheets[0], 0);
    // 最後の行 (Y・z) の基線がそろい、組は下端 (100pt) に付く。最初の行 (X・a) はそろわない
    expect(base.Y).toBeCloseTo(base.z, 1);
    expect(base.X).not.toBeCloseTo(base.a, 0);
    expect(base.Y).toBeGreaterThan(90);
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

describe('flex の order と項目 (Flexbox 1 §4・§5.4)', () => {
  /** 組んだ字の並び (左上から) */
  const order = (body: string, css = '') => {
    const r = load(body, PAGE + css);
    return boxes(E.engine.layout(r.document).sheets[0] as unknown as Area)
      .filter((a) => a.type === 'glyph' && /^[A-Z]$/.test(a.text ?? ''))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((a) => a.text)
      .join('');
  };
  it('::before・::after も項目で、order の順に並ぶ (横並び・縦並び・column-reverse)', () => {
    const css = ' .f { display: flex } .f::before { content: "B"; order: 2 } .f::after { content: "C"; order: -1 }';
    expect(order('<div class="f"><p style="margin: 0">A</p></div>', css)).toBe('CAB');
    expect(order('<div class="f" style="flex-direction: column"><p style="margin: 0">A</p></div>', css)).toBe('CAB');
    expect(order('<div class="f" style="flex-direction: column-reverse"><p style="margin: 0">A</p></div>', css)).toBe('BAC');
  });
  it('::before の背景・幅も項目の箱になる', () => {
    const r = load('<div class="f"><p style="margin: 0">A</p></div>', PAGE + ' .f { display: flex } .f::before { content: "B"; width: 50pt; background: #ff0000 }');
    const red = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area).find((a) => a.bg === '#ff0000')!;
    expect(Math.round(red.w)).toBe(50);
  });
  it('display: contents の子は項目で、order の順に並ぶ (CSS Display 3 §2.5)', () => {
    const body = '<div style="display: contents"><p style="margin: 0; order: 2">A</p><p style="margin: 0; order: 1">B</p></div><p style="margin: 0">C</p>';
    expect(order(`<div style="display: flex">${body}</div>`)).toBe('CBA');
    expect(order(`<div style="display: flex; flex-direction: column">${body}</div>`)).toBe('CBA');
  });
  it('文字と疑似要素を持つ display: contents も、中身を項目にして order の順に並べる (縦並び・横並び)', () => {
    const css = ' .c { display: contents; color: #ff0000 } .c::before { content: "B"; order: 3 }';
    const body = '<span class="c">T<p style="margin: 0; order: -1">C</p></span><p style="margin: 0; order: 1">D</p>';
    // T (無名の項目、order 0) → D (1) → B (::before、3)。C は -1 で先頭
    expect(order(`<div style="display: flex; flex-direction: column">${body}</div>`, css)).toBe('CTDB');
    expect(order(`<div style="display: flex">${body}</div>`, css)).toBe('CTDB');
    // 無名の項目の字の色は、display: contents の要素から受け継ぐ
    const r = load(`<div style="display: flex; flex-direction: column">${body}</div>`, PAGE + css);
    const t: string[] = [];
    JSON.stringify(r.document.sequences[0].flow, (_k, v) => (v && v.type === 'block' && v.color && v.children?.includes?.('T') && t.push(v.color), v));
    expect(t).toEqual(['#ff0000']);
  });
  it('整数でない order の宣言は捨てる', () => {
    expect(order('<div style="display: flex"><p style="margin: 0; order: 2.5">A</p><p style="margin: 0; order: 1">B</p></div>')).toBe('AB');
  });
});

describe('flex の容器の直下の文字 (無名の項目。Flexbox 1 §4)', () => {
  it('目次: <a> の題 (直下の文字)・リーダー (::before)・ページ番号 (::after) を order の順に並べ、リーダーを伸ばす', () => {
    const css =
      ' a { display: flex } a::before { content: ""; flex: 1; border-bottom: 1pt dotted #ff0000; order: 1 } a::after { content: "P"; order: 2 }';
    const r = load('<a href="#x">Title</a><p id="x" style="margin: 0">x</p>', PAGE + css);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const T = b.find((a) => a.type === 'glyph' && a.text === 'T')!;
    const P = b.find((a) => a.type === 'glyph' && a.text === 'P')!;
    // 題は左端、ページ番号は右端 (容器の幅 400pt)、間をリーダーが埋める
    expect(Math.round(T.x)).toBe(0);
    expect(P.x + P.w).toBeGreaterThan(395);
    expect(P.y).toBeCloseTo(T.y, 1);
  });
  it('文字の並びと子の要素は、それぞれ項目になる', () => {
    const t = tables(load('<div style="display: flex">AB <span style="order: -1">C</span> DE</div>', PAGE));
    expect(t[0].columns.length).toBe(3);
  });
});

describe('flex の項目の大きさの上限・下限 (Flexbox 1 §4.5・§9.7)', () => {
  it('min-width: auto は、中身の最も狭い幅 (長い語) より狭く縮めない。min-width: 0 なら縮める', () => {
    const cols = (mw: string) =>
      tables(load(`<div style="display: flex; width: 60pt"><p style="margin: 0; ${mw}">Wwwwwwwwwwww a</p><p style="margin: 0; ${mw}">b</p></div>`, PAGE))[0].columns.map((c) => c.width as number);
    // 語の幅 (W と w の 12 字。10pt で 60pt を超える) より狭くならない
    expect(cols('')[0]).toBeGreaterThan(60);
    expect(cols('min-width: 0')[0]).toBeLessThan(60);
  });
  it('伸ばすとき max-width で止め、残りをほかの項目で分ける。全部止まれば justify-content で空きを置く', () => {
    const r = load('<div style="display: flex"><p style="margin: 0; flex: 1; max-width: 100pt; background: #ff0000">a</p><p style="margin: 0; flex: 1; background: #0000ff">b</p></div>', PAGE);
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    expect(Math.round(b.find((a) => a.bg === '#ff0000')!.w)).toBe(100);
    expect(Math.round(b.find((a) => a.bg === '#0000ff')!.w)).toBe(300);
    const c = tables(load('<div style="display: flex; justify-content: center"><p style="margin: 0; flex: 1; max-width: 100pt">a</p></div>', PAGE))[0].columns;
    expect(c.map((x) => (typeof x.width === 'number' ? Math.round(x.width) : x.width))).toEqual(['1*', 100, '1*']);
  });
  it('和文は 1 字ずつ改行できるので、1 字の幅まで縮められる', () => {
    const c = tables(load('<div style="display: flex; width: 30pt"><p style="margin: 0">日本語の文章</p><p style="margin: 0">あいう</p></div>', PAGE))[0].columns.map((x) => x.width as number);
    expect(c[0] + c[1]).toBeLessThan(31);
  });
});

describe('右から左の flex の容器 (direction: rtl。Flexbox 1 §2.1)', () => {
  const xs = (body: string) => {
    const r = load(body, PAGE + ' .f { display: flex; direction: rtl } .f > p { margin: 0; width: 100pt }');
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    return ['A', 'B'].map((t) => Math.floor(b.find((a) => a.type === 'glyph' && a.text === t)!.x / 100));
  };
  it('主軸の始めは右: 項目は右から並ぶ。justify-content: left は左へ。左右の margin: auto は物理の向き', () => {
    // 字は箱の右端にあるので、x / 100 の整数部で箱の位置を見る (A は 300〜400、B は 200〜300)
    expect(xs('<div class="f"><p>A</p><p>B</p></div>')).toEqual([3, 2]);
    expect(xs('<div class="f" style="justify-content: left"><p>A</p><p>B</p></div>')).toEqual([1, 0]);
    // B は A の左。margin-right: auto は B の右 (A との間) の空きを取って B を左端へ押し、margin-left: auto は B の左 (行の終わり) の空きを取る
    expect(xs('<div class="f"><p>A</p><p style="margin-right: auto">B</p></div>')).toEqual([3, 0]);
    expect(xs('<div class="f"><p>A</p><p style="margin-left: auto">B</p></div>')).toEqual([3, 2]);
  });
});

describe('高さの決まった縦並びの flex の容器 (Flexbox 1 §9.7・§8.1)', () => {
  it('flex-grow の項目は、余った高さを比で分けて伸び、後ろの項目は下がる', () => {
    const r = load(
      '<div style="display: flex; flex-direction: column; height: 200pt"><p style="margin: 0">H</p><p style="margin: 0; flex-grow: 1; background: #ff0000">a</p><p style="margin: 0; flex-grow: 3; background: #0000ff">b</p><p style="margin: 0">F</p></div>',
      PAGE,
    );
    const b = boxes(E.engine.layout(r.document).sheets[0] as unknown as Area);
    const red = b.find((a) => a.bg === '#ff0000')!;
    const blue = b.find((a) => a.bg === '#0000ff')!;
    // 4 行 (各 12pt) で 48pt、余り 152pt を 1 : 3 (38pt・114pt) で分ける
    expect(red.h).toBeCloseTo(12 + 38, 1);
    expect(blue.h).toBeCloseTo(12 + 114, 1);
    const F = b.find((a) => a.type === 'glyph' && a.text === 'F')!;
    expect(F.y + F.h).toBeGreaterThan(195);
  });
  it('伸ばす項目が無ければ、主軸の margin: auto が余りを吸い取る (column-reverse でも上下の余白は物理の向き)', () => {
    const y = (dir: string, m: string) => {
      const r = load(`<div style="display: flex; flex-direction: ${dir}; height: 200pt"><p style="margin: 0">T</p><p style="margin: 0; ${m}">B</p></div>`, PAGE);
      return Math.round(boxes(E.engine.layout(r.document).sheets[0] as unknown as Area).find((a) => a.type === 'glyph' && a.text === 'B')!.y / 10);
    };
    expect(y('column', 'margin-top: auto')).toBe(19);
    // 上下の auto の余白で余り (176pt) を 2 等分: B は 12 + 88 = 100pt
    expect(y('column', 'margin: auto 0')).toBe(10);
    // column-reverse: B が上、T が下 (既定の flex-start で下端に寄る)。B の margin-bottom: auto は B と T の間を空け (B は上端)、
    // margin-top: auto は B の上を空ける (B は T の上に付く)
    expect(y('column-reverse', 'margin-bottom: auto')).toBe(0);
    expect(y('column-reverse', 'margin-top: auto')).toBe(18);
  });
});

describe('flex の残りの指定 (縦並び・伸ばし方・揃え・縦書き)', () => {
  const lay = (body: string, css = '') => boxes(E.engine.layout(load(body, PAGE + css).document).sheets[0] as unknown as Area);
  const glyph = (b: Box[], t: string) => b.find((a) => a.type === 'glyph' && a.text === t)!;
  const bgOf = (b: Box[], c: string) => b.find((a) => a.bg === c)!;
  it('縦並びの row-gap は、項目の間を空ける (CSS Box Alignment 3 §8)', () => {
    const b = lay('<div style="display: flex; flex-direction: column; row-gap: 20pt"><p style="margin: 0">A</p><p style="margin: 0">B</p></div>');
    expect(glyph(b, 'B').y - glyph(b, 'A').y).toBeCloseTo(32, 1);
  });
  it('縦並びの flex-basis は高さ。高さの決まった容器では、自動の最小の大きさ (中身) より縮めず、min-height: 0 なら縮める (§7.2・§9.7・§4.5)', () => {
    expect(bgOf(lay('<div style="display: flex; flex-direction: column; height: 100pt"><p style="margin: 0; flex-basis: 50pt; background: #ff0000">A</p></div>'), '#ff0000').h).toBeCloseTo(50, 1);
    const auto = lay('<div style="display: flex; flex-direction: column; height: 30pt"><p style="margin: 0; background: #ff0000">A<br>A<br>A</p><p style="margin: 0; background: #0000ff">B</p></div>');
    expect(bgOf(auto, '#ff0000').h).toBeCloseTo(36, 1);
    const zero = lay('<div style="display: flex; flex-direction: column; height: 60pt"><p style="margin: 0; height: 50pt; min-height: 0; background: #ff0000">A</p><p style="margin: 0; height: 50pt; min-height: 0; background: #0000ff">B</p></div>');
    expect(bgOf(zero, '#ff0000').h).toBeCloseTo(30, 1);
    expect(bgOf(zero, '#0000ff').y).toBeCloseTo(30, 1);
  });
  it('縦並びの折り返しは、高さを超える所で次の列へ。列は余った幅を等しく分けて広がる (§9.3・§9.4)', () => {
    const b = lay('<div style="display: flex; flex-direction: column; flex-wrap: wrap; height: 30pt; width: 200pt"><p style="margin: 0; background: #ff0000">A</p><p style="margin: 0">B</p><p style="margin: 0; background: #0000ff">C</p></div>');
    const A = bgOf(b, '#ff0000');
    const C = bgOf(b, '#0000ff');
    expect(C.y).toBeCloseTo(0, 1);
    expect(C.x).toBeCloseTo(100, 0);
    expect(A.w).toBeCloseTo(100, 0);
  });
  it('縦並びの align-items: center は、背景のある項目の箱を中身の幅にして寄せる (§8.3)', () => {
    const r = bgOf(lay('<div style="display: flex; flex-direction: column; align-items: center"><p style="margin: 0; background: #ff0000">A</p></div>'), '#ff0000');
    expect(r.w).toBeLessThan(20);
    expect(r.x + r.w / 2).toBeCloseTo(200, 0);
  });
  it('flex-grow の合計が 1 未満なら、余りのその割合だけ伸びる (§9.7 の 4)', () => {
    expect(bgOf(lay('<div style="display: flex"><p style="margin: 0; flex-grow: 0.5; background: #ff0000">A</p></div>'), '#ff0000').w).toBeGreaterThan(195);
    expect(bgOf(lay('<div style="display: flex"><p style="margin: 0; flex-grow: 0.5; background: #ff0000">A</p></div>'), '#ff0000').w).toBeLessThan(210);
  });
  it('stretch は、高さの決まった項目を伸ばさず、max-height で止める (§8.3)', () => {
    expect(bgOf(lay('<div style="display: flex"><p style="margin: 0; height: 20pt; background: #ff0000">A</p><p style="margin: 0">x<br>x<br>x<br>x</p></div>'), '#ff0000').h).toBeCloseTo(20, 1);
    expect(bgOf(lay('<div style="display: flex; height: 100pt"><p style="margin: 0; max-height: 30pt; background: #ff0000">A</p></div>'), '#ff0000').h).toBeCloseTo(30, 1);
  });
  it('高さの決まった折り返しの容器の align-content: stretch (既定) は、余った高さを行に等しく分ける (§8.4)', () => {
    const b = lay('<div style="display: flex; flex-wrap: wrap; height: 200pt"><p style="margin: 0; width: 300pt; background: #ff0000">A</p><p style="margin: 0; width: 300pt; background: #0000ff">B</p></div>');
    expect(bgOf(b, '#ff0000').h).toBeCloseTo(100, 1);
    expect(bgOf(b, '#0000ff').y).toBeCloseTo(100, 1);
  });
  it('flex-basis: min-content は、中身の最も狭い幅 (§7.2.3)', () => {
    const w = bgOf(lay('<div style="display: flex"><p style="margin: 0; flex-basis: min-content; background: #ff0000">aaa bbbbbb</p></div>'), '#ff0000').w;
    expect(w).toBeLessThan(45);
    expect(w).toBeGreaterThan(25);
  });
  it('縦書きの容器は、項目を上から下へ並べる (主軸が縦。§2)。和文の全角の空白も字として幅を見積もる', () => {
    const b = lay('<div style="display: flex"><span>第一章　はじめに</span><span style="flex: 1"></span><span>三</span></div>', ' html { writing-mode: vertical-rl } body { font-size: 10pt; line-height: 14pt }');
    const first = glyph(b, '第');
    const last = glyph(b, 'に');
    const page = glyph(b, '三');
    // 題は 1 行 (同じ x) に収まり、ページ番号は下の端
    expect(last.x).toBeCloseTo(first.x, 1);
    expect(page.x).toBeCloseTo(first.x, 1);
    expect(page.y).toBeGreaterThan(380);
  });
});

describe('縦書きの縦並び・折り返しの列・visibility・aspect-ratio', () => {
  const lay = (body: string, css = '') => boxes(E.engine.layout(load(body, PAGE + css).document).sheets[0] as unknown as Area);
  const glyph = (b: Box[], t: string) => b.find((a) => a.type === 'glyph' && a.text === t)!;
  const bgOf = (b: Box[], c: string) => b.find((a) => a.bg === c)!;
  const V = ' html { writing-mode: vertical-rl }';
  it('縦書きの容器の縦並び: 主軸は横 (右から左)。flex-grow で幅が伸び、row-gap は横に空ける', () => {
    const b = lay('<div style="display: flex; flex-direction: column; width: 200pt"><p style="margin: 0; background: #ff0000">一</p><p style="margin: 0; flex-grow: 1; background: #0000ff">二</p><p style="margin: 0; background: #00ff00">三</p></div>', V);
    // 容器はページの右端 (200〜400pt)。一 が右端、三 が左端、二 がその間を埋める
    expect(bgOf(b, '#ff0000').x + bgOf(b, '#ff0000').w).toBeCloseTo(400, 0);
    expect(bgOf(b, '#00ff00').x).toBeCloseTo(200, 0);
    expect(bgOf(b, '#0000ff').w).toBeGreaterThan(150);
    const g = lay('<div style="display: flex; flex-direction: column; width: 200pt; row-gap: 20pt"><p style="margin: 0">一</p><p style="margin: 0">二</p></div>', V);
    expect(glyph(g, '一').x - glyph(g, '二').x).toBeCloseTo(32, 1);
  });
  it('縦並びの折り返しの列ごとに、flex-grow で伸ばし、justify-content で寄せる', () => {
    const b = lay('<div style="display: flex; flex-direction: column; flex-wrap: wrap; height: 40pt; width: 200pt"><p style="margin: 0">A</p><p style="margin: 0; flex-grow: 1; background: #0000ff">B</p><p style="margin: 0">C</p><p style="margin: 0">D</p><p style="margin: 0">E</p></div>');
    // 1 列目 (A・B・C、36pt) の余り 4pt を B が取る
    expect(bgOf(b, '#0000ff').h).toBeCloseTo(16, 1);
    const j = lay('<div style="display: flex; flex-direction: column; flex-wrap: wrap; height: 40pt; width: 200pt; justify-content: flex-end"><p style="margin: 0">A</p><p style="margin: 0">B</p><p style="margin: 0">C</p><p style="margin: 0">D</p></div>');
    // 1 列目 (A〜C) は 4pt 下げ、2 列目 (D だけ) は 28pt 下げる
    expect(glyph(j, 'A').y).toBeCloseTo(glyph(lay('<p style="margin: 0">A</p>'), 'A').y + 4, 1);
    expect(glyph(j, 'D').y).toBeCloseTo(glyph(lay('<p style="margin: 0">D</p>'), 'D').y + 28, 1);
  });
  it('visibility: hidden は場所を残して描かない (字の色が transparent・背景なし・枠は太さを残す)。中の visible の要素は描く (CSS 2.1 §11.2)', () => {
    const b = lay('<p style="margin: 0">a<span style="visibility: hidden">HID<span style="visibility: visible">V</span></span>b</p><div style="visibility: hidden; border: 2pt solid #000000; background: #ff0000">x</div>');
    expect(glyph(b, 'H').bg ?? '').toBe('');
    const colorOf = (t: string) => {
      let col: string | undefined;
      JSON.stringify(E.engine.layout(load('<p style="margin: 0">a<span style="visibility: hidden">HID<span style="visibility: visible">V</span></span>b</p>', PAGE).document), (_k, v) => (v && v.type === 'glyph' && v.text === t && (col ??= v.color), v));
      return col;
    };
    expect(colorOf('H')).toBe('transparent');
    expect(colorOf('V')).not.toBe('transparent');
    // b は、見えない HIDV の幅の後ろに置かれる (場所は残る)
    expect(glyph(b, 'b').x).toBeGreaterThan(glyph(b, 'V').x);
    // 見えない箱は背景を描かない
    expect(b.find((a) => a.bg === '#ff0000')).toBeUndefined();
  });
  it('flex の項目の visibility: collapse は、主軸から外す (Flexbox 1 §4.4)', () => {
    const b = lay('<div style="display: flex"><p style="margin: 0; width: 50pt">A</p><p style="margin: 0; width: 50pt; visibility: collapse">B</p><p style="margin: 0; width: 50pt">C</p></div>');
    expect(b.find((a) => a.type === 'glyph' && a.text === 'B')).toBeUndefined();
    expect(glyph(b, 'C').x).toBeLessThan(60);
  });
  it('collapse の項目は、交差軸の大きさを支柱として残す (行の高さが変わらない。Flexbox 1 §4.4)', () => {
    const tall = '<p style="margin: 0">1</p><p style="margin: 0">2</p><p style="margin: 0">3</p>';
    const b = lay(`<div style="display: flex; column-gap: 10pt; background: #ff0000"><p style="margin: 0; width: 50pt">A</p><div style="width: 50pt; visibility: collapse; background: #0000ff">${tall}</div><p style="margin: 0; width: 50pt">C</p></div>`);
    // 3 行分の高さ (36pt) が残り、C は A の後ろに間の空き 1 つ分で置かれる
    expect(bgOf(b, '#ff0000').h).toBeCloseTo(36, 1);
    expect(glyph(b, 'C').x - glyph(b, 'A').x).toBeCloseTo(60, 1);
    expect(b.find((a) => a.bg === '#0000ff')).toBeUndefined();
    expect(b.find((a) => a.type === 'glyph' && a.text === '2')).toBeUndefined();
    // 中の visible の子孫も描かず、見出しのしおりも出さない (支柱は空の箱)。上下の margin も支柱の高さに入る (12 + 40pt)
    const doc = load('<div style="display: flex; background: #ff0000"><div style="visibility: collapse; margin: 20pt 0"><span style="visibility: visible">X</span><h2 style="margin: 0; font-size: 10pt">見出し</h2></div><p style="margin: 0">B</p></div>', PAGE).document;
    const tree = E.engine.layout(doc);
    const v = boxes(tree.sheets[0] as unknown as Area);
    expect(v.find((a) => a.type === 'glyph' && a.text === 'X')).toBeUndefined();
    expect(tree.bookmarks ?? []).toEqual([]);
    // 中の id は、リンクの飛び先として残る
    const withId = E.engine.layout(load('<div style="display: flex"><div style="visibility: collapse"><h2 id="sec">見出し</h2></div><p>B</p></div><p><a href="#sec">→</a></p>', PAGE).document);
    expect(withId.destinations?.sec).toBe(0);
    expect(bgOf(v, '#ff0000').h).toBeCloseTo(64, 1);
    // 折り返し: 見える項目の後ろの collapse の項目には間の空きを数えず、同じ行に残す (容器 200pt、項目 95 + 10 + 95)
    const w = lay('<div style="display: flex; flex-wrap: wrap; column-gap: 10pt; width: 200pt"><p style="margin: 0; width: 95pt">A</p><p style="margin: 0; width: 95pt">B</p><p style="margin: 0; width: 50pt; visibility: collapse">C</p><p style="margin: 0; width: 50pt">D</p></div>');
    expect(glyph(w, 'B').y).toBeCloseTo(glyph(w, 'A').y, 1);
    expect(glyph(w, 'D').y).toBeGreaterThan(glyph(w, 'A').y + 5);
    // 支柱は、畳む前に入っていた行の交差軸の大きさ (§9.4)。畳む前の C は D (高さ 100pt) と同じ 2 行目にあったので、1 行目は 100pt
    const s2 = lay('<div style="display: flex; flex-wrap: wrap; width: 200pt; background: #ff0000"><p style="margin: 0; width: 95pt">A</p><p style="margin: 0; width: 95pt">B</p><p style="margin: 0; width: 50pt; visibility: collapse">C</p><p style="margin: 0; width: 50pt; height: 100pt">D</p></div>');
    expect(bgOf(s2, '#ff0000').h).toBeCloseTo(200, 1);
    // 縦書きの容器: 支柱は交差軸 (幅) の大きさ。畳む前の行の幅は 12pt の行 3 つ分 (36pt) で、項目の主軸の大きさ (80pt) ではない
    const vs = lay(`<div style="display: flex; height: 200pt; background: #ff0000"><p style="margin: 0; height: 50pt">A</p><div style="height: 80pt; visibility: collapse">${tall}</div></div>`, V);
    expect(bgOf(vs, '#ff0000').w).toBeCloseTo(36, 1);
    // 基線の揃えで行が高くなる分も、支柱に入る (畳む前と同じ高さ)
    const bl = (v: string) => bgOf(lay(`<div style="display: flex; align-items: baseline; background: #ff0000"><p style="margin: 0; font-size: 30pt; line-height: 40pt">A</p><div style="visibility: ${v}; padding-top: 50pt">b</div></div>`), '#ff0000').h;
    expect(bl('collapse')).toBeCloseTo(bl('hidden'), 1);
    expect(bl('collapse')).toBeGreaterThan(63);
    // grid の項目の collapse は hidden と同じ (場所を残す)
    const g = lay('<div style="display: grid; grid-template-columns: 50pt 50pt 50pt"><p style="margin: 0">A</p><p style="margin: 0; visibility: collapse">B</p><p style="margin: 0">C</p></div>');
    expect(glyph(g, 'C').x - glyph(g, 'A').x).toBeCloseTo(100, 1);
  });
  it('aspect-ratio は、幅か高さの一方からもう一方を決める (CSS Sizing 4 §5.1)', () => {
    expect(bgOf(lay('<div style="width: 100pt; aspect-ratio: 2; background: #ff0000"></div>'), '#ff0000').h).toBeCloseTo(50, 1);
    // 幅も高さも決まらないブロックは、幅 (親の内容の幅 200pt) から高さを出す
    expect(bgOf(lay('<div style="width: 200pt"><div style="aspect-ratio: 4; background: #ff0000"></div></div>'), '#ff0000').h).toBeCloseTo(50, 1);
    expect(bgOf(lay('<div style="display: inline-block; height: 90pt; aspect-ratio: 16 / 9; background: #ff0000"></div>'), '#ff0000').w).toBeCloseTo(160, 1);
  });
  it('min-height・aspect-ratio の箱の最後の子の下の margin (CSS 2.1 §8.3.1。Chromium で測った値)', () => {
    /** [箱の x, 箱の幅, 箱の高さ, 次の段落の行の上端 − 箱の上端] */
    const at = (inner: string, css = '', outer = 'width: 200pt') => {
      const b = lay(`<div style="${outer}"><div style="background: #ff0000; ${css}">${inner}</div><p style="margin: 0">y</p></div>`);
      const t = bgOf(b, '#ff0000');
      const line = b.filter((a) => a.type === 'line' || a.type === 'glyph').find((a) => a.text === 'y')!;
      return [t.x, t.w, t.h, line.y - t.y].map((v) => Math.round(v));
    };
    const y0 = at('', 'height: 10pt')[3] - 10; // 行の上端から字の箱までのずれ
    const many = '<p style="margin: 0">1</p>'.repeat(4);
    // min-height が効いて伸びた箱: 子の下の margin は伸びた分に吸われ、箱の外にも出ない
    expect(at('<p style="margin: 0 0 10pt">x</p>', 'min-height: 20pt')).toEqual([0, 200, 20, 20 + y0]);
    expect(at('<p style="margin: 0 0 30pt">x</p>', 'min-height: 100pt')).toEqual([0, 200, 100, 100 + y0]);
    // min-height が効かない箱: 子の下の margin は箱の外へ畳む
    expect(at('<p style="margin: 0 0 10pt">x</p>', 'min-height: 5pt')).toEqual([0, 200, 12, 22 + y0]);
    // aspect-ratio の箱: 中身が比の高さより低くても高くても、子の下の margin は箱の外に出ない
    expect(at('<p style="margin: 0 0 10pt">x</p>', 'aspect-ratio: 10')).toEqual([0, 200, 20, 20 + y0]);
    expect(at('<p style="margin: 0">1</p><p style="margin: 0 0 10pt">x</p>', 'aspect-ratio: 10')).toEqual([0, 200, 24, 24 + y0]);
    expect(at(`${many}<p style="margin: 0 0 10pt">x</p>`, 'aspect-ratio: 10; max-height: 30pt')).toEqual([0, 200, 30, 30 + y0]);
    // min-height: 0 を指定した箱は中身で伸びない (自動の最小の大きさは min-height: auto のときだけ。CSS Sizing 4 §5.1)
    expect(at(many, 'aspect-ratio: 10; min-height: 0')).toEqual([0, 200, 20, 20 + y0]);
    // 比で移した max は min-width を下回らない
    expect(at('x', 'aspect-ratio: 1; max-height: 50pt; min-width: 80pt')).toEqual([0, 80, 50, 50 + y0]);
    // direction: rtl でも、auto の余白は物理の左右で決まる (CSS 2.1 §10.3.3)
    expect(at('', 'aspect-ratio: 2; width: 100pt; margin-right: auto', 'width: 200pt; direction: rtl').slice(0, 3)).toEqual([0, 100, 50]);
    expect(at('', 'aspect-ratio: 2; width: 100pt; margin-left: auto', 'width: 200pt; direction: rtl').slice(0, 3)).toEqual([100, 100, 50]);
  });
  it('aspect-ratio の高さは、組むときの実際の幅から出す (flex の項目の伸びた幅・border-box・中身で伸びる・切り抜く箱・縦書き)', () => {
    // flex-grow で 150pt に伸びた項目 (容器 200pt、もう一方は 50pt)
    const f = lay('<div style="display: flex; width: 200pt"><div style="width: 50pt; flex-shrink: 0"></div><div style="flex-grow: 1; aspect-ratio: 3; background: #ff0000"></div></div>');
    expect(bgOf(f, '#ff0000').w).toBeCloseTo(150, 0);
    expect(bgOf(f, '#ff0000').h).toBeCloseTo(50, 0);
    // border-box: 枠までの幅 200pt から、枠までの高さ 100pt
    expect(bgOf(lay('<div style="width: 200pt"><div style="box-sizing: border-box; padding: 10pt; aspect-ratio: 2; background: #ff0000"></div></div>'), '#ff0000').h).toBeCloseTo(100, 1);
    // 中身が比の高さより多ければ伸びる (自動の最小の大きさ)。overflow: hidden なら比の高さで切る
    const many = '<p style="margin: 0">1</p><p style="margin: 0">2</p><p style="margin: 0">3</p><p style="margin: 0">4</p>';
    expect(bgOf(lay(`<div style="width: 200pt"><div style="aspect-ratio: 10; background: #ff0000">${many}</div></div>`), '#ff0000').h).toBeCloseTo(48, 1);
    expect(bgOf(lay(`<div style="width: 200pt"><div style="aspect-ratio: 10; overflow: hidden; background: #ff0000">${many}</div></div>`), '#ff0000').h).toBeCloseTo(20, 1);
    // max-height・min-height で比の高さを抑え、幅が auto なら比で幅にも移す (Chromium と同じ)。中身が多くても max-height は超えない
    const mx = bgOf(lay('<div style="width: 200pt"><div style="aspect-ratio: 1; max-height: 50pt; background: #ff0000">x</div></div>'), '#ff0000');
    expect([mx.w, mx.h].map((x) => Math.round(x))).toEqual([50, 50]);
    expect(bgOf(lay(`<div style="width: 200pt"><div style="aspect-ratio: 10; max-height: 30pt; background: #ff0000">${many}</div></div>`), '#ff0000').h).toBeCloseTo(30, 1);
    // 中身の子の上下の margin は箱の外へ畳まれるので、中身の高さに数えない (比の高さ 20pt のまま)
    expect(bgOf(lay('<div style="width: 200pt"><div style="aspect-ratio: 10; max-height: 30pt; background: #ff0000"><p style="margin: 10pt 0">x</p></div></div>'), '#ff0000').h).toBeCloseTo(20, 1);
    // max で幅が決まったら、margin: 0 auto で中央に置く (200pt の中の 50pt の箱は 75pt から)
    expect(bgOf(lay('<div style="width: 200pt"><div style="aspect-ratio: 1; max-height: 50pt; margin: 0 auto; background: #ff0000"></div></div>'), '#ff0000').x).toBeCloseTo(75, 1);
    // float の横の新しいブロック整形文脈の箱は、縮めた幅 (200pt) から高さを出す
    const fl = bgOf(lay('<div style="width: 300pt"><div style="float: left; width: 100pt; height: 10pt"></div><div style="display: flow-root; aspect-ratio: 2; background: #ff0000"></div></div>'), '#ff0000');
    expect([fl.w, fl.h].map((x) => Math.round(x))).toEqual([200, 100]);
    // 絶対配置の箱 (幅も高さも auto) は、幅の見積もりから高さを出す
    expect(bgOf(lay('<div style="position: relative; width: 200pt; height: 200pt"><div style="position: absolute; left: 0; right: 0; aspect-ratio: 4; background: #ff0000"></div></div>'), '#ff0000').h).toBeCloseTo(50, 0);
    // 親と書字方向の違うブロック (横書きの中の縦書き): 高さ 100pt と比 2 から、幅 200pt
    expect(bgOf(lay('<div style="writing-mode: vertical-rl; height: 100pt; aspect-ratio: 2; background: #ff0000"></div>'), '#ff0000').w).toBeCloseTo(200, 1);
    // 縦書きの block の向きの上限は max-width: 幅 50pt で止め、高さも比で 100pt に移す
    const vm = bgOf(lay('<div style="height: 200pt"><div style="aspect-ratio: 1 / 2; max-width: 50pt; background: #ff0000">x</div></div>', V), '#ff0000');
    expect([vm.w, vm.h].map((x) => Math.round(x))).toEqual([50, 100]);
    // 縦書きの max-height は inline の向きの上限: 高さ 100pt で止め、幅は比で 50pt
    const vh = bgOf(lay('<div style="height: 200pt"><div style="aspect-ratio: 1 / 2; max-height: 100pt; background: #ff0000">x</div></div>', V), '#ff0000');
    expect([vh.w, vh.h].map((x) => Math.round(x))).toEqual([50, 100]);
    // 縦書き: inline の大きさ (高さ) 200pt と比 1 / 2 (幅 / 高さ) から、幅 100pt
    expect(bgOf(lay('<div style="height: 200pt"><div style="aspect-ratio: 1 / 2; background: #ff0000"></div></div>', V), '#ff0000').w).toBeCloseTo(100, 1);
  });
});

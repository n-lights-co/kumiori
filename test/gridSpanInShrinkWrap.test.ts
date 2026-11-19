/**
 * grid の列の大きさの続き:
 *  - 縮む容器 (float・inline-block・flex の項目・絶対配置・fit-content・max-content・表のセル) の中の fr の grid で、
 *    列をまたぐ項目 (grid-column: span N) の max-content も、fr の 1 つ分に数える (CSS Grid 1 §12.7.1: またぐ項目は、
 *    またぐ列の比の和で、項目の max-content からまたぐ間隔と決まった列の幅を除いたものを割る)。数えないと、grid が中身より狭くなる
 *  - 列の並びの負の数の検査は、数学の関数 (min()・max()・calc() など) の中の数に掛けない (式の値が負でなければ有効)。値が 0 の -0px は負でない
 *  - 式の負の結果を 0 に抑えるのは、いちばん外の式だけ (百分率を含む式の中の、入れ子の関数の負の値は、そのまま)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { gridTrackListInvalid } from '../src/cssText';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
type Box = { x: number; y: number; w: number; h: number };
const PAGE = '@page { size: 360pt 1000pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt }';

/** 背景の色 (#rrggbb) ごとの箱 (文書の順) */
async function boxes(body: string) {
  const html = `<!DOCTYPE html><html><head><style>${PAGE}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = new Map<string, Box[]>();
  r.areaTree.sheets.forEach((sh) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; backgroundColor?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      const key = g.backgroundColor && g.backgroundColor !== 'transparent' ? String(g.backgroundColor).toLowerCase() : undefined;
      if (key && a.type !== 'line' && a.type !== 'inline') out.set(key, [...(out.get(key) ?? []), { x, y, w: g.width ?? 0, h: g.height ?? 0 }]);
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  return out;
}
const item = (t: string, style = '') => `<div style="background:#f00;${style}">${t}</div>`;
const grid = (tpl: string, cells: string[]) => `<div style="display:grid;grid-template-columns:${tpl};gap:6px;background:#00f">${cells.join('')}</div>`;
const HEAD = 'A fairly long heading text here';

const WRAPS: Array<[string, (s: string) => string]> = [
  ['float', (s) => `<div style="float:left;background:#ff0">${s}</div>`],
  ['inline-block', (s) => `<div><div style="display:inline-block;background:#ff0">${s}</div></div>`],
  ['flex の項目', (s) => `<div style="display:flex"><div style="background:#ff0">${s}</div></div>`],
  ['絶対配置', (s) => `<div style="position:absolute;left:0;top:0;background:#ff0">${s}</div>`],
  ['fit-content', (s) => `<div style="width:fit-content;background:#ff0">${s}</div>`],
  ['max-content', (s) => `<div style="width:max-content;background:#ff0">${s}</div>`],
  ['表のセル', (s) => `<table style="border-collapse:collapse"><tr><td style="padding:0;background:#ff0">${s}</td><td style="padding:0">x</td></tr></table>`],
];

describe('縮む容器の中の grid の、列をまたぐ項目', () => {
  for (const [name, wrap] of WRAPS) {
    it(`${name}: 全部の列をまたぐ見出しは 1 行で、grid はその幅 (repeat(3, 1fr)・auto 1fr)`, async () => {
      // 見出しの max-content (114pt ほど) を 3 列の比の和で割る: 列は (114 − 間隔 2 つ) / 3。Chrome も 123pt・1 行
      const r = await boxes(wrap(grid('repeat(3, 1fr)', [item(HEAD, 'grid-column:span 3'), item('a'), item('b'), item('c')])));
      // grid の箱 (青) の幅 (表のセルは、罫線の半分などで、セルの箱が少し広い)
      const [y] = r.get('#0000ff')!;
      const [head, a, b, c] = r.get('#ff0000')!;
      expect(Math.abs(y.w - 123), 'repeat(3, 1fr)').toBeLessThan(0.5);
      expect(r1(head.w)).toBe(r1(y.w));
      expect(r1(head.h), '見出しは 1 行').toBe(12);
      expect([a, b, c].map((k) => r1(k.w))).toEqual([38, 38, 38]);
      const r2 = await boxes(wrap(grid('auto 1fr', [item(HEAD, 'grid-column:span 2'), item('a'), item('b')])));
      expect(Math.abs(r2.get('#0000ff')![0].w - 123), 'auto 1fr').toBeLessThan(0.5);
      expect(r1(r2.get('#ff0000')![0].h)).toBe(12);
    });
  }
  it('一部の列をまたぐ項目 (1fr 1fr 1fr の span 2): 2 列と間隔 1 つに収まる (Chrome は 144.3pt)', async () => {
    for (const [name, wrap] of WRAPS.slice(0, 3)) {
      const r = await boxes(wrap(grid('1fr 1fr 1fr', [item('alpha beta gamma delta', 'grid-column:span 2'), item('e'), item('f')])));
      const [y] = r.get('#ffff00')!;
      const [span, e] = r.get('#ff0000')!;
      expect(Math.abs(y.w - 144.3), name).toBeLessThan(0.5);
      expect(r1(span.h), name).toBe(12);
      expect(Math.abs(span.w - (e.w * 2 + 4.5)), name).toBeLessThan(0.2);
    }
  });
  it('最後の行の、またぐ項目 (1fr 1fr の a・b と span 2 の見出し)', async () => {
    const r = await boxes(WRAPS[0][1](grid('1fr 1fr', [item('a'), item('b'), item(HEAD, 'grid-column:span 2')])));
    expect(Math.abs(r.get('#ffff00')![0].w - 123), 'float').toBeLessThan(0.5);
    expect(r1(r.get('#ff0000')![2].h)).toBe(12);
  });
  it('決まった列をまたぐ項目 (100px 1fr の span 2): 決まった列と間隔を除いた分が 1fr', async () => {
    const r = await boxes(WRAPS[0][1](grid('100px 1fr', [item(`${HEAD} and more words`, 'grid-column:span 2'), item('a'), item('b')])));
    const [y] = r.get('#ffff00')!;
    expect(Math.abs(y.w - 190), 'Chrome と e179aa0 は 190pt').toBeLessThan(0.5);
    expect(r1(r.get('#ff0000')![0].h)).toBe(12);
  });
  it('ふつうのブロックの中 (縮まない) は、これまでどおり容器いっぱい', async () => {
    const r = await boxes(grid('repeat(3, 1fr)', [item(HEAD, 'grid-column:span 3'), item('a'), item('b'), item('c')]));
    expect(r.get('#ff0000')!.map((k) => r1(k.w))).toEqual([360, 117, 117, 117]);
  });
});

describe('列の並びの、数学の関数の中の負の数', () => {
  const ok = (s: string) => !gridTrackListInvalid(s, () => true);
  it('式の中の負の数は、宣言を無効にしない', () => {
    expect(ok('minmax(10px, max(5px, -1px))')).toBe(true);
    expect(ok('minmax(min(10px, -5px), 1fr)')).toBe(true);
    expect(ok('calc(100px - 20px) 1fr')).toBe(true);
    expect(ok('repeat(2, minmax(max(0px, -3px), 1fr))')).toBe(true);
  });
  it('列の大きさそのものが負の数なら、これまでどおり無効', () => {
    for (const bad of ['-10px 1fr', 'minmax(-5px, 1fr)', 'minmax(10px, -5px)', 'minmax( -5px , 1fr)', 'repeat(2, -1px)', 'repeat(2, minmax(0, -1px))']) expect(ok(bad), bad).toBe(false);
  });
  it('式の負の結果は 0 の大きさの列 (並びは有効のまま。2 列目も置く)', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:minmax(min(10px, -5px), 1fr) 100px;gap:0">${item('a')}${item('b')}</div>`);
    expect(r.get('#ff0000')!.map((k) => [r1(k.x), r1(k.w)])).toEqual([
      [0, 285],
      [285, 75],
    ]);
  });
  it('値が 0 の負の符号 (-0px・-0%・-0fr) は、負でない (有効)', () => {
    for (const z of ['-0px 1fr', 'minmax(-0px, 1fr) 1fr', '-0% 1fr', 'minmax(0, -0fr)', 'repeat(2, -0.0px)']) expect(ok(z), z).toBe(true);
    expect(ok('-0.5px 1fr')).toBe(false);
  });
  it('-0px・minmax(-0px, 1fr) の列を組む (0 の列と 1fr。Chrome・0.3.0 と同じ)', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:-0px 1fr;gap:0">${item('a')}${item('b')}</div>`);
    expect(r.get('#ff0000')!.map((k) => [r1(k.x), r1(k.w)])).toEqual([
      [0, 0],
      [0, 360],
    ]);
    const m = await boxes(`<div style="display:grid;grid-template-columns:minmax(-0px, 1fr) 1fr;gap:0">${item('a')}${item('b')}</div>`);
    expect(m.get('#ff0000')!.map((k) => [r1(k.x), r1(k.w)])).toEqual([
      [0, 180],
      [180, 180],
    ]);
  });
  it('百分率を含む式の中の、入れ子の関数の負の値は、そのまま (0 に抑えるのは、いちばん外の式の結果だけ)', async () => {
    // 360pt の 50% = 180pt に、-10px (-7.5pt)・+10px・-20px を足す (Chrome・0.3.0 と同じ)
    for (const [tpl, w] of [
      ['calc(50% + min(-10px, 5px)) 1fr', 172.5],
      ['calc(50% - calc(10px * -1)) 1fr', 187.5],
      ['calc(50% + max(-50px, -20px)) 1fr', 165],
    ] as const) {
      const r = await boxes(`<div style="display:grid;grid-template-columns:${tpl};gap:0">${item('a')}${item('b')}</div>`);
      expect(r.get('#ff0000')!.map((k) => [r1(k.x), r1(k.w)]), tpl).toEqual([
        [0, w],
        [w, 360 - w],
      ]);
    }
  });
  it('カスケードでも捨てない (後の宣言が勝つ)', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:100px 100px;grid-template-columns:minmax(min(10px, -5px), 1fr);gap:0">${item('a')}${item('b')}</div>`);
    expect(r.get('#ff0000')!.map((k) => [r1(k.x), r1(k.w)])).toEqual([
      [0, 360],
      [0, 360],
    ]);
  });
});

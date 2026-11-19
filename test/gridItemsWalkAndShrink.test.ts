/**
 * grid の列の大きさの続き:
 *  - 列の下限を測る項目の並び (gridTemplate の項目) を、文書の木を総なめする所 (字形の無い字の数え・id の集め・節の番号・写し) が
 *    たどらない (行の表ごとに、grid の全部の項目をたどり直さない)。柱に写した grid も、写した後の項目で下限を測る
 *  - 縮む容器 (float・flex の項目・fit-content・max-content) の中の fr の grid の max-content は、全部の行の項目で決める (CSS Grid 1 §12.7.1)
 *  - minmax(auto, 百分率) の最大の大きさでの抑え (CSS Grid 1 §6.6)・書いた min-width と決まった width は抑えない (§12.5 の最小の寄与)
 *  - とても大きい fr の係数・百分率でも、容器からはみ出さず、NaN にならない
 *  - 無効な列の並びの宣言は捨てる (前の宣言が残る。CSS 2.1 §4.2)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { documentNodes } from '../src/sourceRef';
import { gridTrackPlan, gridTracks } from '../src/gridTracks';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
type Box = { x: number; y: number; w: number };
const PAGE = '@page { size: 360pt 2000pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt }';

/** 背景の色 (#rrggbb) ごとの箱 (ページごとに、文書の順) */
async function boxes(body: string, css = '') {
  const html = `<!DOCTYPE html><html><head><style>${PAGE} ${css}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = new Map<string, Box[]>();
  r.areaTree.sheets.forEach((sh) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; backgroundColor?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      const key = g.backgroundColor && g.backgroundColor !== 'transparent' ? String(g.backgroundColor).toLowerCase() : undefined;
      if (key && a.type !== 'line' && a.type !== 'inline') out.set(key, [...(out.get(key) ?? []), { x, y, w: g.width ?? 0 }]);
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  return { out, warnings: r.warnings.map(String) };
}
const xw = (bs: Box[] | undefined) => (bs ?? []).map((b) => [r1(b.x), r1(b.w)]);
const item = (inner: string, style = '') => `<div style="background:#f00;${style}">${inner}</div>`;
const grid = (tpl: string, cells: string[], gap = '6px', style = '') => `<div style="display:grid;grid-template-columns:${tpl};gap:${gap};${style}">${cells.join('')}</div>`;

const importDoc = (body: string) => {
  const src = `<html><head><title>t</title></head><body>${body}</body></html>`;
  const d = new DOMParser().parseFromString(src, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, PAGE, { uaCss: HTML_UA_CSS, viewport: { width: 480, height: 800 } }), { css: PAGE }).document;
};

describe('項目の並びを、文書の木の総なめがたどらない', () => {
  const cells = Array.from({ length: 40 }, (_v, k) => `<div id="i${k}">項目 ${k}</div>`);
  it('性質を選ばずにたどっても、項目のセルは 1 度ずつ (行の表ごとに、全部の項目をたどり直さない)', () => {
    const doc = importDoc(grid('repeat(4, 1fr)', cells, '0'));
    const seen = new Map<object, number>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === 'object') {
        if ((v as { type?: string }).type === 'table-cell') seen.set(v, (seen.get(v) ?? 0) + 1);
        for (const x of Object.values(v)) walk(x);
      }
    };
    walk(doc);
    expect(seen.size).toBe(40);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    // 節の番号の順 (documentNodes) も、文書の順 (1 行目の表の前に、後の行の項目を並べない)
    const ids = documentNodes(doc)
      .map((n) => (n as { id?: string }).id)
      .filter((id): id is string => !!id && /^i\d+$/.test(id));
    expect(ids).toEqual(cells.map((_c, k) => `i${k}`));
  });

  it('字形の無い字の数は、項目の数のまま', async () => {
    const tofu = Array.from({ length: 40 }, (_v, k) => `<div>項目 ${k} \u{13000}</div>`);
    const { warnings } = await boxes(grid('repeat(4, 1fr)', tofu, '0'));
    expect(warnings.join('\n')).toMatch(/U\+13000 ×40\)/);
  });

  it('柱 (running()) に写した grid も、写した後の項目の中身で列の下限を測る', async () => {
    const g = grid('0fr 1fr', [item('Supercalifragilistic'), item('b'), item('<span style="background:#0f0">Header-<span>{x}</span>wide-word</span>'), item('d')]);
    const body = await boxes(`<div>${g}</div>`);
    const run = await boxes(`<div class="h">${g}</div><p>a</p>`, '.h { position: running(hd) } @page { margin-top: 100pt; @top-left { content: element(hd); vertical-align: top } }');
    expect(xw(run.out.get('#ff0000'))).toEqual(xw(body.out.get('#ff0000')));
  });
});

describe('縮む容器の中の fr の grid の max-content は、全部の行の項目で決める', () => {
  const longs = [item('Supercalifragilisticexpialidocious'), item('b b b'), item('https://example.com/docs/getting-started/installation-guide')];
  const half = [
    [0, 177.8],
    [182.3, 177.8],
    [0, 177.8],
  ];
  for (const [name, wrap] of [
    ['float', (s: string) => `<div style="float:left;background:#ff0">${s}</div>`],
    ['flex の項目', (s: string) => `<div style="display:flex"><div style="background:#ff0">${s}</div></div>`],
    ['fit-content', (s: string) => `<div style="width:fit-content;background:#ff0">${s}</div>`],
    ['max-content', (s: string) => `<div style="width:max-content;max-width:100%;background:#ff0">${s}</div>`],
  ] as const) {
    it(`${name}: 最後の行の項目の max-content が長いと、容器いっぱい (1fr 1fr は等分)`, async () => {
      expect(xw((await boxes(wrap(grid('1fr 1fr', longs)))).out.get('#ff0000')), '1fr 1fr').toEqual(half);
      expect(xw((await boxes(wrap(grid('minmax(0, 1fr) 1fr', longs)))).out.get('#ff0000')), 'minmax(0, 1fr) 1fr').toEqual(half);
    });
  }
  it('項目 a・b・c・d・長い段落の 1fr 1fr (段落だけの 3 行目)', async () => {
    const r = await boxes(`<div style="float:left;background:#ff0">${grid('1fr 1fr', ['a', 'b', 'c', 'd', 'one two three four five six seven eight nine ten eleven twelve thirteen'].map((t) => item(t)))}</div>`);
    expect(xw(r.out.get('#ffff00'))).toEqual([[0, 360]]);
    expect(xw(r.out.get('#ff0000'))[4]).toEqual([0, 177.8]);
  });
  it('3 列の 2 行目が欠けた行: 短い項目だけなら、列は項目の中身の幅 (容器を広げすぎない)', async () => {
    const r = await boxes(`<div style="float:left;background:#ff0">${grid('repeat(3, 1fr)', ['a', 'b', 'medium length text', 'd'].map((t) => item(t)))}</div>`);
    const [w] = xw(r.out.get('#ffff00'))[0].slice(1);
    // 3 列 × いちばん長い項目 (medium length text) + 間隔 2 つ (Chrome は 242.2)
    expect(Math.abs(w - 242.3)).toBeLessThan(0.5);
  });
  it('1 行だけの、欠けた行の grid: 項目の無い列も、fr の 1 つ分の幅を取る (CSS Grid 1 §12.7.1)', async () => {
    const r = await boxes(`<div style="float:left;background:#ff0">${grid('1fr 1fr', [item('abc def')])}</div>`);
    const [red] = xw(r.out.get('#ff0000'));
    const [yellow] = xw(r.out.get('#ffff00'));
    expect(r1(yellow[1])).toBeCloseTo(r1(red[1] * 2 + 4.5), 0);
  });
});

describe('minmax(auto, …) の最大の大きさでの抑え (CSS Grid 1 §6.6)', () => {
  it('minmax(auto, 10%) の列: 組むとき (幅が決まっているとき) は、百分率の最大の大きさでも抑える', async () => {
    const r = await boxes(grid('minmax(auto, 10%) 1fr', [item('Supercalifragilistic'), item('one')]));
    expect(xw(r.out.get('#ff0000'))).toEqual([
      [0, 36],
      [40.5, 319.5],
    ]);
  });
  it('中身の幅を測るとき (幅が決まらないとき) は、百分率の最大の大きさで抑えない', () => {
    const p = gridTrackPlan('minmax(auto, 10%) 1fr', 0, 0, () => 80, undefined, { indefinite: true });
    expect(p!.b[0]).toBe(80);
  });
  it('書いた min-width は抑えない (項目が隣の列に重ならない)', async () => {
    const r = await boxes(grid('minmax(auto, 80px) 1fr', [item('a', 'min-width:150px'), item('b')]));
    const [a, b] = xw(r.out.get('#ff0000'));
    expect(a).toEqual([0, 112.5]);
    expect(b[0]).toBe(117);
  });
  it('長さの width の項目も抑えない (最小の寄与は min-content の寄与 = 指定の幅: CSS Grid 1 §12.5)', async () => {
    const r = await boxes(grid('minmax(auto, 80px) 1fr', [item('a', 'width:200px'), item('b')]));
    const [a, b] = xw(r.out.get('#ff0000'));
    expect(a).toEqual([0, 150]);
    expect(b[0]).toBe(154.5);
  });
  it('中身から測る下限 (自動の最小の大きさ) は、これまでどおり抑える', () => {
    expect(gridTracks('minmax(auto, 50px) 1fr', 300, 0, () => 100)).toEqual([37.5, 262.5]);
    // 書いた下限 (minOf) は抑えない
    expect(gridTracks('minmax(auto, 50px) 1fr', 300, 0, () => 100, undefined, { minOf: (k) => (k === 0 ? 90 : 0) })).toEqual([90, 210]);
  });
});

describe('とても大きい fr の係数・百分率', () => {
  it('1e307fr 1fr の 2 列目に下限があっても、容器からはみ出さない', () => {
    const t = gridTracks('1e307fr 1fr', 360, 4.5, (k) => (k === 1 ? 20 : 0));
    expect(t.map(r1)).toEqual([335.5, 20]);
    expect(gridTracks('1e20fr 1fr', 360, 4.5, (k) => (k === 1 ? 20 : 0)).map(r1)).toEqual([335.5, 20]);
    expect(gridTracks('1e400fr 1fr', 360, 4.5, (k) => (k === 1 ? 20 : 0)).map(r1)).toEqual([335.5, 20]);
    for (const tpl of ['1e307fr 1e-307fr 1fr', '1e308fr 1e308fr 1fr', '1fr 1e300fr 1e-300fr']) {
      const u = gridTracks(tpl, 300, 10, () => 15);
      expect(u.every((x) => Number.isFinite(x) && x >= 15), `${tpl} ${u}`).toBe(true);
      expect(u.reduce((a, b) => a + b, 0) + 10 * (u.length - 1)).toBeCloseTo(300, 5);
    }
  });
  it('1e400% の列は、大きい有限の幅 (0 でも Infinity でもない)', async () => {
    const t = gridTracks('1e400% 1fr', 360, 4.5, (k) => (k === 1 ? 20 : 0));
    expect(Number.isFinite(t[0]) && t[0] > 360).toBe(true);
    expect(t[1]).toBe(20);
    const r = await boxes(grid('1e400% 1fr', [item('Supercalifragilistic'), item('one')]));
    const [a] = xw(r.out.get('#ff0000'));
    expect(Number.isFinite(a[1]) && a[1] > 360).toBe(true);
  });
});

describe('無効な列の並びの宣言', () => {
  it('minmax(1fr, 2fr) などの宣言は捨てる (前の宣言が残る)', async () => {
    for (const bad of ['minmax(1fr, 2fr)', 'repeat(2, repeat(2, 1fr))', '-10px 1fr', '1fr repeat(auto-fill, 50px)']) {
      const r = await boxes(`<div style="display:grid;grid-template-columns:100px 100px;grid-template-columns:${bad};gap:0">${item('a')}${item('b')}</div>`);
      expect(xw(r.out.get('#ff0000')), bad).toEqual([
        [0, 75],
        [75, 75],
      ]);
    }
  });
  it('相対の長さの auto-fill は有効のまま', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:100px;grid-template-columns:repeat(auto-fill, 10em);gap:0">${item('a')}${item('b')}</div>`);
    expect(xw(r.out.get('#ff0000'))).toEqual([
      [0, 100],
      [100, 100],
    ]);
  });
});

/**
 * よく使われる書き方の組み:
 *  - grid の repeat(auto-fill | auto-fit, minmax(…, 1fr)) の列 (CSS Grid 1 §7.2.3.2): 回数を容器の幅の見積もりで 1 度決め、列は容器の幅を分ける。
 *    minmax() の引数の中の min()・max()・clamp() (CSS Values 4 §10.6) も読む。最大が長さの minmax() は、その幅より広げない (§12.6)
 *  - 画像そのものが flex の項目のとき、百分率の width・max-width・flex-basis の基準は flex の容器 (Flexbox 1 §9.2・CSS 2.1 §10.2)。
 *    項目の自動の最小の大きさ (§4.5) で、flex-basis の幅を下から抑える
 *  - 大きさを em などで書いた SVG の本来の比 (CSS Images 3 §5)
 *  - 右から左 (rtl) の中の auto の余白の箱が、幅の違うページへまたぐときの寄せ (CSS 2.1 §10.3.3・CSS Fragmentation 3 §5.1)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { headerSize } from '../src/assets';
import { gridTracks } from '../src/htmlImport';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
type Box = { page: number; x: number; y: number; w: number; h: number };

/** 背景の色 (#rrggbb) ごとの箱と、画像の箱 ('img')。本文の幅は 400pt (余白 0) */
async function boxes(body: string, css = '') {
  const html = `<!DOCTYPE html><html><head><style>@page { size: 400pt 600pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = new Map<string, Box[]>();
  r.areaTree.sheets.forEach((sh, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; backgroundColor?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      const key = a.type === 'image' ? 'img' : g.backgroundColor && g.backgroundColor !== 'transparent' ? String(g.backgroundColor).toLowerCase() : undefined;
      if (key) out.set(key, [...(out.get(key) ?? []), { page, x: r1(x), y: r1(y), w: r1(g.width ?? 0), h: r1(g.height ?? 0) }]);
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  return out;
}

/** grid の項目 (赤の箱 n 個) の 1 行目の [x, 幅] */
async function firstRow(tpl: string, n = 8, wrap = (g: string) => g) {
  const out = await boxes(wrap(`<div style="display:grid;grid-template-columns:${tpl}">${'<div style="background:#f00">a</div>'.repeat(n)}</div>`));
  const reds = out.get('#ff0000')!;
  return reds.filter((b) => b.y === reds[0].y).map((b) => [b.x, b.w]);
}
const cols = (w: number, n: number, x0 = 0) => Array.from({ length: n }, (_, k) => [r1(x0 + w * k), r1(w)]);

describe('grid の repeat(auto-fill | auto-fit, …)', () => {
  it('repeat(auto-fill, minmax(100px, 1fr)): 75pt の列が 5 つ入り、列は 80pt ずつ (幅 0 の列にならない)', async () => {
    expect(await firstRow('repeat(auto-fill, minmax(100px, 1fr))')).toEqual(cols(80, 5));
    // 空白の無い書き方も同じ
    expect(await firstRow('repeat(auto-fill,minmax(100px,1fr))')).toEqual(cols(80, 5));
    // 間隔 (gap) のある並び: (400 + 10) / (75 + 10) = 4 列、列は (400 − 30) / 4
    const gap = await boxes(`<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));gap:10pt">${'<div style="background:#f00">a</div>'.repeat(8)}</div>`);
    expect(gap.get('#ff0000')!.slice(0, 4).map((b) => [b.x, b.w])).toEqual([0, 1, 2, 3].map((k) => [r1(k * 102.5), 92.5]));
  });

  it('repeat(auto-fit, minmax(120px, 1fr)) は auto-fill と同じに数える (90pt の列が 4 つ、100pt ずつ)', async () => {
    expect(await firstRow('repeat(auto-fit, minmax(120px, 1fr))')).toEqual(cols(100, 4));
    // 幅 360pt の容器: 90pt の列が 4 つ (前は、容器の幅で回数が変わる比の求め方で、列の幅が 0 になっていた)
    const w360 = (g: string) => `<div style="width:360pt">${g}</div>`;
    expect(await firstRow('repeat(auto-fit, minmax(120px, 1fr))', 8, w360)).toEqual(cols(90, 4));
    expect(await firstRow('repeat(auto-fill, minmax(100px, 1fr))', 8, w360)).toEqual(cols(90, 4));
  });

  it('決まった列と並べた auto-fill: 100px repeat(auto-fill, minmax(100px, 1fr))', async () => {
    // 75pt の列の残り 325pt に、75pt の列が 4 つ (81.25pt ずつ)
    const row = await firstRow('100px repeat(auto-fill, minmax(100px, 1fr))');
    const want = [[0, 75], ...[0, 1, 2, 3].map((k) => [75 + 81.25 * k, 81.25])];
    expect(row).toHaveLength(5);
    // 幅 360pt の容器: 75pt の残り 285pt に 3 つ (95pt ずつ)
    expect(await firstRow('100px repeat(auto-fill, minmax(100px, 1fr))', 8, (g) => `<div style="width:360pt">${g}</div>`)).toEqual([[0, 75], ...cols(95, 3, 75)]);
    row.forEach(([x, w], k) => {
      expect(x).toBeCloseTo(want[k][0], 0);
      expect(w).toBeCloseTo(want[k][1], 0);
    });
  });

  it('minmax() の引数の min()・max()・clamp() を、括弧の外のカンマで分けて読む', async () => {
    // min(100%, 200px) = 150pt → 2 列 (200pt ずつ)。100pt の容器の中では 100pt → 1 列
    expect(await firstRow('repeat(auto-fill, minmax(min(100%, 200px), 1fr))')).toEqual(cols(200, 2));
    expect(await firstRow('repeat(auto-fill, minmax(min(100%, 200px), 1fr))', 3, (g) => `<div style="width:100pt">${g}</div>`)).toEqual(cols(100, 1));
    // max(100px, 20%) = 80pt → 5 列。clamp(100px, 20%, 200px) も 80pt
    expect(await firstRow('repeat(auto-fill, minmax(max(100px, 20%), 1fr))')).toEqual(cols(80, 5));
    expect(await firstRow('repeat(auto-fill, minmax(clamp(100px, 20%, 200px), 1fr))')).toEqual(cols(80, 5));
    expect(gridTracks('repeat(auto-fill, minmax(min(150px, 100%), 1fr))', 400, 0)).toHaveLength(3);
  });

  it('最大が長さの minmax() は、その幅より広げず、残りをほかの列で分ける', async () => {
    expect(await firstRow('minmax(100px, 200px) 1fr', 2)).toEqual([[0, 150], [150, 250]]);
    expect(await firstRow('repeat(auto-fill, minmax(auto, 100px))')).toEqual(cols(75, 5));
    expect(gridTracks('minmax(100px, 200px) minmax(100px, 200px)', 400, 0)).toEqual([150, 150]);
  });
});

describe('画像そのものが flex の項目のときの百分率', () => {
  const I = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect width='300' height='200' fill='red'/%3E%3C/svg%3E"; // 225pt × 150pt
  const img = (st: string) => `<img src="${I}" style="${st}">`;
  const imgs = async (body: string) => (await boxes(body)).get('img')!.map((b) => [b.x, b.w, b.h]);

  it('画像と文を並べた flex: width: 30% は容器 (400pt) の 30%', async () => {
    expect(await imgs(`<div style="display:flex;gap:10pt">${img('width:30%')}<p>Some description text that goes alongside the picture.</p></div>`)).toEqual([[0, 120, 80]]);
  });

  it('width・max-width・calc() の百分率、折り返し・縦並びの flex でも、容器が基準', async () => {
    expect(await imgs(`<div style="display:flex;width:200pt">${img('width:50%')}${img('width:50%')}</div>`)).toEqual([
      [0, 100, 66.7],
      [100, 100, 66.7],
    ]);
    expect(await imgs(`<div style="display:flex;width:200pt">${img('max-width:40%')}<p>x</p></div>`)).toEqual([[0, 80, 53.3]]);
    expect(await imgs(`<div style="display:flex;width:200pt">${img('max-width:calc(50% - 10pt)')}<p>x</p></div>`)).toEqual([[0, 90, 60]]);
    expect((await imgs(`<div style="display:flex;flex-wrap:wrap">${img('width:50%')}${img('width:50%')}</div>`)).map((b) => b[1])).toEqual([200, 200]);
    expect(await imgs(`<div style="display:flex;flex-direction:column">${img('width:50%')}</div>`)).toEqual([[0, 200, 133.3]]);
  });

  it('flex: 0 0 30% の画像は、本来の幅 (225pt) より狭くしない (自動の最小の大きさ)。min-width: 0 なら 30%', async () => {
    expect(await imgs(`<div style="display:flex">${img('flex:0 0 30%')}<p>Some description text that goes alongside.</p></div>`)).toEqual([[0, 225, 150]]);
    expect(await imgs(`<div style="display:flex">${img('flex:0 0 30%;min-width:0')}<p>Some description text that goes alongside.</p></div>`)).toEqual([[0, 120, 80]]);
  });

  it('grid の項目の画像の百分率は、grid の領域 (列) が基準のまま', async () => {
    expect(await imgs(`<div style="display:grid;grid-template-columns:1fr 1fr">${img('width:50%')}<div>t</div></div>`)).toEqual([[0, 100, 66.7]]);
  });
});

describe('大きさを em などで書いた SVG の本来の比', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('width="10em" height="5em" (viewBox 無し) は 160×80px (1em = 16px)。<svg が頭の 4096 バイトより後でも読む', () => {
    expect(headerSize(enc(`<svg xmlns="http://www.w3.org/2000/svg" width="10em" height="5em"/>`), 'image/svg+xml')).toEqual({ width: 160, height: 80 });
    expect(headerSize(enc(`<?xml version="1.0"?><!--${'x'.repeat(5000)}--><svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"/>`), 'image/svg+xml')).toEqual({ width: 200, height: 50 });
    // 大きさも viewBox も無ければ、本来の比は無い
    expect(headerSize(enc(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 'image/svg+xml')).toEqual({ width: 300, height: 150, noRatio: true });
  });

  it('属性 width=600 height=100 と height: auto の画像は、SVG の本来の比 (2:1) で組む', async () => {
    const svg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="10em" height="5em"><rect width="100%" height="100%" fill="red"/></svg>`)}`;
    const out = await boxes(`<img src="${svg}" width="600" height="100" style="height:auto">`);
    expect(out.get('img')!.map((b) => [b.w, b.h])).toEqual([[400, 200]]);
  });
});

describe('rtl の中の auto の余白の箱が、幅の違うページへまたぐ', () => {
  const lines = Array.from({ length: 40 }, (_, k) => `<p>line ${k}</p>`).join('');
  const reds = async (css: string) => {
    const html = `<!DOCTYPE html><html><head><style>@page { size: 400pt 300pt; margin: 0 } ${css} body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 }</style></head><body><div dir="rtl"><div style="width:320pt;margin:0 auto;background:#f00">${lines}</div></div></body></html>`;
    const r = await typesetHtml(html, { loadFont: loadCachedFont });
    return r.areaTree.sheets.map((sh) => {
      let x: number | undefined;
      const rec = (a: AreaNode, ox: number) => {
        const g = a as unknown as { x?: number; backgroundColor?: string };
        const ax = ox + (g.x ?? 0);
        if (x === undefined && g.backgroundColor === '#ff0000') x = r1(ax);
        for (const c of childrenOf(a)) rec(c, ax);
      };
      rec(sh.page as unknown as AreaNode, 0);
      return x;
    });
  };
  it('最初のページではみ出す (右に揃える) 箱は、広い次のページで中央に寄せる', async () => {
    // 1 ページ目: 本文 100〜400pt (幅 300pt) に 320pt の箱 → 右に揃えて 80。2 ページ目: 幅 400pt → 中央の 40
    expect(await reds('@page :first { margin-left: 100pt }')).toEqual([80, 40]);
  });
  it('最初のページで収まり、狭い次のページではみ出す箱は、右に揃える', async () => {
    expect(await reds('@page { margin-left: 100pt } @page :first { margin-left: 0 }')).toEqual([40, 80]);
  });
});

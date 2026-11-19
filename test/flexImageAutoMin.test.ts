/**
 * 画像そのものの flex の項目の、自動の最小の大きさ (min-width: auto。CSS Flexbox 1 §4.5: 指定の幅か本来の幅を、決まった max-width で抑えたもの):
 *  - 伸びる項目 (flex: 1 の basis 0 など) も、余りを分けた幅が自動の最小の大きさより狭ければ、そこで止める (§9.7 の凍結)
 *  - 長さの max-width で抑える (読み込みで画像本来の大きさが分からない画像も)
 * と、行内の要素として組む inline-flex の容器の中の画像の百分率は、容器の幅が基準 (Flexbox 1 §9.2・CSS 2.1 §10.1)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
// 300×200px の SVG (225pt × 150pt)
const I = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect width='300' height='200' fill='red'/%3E%3C/svg%3E";
const img = (st: string) => `<img src="${I}" style="${st}">`;
const P = '<p style="background:#00f">Some description text alongside the picture that wraps.</p>';

/** 本文の幅 360pt で組んだ、画像と青の箱の [x, 幅, 高さ] */
async function boxes(body: string): Promise<{ img: number[][]; blue: number[][] }> {
  const html = `<!DOCTYPE html><html><head><style>@page { size: 360pt 600pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 }</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = { img: [] as number[][], blue: [] as number[][] };
  r.areaTree.sheets.forEach((sh) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; backgroundColor?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      if (a.type === 'image') out.img.push([r1(x), r1(g.width ?? 0), r1(g.height ?? 0)]);
      else if (g.backgroundColor && /^#0000ff$/i.test(String(g.backgroundColor))) out.blue.push([r1(x), r1(g.width ?? 0)]);
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  return out;
}

describe('画像そのものの flex の項目の自動の最小の大きさ', () => {
  it('flex: 1 の画像と文: 画像は本来の幅 (225pt) で止め、文を縮める', async () => {
    for (const st of ['flex:1', 'flex:1 1 0', 'flex:1 1 30%']) {
      const r = await boxes(`<div style="display:flex;gap:10px">${img(st)}${P}</div>`);
      expect(r.img, st).toEqual([[0, 225, 150]]);
      expect(r.blue, st).toEqual([[232.5, 127.5]]);
    }
  });
  it('百分率の max-width で抑えた幅 (max-width: 50% は 180pt) で止める', async () => {
    const r = await boxes(`<div style="display:flex;gap:10px">${img('max-width:50%;flex:1')}${P}</div>`);
    expect(r.img).toEqual([[0, 180, 120]]);
    expect(r.blue).toEqual([[187.5, 172.5]]);
  });
  it('余りが自動の最小の大きさより広ければ、これまでどおり余りを分ける', async () => {
    const r = await boxes(`<div style="display:flex;width:360pt">${img('flex:1;max-width:100%')}<p style="background:#00f;width:50pt">x</p></div>`);
    expect(r.img).toEqual([[0, 310, 206.7]]);
    // 本来の幅の違う 2 つの画像 (75pt と 150pt) の flex: 1 は、等しく分ける (どちらも最小の大きさより広い)
    const S = (w: number) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${w}'%3E%3C/svg%3E`;
    const r2 = await boxes(`<div style="display:flex">${`<img src="${S(100)}" style="flex:1">`}${`<img src="${S(200)}" style="flex:1">`}</div>`);
    expect(r2.img.map((b) => b[1])).toEqual([180, 180]);
  });
  it('長さの max-width で抑える (flex: 0 0 30%; max-width: 50px は 37.5pt。隣の文に重ならない)', async () => {
    const r = await boxes(`<div style="display:flex;gap:10px">${img('flex:0 0 30%;max-width:50px')}${P}</div>`);
    expect(r.img).toEqual([[0, 37.5, 25]]);
    expect(r.blue[0][0]).toBe(45);
  });
});

describe('行内の要素として組む inline-flex・inline-grid の中の画像の百分率', () => {
  it('容器の幅 (200pt) が基準', async () => {
    expect((await boxes(`<div style="display:inline-flex;width:200pt">${img('width:50%')}</div>`)).img).toEqual([[0, 100, 66.7]]);
    expect((await boxes(`<div style="display:inline-grid;width:200pt">${img('width:50%')}</div>`)).img).toEqual([[0, 100, 66.7]]);
    expect((await boxes(`<div style="display:inline-flex;width:200pt"><span>${img('width:50%')}</span></div>`)).img).toEqual([[0, 100, 66.7]]);
  });
});

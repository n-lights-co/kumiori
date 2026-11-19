/**
 * 百分率を組むときに解く仕組みの端の場合:
 *  - flex の項目が画像そのもののとき、自動の最小の大きさ (min-width: auto。CSS Flexbox 1 §4.5) は、画像の指定の幅か本来の幅
 *    (max-width の百分率は flex の容器の幅で解いて抑える)。中身の最も狭い幅の寄与 (CSS Sizing 3 §5.2.2 の、縮められる置換要素の 0) ではない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
/** w×h px の赤い SVG (pt では 0.75 倍) */
const svg = (w: number, h: number) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='${w}' height='${h}' fill='red'/%3E%3C/svg%3E`;

type Box = { page: number; x: number; y: number; w: number; h: number };

/** 背景の色 (#rrggbb) ごとの箱と、画像の箱 ('img') */
function boxesOf(r: Awaited<ReturnType<typeof typesetHtml>>) {
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
async function boxes(body: string, css = '') {
  const html = `<!DOCTYPE html><html><head><style>@page { size: 400pt 600pt; margin: 20pt } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } td { padding: 0 } table { border-spacing: 0 } ${css}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = boxesOf(r);
  return { out, pages: r.areaTree.sheets.length, img: (k = 0) => out.get('img')?.[k], color: (c: string, k = 0) => out.get(c)?.[k] };
}
const xw = (b: Box | undefined) => (b ? [b.x, b.w] : undefined);

describe('flex の項目の画像の自動の最小の大きさ', () => {
  it('本文の flex に、本来の幅の画像 2 つ (入りきらなくても、本来の幅より狭く縮めない)', async () => {
    const r = await boxes(`<div style="display:flex"><img src="${svg(300, 60)}"><img src="${svg(300, 60)}"></div>`);
    expect([xw(r.img(0)), xw(r.img(1))]).toEqual([[20, 225], [245, 225]]);
  });
  it('幅の指定のある画像は、指定の幅が下限 (容器の幅の決まった flex・grid の列・float の中)', async () => {
    for (const html of [
      `<div style="display:flex;width:100pt"><img src="${svg(100, 20)}" style="width:75pt"><img src="${svg(100, 20)}" style="width:75pt"></div>`,
      `<div style="display:grid;grid-template-columns:100pt"><div style="display:flex"><img src="${svg(100, 20)}"><img src="${svg(100, 20)}"></div></div>`,
      `<div style="float:left;width:100pt"><div style="display:flex"><img src="${svg(100, 20)}"><img src="${svg(100, 20)}"></div></div>`,
    ]) {
      const r = await boxes(html);
      expect([xw(r.img(0)), xw(r.img(1))], html).toEqual([[20, 75], [95, 75]]);
    }
  });
  it('画像と文の項目: 文の項目だけが縮む', async () => {
    const r = await boxes(`<div style="display:flex;width:200pt"><img src="${svg(200, 40)}"><div style="background:#00ff00">caption text here and more</div></div>`);
    expect(xw(r.img())).toEqual([20, 150]);
    expect(xw(r.color('#00ff00'))).toEqual([170, 50]);
  });
  it('max-width: 100% の画像の下限は、容器の幅で抑えた本来の幅', async () => {
    const r = await boxes(`<div style="display:flex"><img src="${svg(600, 60)}"><p style="background:#00ff00">text</p></div>`);
    expect(xw(r.img())).toEqual([20, 360]);
  });
  it('仕様どおりに縮むもの (min-width: 0・overflow: hidden の項目・ブロックに包んだ max-width: 100% の画像) は縮む', async () => {
    for (const html of [
      `<div style="display:flex;width:100pt"><img src="${svg(100, 20)}" style="min-width:0"><img src="${svg(100, 20)}" style="min-width:0"></div>`,
      `<div style="display:flex;width:100pt"><div style="overflow:hidden"><img src="${svg(100, 20)}"></div><div style="overflow:hidden"><img src="${svg(100, 20)}"></div></div>`,
      `<div style="display:flex;width:100pt"><div><img src="${svg(100, 20)}"></div><div><img src="${svg(100, 20)}"></div></div>`,
    ]) {
      const r = await boxes(html);
      expect([xw(r.img(0)), xw(r.img(1))], html).toEqual([[20, 50], [70, 50]]);
    }
  });
});

describe('幅の見積もりと違う所の flex-wrap: wrap の容器', () => {
  // 行に分けるのは読み込みのとき (見積もりの幅) なので、組むときに容器が狭くても、項目を縮めて 1 行に詰めない (Flexbox 1 §9.3: 折り返す容器の項目は、
  // 行に分けた後で、その行の中でだけ伸び縮みする)。折り返しは見積もりの幅のまま
  it('grid の 100pt の列・段の中の、80pt の項目 2 つは、縮めない', async () => {
    for (const html of [
      `<div style="display:grid;grid-template-columns:100pt 1fr"><div style="display:flex;flex-wrap:wrap"><div style="width:80pt;background:#ff0000">a</div><div style="width:80pt;background:#00ff00">b</div></div><div></div></div>`,
      `<div style="columns:4;column-gap:0"><div style="display:flex;flex-wrap:wrap"><div style="width:80pt;background:#ff0000">a</div><div style="width:80pt;background:#00ff00">b</div></div></div>`,
    ]) {
      const r = await boxes(html);
      expect([r.color('#ff0000')?.w, r.color('#00ff00')?.w], html).toEqual([80, 80]);
    }
  });
  it('nowrap の容器は、組むときの容器の幅に縮める', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:100pt 1fr"><div style="display:flex"><div style="width:80pt;background:#ff0000">a</div><div style="width:80pt;background:#00ff00">b</div></div><div></div></div>`);
    expect([r.color('#ff0000')?.w, r.color('#00ff00')?.w]).toEqual([50, 50]);
  });
});

describe('幅の違うページへまたぐ箱の auto の余白', () => {
  // 1 ページ目の領域は 300pt (左 80pt)、2 ページ目からは 360pt (左 20pt)。auto の余白は、置くページの包含ブロックの幅で配り直す (CSS 2.1 §10.3.3)
  const PAGES = '@page { size: 400pt 400pt; margin: 20pt } @page :first { margin-left: 80pt }';
  const long = Array.from({ length: 60 }, (_, i) => `<p>${i} あいうえおかきくけこさしすせそ</p>`).join('');
  const page2 = async (style: string, tag = 'div') => {
    const r = await (async () => {
      const html = `<!DOCTYPE html><html><head><style>${PAGES} body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } td { padding: 0 } table { border-spacing: 0 }</style></head><body><${tag} style="${style};background:#ff0000">${tag === 'table' ? `<tr><td>${long}</td></tr>` : long}</${tag}></body></html>`;
      return boxesOf(await typesetHtml(html, { loadFont: loadCachedFont }));
    })();
    const reds = r.get('#ff0000') ?? [];
    return [reds.find((b) => b.page === 0), reds.find((b) => b.page === 1)].map((b) => (b ? [b.x, b.w] : undefined));
  };
  it('百分率の幅・上限の箱', async () => {
    expect(await page2('max-width:70%;margin:0 auto')).toEqual([[125, 210], [74, 252]]);
    expect(await page2('width:80%;margin:0 auto')).toEqual([[110, 240], [56, 288]]);
    expect(await page2('width:80%;margin-left:auto')).toEqual([[140, 240], [92, 288]]);
  });
  it('長さの幅の箱・表', async () => {
    expect(await page2('width:200pt;margin:0 auto')).toEqual([[130, 200], [100, 200]]);
    expect(await page2('width:200pt;margin-left:auto')).toEqual([[180, 200], [180, 200]]);
    // 表 (既定の罫線をつぶす表。外枠の罫線の半分が外へ出る): 続きの断片も、1 ページ目と同じく中央に
    expect(await page2('width:200pt;margin:0 auto', 'table')).toEqual([[129.7, 200.5], [99.7, 200.5]]);
  });
});

describe('grid の余りの空の列を、中身の幅に数えない', () => {
  // 百分率の和が 100% 未満・fr の係数の和が 1 未満の grid の、余りを残す列は、縮む容器 (float・inline-block・自動の表のセル) の中身の幅を
  // 測るときは数えない (CSS Grid 1 §7.2.1・§12.7.1、CSS Sizing 3 §5.2.1)。容器は、項目の中身の幅の和に縮む (余りの比で割って広げない)
  const items = `<div style="background:#ff0000">#f00</div><div style="background:#00ff00">#0f0</div>`;
  it('float・inline-block・自動のセルの中の 25% 25% と 0.2fr 0.3fr', async () => {
    const one = async (html: string) => (await boxes(html)).color('#999999')?.w;
    const a = await one(`<div style="float:left;background:#999999"><div style="display:grid;grid-template-columns:25% 25%">${items}</div></div>`);
    const b = await one(`<span style="display:inline-block;background:#999999"><div style="display:grid;grid-template-columns:25% 25%">${items}</div></span>`);
    const c = await one(`<div style="float:left;background:#999999"><div style="display:grid;grid-template-columns:0.2fr 0.3fr">${items}</div></div>`);
    const d = await one(`<div style="float:left;background:#999999"><div style="display:grid;grid-template-columns:50% 50%">${items}</div></div>`);
    const e = await one(`<div style="float:left;background:#999999"><div style="display:grid;grid-template-columns:30% auto">${items}</div></div>`);
    // 50% 50% (余りの無い grid) と同じ幅 (項目の中身の幅の和)。30% auto も、百分率の列は測るときは auto
    expect([a, b, e]).toEqual([d, d, d]);
    expect(d).toBeLessThan(40);
    // fr の係数の和が 1 未満: 余りの列は数えない (係数で割って広げる分は残る)
    expect(c).toBeLessThan(46);
  });
  it('幅の決まった容器では、余りを残す (百分率の列は容器の幅で解く)', async () => {
    const r = await boxes(`<div style="display:grid;grid-template-columns:25% 25%;width:200pt">${items}</div>`);
    expect([r.color('#ff0000')?.w, r.color('#00ff00')?.x, r.color('#00ff00')?.w]).toEqual([50, 70, 50]);
  });
});

describe('基準の箱の中の絶対配置の箱の、百分率の left・right・margin', () => {
  // 基準は、包含ブロック (位置の基準の祖先の padding の箱) の、組むときの幅 (CSS 2.1 §10.1 の 4・§10.3.7、CSS Position 3 §3.1)
  const abs = (s: string) => `<div style="position:absolute;background:#ff0000;height:10pt;${s}"></div>`;
  const rel = (inner: string, extra = '') => `<div style="position:relative;height:60pt;background:#0000ff;${extra}">${inner}</div>`;
  const at = async (html: string) => {
    const r = await boxes(html);
    const t = r.color('#ff0000');
    const b = r.color('#0000ff');
    return t && b ? [r1(t.x - b.x), t.w] : undefined;
  };
  it('flex の項目・grid の列・float・自動のセルの中の基準の箱', async () => {
    expect(await at(`<div style="display:flex"><div style="flex:0 0 100pt">${rel(abs('left:10%;right:10%;top:0'))}</div><div style="flex:1">z</div></div>`)).toEqual([10, 80]);
    expect(await at(`<div style="display:grid;grid-template-columns:100pt 1fr"><div>${rel(abs('right:10%;width:20pt;top:0'))}</div><div>z</div></div>`)).toEqual([70, 20]);
    expect(await at(`<div style="float:left;width:100pt">${rel(abs('left:0;width:20pt;margin-left:10%;top:0'))}</div>`)).toEqual([10, 20]);
    expect(await at(`<table><tr><td>${rel(abs('left:10%;width:20pt;top:0'), 'width:100pt')}</td><td>Z</td></tr></table>`)).toEqual([10, 20]);
  });
  it('百分率の padding の基準は、基準の箱の padding の箱の幅', async () => {
    expect(await at(rel(abs('left:0;width:20pt;padding-left:10%;top:0'), 'width:200pt;padding:0 20pt'))).toEqual([0, 44]);
  });
});

describe('img の width・height の属性の縦横比 (aspect-ratio: auto w / h。HTML §15.4.3)', () => {
  // 作成者が auto を書いて属性の大きさを使わない向きも、本来の比が無い画像では、属性の比で決める
  const size = async (html: string) => {
    const r = await boxes(html);
    const b = r.img();
    return b ? [b.w, b.h] : undefined;
  };
  const NOSIZE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E";
  it('読めない画像', async () => {
    expect(await size(`<img src="missing.png" width="200" height="100" style="height:auto">`)).toEqual([150, 75]);
    expect(await size(`<img src="missing.png" width="400" height="400" style="width:auto">`)).toEqual([300, 300]);
    expect(await size(`<img src="missing.png" width="100" height="200" style="height:auto;width:50px">`)).toEqual([37.5, 75]);
  });
  it('大きさも viewBox も無い SVG', async () => {
    expect(await size(`<img src="${NOSIZE}" width="100" height="200" style="height:auto">`)).toEqual([75, 150]);
  });
  it('本来の大きさのある画像は、本来の比', async () => {
    expect(await size(`<img src="${svg(300, 30)}" width="100" height="200" style="height:auto">`)).toEqual([75, 7.5]);
  });
});

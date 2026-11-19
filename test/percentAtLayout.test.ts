/**
 * 百分率の寸法を、組むときの実際の包含ブロックの幅で解く (CSS 2.1 §10.1・§10.2・§10.4・§8.3・§8.4、CSS Text 3 §8.1、CSS Sizing 3 §5.2.1)。
 *  - float・inline-block・絶対配置・flex と grid の項目・段組の段・表のセル・fit-content の箱の中の width・max-width・min-width・padding・
 *    margin・text-indent の百分率は、その箱の内容の幅が基準 (外のブロックの幅の見積もりではない)
 *  - 中身の幅を測るときは、循環する百分率の幅は auto、padding・margin・下限は 0 (容器が中身の幅に縮む所で、百分率の箱がはみ出さない)
 *  - 画像の max-width: 100%・width: 100% は、行を組む箱の内容の幅が基準
 *  - ページごとに領域の幅が違うとき (:first・:left・名前付きのページ) は、置くページの領域が基準。固定配置の箱は、ページごとに置き直す
 *  - 縦書きの中の margin・padding の百分率は、包含ブロックの inline の大きさ (高さ) が基準 (CSS Writing Modes 4 §7.2)。余白の箱の中は、余白の箱が基準
 *  - 段組の column-width からの段の数・grid の百分率の列・flex の縮めは、容器の実際の幅で決める
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
const IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='30'%3E%3Crect width='300' height='30' fill='red'/%3E%3C/svg%3E"; // 225pt × 22.5pt

type Box = { page: number; x: number; y: number; w: number; h: number };

/** 背景の色 (#rrggbb) ごとの箱と、画像の箱 ('img')。full なら body をそのまま文書にする */
async function boxes(body: string, css = '', full = false) {
  const html = full ? body : `<!DOCTYPE html><html><head><style>@page { size: 400pt 600pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } td { padding: 0 } table { border-spacing: 0 } ${css}</style></head><body>${body}</body></html>`;
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = new Map<string, Box[]>();
  const glyphs: Array<{ text: string; x: number }> = [];
  r.areaTree.sheets.forEach((sh, page) => {
    const rec = (a: AreaNode, ox: number, oy: number) => {
      const g = a as unknown as { x?: number; y?: number; width?: number; height?: number; backgroundColor?: string; text?: string; padding?: { left?: number; top?: number }; border?: { left?: { width: number }; top?: { width: number } } };
      const x = ox + (g.x ?? 0);
      const y = oy + (g.y ?? 0);
      const key = a.type === 'image' ? 'img' : g.backgroundColor && g.backgroundColor !== 'transparent' ? String(g.backgroundColor).toLowerCase() : undefined;
      if (key) out.set(key, [...(out.get(key) ?? []), { page, x: r1(x), y: r1(y), w: r1(g.width ?? 0), h: r1(g.height ?? 0) }]);
      if (a.type === 'glyph') glyphs.push({ text: g.text ?? '', x: r1(x) });
      for (const c of childrenOf(a)) rec(c, x + (g.padding?.left ?? 0) + (g.border?.left?.width ?? 0), y + (g.padding?.top ?? 0) + (g.border?.top?.width ?? 0));
    };
    rec(sh.page as unknown as AreaNode, 0, 0);
  });
  const red = (k = 0) => out.get('#ff0000')?.[k];
  return { out, red, glyphs, pages: r.areaTree.sheets.length };
}

// 置く場所 (中の箱の包含ブロックの内容の幅が、どれも 100pt)
const PLACES: Record<string, (c: string) => string> = {
  flexItem: (c) => `<div style="display:flex"><div style="flex:0 0 100pt">${c}</div></div>`,
  gridItem: (c) => `<div style="display:grid;grid-template-columns:100pt 300pt"><div>${c}</div><div></div></div>`,
  absLeftRight: (c) => `<div style="position:relative;height:100pt"><div style="position:absolute;top:0;left:150pt;right:150pt">${c}</div></div>`,
  column: (c) => `<div style="columns:4;column-gap:0"><div>${c}</div></div>`,
  fixedCell: (c) => `<table style="table-layout:fixed;width:200pt"><tr><td style="width:100pt">${c}</td><td></td></tr></table>`,
  maxWidthBox: (c) => `<div style="max-width:100pt">${c}</div>`,
  vertical: (c) => `<div style="writing-mode:vertical-rl;height:100pt">${c}</div>`,
};

describe('組んだ結果: 百分率の基準は、実際の包含ブロックの幅', () => {
  it('width・max-width・min-width・calc() の百分率 (flex・grid の項目・絶対配置・段・固定のセル・max-width の箱の中)', async () => {
    for (const [name, wrap] of Object.entries(PLACES)) {
      if (name === 'vertical') continue;
      const tol = name === 'fixedCell' ? 0.6 : 0.05; // 固定の表のセルの内容の幅は 100.5pt
      const w = async (style: string) => (await boxes(wrap(`<div style="${style};height:4pt;background:#f00">x</div>`))).red()?.w ?? NaN;
      expect(Math.abs((await w('width:50%')) - 50), `${name} width`).toBeLessThan(tol);
      expect(Math.abs((await w('width:calc(50% + 2pt)')) - 52), `${name} calc`).toBeLessThan(tol);
      expect(Math.abs((await w('max-width:30%')) - 30), `${name} max-width`).toBeLessThan(tol);
      expect(Math.abs((await w('width:1pt;min-width:40%')) - 40), `${name} min-width`).toBeLessThan(tol);
    }
  }, 120_000);

  it('padding・margin・text-indent の百分率 (上下の padding も、包含ブロックの幅が基準)', async () => {
    for (const name of ['flexItem', 'gridItem', 'absLeftRight', 'column', 'maxWidthBox']) {
      const wrap = PLACES[name];
      const pl = await boxes(wrap(`<div style="padding-left:10%;padding-top:20%;background:#f00"><div style="height:4pt;background:#0f0"></div></div>`));
      expect(r1(pl.out.get('#00ff00')![0].x - pl.red()!.x), `${name} padding-left`).toBe(10);
      expect(r1(pl.out.get('#00ff00')![0].y - pl.red()!.y), `${name} padding-top`).toBe(20);
      // 左端は、置く場所の左端 (段は、どの段に入っても 100pt の倍数)
      const left = name === 'absLeftRight' ? 150 : 0;
      const at = (x: number) => r1((x - left) % 100);
      const ml = await boxes(wrap(`<div style="margin-left:10%;height:4pt;background:#f00"></div>`));
      expect(at(ml.red()!.x), `${name} margin-left`).toBe(10);
      const ti = await boxes(wrap(`<p style="text-indent:10%">X</p>`));
      expect(at(ti.glyphs.find((g) => g.text === 'X')!.x), `${name} text-indent`).toBe(10);
    }
  }, 120_000);

  it('縦書きの中の padding・margin の百分率は、包含ブロックの高さ (inline の大きさ) が基準', async () => {
    const r = await boxes(PLACES.vertical(`<div style="background:#0f0">a</div><div style="margin-top:10%;background:#f00">b</div>`));
    expect(r.red()!.y).toBe(10);
  });

  it('容器が中身の幅に縮む所 (float・inline-block・絶対配置・fit-content・自動のセル): 百分率の箱は auto として数え、縮んだ幅の中に収まる', async () => {
    const inner = `<div style="width:20pt;height:2pt"></div><div style="width:50%;height:4pt;background:#f00"></div><div style="padding-left:10%"><div style="height:4pt;background:#0f0"></div></div>`;
    const wraps = [
      (c: string) => `<div style="float:left;background:#00f">${c}</div>`,
      (c: string) => `<div><span style="display:inline-block;background:#00f">${c}</span></div>`,
      (c: string) => `<div style="position:relative;height:50pt"><div style="position:absolute;top:0;left:0;background:#00f">${c}</div></div>`,
      (c: string) => `<div style="width:fit-content;background:#00f">${c}</div>`,
    ];
    for (const wrap of wraps) {
      const r = await boxes(wrap(inner));
      // 外の箱は、長さで幅を書いた中の箱 (20pt) の幅 (CSS Sizing 3 §5.1)。百分率の箱は、その半分。padding は、その 10%
      expect(r.out.get('#0000ff')![0].w).toBe(20);
      expect(r.red()!.w).toBe(10);
      expect(r.out.get('#00ff00')![0].x - r.out.get('#0000ff')![0].x).toBe(2);
    }
    // 自動の表のセル: width:100% の箱は、列の幅を広げず、列の中に収まる
    const cell = await boxes(`<table><tr><td style="background:#00f"><div style="width:100%;background:#f00">abc def</div></td><td style="background:#0f0">Z</td></tr></table>`);
    expect(cell.out.get('#0000ff')![0].w).toBeLessThan(40);
    expect(cell.red()!.w).toBeLessThanOrEqual(cell.out.get('#0000ff')![0].w);
    // 自動の表のセル・float の中の、幅 100% の表は、中身に合わせた幅
    const tbl = await boxes(`<div style="float:left;background:#00f"><table style="width:100%"><tr><td>abc def</td></tr></table></div>`);
    expect(tbl.out.get('#0000ff')![0].w).toBeLessThan(40);
  }, 120_000);

  it('画像の max-width:100%・width:100% は、行を組む箱の内容の幅が基準 (225pt の画像)', async () => {
    for (const name of ['flexItem', 'gridItem', 'fixedCell', 'maxWidthBox']) {
      const wrap = PLACES[name];
      for (const st of ['max-width:100%', 'width:100%', 'max-width:100%;display:block']) {
        const r = await boxes(wrap(`<img src="${IMG}" style="${st}">`));
        const img = r.out.get('img')![0];
        expect(Math.abs(img.w - 100), `${name} ${st}`).toBeLessThan(0.6);
        expect(Math.abs(img.h - img.w / 10), `${name} ${st} 縦横比`).toBeLessThan(0.1);
      }
    }
    // 3 段の段組の段 (133.3pt) の中
    const col = await boxes(`<div style="columns:3;column-gap:0"><img src="${IMG}" style="max-width:100%"></div>`);
    expect(col.out.get('img')![0].w).toBe(133.3);
    // float の中の width:100% の画像: 中身の幅は画像本来の大きさ (max-content では auto。CSS Sizing 3 §5.2.1)
    const fl = await boxes(`<div style="float:left;background:#00f"><img src="${IMG}" style="width:100%"></div>`);
    expect(fl.out.get('img')![0].w).toBe(225);
    // 幅・高さの属性のある画像の max-width: 100%; height: auto: 属性は表示のための指定 (HTML §15.4.3) で、作成者の height: auto が
    // 勝つので、幅を縮めると、高さも縦横比で縮む (CSS 2.1 §10.6.2)。height: auto が無ければ、属性の高さのまま (CSS 2.1 §10.4)
    const attr = async (st: string) => (await boxes(PLACES.gridItem(`<img src="${IMG}" width="300" height="60" style="${st}">`))).out.get('img')![0];
    expect(await attr('max-width:100%;height:auto')).toMatchObject({ w: 100, h: 10 });
    expect(await attr('max-width:100%')).toMatchObject({ w: 100, h: 45 });
    // 高さだけ決まった画像は、高さに上限を当ててから、幅を縦横比で出す (CSS 2.1 §10.4: 225pt × 22.5pt の画像の height: 30pt; max-height: 5pt は 50pt × 5pt)
    expect((await boxes(PLACES.gridItem(`<img src="${IMG}" style="height:30pt;max-height:5pt;max-width:100%">`))).out.get('img')![0]).toMatchObject({ w: 50, h: 5 });
  }, 120_000);

  it('ふつうの本文の、幅 auto の箱の百分率の max-width・min-width (calc() も。margin: auto で寄せる)', async () => {
    const T = 'text text text text text text text text text text text text text text text text text text text text text text text text text text';
    const w = async (style: string) => (await boxes(`<div style="${style};background:#f00">${T}</div>`)).red()!;
    expect(await w('max-width:50%')).toMatchObject({ x: 0, w: 200 });
    expect(await w('max-width:calc(50% - 10pt)')).toMatchObject({ x: 0, w: 190 });
    expect(await w('max-width:80%;margin:0 auto')).toMatchObject({ x: 40, w: 320 });
    expect((await w('min-width:150%')).w).toBe(600);
    expect((await boxes(`<div style="width:200pt"><div style="max-width:50%;background:#f00">${T}</div></div>`)).red()!.w).toBe(100);
  });
});

describe('組んだ結果: ページごとに違う領域の百分率', () => {
  const doc = (css: string, body: string) => `<!DOCTYPE html><html><head><style>@page { size: 400pt 300pt; margin: 20pt } body { margin: 0; font-size: 10pt } ${css}</style></head><body>${body}</body></html>`;
  it(':first・:left の余白・大きさで、width:100% の箱と表は、置くページの領域の幅', async () => {
    const first = await boxes(doc('@page :first { margin-left: 80pt }', '<div style="width:100%;background:#f00">a</div><table style="width:100%;background:#0f0"><tr><td>t</td></tr></table>'), '', true);
    expect(first.red()).toMatchObject({ x: 80, w: 300 });
    expect(Math.abs(first.out.get('#00ff00')![0].w - 300)).toBeLessThan(1);
    const left = await boxes(doc('@page :left { margin-left: 80pt }', '<p>a</p><div style="break-before:page;width:100%;background:#f00">b</div><div style="width:100%;background:#0f0">' + 'x '.repeat(1500) + '</div>'), '', true);
    expect(left.red()).toMatchObject({ page: 1, x: 80, w: 300 });
    // ページをまたいだ width:100% の箱は、断片ごとに、そのページの領域の幅 (CSS Fragmentation 3 §5.1)
    const frags = left.out.get('#00ff00')!;
    expect(frags.map((f) => [f.page, f.w])).toEqual(frags.map((f) => [f.page, f.page % 2 === 1 ? 300 : 360]));
  });

  it('position: fixed の width:100% は、どのページでも、そのページの領域の幅と位置', async () => {
    const r = await boxes(doc('@page :left { margin-left: 80pt }', '<div style="position:fixed;top:0;left:0;width:100%;height:10pt;background:#f00"></div><p>a</p><p style="break-before:page">b</p>'), '', true);
    expect(r.out.get('#ff0000')!.map((b) => [b.page, b.x, b.w])).toEqual([
      [0, 20, 360],
      [1, 80, 300],
    ]);
  });

  it('余白の箱 (@top-center の width) の中の百分率は、余白の箱が基準', async () => {
    const html = `<!DOCTYPE html><html><head><style>@page { size: 300pt 300pt; margin: 50pt; @top-center { content: element(hd); width: 100pt } } body { margin: 0; font-size: 10pt } .hd { position: running(hd) }</style></head><body><div class="hd"><div style="width:50%;background:#f00">h</div></div><p>body</p></body></html>`;
    expect((await boxes(html, '', true)).red()!.w).toBe(50);
  });
});

describe('組んだ結果: 容器の実際の幅で決める段の数・grid の列・flex の縮め', () => {
  it('column-width からの段の数と、百分率の column-gap (CSS Multi-column 1 §3.4・CSS Box Alignment 3 §8.1)', async () => {
    const ps = '<p>a</p>'.repeat(6);
    const r = await boxes(PLACES.flexItem(`<div style="columns:40pt;column-gap:0"><div style="background:#f00">${ps}</div></div>`));
    expect(r.out.get('#ff0000')!.map((b) => [b.x, b.w])).toEqual([
      [0, 50],
      [50, 50],
    ]);
    const g = await boxes(PLACES.flexItem(`<div style="columns:2;column-gap:10%"><div style="background:#f00">${ps}</div></div>`));
    expect(g.out.get('#ff0000')!.map((b) => [b.x, b.w])).toEqual([
      [0, 45],
      [55, 45],
    ]);
  });

  it('grid の百分率の列は、容器の内容の幅 × 比 (間隔を引かない)。fr の係数の和が 1 未満なら、余りを残す', async () => {
    const two = async (tpl: string, w = 280) => {
      const r = await boxes(`<div style="width:${w}pt;display:grid;grid-template-columns:${tpl}"><div style="background:#f00">a</div><div style="background:#0f0">b</div></div>`);
      return [r.red()!.w, r.out.get('#00ff00')![0].w];
    };
    expect(await two('25% 1fr;gap:8pt')).toEqual([70, 202]);
    expect(await two('30% 70%;gap:8pt')).toEqual([84, 196]);
    expect(await two('0.2fr 0.3fr', 240)).toEqual([48, 72]);
    expect(await two('25% 25%', 240)).toEqual([60, 60]);
    // grid の項目 (100pt) の中の、25% 1fr の grid
    const nested = await boxes(PLACES.gridItem(`<div style="display:grid;grid-template-columns:25% 1fr"><div style="background:#f00">a</div><div style="background:#0f0">b</div></div>`));
    expect([nested.red()!.w, nested.out.get('#00ff00')![0].w]).toEqual([25, 75]);
  });

  it('calc(百分率 + 長さ) の列は、容器の内容の幅 × 比 + 長さ (CSS Values 4 §10.1)。repeat(auto-fill, …) は、入るだけの列 (CSS Grid 1 §7.2.3.2)', async () => {
    const two = async (tpl: string, w = 280) => {
      const r = await boxes(`<div style="width:${w}pt;display:grid;grid-template-columns:${tpl}"><div style="background:#f00">a</div><div style="background:#0f0">b</div></div>`);
      return [r.red()!.w, r.out.get('#00ff00')![0].w];
    };
    // 1em は 10pt
    expect(await two('calc(10% + 1em) 1fr', 300)).toEqual([40, 260]);
    expect(await two('calc(20% + 10pt) calc(30% - 5pt);gap:6pt', 300)).toEqual([70, 85]);
    // grid の項目 (100pt) の中の calc(10% + 1em) 1fr: 10% は 100pt に対して
    const nested = await boxes(PLACES.gridItem(`<div style="display:grid;grid-template-columns:calc(10% + 1em) 1fr"><div style="background:#f00">a</div><div style="background:#0f0">b</div></div>`));
    expect([nested.red()!.w, nested.out.get('#00ff00')![0].w]).toEqual([20, 80]);
    // 本文の幅 (400pt) に 80pt の列が 5 つ (丸めの誤差で 4 つにしない)
    const fill = await boxes(`<div style="display:grid;grid-template-columns:repeat(auto-fill, 80pt)">${'<div style="background:#f00">a</div>'.repeat(5)}</div>`);
    expect(fill.out.get('#ff0000')!.map((b) => [b.x, b.y])).toEqual([0, 80, 160, 240, 320].map((x) => [x, 0]));
  });

  it('flex の項目 (80pt + 80pt) は、grid の項目 (100pt) の中でも縮む。自動のセルの中の flex: 1 の項目は、中身の幅', async () => {
    const r = await boxes(PLACES.gridItem(`<div style="display:flex"><div style="width:80pt;background:#f00">a</div><div style="width:80pt;background:#0f0">b</div></div>`));
    expect([r.red()!.w, r.out.get('#00ff00')![0].w]).toEqual([50, 50]);
    const cell = await boxes(`<table><tr><td><div style="display:flex"><div style="flex:1;background:#f00">abc</div></div></td><td>Z</td></tr></table>`);
    expect(cell.red()!.w).toBeGreaterThan(10);
  });
});

describe('組んだ結果: 近い所の直し', () => {
  it('float・inline-block・絶対配置の中身の幅に、長さで幅を書いた中の箱 (100pt) を数える', async () => {
    for (const wrap of [
      (c: string) => `<div style="float:left;background:#00f">${c}</div>`,
      (c: string) => `<div><span style="display:inline-block;background:#00f">${c}</span></div>`,
      (c: string) => `<div style="position:relative;height:50pt"><div style="position:absolute;background:#00f">${c}</div></div>`,
    ]) {
      const r = await boxes(wrap(`<div style="width:100pt;background:#f00">ab</div>`));
      expect(r.out.get('#0000ff')![0].w).toBe(100);
    }
    // inline-block の中の center の中の、幅の決まった箱
    const c = await boxes(`<div><span style="display:inline-block;background:#00f"><center><div style="width:30pt;background:#f00">ab</div></center></span></div>`);
    expect(c.out.get('#0000ff')![0].w).toBe(30);
  });

  it('body の最初の中身が字でも、続くブロックは同じページ', async () => {
    const r = await boxes(`text<div style="background:#f00">x</div>`);
    expect(r.pages).toBe(1);
    expect(r.red()).toMatchObject({ page: 0, y: 12 });
  });
});

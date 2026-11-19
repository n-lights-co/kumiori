/**
 * grid の fr・auto の列の下限 (項目の自動の最小の大きさ: CSS Grid 1 §6.6・§12.5) を、組版エンジンが、組むときと同じ折り返しで
 * 項目の中身を測った min-content にする:
 *  - 項目の中の百分率の幅の子 (width: 100% の div・画像・表) は、min-content では auto (CSS Sizing 3 §5.2.1)。下限を容器いっぱいにしない
 *  - 百分率の max-width の画像 (縮められる置換要素) の min-content の寄与は 0 (§5.2.2)
 *  - ハイフンのある語・URL・em ダッシュは、組むときと同じく、その後ろで折れる (1 語として測らない)。ソフトハイフンの位置でも折れる
 *  - 表の項目は、表の列の最小の幅の和
 *  - 入れ子の grid の項目は、内の grid の全部の列の下限の和
 *  - 下限は grid 全体で 1 つ (どの行も同じ列の幅)
 * あわせて、minmax() の最小が fr の宣言 (無効)・とても大きい fr の係数・SVG の DOCTYPE の内部の宣言の中の注釈
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { svgStartTag } from '../src/assets';
import { gridTrackPlan, gridTracks } from '../src/gridTracks';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const r1 = (n: number) => Math.round(n * 10) / 10;
type Box = { x: number; y: number; w: number };

/** 背景の色 (#rrggbb) ごとの箱。本文の幅は 360pt (余白 0) */
async function boxes(body: string) {
  const html = `<!DOCTYPE html><html><head><style>@page { size: 360pt 2000pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt }</style></head><body>${body}</body></html>`;
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
  return out;
}

/** 赤の項目の、1 行目の [x, 幅] (箱は文書の順に並ぶ。次の行は、左へ戻ったところから。表の項目は、箱の上端が行の上端より下がるので、y で分けない) */
async function firstRow(body: string) {
  const reds = (await boxes(body)).get('#ff0000')!;
  const end = reds.findIndex((b, k) => k > 0 && b.x <= reds[k - 1].x);
  return reds.slice(0, end < 0 ? reds.length : end).map((b) => [r1(b.x), r1(b.w)]);
}
const item = (inner: string) => `<div style="background:#f00">${inner}</div>`;
const grid = (tpl: string, cells: string[], gap = '6px') => `<div style="display:grid;grid-template-columns:${tpl};gap:${gap}">${cells.join('')}</div>`;
const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"/>')}`;

describe('項目の中の百分率の幅の子 (カードの grid)', () => {
  // 6px の間隔は 4.5pt。1fr 1fr は (360 − 4.5) / 2 = 177.75
  const half = [
    [0, 177.8],
    [182.3, 177.8],
  ];
  it('width: 100% の div・画像・表、width 属性の 100% の画像・表: 1fr 1fr は等分のまま (下限を容器いっぱいにしない)', async () => {
    for (const child of [
      '<div style="width:100%">Card title</div>',
      `<img style="width:100%" src="${svg}">`,
      `<img width="100%" src="${svg}">`,
      '<table style="width:100%"><tr><td>a</td></tr></table>',
      '<table width="100%"><tr><td>a</td></tr></table>',
      '<div style="width:calc(100% - 10px)">Card</div>',
      // 組むときに百分率を解き直さない、行内の入力欄・svg (読み込みの見積もりの幅で長さにしてある)
      '<input style="width:100%">',
      '<svg style="width:100%" viewBox="0 0 300 100"><rect width="300" height="100"/></svg>',
    ])
      expect(await firstRow(grid('1fr 1fr', [item(child), item('text')])), child).toEqual(half);
  });

  it('項目そのものの width: 100%・min-width: 100%: 列の大きさを決める間は auto と同じ (1fr 1fr は等分のまま)', async () => {
    for (const style of ['width:100%', 'min-width:100%', 'width:100%;max-width:100%'])
      expect(await firstRow(grid('1fr 1fr', [`<div style="background:#f00;${style}">a</div>`, item('text')])), style).toEqual(half);
  });

  it('repeat(3, 1fr) の width: 50% の子: 3 列とも等しく、容器の中に収まる', async () => {
    const row = await firstRow(grid('repeat(3, 1fr)', [item('<div style="width:50%">a</div>'), item('b'), item('c')]));
    expect(row).toEqual([
      [0, 117],
      [121.5, 117],
      [243, 117],
    ]);
  });

  it('長さの幅の画像 (既定の max-width: 100%。縮められる置換要素の min-content の寄与は 0): 1fr 1fr は等分', async () => {
    expect(await firstRow(grid('1fr 1fr', [item(`<img style="width:250px" src="${svg}">`), item('text')]))).toEqual(half);
  });
});

describe('組むときと同じ折り返しで測る', () => {
  const url = 'See https://example.com/docs/getting-started/installation-guide for details';
  it('URL の項目: 1fr 1fr は等分、200px 1fr は 150 / 201 (容器からはみ出さない)', async () => {
    expect(await firstRow(grid('1fr 1fr', [item(url), item('b')], '12px'))).toEqual([
      [0, 175.5],
      [184.5, 175.5],
    ]);
    expect(await firstRow(grid('200px 1fr', [item(url), item('b')], '12px'))).toEqual([
      [0, 150],
      [159, 201],
    ]);
  });

  it('ハイフンのある語・em ダッシュの語・ソフトハイフンの語: 1fr 1fr 1fr 1fr は 4 列とも等しい', async () => {
    for (const text of ['A well-known state-of-the-art-technology-solutions-provider', 'alpha—beta—gamma—delta—epsilon', 'Super&shy;cali&shy;fragilistic&shy;expiali&shy;docious&shy;wordlonger']) {
      const row = await firstRow(grid('1fr 1fr 1fr 1fr', [item(text), item('b'), item('c'), item('d')]));
      expect(row.map((c) => c[1]), text).toEqual([86.6, 86.6, 86.6, 86.6]);
    }
  });

  it('表の項目: 列の下限は表の列の最小の幅の和 (語の後ろで折れる列を、1 行の長さで数えない)。ほかの列も幅 0 にならない', async () => {
    const t = '<table><tr><td>Column A</td><td>Column B wide</td></tr></table>';
    const row = await firstRow(grid('1fr 1fr 1fr 1fr 1fr', [item(t), item('y'), item('z'), item(t), item('y')], '12px'));
    // 表の列の最小の幅は「Column」2 つ (と、セルの余白・間隔)。表全体を 1 行で組んだ幅 (126pt) より狭い
    expect(row[0][1]).toBeLessThan(100);
    expect(row[0][1]).toBeGreaterThan(60);
    for (const [, w] of row) expect(w).toBeGreaterThan(40);
    expect(row[4][0] + row[4][1]).toBeLessThanOrEqual(360.05);
  });

  it('同じ列の下限は、grid 全体で 1 つ (長い語が 2 行目にあっても、1 行目の列も同じ幅)', async () => {
    const reds = (await boxes(grid('1fr 1fr 1fr', [item('a'), item('b'), item('c'), item('d'), item('Supercalifragilisticexpialidocious'), item('f')]))).get('#ff0000')!;
    const cols = (k: number) => reds.filter((_, j) => j % 3 === k).map((b) => r1(b.w));
    expect(new Set(cols(1)).size).toBe(1);
    expect(cols(1)[0]).toBeGreaterThan(cols(0)[0]);
  });
});

describe('入れ子の grid', () => {
  it('1fr 1fr の項目の中の 1fr 1fr の grid: 外の列は、内の grid の全部の列の下限の和 (内の grid が外の列から出て、隣の列に重ならない)', async () => {
    const inner = '<div style="display:grid;grid-template-columns:1fr 1fr"><div>Supercalifragilisticexpialidocious</div><div style="background:#00f">xyz</div></div>';
    const body = `<div style="width:270pt;display:grid;grid-template-columns:1fr 1fr">${item(inner)}<div style="background:#0f0">Other text here</div></div>`;
    const b = await boxes(body);
    const red = b.get('#ff0000')![0];
    const green = b.get('#00ff00')![0];
    const blue = b.get('#0000ff')![0];
    expect(r1(red.w)).toBe(148.9);
    expect(r1(green.x)).toBe(148.9);
    // 内の grid の 2 列目 (xyz) は、外の 1 列目の中
    expect(blue.x + blue.w).toBeLessThanOrEqual(red.x + red.w + 0.05);
  });

  it('6 段の入れ子でも、内の項目どうしが重ならない', async () => {
    let g = '<div style="display:grid;grid-template-columns:1fr 1fr"><div>Supercalifragilistic</div><div style="background:#00f">y</div></div>';
    for (let k = 0; k < 5; k++) g = `<div style="display:grid;grid-template-columns:1fr 1fr"><div>${g}</div><div style="background:#00f">y</div></div>`;
    const blues = (await boxes(`<div style="width:300pt">${g}</div>`)).get('#0000ff')!;
    const xs = blues.map((b) => r1(b.x));
    expect(new Set(xs).size).toBe(xs.length);
  });
});

describe('自動の最小の大きさを使わない項目は、これまでどおり', () => {
  it('min-width: 0・overflow: hidden の項目、minmax(0, 1fr): 長い語があっても等分', async () => {
    const w = 'Supercalifragilisticexpialidociousxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    for (const [tpl, style] of [
      ['1fr 1fr', 'min-width:0'],
      ['1fr 1fr', 'overflow:hidden'],
      ['minmax(0, 1fr) minmax(0, 1fr)', ''],
    ])
      expect(await firstRow(grid(tpl, [`<div style="background:#f00;${style}">${w}</div>`, item('b')])), `${tpl} ${style}`).toEqual([
        [0, 177.8],
        [182.3, 177.8],
      ]);
  });

  it('0fr の列は、項目の中身の最も狭い幅 (余りを取らない)', async () => {
    const row = await firstRow(grid('0fr 1fr', [item('ab cd'), item('b')]));
    expect(row[0][1]).toBeGreaterThan(5);
    expect(row[0][1]).toBeLessThan(15);
    expect(Math.abs(row[1][0] + row[1][1] - 360)).toBeLessThan(0.15);
  });

  it('長さの width の項目は、その幅が下限 (中身を測らない)', async () => {
    const row = await firstRow(grid('1fr 1fr 1fr', [`<div style="background:#f00;width:200pt">a</div>`, item('b'), item('c')]));
    // 列は 200pt 以上 (項目の幅の指定)。残りを 2 列が分ける
    expect(row[0][1]).toBe(200);
    expect(row[1][0]).toBe(204.5);
  });
});

describe('列の並びの読み方', () => {
  it('minmax() の最小が fr の並びは、宣言ごと無効 (CSS Grid 1 §7.2.3)', () => {
    expect(gridTrackPlan('minmax(1fr, 2fr) 1fr', 300, 0)).toBeUndefined();
    expect(gridTracks('minmax(1fr, 2fr) 1fr', 300, 0)).toEqual([300]);
    expect(gridTracks('repeat(2, minmax(1fr, 100px))', 300, 0)).toEqual([300]);
  });

  it('とても大きい fr の係数・有限でない係数でも、NaN・Infinity にならない', () => {
    for (const tpl of ['1e400fr 1fr', '1e307fr 1e307fr', '1fr 1e308fr 1e308fr', '1e400fr 1e400fr']) {
      const t = gridTracks(tpl, 300, 10);
      expect(t.every((x) => Number.isFinite(x) && x >= 0), `${tpl} ${t}`).toBe(true);
      expect(t.reduce((a, b) => a + b, 0) + 10 * (t.length - 1)).toBeCloseTo(300, 5);
    }
    expect(gridTracks('1e307fr 1e307fr', 300, 0)).toEqual([150, 150]);
    expect(gridTracks('1e400fr 1fr', 300, 0)).toEqual([300, 0]);
  });

  it('minmax(auto, 長さ) の下限は、最大の大きさで抑える (CSS Grid 1 §6.6)', () => {
    expect(gridTracks('minmax(auto, 50px) 1fr', 300, 0, () => 100)).toEqual([37.5, 262.5]);
  });
});

describe('SVG の開始タグ', () => {
  it('DOCTYPE の内部の宣言の中の注釈・処理命令の引用符を、引用符として読まない', () => {
    const doc = `<?xml version="1.0"?><!DOCTYPE svg [ <!-- don't --> <!ENTITY a "x"> ]><svg width="200" height="100"></svg>`;
    expect(svgStartTag(doc)).toBe('<svg width="200" height="100">');
    expect(svgStartTag(`<!DOCTYPE svg [ <?pi it's?> ]><svg width="2">`)).toBe('<svg width="2">');
    // 注釈の外の引用符は、これまでどおり引用符 (中の > で終わらない)
    expect(svgStartTag(`<!DOCTYPE svg [ <!ENTITY a "]>"> ]><svg width="3">`)).toBe('<svg width="3">');
  });
});

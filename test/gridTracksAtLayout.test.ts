/**
 * grid の列の幅を、組むときの容器の実際の内容の幅で決める (CSS Grid 1 §11・§12):
 *  - 容器が読み込みの見積もりより狭い所 (flex の項目・表のセル・grid の項目・float の中) でも、上限のある minmax() の隣の fr の列が
 *    幅 0 にならず、はみ出さない (上限のある列を先に伸ばし、fr の列は項目の中身の最小の幅を下限に持つ: §12.5・§12.6・§12.7)
 *  - auto-fill の列は、回数を見積もりの幅で決めても、minmax() の最小の大きさより狭くならない (幅 0 の列にして字を重ねない)
 *  - 上限に当たる列を止めて分け直す手間が、列の数に比例する
 *  - でたらめな並びの性質 (NaN・負の幅・幅 0 の列・項目の重なり・容器からのはみ出しが無い)
 *  - SVG の開始タグを、注釈などを飛ばして、文書の長さに比例する手間で探す
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cpuClock, scaled } from './timing';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { headerSize, svgStartTag } from '../src/assets';
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

const items = (n: number) => Array.from({ length: n }, (_, k) => `<div style="background:#f00">a${k}</div>`).join('');
const grid = (tpl: string, n = 5) => `<div style="display:grid;grid-template-columns:${tpl};gap:6px">${items(n)}</div>`;
/** 1 行目の項目の [x, 幅] */
async function firstRow(body: string) {
  const reds = (await boxes(body)).get('#ff0000')!;
  return reds.filter((b) => Math.abs(b.y - reds[0].y) < 0.5).map((b) => [r1(b.x), r1(b.w)]);
}
/** 250pt の脇の欄の隣の、flex: 1 の項目 (幅 110pt) */
const flexNarrow = (g: string) => `<div style="display:flex"><div style="width:250pt;flex:none;background:#00f">x</div><div style="flex:1;min-width:0">${g}</div></div>`;
/** 1fr 3fr の grid の、1 列目の項目 (幅 90pt) */
const gridItem = (g: string) => `<div style="display:grid;grid-template-columns:1fr 3fr"><div>${g}</div><div style="background:#00f">y</div></div>`;

describe('上限のある minmax() と fr の列 (容器が見積もりより狭い所)', () => {
  it('110pt の flex の項目の中の minmax(100px, 500px) 1fr: 上限のある列を先に伸ばし、1fr の列は中身の幅 (幅 0 にせず、はみ出さない)', async () => {
    // 6px の間隔は 4.5pt。110 − 4.5 = 105.5 を、1fr の列の下限 (「a1」の min-content 9.45。組むときに測った幅で、行を折り返さないための 0.01pt の余裕を含む) を残して、minmax の列が取る
    expect(await firstRow(flexNarrow(grid('minmax(100px, 500px) 1fr')))).toEqual([
      [250, 96.1],
      [350.6, 9.5],
    ]);
    // 上限が 200px でも同じ (上限 150pt に届かない)
    expect(await firstRow(flexNarrow(grid('minmax(100px, 200px) 1fr')))).toEqual([
      [250, 96.1],
      [350.6, 9.5],
    ]);
  });

  it('1fr minmax(0, 150px) 1fr: 外側の 2 列が幅 0 にならず、真ん中の列に字が重ならない', async () => {
    const row = await firstRow(flexNarrow(grid('1fr minmax(0, 150px) 1fr')));
    expect(row).toEqual([
      [250, 9.5],
      [263.9, 82.1],
      [350.6, 9.5],
    ]);
  });

  it('grid の項目 (90pt) の中: minmax(100px, 500px) 1fr は 76.1 / 9.5', async () => {
    expect(await firstRow(gridItem(grid('minmax(100px, 500px) 1fr')))).toEqual([
      [0, 76.1],
      [80.6, 9.5],
    ]);
  });

  it('本文の幅 (見積もりどおり) では、上限に当たる列も当たらない列も、前と同じ・ブラウザと同じ', async () => {
    expect(await firstRow(grid('minmax(100px, 200px) 1fr'))).toEqual([
      [0, 150],
      [154.5, 205.5],
    ]);
    // 上限が 60% − 200px (= 66pt) の列
    expect(await firstRow(grid('minmax(0, calc(60% - 200px)) 1fr 1fr'))).toEqual([
      [0, 66],
      [70.5, 142.5],
      [217.5, 142.5],
    ]);
  });

  it('float の中 (中身の幅で決まる容器): 上限のある列は上限まで、fr の列は中身の幅', async () => {
    expect(await firstRow(`<div style="float:left;width:30%">${grid('minmax(100px, 200px) 1fr')}</div>`)).toEqual([
      [0, 94.1],
      [98.6, 9.5],
    ]);
    expect(await firstRow(`<div style="float:left">${grid('minmax(100px, 200px) 1fr')}</div>`)).toEqual([
      [0, 150],
      [154.5, 9.5],
    ]);
  });
});

describe('auto-fill の列 (回数は見積もりの幅で決まる)', () => {
  it('110pt の flex の項目の中の 200px repeat(auto-fill, minmax(60px, 1fr)): どの列も 45pt (minmax の最小) で、幅 0 にして重ねない', async () => {
    const row = await firstRow(flexNarrow(grid('200px repeat(auto-fill, minmax(60px, 1fr))')));
    expect(row[0]).toEqual([250, 150]);
    for (const [, w] of row.slice(1)) expect(w).toBe(45);
    for (let k = 1; k < row.length; k++) expect(row[k][0]).toBeGreaterThanOrEqual(row[k - 1][0] + row[k - 1][1]);
  });

  it('grid の項目の中の repeat(auto-fill, minmax(100px, 1fr)): 列は 75pt (最小の大きさ) より狭くならない', async () => {
    const row = await firstRow(gridItem(grid('repeat(auto-fill, minmax(100px, 1fr))', 8)));
    expect(row.length).toBeGreaterThan(1);
    for (const [, w] of row) expect(w).toBe(75);
  });
});

describe('列の幅を決める手間', () => {
  it('上限に当たる列が多くても、手間は列の数に比例する (1 本ずつ止めて分け直さない)', () => {
    const t0 = cpuClock();
    const a = gridTracks('repeat(10000, minmax(0, 1px))', 1e5, 0);
    const t1 = cpuClock();
    expect(a.length).toBe(10000);
    expect(a.every((w) => w === 0.75)).toBe(true);
    const b = gridTracks('repeat(10000, 1fr)', 7500, 0);
    expect(b.every((w) => Math.abs(w - 0.75) < 1e-9)).toBe(true);
    // 前は 1 回に 750ms ほど (列の数の 2 乗)。いまは数 ms
    expect(t1 - t0).toBeLessThan(scaled(300));
    // 下限と上限の区切りが列ごとに違う並びも
    const tpl = Array.from({ length: 3000 }, (_, k) => `minmax(${k % 7}px, ${10 + (k % 13)}px) ${1 + (k % 3)}fr`).join(' ');
    const t2 = cpuClock();
    const c = gridTracks(tpl, 20000, 1);
    expect(cpuClock() - t2).toBeLessThan(scaled(300));
    expect(c.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
  });
});

describe('gridTracks の分け方', () => {
  it('上限のある列は先に上限まで伸び、残りを fr の列が比で分ける。fr の列は下限 (中身の最小の幅) より狭くならない', () => {
    // 360pt: minmax(100px, 500px) は 375pt まで伸びられるが、1fr の列の下限 9.4 を残す
    expect(gridTracks('minmax(100px, 500px) 1fr', 360, 0, () => 9.4).map(r1)).toEqual([350.6, 9.4]);
    // 上限に届けば、残りは fr の列
    expect(gridTracks('minmax(100px, 200px) 2fr', 360, 0)).toEqual([150, 210]);
    // minmax(a, Nfr) の比は N
    expect(gridTracks('minmax(0, 2fr) 1fr', 300, 0)).toEqual([200, 100]);
    // fr の係数の和が 1 未満なら、余りのその割合だけ (CSS Grid 1 §12.7.1)
    expect(gridTracks('0.5fr 0.3fr', 360, 0)).toEqual([180, 108]);
    // minmax(100px, 1fr) は、容器が狭くても 75pt より狭くならない
    expect(gridTracks('minmax(100px, 1fr) 2fr', 200, 0)).toEqual([75, 125]);
    // 比 0 の minmax(a, 0fr) は a の幅で、ほかの列は、その残りを分ける
    expect(gridTracks('100px minmax(50pt, 0fr) 1fr', 300, 0)).toEqual([75, 50, 175]);
    // 下限の和が容器より広ければ、下限のまま (はみ出す)
    expect(gridTracks('repeat(4, minmax(60px, 1fr))', 100, 0, undefined, { times: undefined })).toEqual([45, 45, 45, 45]);
  });

  it('auto-fill の回数を渡すと、その回数で展開する (組むときに列の数を変えない)', () => {
    expect(gridTracks('repeat(auto-fill, minmax(100px, 1fr))', 110, 0, undefined, { times: 4 })).toEqual([75, 75, 75, 75]);
    const rep: { times?: number } = {};
    expect(gridTracks('repeat(auto-fill, minmax(100px, 1fr))', 360, 0, undefined, rep)).toEqual([90, 90, 90, 90]);
    expect(rep.times).toBe(4);
  });
});

/** 決まった乱数 (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('でたらめな並びの性質', () => {
  it('NaN・負の幅・幅 0 の列・項目の重なり・容器からのはみ出しが無い', async () => {
    const R = rng(7);
    const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
    const num = (a: number, b: number) => Math.round((a + R() * (b - a)) * 10) / 10;
    const len = () => pick([`${num(1, 200)}px`, `${num(1, 150)}pt`]);
    const pct = () => `${num(1, 60)}%`;
    const track = (): string =>
      pick([
        len,
        pct,
        () => pick(['1fr', '2fr', '0.5fr', '0.3fr']),
        () => 'auto',
        () => `minmax(${pick([len(), pct(), 'auto', '0'])}, ${pick([len(), '1fr', 'auto', `calc(${pct()} + 10px)`])})`,
        () => `calc(${pct()} + ${num(0, 60)}px)`,
        () => `min(${pct()}, ${len()})`,
        () => `repeat(2, ${pick(['1fr', len(), 'minmax(0, 1fr)'])})`,
      ])();
    const fixedSize = () => pick([len, () => `minmax(${len()}, 1fr)`, () => `minmax(auto, ${len()})`])();
    const wraps: Array<(g: string, w: number) => string> = [
      (g, w) => `<div style="width:${w}pt">${g}</div>`,
      (g, w) => `<div style="display:flex;width:${Math.min(w + 100, 360)}pt"><div style="width:100pt;flex:none">s</div><div style="flex:1;min-width:0">${g}</div></div>`,
      (g, w) => `<table style="width:${Math.min(w + 100, 360)}pt;border-spacing:0"><tr><td style="width:100pt;padding:0">s</td><td style="padding:0">${g}</td></tr></table>`,
      (g, w) => `<div style="width:${w}pt"><div style="float:left;max-width:100%">${g}</div></div>`,
    ];
    const bad: string[] = [];
    for (let i = 0; i < 40; i++) {
      const tpl =
        R() < 0.3
          ? `${R() < 0.5 ? fixedSize() + ' ' : ''}repeat(${pick(['auto-fill', 'auto-fit'])}, ${fixedSize()})`
          : Array.from({ length: 1 + Math.floor(R() * 5) }, track).join(' ');
      const gap = pick(['0', `${num(0, 16)}px`, `${num(0, 6)}%`]);
      const W = num(50, 340);
      const n = 1 + Math.floor(R() * 10);
      const g = `<div style="display:grid;background:#00f;grid-template-columns:${tpl};column-gap:${gap}">${items(n)}</div>`;
      const out = await boxes(pick(wraps)(g, W));
      const cont = out.get('#0000ff')![0];
      const reds = out.get('#ff0000') ?? [];
      const gapPt = /%$/.test(gap) ? (parseFloat(gap) * cont.w) / 100 : parseFloat(gap) * 0.75;
      const rows = new Map<number, Box[]>();
      for (const b of reds) rows.set(Math.round(b.y * 2), [...(rows.get(Math.round(b.y * 2)) ?? []), b]);
      // 列の最小の和 (決まった幅・minmax() の最小・項目の中身の最小 (多めに 16pt) と間隔)。auto-fill の回数は、読み込みの見積もりの幅で
      // 決まるので、行に並んだ項目の数の列で数える
      const perRow = Math.max(...[...rows.values()].map((r) => r.length));
      const plan = gridTrackPlan(tpl, cont.w, gapPt, () => 16);
      const mins = plan ? plan.toks.map((_t, k) => plan.fixed[k] ?? plan.b[k]) : [0];
      // (容器の幅で数えたより多くの列が並べば、増えた列は、いちばん狭い列の最小で数える)
      const extra = /auto-(fill|fit)/.test(tpl) ? Math.max(perRow - mins.length, 0) : 0;
      const minSum = mins.reduce((a, b) => a + b, 0) + extra * Math.min(...mins) + gapPt * (mins.length + extra - 1);
      // 列の最小の和が容器より広ければ (はみ出す)、最小の大きさが 0 の列は幅 0 になりうる (CSS Grid 1 §12.4)
      const tight = minSum >= cont.w - 0.6 || gapPt >= cont.w;
      for (const row of rows.values()) {
        row.sort((a, b) => a.x - b.x);
        row.forEach((b, k) => {
          if (!Number.isFinite(b.x) || !Number.isFinite(b.w) || b.w < 0) bad.push(`${tpl}: NaN/負 ${b.w}`);
          if (b.w < 0.5 && !tight) bad.push(`${tpl}: 幅 0`);
          if (k > 0 && row[k - 1].x + row[k - 1].w > b.x + 0.5) bad.push(`${tpl}: 重なり`);
          if (b.x + b.w > cont.x + cont.w + 0.6 && !tight) bad.push(`${tpl} (${cont.w}): はみ出し ${b.x + b.w - cont.x - cont.w}`);
        });
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

describe('SVG の開始タグ', () => {
  it('注釈・DOCTYPE・処理命令・CDATA の中の <svg …> を飛ばす', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const fake = `<?xml version="1.0"?><!-- ${'x'.repeat(5000)} <svg width="10" height="100"> --><!DOCTYPE svg [ <!ENTITY a "<svg width='1' height='1'>"> ]><svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"/>`;
    expect(headerSize(enc(fake), 'image/svg+xml')).toEqual({ width: 200, height: 50 });
    expect(svgStartTag(`<![CDATA[<svg width="1">]]><svg a=">" width="3">`)).toBe(`<svg a=">" width="3">`);
    // 開始タグが終わらなければ undefined (頭だけを読んだときは、全体で探し直す)
    expect(svgStartTag('<svg width="3"')).toBeUndefined();
  });

  it('> の無い <svg が続く細工したファイルでも、手間は長さに比例する', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const evil = enc('<!--' + ' '.repeat(5000) + '-->' + '<svg '.repeat(80_000));
    const t0 = cpuClock();
    expect(headerSize(evil, 'image/svg+xml')).toEqual({ width: 300, height: 150, noRatio: true });
    // 前は 400KB で 14 秒ほど (正規表現の 2 乗の手間)
    expect(cpuClock() - t0).toBeLessThan(scaled(1000));
  });
});

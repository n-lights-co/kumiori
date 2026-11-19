/**
 * 公開の前の脆弱性検査 (5 回目): grid の列の数が上限 (repeat() の回数 10000) まであるときの手間
 *  - 列の決め方 (gridTrackPlan) を、展開した列ごとに読み直さず、語の種類ごとに 1 度だけ読む。同じ入力の計画は覚えて返す
 *  - 中身の幅を測る組版で、行の表ごとに計画を作り直さず、行ごとに grid の全部の列をなめない
 *  - どちらも、列の幅・中身の幅の結果は変えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import { gridTrackPlan, gridTracks } from '../src/gridTracks';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const doc = (body: string, css = '') =>
  `<!doctype html><html lang="en"><head><style>@page{size:300pt 300pt;margin:20pt} body{margin:0;font:10pt/12pt serif} ${css}</style></head><body>${body}</body></html>`;

/** 背景の色 (#rrggbb) ごとの箱の幅 */
async function widths(html: string) {
  const r = await typesetHtml(html, { loadFont: loadCachedFont });
  const out = new Map<string, number[]>();
  r.areaTree.sheets.forEach((sh) => {
    const rec = (a: AreaNode) => {
      const g = a as unknown as { width?: number; backgroundColor?: string };
      const key = g.backgroundColor && g.backgroundColor !== 'transparent' ? String(g.backgroundColor).toLowerCase() : undefined;
      if (key && a.type !== 'line' && a.type !== 'inline') out.set(key, [...(out.get(key) ?? []), g.width ?? 0]);
      for (const c of childrenOf(a)) rec(c);
    };
    rec(sh.page as unknown as AreaNode);
  });
  return out;
}

describe('列の数が上限まである grid', () => {
  it('repeat(10000, minmax(1px, 1fr)) の grid の容器を 500 個並べても、すぐに組み終わる', async () => {
    const body = Array.from({ length: 500 }, (_, j) => `<div class="g"><div>x${j}</div></div>`).join('');
    const t0 = Date.now();
    const r = await typesetHtml(doc(body, '.g{display:grid;grid-template-columns:repeat(10000, minmax(1px, 1fr))}'), { loadFont: loadCachedFont });
    expect(r.pageCount).toBeGreaterThan(1);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 120_000);

  it('float の中の grid (中身の幅を測る組版) に、列を全部占める項目を 1600 個並べても、すぐに組み終わる', async () => {
    const items = Array.from({ length: 1600 }, (_, j) => `<div style="grid-column:span 10000">x${j}</div>`).join('');
    const t0 = Date.now();
    const r = await typesetHtml(doc(`<div style="float:left"><div style="display:grid;grid-template-columns:repeat(10000, 1px)">${items}</div></div>`), { loadFont: loadCachedFont });
    expect(r.pageCount).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 120_000);

  it('覚えた計画は、作り直した計画と同じで、auto-fill の回数も受け渡す', () => {
    const v = 'repeat(auto-fill, minmax(30px, 1fr)) 10px';
    const fresh = gridTrackPlan(v, 200, 3, () => 0, {});
    const r1: { times?: number } = {};
    const a = gridTrackPlan(v, 200, 3, undefined, r1);
    const r2: { times?: number } = {};
    const b = gridTrackPlan(v, 200, 3, undefined, r2);
    expect(b).toBe(a);
    expect(r2.times).toBe(r1.times);
    expect(r1.times).toBeGreaterThan(1);
    expect(a).toEqual(fresh);
    // 呼び手が列の幅を書き換えても、次の呼び出しの値は変わらない
    const t = gridTracks(v, 200, 3);
    const t2 = t.slice();
    t[0] = -1;
    expect(gridTracks(v, 200, 3)).toEqual(t2);
  });

  it('中身の幅を測る組版で、行の項目が占めない列も、grid の中身の幅に数える', async () => {
    // 列 2 と 4 だけを占める項目: 占めない列 1・3・5 (20px ずつ) と間隔 (4 つ) も、float の幅に入る
    const items = '<div style="grid-column:2;background:#ff0000">a</div><div style="grid-column:4">b</div>';
    const w = await widths(doc(`<div style="float:left;background:#00ff00"><div style="display:grid;column-gap:2px;grid-template-columns:repeat(5, 20px)">${items}</div></div>`));
    expect(w.get('#00ff00')?.[0]).toBeCloseTo((5 * 20 + 4 * 2) * 0.75, 5);
    expect(w.get('#ff0000')?.[0]).toBeCloseTo(20 * 0.75, 5);
  });
});

/**
 * 中身の幅 (min-content・max-content。CSS Sizing 3 §5) の数え方: 自動の表の列の幅・shrink-to-fit の箱 (float・inline-block・絶対配置・
 * 表の見出し)・fit-content・flex の項目の中で、中の箱の寄与を正しく数える
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { childrenOf } from '../src/areaTree';
import type { Area } from '../src/types';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const PAGE = '@page { size: 400pt 600pt; margin: 0 } body { margin: 0; font-size: 10pt; line-height: 12pt } p { margin: 0 } td, th { padding: 0 } table { border-spacing: 0 }';
const LONG = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn '.repeat(3);

type Rect = { x: number; y: number; w: number; h: number };
/** 背景の色ごとの箱 (pt。ページの左上から) */
function rects(body: string, css = ''): Map<string, Rect[]> {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const all = PAGE + css;
  const tree = E.engine.layout(importHtml(d, cascadeStyles(d, all, { viewport: { width: 600, height: 800 } }), { css: all }).document);
  const out = new Map<string, Rect[]>();
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    const bg = (a as { backgroundColor?: string }).backgroundColor;
    if (bg && bg !== 'transparent') out.set(bg.toLowerCase(), [...(out.get(bg.toLowerCase()) ?? []), { x, y, w: a.width, h: a.height }]);
    if (a.type === 'glyph') return;
    for (const c of childrenOf(a)) rec(c, x + (a.border?.left?.width ?? 0) + (a.padding?.left ?? 0), y + (a.border?.top?.width ?? 0) + (a.padding?.top ?? 0));
  };
  tree.sheets.forEach((s) => rec(s.page, 0, 0));
  return out;
}
const blue = (body: string, css = '') => rects(body, css).get('#0000ff')![0];
/** 幅 400pt の表の 1 列目 (青) に x、2 列目 (緑) に長い文を置いたときの、2 つの列の箱 */
const cols = (x: string, table = 'width: 400pt') => {
  const r = rects(`<table style="${table}"><tr><td style="background: #00f">${x}</td><td style="background: #0f0">${LONG}</td></tr></table>`);
  return { a: r.get('#0000ff')![0], b: r.get('#00ff00')![0], red: r.get('#ff0000')?.[0] };
};

describe('自動の表の列の幅: セルの中の箱の寄与 (CSS Sizing 3 §5.1・§5.2.1)', () => {
  it('百分率の幅・max-width だけの箱・内容による下限の箱 (fieldset など) は、固定の幅として数えない (列が表の幅いっぱいにならない)', () => {
    for (const x of ['<div style="width: 100%">abc</div>', '<div style="width: 50%">abc</div>', '<div style="max-width: 300pt">abc</div>', '<div style="max-width: 50%">abc</div>', '<fieldset>abc</fieldset>', '<div style="min-width: min-content">abc</div>']) {
      const { a, b } = cols(x);
      expect(a.w, x).toBeLessThan(40);
      expect(b.w, x).toBeGreaterThan(355);
    }
  });

  it('max-width が長さの箱の寄与は、中身の幅を max-width で頭打ちにしたもの。組むときも、セルの幅に収める', () => {
    const { a, red } = cols(`<div style="max-width: 300pt; background: #f00">${LONG}</div>`);
    // 2 つの列の max-content は 300 と長い文の幅、min-content は 1 語: 表の幅を max-content の比で分ける
    expect(a.w).toBeGreaterThan(100);
    expect(a.w).toBeLessThan(200);
    // 箱はセルからはみ出さない
    expect(red!.w).toBeLessThanOrEqual(a.w + 0.01);
  });

  it('長さで幅を書いた箱は、その箱の外側の幅で数える (箱はセルからはみ出さない)', () => {
    expect(cols('<div style="width: 100pt">abc</div>').a.w).toBeCloseTo(100, 0);
    expect(cols('<div style="width: 100pt; margin: 0 auto">abc</div>').a.w).toBeCloseTo(100, 0);
    expect(cols('<div style="width: 20pt">abc def ghi</div>').a.w).toBeCloseTo(20, 0);
  });
});

describe('shrink-to-fit の箱の中のリスト (CSS 2.1 §10.3.5・§10.3.7・§17.5.2.2)', () => {
  const ul = `<ul><li>${LONG}</li></ul>`;
  it('float・絶対配置の中のリストの項目が使える幅より長ければ、箱は使える幅 (max-content の幅にしない)', () => {
    expect(blue(`<div style="float: left; background: #00f">${ul}</div>after`).w).toBeCloseTo(400, 0);
    const r = blue(`<div style="float: right; background: #00f"><ol><li>${LONG}</li></ol></div>after`);
    expect([r.x, r.w]).toEqual([expect.closeTo(0, 0), expect.closeTo(400, 0)]);
    expect(blue(`<div style="float: left; background: #00f"><div style="display: list-item; margin-left: 20pt">${LONG}</div></div>`).w).toBeCloseTo(400, 0);
    expect(blue(`<div style="position: relative; height: 80pt"><div style="position: absolute; left: 0; top: 0; background: #00f">${ul}</div></div>`).w).toBeCloseTo(400, 0);
    // 縦書きの float は、行の向き (高さ) の使える長さ
    expect(blue(`<div style="writing-mode: vertical-rl; height: 250pt"><div style="float: left; background: #00f"><ul><li>${'縦の長い項目'.repeat(10)}</li></ul></div>後</div>`).h).toBeCloseTo(250, 0);
    // 中身の短いリストは、中身の幅に縮む
    expect(blue('<div style="float: left; background: #00f"><ul><li>abc def</li></ul></div>after').w).toBeLessThan(100);
  });

  it('表の見出しの最小の幅 (CAPMIN) は、中のリストの min-content (字下げ + いちばん長い語)', () => {
    const cap = blue(`<table><caption style="background: #00f">${ul}</caption><tr><td>x</td></tr></table>`);
    expect(cap.w).toBeLessThan(60);
  });
});

describe('中身の幅が置く場所いっぱいにならない中身 (CSS Sizing 3 §5)', () => {
  const ib = (x: string, css = '') => blue(`<div><span style="display: inline-block; background: #00f">${x}</span></div>`, css);
  const fl = (x: string, css = '') => blue(`<div style="float: left; background: #00f">${x}</div>`, css);

  it('inline-block の中のリスト・リーダー・伸びる flex の項目は、float の中と同じ幅 (CSS 2.1 §10.3.9)', () => {
    for (const [x, css] of [
      ['<ul><li>abc</li></ul>', ''],
      ["<p class='ld'>abc</p>", ".ld::after { content: leader('.') '5' }"],
      ["<div style='display: flex'><span style='flex: 1'>abc</span><span>def</span></div>", ''],
    ]) {
      const w = ib(x, css).w;
      expect(w, x).toBeLessThan(60);
      expect(w, x).toBeCloseTo(fl(x, css).w, 0);
    }
    // 中身が使える幅より長ければ、使える幅
    expect(ib(LONG).w).toBeCloseTo(400, 0);
  });

  it('grid の容器: 長さの列は列の和、fr の列は fr の 1 つ分 × 比 (いちばん広い項目で決まる)、列の指定が無ければ項目の幅 (CSS Grid 1 §12.7)', () => {
    const g20 = "<div style='display: grid; grid-template-columns: 20pt 20pt'><span>a</span><span>b</span></div>";
    expect(fl(g20).w).toBeCloseTo(40, 0);
    expect(ib(g20).w).toBeCloseTo(40, 0);
    expect(cols(g20, '').a.w).toBeCloseTo(40, 0);
    const r = rects("<div style='float: left; background: #00f'><div style='display: grid; grid-template-columns: 1fr 1fr'><span style='background: #f00'>abc</span><span style='background: #0f0'>d</span></div></div>");
    const box = r.get('#0000ff')![0];
    const a = r.get('#ff0000')![0];
    const b = r.get('#00ff00')![0];
    // 2 つの列は同じ幅 (広い方の項目の幅)
    expect(box.w).toBeCloseTo(2 * a.w, 0);
    expect(b.x).toBeCloseTo(box.w / 2, 0);
    expect(fl("<div style='display: grid'><span>abc</span><span>de</span></div>").w).toBeLessThan(20);
    // 置く場所の幅で組む grid は、これまでどおり列を等分する
    const blk = rects("<div style='display: grid; grid-template-columns: 1fr 1fr; background: #00f'><span style='background: #f00'>abc</span><span>d</span></div>");
    expect([blk.get('#0000ff')![0].w, blk.get('#ff0000')![0].w]).toEqual([expect.closeTo(400, 0), expect.closeTo(200, 0)]);
  });

  it('text-align-last: justify・text-align: justify-all の行は、両端揃えで広げた長さを数えない (CSS Text 3 §7)', () => {
    for (const s of ['text-align-last: justify', 'text-align: justify-all']) {
      const r = rects(`<table><tr><th style="${s}; background: #00f">氏名</th><td style="background: #0f0">${LONG}</td></tr></table>`);
      expect(r.get('#0000ff')![0].w, s).toBeLessThan(40);
      expect(fl(`<div style="${s}">abc def</div>`).w, s).toBeLessThan(40);
    }
  });

  it('中の絶対配置の箱は、外の箱の中身の幅に数えない (CSS 2.1 §9.3.1・§10.1)', () => {
    const abs = "<div style='position: relative'>abc<div style='position: absolute; top: 0; left: 0'>xxxxxxxxxxxxxxxxxxxxxx</div></div>";
    expect(fl(abs).w).toBeLessThan(20);
    expect(cols(abs, '').a.w).toBeLessThan(20);
  });
});

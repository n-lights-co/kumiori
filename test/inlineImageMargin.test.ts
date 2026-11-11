/**
 * 行内の画像の margin (OUT-19)。置換要素の行内の箱には、4 辺の margin が効く
 * (CSS 2.1 §8.3: 上下の margin が効かないのは、置換要素でない行内の箱だけ。§10.8: 行の箱の中での高さは margin の箱の高さ。
 * §10.8.1: 基線の無い箱は、下の margin の端を基線に揃える。§10.3.2: auto は 0)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';
import type { Area, GlyphArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

interface Placed {
  a: Area;
  x: number;
  y: number;
}
function typeset(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const styles = cascadeStyles(d, css, { viewport: { width: 600, height: 800 } });
  const imported = importHtml(d, styles, { css });
  const out: Placed[] = [];
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    out.push({ a, x, y });
    for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
  };
  E.engine.layout(imported.document).sheets.forEach((s) => rec(s.page, 0, 0));
  return { ps: out, unsupported: imported.report.unsupported ?? {} };
}
const images = (ps: Placed[]) => ps.filter((p) => p.a.type === 'image');
const glyph = (ps: Placed[], ch: string) => ps.find((p) => p.a.type === 'glyph' && (p.a as GlyphArea).text === ch) as Placed & { a: GlyphArea };
const lines = (ps: Placed[]) => ps.filter((p) => p.a.type === 'line');
const P = 'font-size: 10pt; line-height: 20pt; margin: 0; text-indent: 0;';
const IMG = 'width: 30pt; height: 12pt;';

describe('行内の画像の margin (CSS 2.1 §8.3・§10.8)', () => {
  it('左右の margin: 前後の字・画像との間が空く', () => {
    const { ps } = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} margin: 0 6pt 0 9pt"><img src="a.png" style="${IMG} margin-left: 3pt">後</p>`);
    const [a, b] = images(ps);
    const before = glyph(ps, '前');
    const after = glyph(ps, '後');
    expect(a.x - (before.x + 10)).toBeCloseTo(9, 2);
    expect(b.x - (a.x + 30)).toBeCloseTo(6 + 3, 2);
    expect(after.x - (b.x + 30)).toBeCloseTo(0, 2);
  });

  it('下の margin: 画像の下端が、基線より margin の分だけ上がる。上の margin: 行の箱が高くなる', () => {
    const base = typeset(`<p style="${P}">前<img src="a.png" style="${IMG}">後</p>`).ps;
    const baseline = (ps: Placed[]) => glyph(ps, '前').y + glyph(ps, '前').a.baselineY;
    // margin の無い画像の下端は基線
    expect(images(base)[0].y + 12).toBeCloseTo(baseline(base), 2);
    const low = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} margin-bottom: 5pt">後</p>`).ps;
    expect(baseline(low) - (images(low)[0].y + 12)).toBeCloseTo(5, 2);
    // 上の margin 20pt: 画像の箱 (12 + 20 = 32pt) が行の高さ (20pt) を超えるので、行の箱が高くなる (画像の下端は基線のまま)
    const tall = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} margin-top: 20pt">後</p>`).ps;
    expect(images(tall)[0].y + 12).toBeCloseTo(baseline(tall), 2);
    expect(lines(tall)[0].a.height).toBeGreaterThan(lines(base)[0].a.height + 5);
  });

  it('auto は 0。負の margin は、次の字を画像に寄せる', () => {
    const auto = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} margin: auto">後</p>`).ps;
    expect(glyph(auto, '後').x - (images(auto)[0].x + 30)).toBeCloseTo(0, 2);
    expect(images(auto)[0].x - (glyph(auto, '前').x + 10)).toBeCloseTo(0, 2);
    const neg = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} margin-right: -4pt">後</p>`).ps;
    expect(glyph(neg, '後').x - (images(neg)[0].x + 30)).toBeCloseTo(-4, 2);
  });

  it('縦書き: 上下の margin が行の中の空きになる', () => {
    const { ps } = typeset(`<div style="writing-mode: vertical-rl; height: 200pt; ${P}">前<img src="a.png" style="width: 12pt; height: 30pt; margin: 7pt 0 4pt">後</div>`);
    const img = images(ps)[0];
    expect(img.y - (glyph(ps, '前').y + 10)).toBeCloseTo(7, 2);
    expect(glyph(ps, '後').y - (img.y + 30)).toBeCloseTo(4, 2);
  });

  it('ブロックの画像・回り込みの画像の margin は、今までどおり (画像そのものには付けない)', () => {
    const { ps } = typeset(`<div style="${P}"><img src="a.png" style="display: block; ${IMG} margin: 0 0 0 8pt"><img src="b.png" style="float: left; ${IMG} margin: 0 6pt 0 4pt">横の字</div>`);
    const [blockImg, floatImg] = images(ps);
    // ブロックの画像: 左の余白 8pt (余白の無い画像の位置から)
    const outer = typeset(`<div style="${P}"><img src="a.png" style="display: block; ${IMG}"></div>`).ps;
    expect(blockImg.x - images(outer)[0].x).toBeCloseTo(8, 2);
    // 回り込みの画像の右の余白 6pt の先から、横の字が始まる
    expect(glyph(ps, '横').x - (floatImg.x + 30)).toBeCloseTo(6, 2);
  });

  it('罫線のある行内の画像: margin は罫線の外に付く。罫線・padding・上下の margin も行の高さに入る (CSS 2.1 §10.8。前後の行に重ならない)', () => {
    const r = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} border: 3pt solid #000; margin: 5pt 6pt">後</p>`);
    const img = images(r.ps)[0];
    // 前の字 + 左の margin 6 + 罫線 3
    expect(img.x - (glyph(r.ps, '前').x + 10)).toBeCloseTo(6 + 3, 2);
    expect(glyph(r.ps, '後').x - (img.x + 30)).toBeCloseTo(3 + 6, 2);
    expect(Object.keys(r.unsupported).some((k) => k.startsWith('margin-top・margin-bottom'))).toBe(false);
    // 画像の下端は、基線 (後の字の基線) より 下の margin 5 + 罫線 3 上
    const base = glyph(r.ps, '後').y + glyph(r.ps, '後').a.baselineY;
    expect(base - (img.y + img.a.height)).toBeCloseTo(5 + 3, 1);
    // 行の箱は、上の margin の端 (画像の上端 − 罫線 3 − 上の margin 5) まで高い
    const line = lines(r.ps).find((l) => l.y <= img.y && img.y < l.y + l.a.height)!;
    expect(img.y - 3 - 5).toBeGreaterThanOrEqual(line.y - 0.01);
  });
});

describe('行内の svg・object の margin (HTM-30 (6))', () => {
  it('行内の <svg> と画像の <object> にも、img と同じく 4 辺の margin を付ける (百分率は包含ブロックの幅に対して)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16" style="margin: 0 5pt 0 7pt"><rect width="40" height="16"/></svg>';
    const r = typeset(`<p style="${P}">前${svg}後</p>`);
    const img = images(r.ps)[0];
    expect(img.x - (glyph(r.ps, '前').x + 10)).toBeCloseTo(7, 2);
    expect(glyph(r.ps, '後').x - (img.x + 30)).toBeCloseTo(5, 2);
    // 百分率: 幅 200pt の段落の 10% = 20pt
    const q = typeset(`<p style="${P} width: 200pt">前<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16" style="margin: 0 10%"><rect width="40" height="16"/></svg>後</p>`);
    const qi = images(q.ps)[0];
    expect(qi.x - (glyph(q.ps, '前').x + 10)).toBeCloseTo(20, 2);
  });
  it('回り込み・ブロックの <svg>・<object> の margin は、その箱に 1 度だけ (画像に二重に付けない。見本の CSS-Print 第 4 版の object { float: right; margin-right: 9pt })', () => {
    const s = (st: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16" style="${st}"><rect width="40" height="16"/></svg>`;
    const right = (st: string) => {
      const r = typeset(`<div style="width: 200pt">${s(st)}<p style="${P}">本文</p></div>`);
      const img = images(r.ps)[0];
      return img.x + img.a.width;
    };
    expect(right('float: right') - right('float: right; margin-right: 9pt')).toBeCloseTo(9, 2);
    const left = (st: string) => images(typeset(`<div style="width: 200pt">${s(st)}</div>`).ps)[0].x;
    expect(left('display: block; margin-left: 9pt') - left('display: block')).toBeCloseTo(9, 2);
  });
});

describe('負の text-indent の inline-block の幅 (HTM-30 (4))', () => {
  it('中身の幅 (shrink-to-fit) から、負の字下げの分を引く (Chromium と同じ。CSS Text 3 §8.1: 字下げは行の箱の始めの側の margin)', () => {
    const one = (indent: string) => {
      const r = typeset(`<p style="${P}">前<span style="display: inline-block; text-indent: ${indent}">一二三四</span>後</p>`);
      return glyph(r.ps, '後').x - glyph(r.ps, '前').x;
    };
    // 字下げなし: 前 10 + 箱 40。字下げ −20pt: 箱は 20pt 狭い。正の字下げ 10pt: 10pt 広い (前から)
    expect(one('0')).toBeCloseTo(50, 1);
    expect(one('-20pt')).toBeCloseTo(30, 1);
    expect(one('10pt')).toBeCloseTo(60, 1);
  });
});

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

  it('罫線のある行内の画像: 左右の margin は枠の外に付く。上下の margin は未対応として知らせる', () => {
    const r = typeset(`<p style="${P}">前<img src="a.png" style="${IMG} border: 3pt solid #000; margin: 5pt 6pt">後</p>`);
    const img = images(r.ps)[0];
    // 前の字 + 左の margin 6 + 罫線 3
    expect(img.x - (glyph(r.ps, '前').x + 10)).toBeCloseTo(6 + 3, 2);
    expect(glyph(r.ps, '後').x - (img.x + 30)).toBeCloseTo(3 + 6, 2);
    expect(Object.keys(r.unsupported).some((k) => k.startsWith('margin-top・margin-bottom'))).toBe(true);
  });
});

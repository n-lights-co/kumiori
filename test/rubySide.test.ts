/**
 * 縦書き (vertical-lr) のルビ・圏点の側と、下側のルビの行の空き (NC-18 の (3)(4))。
 *  - CSS Writing Modes 3 §6.3・§6.4: 行の上側 (line-over) は、vertical-rl でも vertical-lr でも右、下側 (line-under) は左
 *  - CSS Ruby 1 §4.1: ruby-position の over は line-over (縦書きは右)、under は line-under (縦書きは左)
 *  - CSS Text Decoration 4 §3.4: text-emphasis-position の縦書きの側は right・left (物理の向き。省略は right)
 *  - CSS Ruby 1 §3.6: line-height が、上の注釈の上端から下の注釈の下端までより小さいとき、同じ行を重ねても注釈が重ならないだけの空きを、
 *    注釈のある側に足す
 *  - 指定の無い 2 段目のルビと、下側 (横書き)・左側 (vertical-rl) の圏点も、同じ決まり (CSS Text Decoration 4 §3.4: 圏点の行の高さへの効き方はルビと同じ)
 * 横書き・vertical-rl の結果と、XSL-FO の tb-lr のルビ (fo:inline-container からの読み替え。前の側 = 左) は変わらない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importHtml } from '../src/htmlImport';
import { importXslFo } from '../src/xslfoImport';
const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
import type { Area, GlyphArea, RubyArea } from '../src/types';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { childrenOf } from '../src/areaTree';
import { makeEngine } from './helpers';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});
const imp = (body: string, extraCss = '') => {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  const css = `@page { size: A5; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 2 } p { margin: 0 } ${extraCss}`;
  return importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css }).document;
};
interface Laid {
  rubies: Array<{ base: GlyphArea[]; ruby: GlyphArea[] }>;
  lines: Array<{ x: number; y: number; width: number; height: number }>;
  glyphs: Array<{ text: string; x: number; y: number; width: number; height: number; size: number }>;
}
const scan = (document: ReturnType<typeof imp>): Laid => {
  const out: Laid = { rubies: [], lines: [], glyphs: [] };
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'ruby') {
      const abs = (g: GlyphArea) => ({ ...g, x: x + g.x, y: y + g.y });
      out.rubies.push({ base: (a as RubyArea).base.map(abs), ruby: (a as RubyArea).ruby.map(abs) });
    }
    if (a.type === 'line') out.lines.push({ x, y, width: a.width, height: a.height });
    if (a.type === 'glyph') out.glyphs.push({ text: (a as GlyphArea).text, x, y, width: a.width, height: a.height, size: (a as GlyphArea).fontSize });
    for (const c of childrenOf(a)) rec(c, x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0), y + (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0));
  };
  for (const s of E.engine.layout(document).sheets) rec(s.page, 0, 0);
  return out;
};
const laid = (body: string, css = '') => scan(imp(body, css));
/**
 * 横書きの行の、字の行 (半行間を除いた 1em) の上端から、字の枠 (em の箱) の上端まで (pt。字は 10pt)。行の基線は、最初に使える書体
 * (このテストの書体は Noto Serif JP だけ。hhea の ascent 1.151・descent 0.286) の値で、行内の箱の上端から
 * (line-height + (1.151 − 0.286) × 10) / 2 (CSS Inline 3 §5.3)。字の枠の上端は基線から 0.88em 上なので、
 * ((1.151 − 0.286) / 2 − (0.88 − 0.5)) × 10 = 0.525pt (基線を em の箱の 0.88 の所に置いていたときは 0)
 */
const EM = ((1.151 - 0.286) / 2 - (0.88 - 0.5)) * 10;
const V = (wm: string, inner: string, style = '') => `<div style="writing-mode: ${wm}; height: 60mm; ${style}">${inner}</div>`;
/** ルビの字が親文字の右にあるか (字の箱の中央どうしを比べる) */
const rightOf = (r: { base: GlyphArea[]; ruby: GlyphArea[] }, k = 0) => r.ruby[k].x + r.ruby[k].width / 2 > r.base[0].x + r.base[0].width / 2;

describe('縦書きのルビの側 (CSS Ruby 1 §4.1・CSS Writing Modes 3 §6.4)', () => {
  it('vertical-rl: 指定の無いルビ (over) は右、under は左 (これまでどおり)', () => {
    expect(rightOf(laid(V('vertical-rl', '<p><ruby>漢<rt>かん</rt></ruby></p>')).rubies[0])).toBe(true);
    expect(rightOf(laid(V('vertical-rl', '<p style="ruby-position: under"><ruby>漢<rt>かん</rt></ruby></p>')).rubies[0])).toBe(false);
  });
  it('vertical-lr: 指定の無いルビ (over) は右 (行の上側は、vertical-lr でも右)、under は左', () => {
    const over = laid(V('vertical-lr', '<p><ruby>漢<rt>かん</rt></ruby></p>')).rubies[0];
    expect(rightOf(over)).toBe(true);
    // 親文字のすぐ右 (親文字の箱の右端から)
    expect(over.ruby[0].x).toBeCloseTo(over.base[0].x + over.base[0].width, 1);
    const under = laid(V('vertical-lr', '<p style="ruby-position: under"><ruby>漢<rt>かん</rt></ruby></p>')).rubies[0];
    expect(rightOf(under)).toBe(false);
    expect(under.ruby[0].x + under.ruby[0].width).toBeCloseTo(under.base[0].x, 1);
  });
  it('vertical-lr の 2 段のルビ: 1 段目 (over) が右、2 段目 (alternate で逆の側) が左。色も段に付いていく', () => {
    const r = laid(V('vertical-lr', '<p><ruby>東<rt style="color: #ff0000">とう</rt><rtc style="color: #0000ff">T</rtc></ruby></p>')).rubies[0];
    const first = r.ruby.filter((g) => g.text !== 'T');
    const second = r.ruby.filter((g) => g.text === 'T');
    expect(first.every((g) => g.x > r.base[0].x)).toBe(true);
    expect(second.every((g) => g.x < r.base[0].x)).toBe(true);
    expect(first[0].color).toBe('#ff0000');
    expect(second[0].color).toBe('#0000ff');
  });
  it('vertical-lr でも、字の位置と行の位置は、ルビを置く側だけが変わる (行の幅は同じ)', () => {
    const a = laid(V('vertical-lr', '<p>あ<ruby>漢<rt>かん</rt></ruby>い</p><p>う</p>'));
    expect(a.lines.map((l) => l.width)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
    // 1 行目は左の端から。親文字は、ルビの無い字と同じ列
    expect(a.rubies[0].base[0].x).toBeCloseTo(a.glyphs.find((g) => g.text === 'あ')!.x, 1);
  });
});

describe('縦書きの圏点の側 (CSS Text Decoration 4 §3.4: right・left は物理の向き。省略は right)', () => {
  const marks = (wm: string, pos: string) => laid(V(wm, `<p style="text-emphasis: sesame; ${pos ? `text-emphasis-position: ${pos}` : ''}">強調</p>`)).rubies;
  it('vertical-rl: 指定なし・over right は右、over left は左 (これまでどおり)', () => {
    expect(marks('vertical-rl', '').every((r) => rightOf(r))).toBe(true);
    expect(marks('vertical-rl', 'over right').every((r) => rightOf(r))).toBe(true);
    expect(marks('vertical-rl', 'over left').every((r) => !rightOf(r))).toBe(true);
  });
  it('vertical-lr: 指定なし・over right は右、over left は左', () => {
    expect(marks('vertical-lr', '').length).toBe(2);
    expect(marks('vertical-lr', '').every((r) => rightOf(r))).toBe(true);
    expect(marks('vertical-lr', 'over right').every((r) => rightOf(r))).toBe(true);
    expect(marks('vertical-lr', 'under right').every((r) => rightOf(r))).toBe(true);
    expect(marks('vertical-lr', 'over left').every((r) => !rightOf(r))).toBe(true);
  });
});

describe('下側のルビの行の空き (CSS Ruby 1 §3.6: 注釈のある側に足す)', () => {
  // 字 10pt・ルビ 5pt。line-height: 1 (行間 0) なので、ルビの厚さ 5pt が足りない
  const css = 'p { line-height: 1 }';
  it('横書き: 下側のルビの行の下に、ルビの分を空ける (次のルビの無い行と重ならない)', () => {
    const a = laid('<p style="ruby-position: under">あ<ruby>漢<rt>かん</rt></ruby></p><p>次</p>', css);
    const ruby = a.rubies[0].ruby[0];
    const next = a.glyphs.find((g) => g.text === '次')!;
    expect(ruby.y).toBeCloseTo(a.rubies[0].base[0].y + 10, 1);
    // ルビの下端 ≦ 次の行の字の上端
    expect(next.y).toBeGreaterThanOrEqual(ruby.y + 5 - 0.01);
    // 行の高さは 字 10 + ルビ 5。字の行は行の上端から (上には空けない)
    expect(a.lines[0].height).toBeCloseTo(15, 1);
    expect(a.rubies[0].base[0].y).toBeCloseTo(a.lines[0].y + EM, 1);
  });
  it('横書き: 上側のルビは、これまでどおり行の上に空ける (下側と対称)', () => {
    const a = laid('<p>前</p><p>あ<ruby>漢<rt>かん</rt></ruby></p>', css);
    expect(a.lines[1].height).toBeCloseTo(15, 1);
    expect(a.rubies[0].base[0].y).toBeCloseTo(a.lines[1].y + 5 + EM, 1);
    expect(a.rubies[0].ruby[0].y).toBeGreaterThanOrEqual(a.glyphs.find((g) => g.text === '前')!.y + 10 - 0.01);
  });
  it('line-height に余裕があれば、下側のルビでも行の高さは変わらない', () => {
    const a = laid('<p style="ruby-position: under">あ<ruby>漢<rt>かん</rt></ruby></p><p>次</p>', 'p { line-height: 2 }');
    expect(a.lines.map((l) => l.height)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
  });
  it('上下の 2 段のルビ (ruby-position: under と 2 段目): 足りない分を、上と下に、それぞれの厚さの割合で分ける', () => {
    const a = laid('<p>前</p><p style="ruby-position: under"><ruby>東<rt>とう</rt><rtc>T</rtc></ruby></p><p>次</p>', css);
    expect(a.lines[1].height).toBeCloseTo(20, 1);
    expect(a.rubies[0].base[0].y).toBeCloseTo(a.lines[1].y + 5 + EM, 1);
  });
  it('縦書き (vertical-rl) の左のルビ: 行の左に空ける。vertical-lr の右のルビ (over): 行の右に空ける', () => {
    const rl = laid(V('vertical-rl', '<p style="ruby-position: under">あ<ruby>漢<rt>かん</rt></ruby></p><p>次</p>'), css);
    const next = rl.glyphs.find((g) => g.text === '次')!;
    expect(next.x + next.width).toBeLessThanOrEqual(rl.rubies[0].ruby[0].x + 0.01);
    expect(rl.lines[0].width).toBeCloseTo(15, 1);
    const lr = laid(V('vertical-lr', '<p>あ<ruby>漢<rt>かん</rt></ruby></p><p>次</p>'), css);
    const n2 = lr.glyphs.find((g) => g.text === '次')!;
    expect(n2.x).toBeGreaterThanOrEqual(lr.rubies[0].ruby[0].x + 5 - 0.01);
    expect(lr.lines[0].width).toBeCloseTo(15, 1);
    // vertical-lr の 1 行目の親文字は、左の端から (左には空けない)
    expect(lr.rubies[0].base[0].x).toBeCloseTo(lr.lines[0].x, 1);
  });
});

describe('2 段目のルビ (指定なし) と、下側 (横書き)・左側 (vertical-rl) の圏点の行の空き (CSS Ruby 1 §3.6・CSS Text Decoration 4 §3.4)', () => {
  // 字 10pt・注釈 5pt
  const two = '<ruby>東<rt>とう</rt><rtc>T</rtc></ruby>';
  const dots = (pos: string) => `<span style="text-emphasis: dot; text-emphasis-position: ${pos}">強調</span>`;
  it('行間に収まれば、行を高くしない (line-height: 2 は 20pt のまま)', () => {
    const lh2 = 'p { line-height: 2 }';
    expect(laid(`<p>あ${two}</p><p>次</p>`, lh2).lines.map((l) => l.height)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
    expect(laid(`<p>あ${dots('under right')}</p><p>次</p>`, lh2).lines.map((l) => l.height)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
    // 字の位置も、注釈の無い行と同じ
    const plain = laid('<p>あ強調</p><p>次</p>', lh2);
    const under = laid(`<p>あ${dots('under right')}</p><p>次</p>`, lh2);
    expect(under.glyphs.find((g) => g.text === 'あ')!.y).toBeCloseTo(plain.glyphs.find((g) => g.text === 'あ')!.y, 2);
    expect(under.glyphs.find((g) => g.text === '次')!.y).toBeCloseTo(plain.glyphs.find((g) => g.text === '次')!.y, 2);
    // vertical-rl の左の圏点: 行の幅は 20pt のまま
    expect(laid(V('vertical-rl', `<p>あ${dots('over left')}</p><p>次</p>`), lh2).lines.map((l) => l.width)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
  });
  it('行間に収まらない分だけ、注釈のある側に空ける', () => {
    const lh1 = 'p { line-height: 1 }';
    // 下側の圏点 (5pt): 行の下に 5pt。字は行の上端から
    const d = laid(`<p>あ${dots('under right')}</p><p>次</p>`, lh1);
    expect(d.lines[0].height).toBeCloseTo(15, 1);
    expect(d.glyphs.find((g) => g.text === 'あ')!.y).toBeCloseTo(d.lines[0].y + EM, 1);
    // 2 段のルビ (上 5pt・下 5pt): 上と下に 5pt ずつ
    const t = laid(`<p>前</p><p>${two}</p><p>次</p>`, lh1);
    expect(t.lines[1].height).toBeCloseTo(20, 1);
    expect(t.rubies[0].base[0].y).toBeCloseTo(t.lines[1].y + 5 + EM, 1);
    // 行間 4pt (line-height: 1.4) に 5pt の圏点: 足りない 1pt だけ
    expect(laid(`<p>あ${dots('under right')}</p>`, 'p { line-height: 1.4 }').lines[0].height).toBeCloseTo(15, 1);
    // vertical-rl の左の圏点: 行の左 (後ろ側) に 5pt
    const v = laid(V('vertical-rl', `<p>あ${dots('over left')}</p><p>次</p>`), lh1);
    expect(v.lines[0].width).toBeCloseTo(15, 1);
  });
  it('上側のルビ・圏点 (日本語の横書きの既定) は、これまでどおり', () => {
    const lh2 = 'p { line-height: 2 }';
    expect(laid(`<p>あ${dots('over right')}</p><p>次</p>`, lh2).lines.map((l) => l.height)).toEqual([20, 20].map((v) => expect.closeTo(v, 1)));
    const lh1 = laid(`<p>前</p><p>あ${dots('over right')}</p>`, 'p { line-height: 1 }');
    expect(lh1.lines[1].height).toBeCloseTo(15, 1);
    expect(lh1.glyphs.find((g) => g.text === 'あ')!.y).toBeCloseTo(lh1.lines[1].y + 5 + EM, 1);
  });
});

// この読み替えは、互換モード (compat: 'antenna') のときだけ行う (仕様モードでは fo:inline-container として組む。XSL 1.1 §6.6.8)
describe('XSL-FO の tb-lr のルビ (互換モードの、fo:inline-container からの読み替え) は、これまでどおり前の側 (左)', () => {
  it('ルビのブロックが親文字のブロックの前 (左) に積まれる入力なので、左に置く', () => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200pt" page-height="200pt" margin="20pt"><fo:region-body writing-mode="tb-lr"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p" writing-mode="tb-lr"><fo:flow flow-name="xsl-region-body"><fo:block font-size="10pt" line-height="2">あ<fo:inline-container alignment-baseline="central" text-indent="0mm" last-line-end-indent="0mm" start-indent="0mm" end-indent="0mm" text-align="center" text-align-last="center"><fo:block font-size="5pt" line-height="1">かん</fo:block><fo:block line-height="1">漢</fo:block></fo:inline-container></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const a = scan(importXslFo(fo, parse, { compat: 'antenna' }).document);
    expect(a.rubies.length).toBe(1);
    expect(rightOf(a.rubies[0])).toBe(false);
  });
});

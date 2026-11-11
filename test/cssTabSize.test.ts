/**
 * タブ位置の間隔 (CSS の tab-size) と、残したタブ (U+0009) の組み方。CSS Text 3
 * (https://www.w3.org/TR/css-text-3/ 、2026-11-11 取得の 2026-08-14 版):
 *  - §4.2: tab-size は <number [0,∞]> | <length [0,∞]>。初期値 8。継承する。数は、タブにいちばん近いブロック容器の空白の字 (U+0020) の
 *    送り (字間・語間を含む) の何倍か
 *  - §4.1.2: 残したタブは、次の字の始まりを次のタブ位置にそろえる送りとして描く。タブ位置は、ブロック容器の内容の始まりの端から、
 *    タブ位置の間隔の倍数の所。次のタブ位置までが 0.5ch より短ければ、その次のタブ位置を使う。間隔が 0 なら、タブは描かない
 *  - タブを残すのは、white-space が pre・pre-wrap・break-spaces のとき (§3・§4.1.1)。ほかでは、空白の字と同じに詰める
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { parseCss } from '../src/htmlPaged';
import { unsupportedCssReport, UNSUPPORTED_CSS_PROPERTIES } from '../src/cssUnsupported';
import { paintSheet, type Painter } from '../src/paint';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, AreaTree, GlyphArea } from '../src/types';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const T = '\t';
const MM = 72 / 25.4;
/** ブロックの内容の端 (ページの余白 10mm) */
const X0 = 10 * MM;
// 等幅の書体 (Cousine。字の送りは 1229/2048 em: 10pt で約 6.001pt。空白も「0」も同じ)。位置は 0.1pt に丸めて比べる
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 150mm 100mm; margin: 10mm } body { margin: 0; font-size: 10pt; line-height: 15pt } p { margin: 0; text-indent: 0 } pre { margin: 0; font-family: monospace; font-size: 10pt; line-height: 15pt } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont });
/** 描いた字 (ページ番号を除く) の [字, Sheet の x, y] を、描く順に */
function glyphs(t: AreaTree): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  const p = new Proxy({} as Painter, {
    get:
      (_t, name) =>
      (...args: unknown[]) => {
        if (name === 'drawGlyph') out.push([(args[0] as GlyphArea).text, args[1] as number, args[2] as number]);
        for (const a of args) if (typeof a === 'function') (a as () => void)();
      },
  });
  for (const s of t.sheets) paintSheet(s, p);
  // ページの余白の箱 (ページ番号) は、本文の下
  return out.filter(([, , y]) => y < 85 * MM);
}
/** 字 ch の、ブロックの内容の端からの x (pt)。同じ字が何度も出るときは nth 番目 */
const xOf = (g: Array<[string, number, number]>, ch: string, nth = 0) => {
  const hit = g.filter(([c]) => c === ch)[nth];
  expect(hit, `字 ${ch}`).toBeDefined();
  return +(hit[1] - X0).toFixed(1);
};

describe('tab-size の値を読む (cssCascade)', () => {
  const cs = (css: string, body = '<p>x</p>') => {
    const doc = new DOMParser().parseFromString(`<html><head></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const el = doc.getElementsByTagName('p')[0] as unknown as Element;
    return cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el).getPropertyValue('tab-size');
  };
  it('初期値は 8。計算値は、指定した数か、絶対の長さ。継承する (§4.2)', () => {
    expect(cs('')).toBe('8');
    expect(cs('p { tab-size: 4 }')).toBe('4');
    expect(cs('p { tab-size: 2.5 }')).toBe('2.5');
    expect(cs('p { tab-size: 0 }')).toBe('0');
    expect(cs('p { tab-size: 30px }')).toBe('30px');
    expect(cs('p { font-size: 10px; tab-size: 3em }')).toBe('30px');
    expect(cs('p { tab-size: 12pt }')).toBe('16px');
    expect(cs('body { tab-size: 3 }')).toBe('3');
    expect(cs('body { tab-size: 3 } p { tab-size: initial }')).toBe('8');
  });
  it('読めない値の宣言は捨てる (負の値・百分率・語)。@supports も対応していないと答える', () => {
    for (const v of ['8', '0', '4', '1.5', '20px', '2em', '0px', 'calc(1em + 2px)']) expect(supportsCssDeclaration('tab-size', v), v).toBe(true);
    for (const v of ['-1', '-2px', '50%', 'auto', 'normal', '4 8', 'zzz']) expect(supportsCssDeclaration('tab-size', v), v).toBe(false);
    expect(cs('p { tab-size: 4; tab-size: -1; tab-size: 50%; tab-size: auto }')).toBe('4');
  });
  it('未対応の CSS の一覧に無い (警告に数えない)。接頭辞の付いた古い名前 (-moz-tab-size・-o-tab-size) は読まない (警告にも数えない)', () => {
    expect(UNSUPPORTED_CSS_PROPERTIES.has('tab-size')).toBe(false);
    expect(unsupportedCssReport(parseCss('pre { tab-size: 4; -moz-tab-size: 4; -o-tab-size: 4 }'))).toEqual({ unsupported: {}, unknown: {} });
    expect(cs('p { -moz-tab-size: 2; -o-tab-size: 2 }')).toBe('8');
  });
});

describe('残したタブを、次のタブ位置まで進める (§4.1.2)', () => {
  it('初期値は空白 8 つ分ごと。タブの字形 (字形の無い字の印) は描かない', async () => {
    const r = await set(page(`<pre>a${T}b${T}c\nabcdefg${T}h\nabcdefgh${T}i</pre>`));
    expect(r.warnings ?? []).toEqual([]);
    const g = glyphs(r.areaTree);
    expect(g.some(([c]) => c.includes(T))).toBe(false);
    // 1 行目: a は 0、b は 48pt (8 × 6pt)、c は 96pt
    expect([xOf(g, 'a'), xOf(g, 'b'), xOf(g, 'c')]).toEqual([0, 48, 96]);
    // 7 字の後のタブ: 次のタブ位置 (48pt) まで 1 字分 (0.5ch 以上) なので、h は 48pt
    expect(xOf(g, 'h', 0)).toBe(48);
    // 8 字の後 (ちょうどタブ位置) のタブ: 次のタブ位置 (96pt) へ
    expect(xOf(g, 'i')).toBe(96);
  });
  it('tab-size の数・長さ・0', async () => {
    const r = await set(
      page(`<pre style="tab-size: 4">a${T}b${T}${T}c</pre><pre style="tab-size: 2">d${T}e</pre><pre style="tab-size: 0">f${T}g${T}h</pre><pre style="tab-size: 30pt">i${T}j${T}k</pre><pre style="tab-size: 2.5em">l${T}m</pre><pre style="tab-size: 1.6">n${T}o${T}p</pre>`),
    );
    expect(r.warnings ?? []).toEqual([]);
    const g = glyphs(r.areaTree);
    // 4: 24pt ごと。続いたタブは、次の次のタブ位置へ
    expect([xOf(g, 'b'), xOf(g, 'c')]).toEqual([24, 72]);
    expect(xOf(g, 'e')).toBe(12);
    // 0: タブは描かない (前の字に続ける)
    expect([xOf(g, 'f'), xOf(g, 'g'), xOf(g, 'h')]).toEqual([0, 6, 12]);
    expect([xOf(g, 'j'), xOf(g, 'k')]).toEqual([30, 60]);
    // 2.5em = 25pt
    expect(xOf(g, 'm')).toBe(25);
    // 1.6 字分 = 9.6pt ごと: n (0〜6) の後は 9.6pt、o (9.6〜15.6) の後は 19.2pt
    expect([xOf(g, 'o'), xOf(g, 'p')]).toEqual([9.6, 19.2]);
  });
  it('次のタブ位置までが 0.5ch より短ければ、その次のタブ位置へ', async () => {
    // 字の送りは 6pt、0.5ch は 3pt。タブ位置の間隔 20pt: abc (18pt) の後は残り 2pt なので 40pt へ。ab (12pt) の後は 20pt へ
    // 間隔 21.2pt: def (18pt) の後は残り 3.2pt (0.5ch より短くない) なので 21.2pt へ。間隔 20.8pt: ghi の後は残り 2.8pt なので 41.6pt へ
    const r = await set(page(`<pre style="tab-size: 20pt">abc${T}x\nab${T}y</pre><pre style="tab-size: 21.2pt">def${T}z</pre><pre style="tab-size: 20.8pt">ghi${T}w</pre>`));
    const g = glyphs(r.areaTree);
    expect([xOf(g, 'x'), xOf(g, 'y'), xOf(g, 'z'), xOf(g, 'w')]).toEqual([40, 20, 21.2, 41.6]);
  });
  it('タブ位置は、ブロックの内容の端から数える (字下げ・padding)。折り返した後の行は、その行の始まりから', async () => {
    const r = await set(
      page(
        `<pre style="tab-size: 4; padding-left: 10pt; text-indent: 15pt">a${T}b\nc${T}d</pre><pre style="tab-size: 4; white-space: pre-wrap; width: 62pt">ef${T}gh${T}ij${T}kl${T}mn</pre>`,
      ),
    );
    const g = glyphs(r.areaTree);
    // 1 行目: 内容の端 (padding の内側 = 10pt) から、字下げ 15pt の後に a (15〜21pt)。次のタブ位置は 24pt。2 行目 (字下げなし): c の後は 24pt
    expect([xOf(g, 'a'), xOf(g, 'b'), xOf(g, 'c'), xOf(g, 'd')]).toEqual([25, 34, 10, 34]);
    // 幅 62pt で折り返す: ef → gh (24) → ij (48) で約 60pt。次の kl は次の行の頭、mn はその行の 24pt
    expect([xOf(g, 'e'), xOf(g, 'g'), xOf(g, 'i'), xOf(g, 'k'), xOf(g, 'm')]).toEqual([0, 24, 48, 0, 24]);
    const yOf = (ch: string) => g.find(([c]) => c === ch)![2];
    expect(yOf('k')).toBeGreaterThan(yOf('i'));
    expect(yOf('m')).toBe(yOf('k'));
  });
  it('数は、ブロックの空白の字の送りの何倍か: 字間・語間を含む (§4.2)。中の要素の書体が違っても、ブロックの書体で決める', async () => {
    const r = await set(
      page(
        `<pre style="tab-size: 4; letter-spacing: 2pt">a${T}b</pre><pre style="tab-size: 4; word-spacing: 3pt">c${T}d</pre><pre style="tab-size: 4">e<span style="font-size: 20pt">${T}f</span>${T}g</pre><div style="tab-size: 3"><pre>h${T}i</pre></div>`,
      ),
    );
    const g = glyphs(r.areaTree);
    // 字間 2pt: 空白の送りは 8pt → 32pt ごと
    expect(xOf(g, 'b')).toBe(32);
    // 語間 3pt: 空白の送りは 9pt → 36pt ごと
    expect(xOf(g, 'd')).toBe(36);
    // 中の span (20pt の字) のタブも、ブロックの空白 (6pt) の 4 倍 = 24pt ごと: f は 24pt、f (12pt 幅) の後は 48pt
    expect([xOf(g, 'f'), xOf(g, 'g')]).toEqual([24, 48]);
    // 継承した tab-size: 3
    expect(xOf(g, 'i')).toBe(18);
  });
  it('空白を詰める書式 (normal・nowrap・pre-line) の中のタブは、空白 1 つと同じ。pre-wrap・break-spaces はタブを残す', async () => {
    const r = await set(
      page(
        `<p style="font-family: monospace; tab-size: 4">a${T}${T}b</p><p style="font-family: monospace; tab-size: 4; white-space: pre-line">c${T}d</p><p style="font-family: monospace; tab-size: 4; white-space: nowrap">e${T} ${T}f</p><p style="font-family: monospace; tab-size: 4; white-space: pre-wrap">g${T}h</p><p style="font-family: monospace; tab-size: 4; white-space: break-spaces">i${T}j</p>`,
      ),
    );
    const g = glyphs(r.areaTree);
    expect([xOf(g, 'b'), xOf(g, 'd'), xOf(g, 'f')]).toEqual([12, 12, 12]);
    expect([xOf(g, 'h'), xOf(g, 'j')]).toEqual([24, 24]);
  });
  it('寄せ (右寄せ) の行でも、タブの幅は、寄せる前の行の始まりからの位置で決める。中身に合わせた幅は、タブの幅を含む', async () => {
    const r = await set(page(`<pre style="tab-size: 4; text-align: right; width: 100pt">a${T}b</pre><div style="display: inline-block; background: #ddd" id="ib"><pre style="tab-size: 4">c${T}d</pre></div>`));
    const g = glyphs(r.areaTree);
    // a${T}b の幅は 30pt (a は 0、b は 24〜30pt): 右寄せで a は 70pt、b は 94pt
    expect([xOf(g, 'a'), xOf(g, 'b')]).toEqual([70, 94]);
    const ib: Area[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type !== 'sheet' && (a as Area).backgroundColor === '#dddddd') ib.push(a as Area);
    });
    expect(ib[0].width).toBeCloseTo(30, 1);
  });
  it('縦書きでも、行の始まり (上) から数える', async () => {
    const r = await set(page(`<div style="writing-mode: vertical-rl; height: 200pt"><pre style="tab-size: 30pt">縦${T}書${T}${T}き</pre></div>`));
    expect(r.warnings ?? []).toEqual([]);
    const ys: Record<string, number> = {};
    const p = new Proxy({} as Painter, {
      get:
        (_t, name) =>
        (...args: unknown[]) => {
          if (name === 'drawGlyph' && /[縦書き]/.test((args[0] as GlyphArea).text)) ys[(args[0] as GlyphArea).text] = args[2] as number;
          for (const a of args) if (typeof a === 'function') (a as () => void)();
        },
    });
    for (const s of r.areaTree.sheets) paintSheet(s, p);
    // 縦 (10pt) の後のタブは 30pt のタブ位置へ、書 (30〜40pt) の後の 2 つのタブは 90pt のタブ位置へ
    expect(ys['書'] - ys['縦']).toBeCloseTo(30, 1);
    expect(ys['き'] - ys['縦']).toBeCloseTo(90, 1);
  });
});

describe('XSL-FO のタブは変えない', () => {
  it('white-space-treatment="preserve"・white-space-collapse="false" の中のタブは、これまでどおり空白 1 つ分', async () => {
    const fo = (text: string) =>
      `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="monospace" font-size="10pt" white-space-treatment="preserve" white-space-collapse="false" linefeed-treatment="preserve">${text}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const tab = await typesetFo(fo(`a${T}b`), { loadFont });
    const sp = await typesetFo(fo('a b'), { loadFont });
    const xs = (t: AreaTree) => glyphs(t).filter(([c]) => c === 'a' || c === 'b').map(([, x]) => +x.toFixed(3));
    expect(xs(tab.areaTree)).toEqual(xs(sp.areaTree));
  });
});

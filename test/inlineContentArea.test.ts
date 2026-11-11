/**
 * インラインの箱の内容の領域の高さ (LAY-17)。HTML の span の背景・罫線・リンクの範囲は、最初に使える書体の上の高さ + 下の深さの箱。
 *  - CSS 2.1 §10.6.1: 行内の非置換の箱の内容の領域の高さは書体に基づく (決め方は UA に任される。em の箱か、書体の ascender・descender の最大)
 *  - CSS Inline 3 §6.4 (inline-sizing: normal): 内容の領域は、最初に使える書体の字に合う大きさ・位置。代わりの書体の字は数えない
 *  - 行の高さ (line-height) は変わらない (§10.6.1: 上下の padding・罫線・margin は内容の領域の上下から始まり、line-height とは関係が無い)
 * 書体の上下の値 (fontManager.ts の inlineAreaMetrics): hhea の ascent・descent (Tinos: 0.891・0.216、Noto Sans Myanmar: 1.324・0.860。
 * em に対する比)。OS/2 の typo の上下が 1em を成す和文の書体は、その値 (Noto Serif JP: 0.88・0.12 = 字の枠。hhea の 1.151・0.286 は使わない)。
 * 既定の書体の組 (font-family: 'Noto Serif JP'・serif) は、欧文と空白を Tinos で組むので、最初に使える書体は Tinos。
 * 和文の書体だけの指定は、@font-face で別の名前 (J) を付けた Noto Serif JP で確かめる。
 * XSL-FO の fo:inline と、API から直接組む inline は、これまでどおり字の大きさの箱 (em の箱)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DEFAULT_FONTS, typesetFo, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, extraTestFont, fontBuffer, loadCachedFont } from './helpers';

let myanmar: Uint8Array;
let serifJp: Uint8Array;
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
  myanmar = new Uint8Array(fs.readFileSync(await extraTestFont('NotoSansMyanmar-Regular-v27.ttf')));
  serifJp = new Uint8Array(await fontBuffer());
}, 300_000);

const JP = { a: 0.88, d: 0.12 };
const TINOS = { a: 0.891, d: 0.216 };
const MYANMAR = { a: 1.324, d: 0.86 };
const FS = 20;

interface Box { x: number; y: number; w: number; h: number; border: boolean }
interface Found {
  /** 背景の色 → その色の箱 (ページの座標) */
  bg: Map<string, Box[]>;
  /** 字 → 基線の位置 (横書きは y、縦書きは字の中央の x) */
  glyphs: Array<{ text: string; x: number; y: number; w: number; h: number; base: number }>;
  links: Box[];
  lines: Array<{ y: number; h: number; x: number; w: number }>;
}
function scan(tree: AreaTree): Found {
  const f: Found = { bg: new Map(), glyphs: [], links: [], lines: [] };
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { backgroundColor?: string; border?: Record<string, unknown>; link?: unknown; baselineY?: number; text?: string };
    const box = { x, y, w: a.width, h: a.height, border: !!b.border && Object.keys(b.border).length > 0 };
    if (b.backgroundColor) f.bg.set(b.backgroundColor.toLowerCase(), [...(f.bg.get(b.backgroundColor.toLowerCase()) ?? []), box]);
    if (b.link) f.links.push(box);
    if (a.type === 'line') f.lines.push({ x, y, w: a.width, h: a.height });
    if (a.type === 'glyph') f.glyphs.push({ text: b.text ?? '', x, y, w: a.width, h: a.height, base: y + (b.baselineY ?? 0) });
    for (const c of childrenOf(a)) rec(c as Area, x, y);
  };
  rec(tree.sheets[0].page as unknown as Area, 0, 0);
  return f;
}
const page = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 20pt } @font-face { font-family: J; src: url(j.ttf) } body { margin: 0; font-size: ${FS}pt; line-height: 2; font-family: J } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const html = async (body: string, css = '') => scan((await typesetHtml(page(body, css), { loadFont: loadCachedFont, fonts: [{ name: 'NotoSansMyanmar-Regular.ttf', data: myanmar }], files: [{ name: 'j.ttf', data: serifJp }] })).areaTree);
/** 色の箱の上端・下端 (同じ色の箱をまとめた範囲) */
const span = (f: Found, color: string) => {
  const bs = f.bg.get(color)!;
  expect(bs, color).toBeTruthy();
  return { top: Math.min(...bs.map((b) => b.y)), bottom: Math.max(...bs.map((b) => b.y + b.h)), left: Math.min(...bs.map((b) => b.x)), right: Math.max(...bs.map((b) => b.x + b.w)) };
};
const baseOf = (f: Found, ch: string) => f.glyphs.find((g) => g.text === ch)!.base;

describe('HTML の span の背景の高さは、最初に使える書体の ascent + descent (CSS 2.1 §10.6.1・CSS Inline 3 §6.4)', () => {
  it('和文の書体だけの指定 (Noto Serif JP): 字の枠 (基線の上に 0.88em、下に 0.12em)。罫線つきの箱も同じ', async () => {
    const f = await html('<p><span style="background: #ff0000">漢字</span></p>');
    const s = span(f, '#ff0000');
    const base = baseOf(f, '漢');
    expect(base - s.top).toBeCloseTo(JP.a * FS, 1);
    expect(s.bottom - base).toBeCloseTo(JP.d * FS, 1);
    const g = await html('<p><span style="background: #ff0000; border: 1pt solid #000">漢字<span style="font-size: 30pt">大</span></span></p>');
    const b = span(g, '#ff0000');
    expect(b.bottom - b.top).toBeCloseTo(FS + 1.5, 1);
  });
  it('既定の書体の組 (serif = 欧文 Tinos + 和文 Noto Serif JP): 最初に使える書体は Tinos。和文だけの span も、基線の上に 0.891em、下に 0.216em', async () => {
    for (const fam of ['serif', `'Noto Serif JP'`]) {
      const f = await html(`<p style="font-family: ${fam}"><span style="background: #ff0000">漢字</span></p>`);
      const s = span(f, '#ff0000');
      const base = baseOf(f, '漢');
      expect(base - s.top).toBeCloseTo(TINOS.a * FS, 1);
      expect(s.bottom - base).toBeCloseTo(TINOS.d * FS, 1);
    }
  });
  it('欧文の書体 (Tinos) と、上下の大きい書体 (Noto Sans Myanmar)', async () => {
    const f = await html(`<p style="font-family: Tinos"><span style="background: #ff0000">Hg</span></p><p style="font-family: 'Noto Sans Myanmar'"><span style="background: #00ff00">မြန်</span></p>`);
    const t = span(f, '#ff0000');
    expect(baseOf(f, 'H') - t.top).toBeCloseTo(TINOS.a * FS, 1);
    expect(t.bottom - baseOf(f, 'H')).toBeCloseTo(TINOS.d * FS, 1);
    const m = span(f, '#00ff00');
    expect(m.bottom - m.top).toBeCloseTo((MYANMAR.a + MYANMAR.d) * FS, 1);
  });
  it('行の高さ・字の位置は変わらない (背景の無いときと同じ)', async () => {
    const a = await html(`<p>前<span style="background: #ff0000; border: 1pt solid #000; padding: 2pt">漢字</span>後</p><p>次の行</p>`);
    const b = await html(`<p>前<span style="border: 0 solid #000; padding: 0 2.75pt">漢字</span>後</p><p>次の行</p>`);
    expect(a.lines.map((l) => [l.y, l.h])).toEqual(b.lines.map((l) => [l.y, l.h]));
    for (const l of a.lines) expect(l.h).toBeCloseTo(40, 1);
    expect(a.glyphs.map((g) => g.base)).toEqual(b.glyphs.map((g) => g.base));
  });
  it('罫線・padding つきの箱は、内容の領域の上下に padding と罫線を足す', async () => {
    const f = await html('<p><span style="background: #ff0000; border: 3pt solid #000; padding: 5pt 4pt">漢字</span></p>');
    const s = span(f, '#ff0000');
    const base = baseOf(f, '漢');
    expect(base - s.top).toBeCloseTo(JP.a * FS + 5 + 3, 1);
    expect(s.bottom - base).toBeCloseTo(JP.d * FS + 5 + 3, 1);
  });
  it('和欧の混じる span: 代わりの書体の字は数えず、最初に使える書体だけで決まる (Inline 3 §6.4 の注)', async () => {
    // 最初に使える書体は Tinos。漢字は Noto Serif JP で組まれるが、箱は Tinos の上下
    const f = await html(`<p style="font-family: Tinos, J"><span style="background: #ff0000">Hg漢字</span> <span style="background: #00ff00">漢字</span> <span style="background: #0000ff; border: 1pt solid #000">漢字</span></p>`);
    const base = baseOf(f, 'H');
    for (const c of ['#ff0000', '#00ff00']) {
      const s = span(f, c);
      expect(base - s.top).toBeCloseTo(TINOS.a * FS, 1);
      expect(s.bottom - base).toBeCloseTo(TINOS.d * FS, 1);
    }
    const box = span(f, '#0000ff');
    expect(box.bottom - box.top).toBeCloseTo((TINOS.a + TINOS.d) * FS + 1.5, 1);
  });
  it('入れ子: 外の span の背景は外の字の大きさ・書体で決まり、中の小さい字・大きい字の所でも同じ高さ。中の span の背景は中の字の大きさ', async () => {
    const f = await html(`<p style="line-height: 3; font-family: Tinos, J"><span style="background: #ff0000">外<span style="font-size: 10pt">小</span><span style="font-size: 30pt">大</span>外</span> <span style="background: #00ff00">外<span style="background: #0000ff; font-size: 30pt">大</span></span></p>`);
    const base = baseOf(f, '外');
    const outer = f.bg.get('#ff0000')!;
    // 外の span の箱は、どの並びの所でも同じ上端・下端
    for (const b of outer) {
      expect(base - b.y).toBeCloseTo(TINOS.a * FS, 1);
      expect(b.y + b.h - base).toBeCloseTo(TINOS.d * FS, 1);
    }
    expect(span(f, '#ff0000').right - span(f, '#ff0000').left).toBeCloseTo(20 + 10 + 30 + 20, 1);
    const inner = span(f, '#0000ff');
    expect(base - inner.top).toBeCloseTo(TINOS.a * 30, 1);
    expect(inner.bottom - base).toBeCloseTo(TINOS.d * 30, 1);
  });
  it('上付き (vertical-align: super) の span の箱は、ずらした基線から', async () => {
    const f = await html(`<p style="line-height: 3; font-family: Tinos, J">字<span style="vertical-align: super; font-size: 10pt; background: #ff0000">上</span><span style="vertical-align: super; font-size: 10pt; background: #00ff00; border: 1pt solid #000">枠</span></p>`);
    for (const [c, ch, extra] of [['#ff0000', '上', 0], ['#00ff00', '枠', 0.75]] as const) {
      const s = span(f, c);
      const base = baseOf(f, ch);
      expect(base).toBeLessThan(baseOf(f, '字') - 1);
      expect(base - s.top).toBeCloseTo(TINOS.a * 10 + extra, 1);
      expect(s.bottom - base).toBeCloseTo(TINOS.d * 10 + extra, 1);
    }
  });
  it('ルビ・行内の箱 (inline-block) を含む span も、同じ内容の領域 (行の高さいっぱいにはならない)', async () => {
    const f = await html(`<p style="line-height: 3; font-family: Tinos, J"><span style="background: #ff0000"><ruby>漢<rt>かん</rt></ruby>字</span> <span style="background: #00ff00; border: 1pt solid #000">字<span style="display: inline-block; width: 10pt; height: 50pt"></span></span></p>`);
    const base = baseOf(f, '字');
    const r = span(f, '#ff0000');
    expect(base - r.top).toBeCloseTo(TINOS.a * FS, 1);
    expect(r.bottom - base).toBeCloseTo(TINOS.d * FS, 1);
    const b = span(f, '#00ff00');
    expect(b.bottom - b.top).toBeCloseTo((TINOS.a + TINOS.d) * FS + 1.5, 1);
  });
  it('リンクの範囲も同じ箱', async () => {
    const f = await html('<p style="font-family: Tinos, J"><a href="https://example.com/">漢字</a></p>');
    const base = baseOf(f, '漢');
    expect(f.links.length).toBe(1);
    expect(base - f.links[0].y).toBeCloseTo(TINOS.a * FS, 1);
    expect(f.links[0].h).toBeCloseTo((TINOS.a + TINOS.d) * FS, 1);
  });
  it('縦書き: 字の中央の基線を挟んで、(ascent + descent) / 2 ずつ (字は中央の基線にそろう。CSS Writing Modes 4 §4.2)', async () => {
    const f = await html(`<div style="writing-mode: vertical-rl; height: 300pt; font-family: Tinos, J"><p><span style="background: #ff0000">漢字</span></p><p><span style="background: #00ff00; border: 1pt solid #000; padding: 2pt">漢字</span></p></div>`);
    const g = f.glyphs.filter((x) => x.text === '漢');
    const s = span(f, '#ff0000');
    const centre = g[0].x + g[0].w / 2;
    expect(centre - s.left).toBeCloseTo(((TINOS.a + TINOS.d) / 2) * FS, 1);
    expect(s.right - centre).toBeCloseTo(((TINOS.a + TINOS.d) / 2) * FS, 1);
    const b = span(f, '#00ff00');
    const c2 = g[1].x + g[1].w / 2;
    expect(c2 - b.left).toBeCloseTo(((TINOS.a + TINOS.d) / 2) * FS + 2.75, 1);
    expect(b.right - c2).toBeCloseTo(((TINOS.a + TINOS.d) / 2) * FS + 2.75, 1);
  });
});

describe('XSL-FO の fo:inline の背景は、これまでどおり字の大きさの箱 (XSL 1.1 §4.6・§7.29.4 は書体の値に幅を許す)', () => {
  it('fo:inline の background-color・罫線の箱の高さは 1em', async () => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="400pt" page-height="400pt" margin="20pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Noto Serif JP" font-size="20pt" line-height="2"><fo:inline background-color="#ff0000">漢字</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    for (const compat of ['spec', 'antenna'] as const) {
      const f = scan((await typesetFo(fo, { loadFont: loadCachedFont, compat })).areaTree);
      const s = span(f, '#ff0000');
      expect(s.bottom - s.top).toBeCloseTo(FS, 1);
    }
  });
});

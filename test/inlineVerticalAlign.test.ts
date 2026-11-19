/**
 * 置き換えでない行内の箱 (span・::before など) の vertical-align のキーワード (CSS 2.1 §10.8.1): top・bottom・middle・text-top・text-bottom。
 * 行内の箱は line-height の高さの箱 (最初に使える書体の基線の上・下 (em の箱) に、半行間 (line-height − 字の大きさ) / 2 を足したもの。負にもなる)。
 *  - bottom・top: その要素と中身 (aligned subtree) の箱の下端・上端を、行の箱の下端・上端にそろえる。箱が行より高ければ、行を広げる
 *  - text-top・text-bottom: 箱の上端・下端を、親の内容の領域の上端・下端にそろえる
 *  - middle: 箱の上下の中央を、親の基線から親の x-height の半分だけ上にそろえる
 * 前は、どれも基線にそろえていた (Sphinx の印刷用の CSS の目次の「•」(font-size: 30pt; line-height: 10pt; vertical-align: bottom) が、
 * 行の上へ浮き、行も広がっていた。WeasyPrint・Chromium は行の中ほどに置く)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, childrenOf, typesetHtml, type AreaNode } from '../src/index';
import type { AreaTree, GlyphArea } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

interface G { text: string; base: number; fs: number }
interface Line { top: number; bottom: number; glyphs: G[] }
/** 行ごとの、行の箱の上端・下端と、字の基線の位置 (ページの上からの y。pt) */
function lines(t: AreaTree): Line[] {
  const out: Line[] = [];
  const rec = (a: AreaNode, oy: number, line?: Line) => {
    const y = oy + a.y;
    let cur = line;
    if (a.type === 'line') out.push((cur = { top: y, bottom: y + a.height, glyphs: [] }));
    if (a.type === 'glyph' && cur) {
      const g = a as GlyphArea;
      cur.glyphs.push({ text: g.text, base: y + g.baselineY, fs: g.fontSize });
    }
    const inner = y + a.padding.top + (a.border.top?.width ?? 0);
    for (const c of childrenOf(a)) rec(c, inner, cur);
  };
  for (const s of t.sheets) rec(s, 0);
  return out;
}
const page = (body: string) => `<!doctype html><html lang="en"><head><style>@page { size: 120mm 80mm; margin: 10mm } p { margin: 0; text-indent: 0; font-size: 12pt; line-height: 20pt }</style></head><body>${body}</body></html>`;
const run = async (body: string) => lines((await typesetHtml(page(body), { loadFont: loadCachedFont, style: 'browser' })).areaTree);
const glyph = (l: Line, text: string) => l.glyphs.find((g) => g.text === text)!;
/**
 * 行の高さの計算が使う、書体 (総称の serif = Tinos) の基線の位置の比 (CSS の em の箱の上からの比)。何も無い行 (字 12pt・行の高さ 20pt) の
 * 基線は、行の上端から 比 × 12 + (20 − 12) / 2 の所にある
 */
let BR = 0;
beforeAll(async () => {
  const [l] = await run('<p>Text</p>');
  BR = (glyph(l, 'T').base - l.top - 4) / 12;
});
/** line-height の箱の上・下 (基線から) */
const box = (g: G, lh: number) => ({ above: BR * g.fs + (lh - g.fs) / 2, below: (1 - BR) * g.fs + (lh - g.fs) / 2 });

describe('行内の箱の vertical-align: top・bottom (行の箱の上端・下端にそろえる)', () => {
  it('bottom: 箱 (line-height 10pt) の下端が行の下端にそろい、30pt の字でも行は広がらない (目次の「•」の書き方)', async () => {
    const [plain] = await run('<p>Text</p>');
    const [l] = await run('<p><span style="font-size: 30pt; line-height: 10pt; vertical-align: bottom">•</span> Text</p>');
    expect(l.bottom - l.top).toBeCloseTo(plain.bottom - plain.top, 2);
    const b = glyph(l, '•');
    expect(b.base + box(b, 10).below).toBeCloseTo(l.bottom, 1);
    // 本文の字は、何も無い行と同じ位置
    expect(glyph(l, 'T').base - l.top).toBeCloseTo(glyph(plain, 'T').base - plain.top, 2);
  });

  it('top: 箱の上端が行の上端にそろう', async () => {
    const [l] = await run('<p><span style="font-size: 30pt; line-height: 10pt; vertical-align: top">•</span> Text</p>');
    // 箱 (10pt) は行 (20pt) より低いので、行は広がらない
    expect(l.bottom - l.top).toBeCloseTo(20, 1);
    const b = glyph(l, '•');
    expect(b.base - box(b, 10).above).toBeCloseTo(l.top, 1);
  });

  it('行より高い箱は行を広げる (bottom は上へ): 行の高さは箱の高さ', async () => {
    const [l] = await run('<p><span style="line-height: 40pt; vertical-align: bottom">B</span> Text</p>');
    expect(l.bottom - l.top).toBeCloseTo(40, 1);
    // 下にそろえる箱は、行を上へ広げる: 本文の字は、何も無い行より 20pt 下 (基線にそろえると、箱は基線を中心に上下へ広がる)
    expect(glyph(l, 'T').base - l.top).toBeCloseTo(20 + BR * 12 + 4, 1);
    const b = glyph(l, 'B');
    expect(b.base + box(b, 40).below).toBeCloseTo(l.bottom, 1);
  });

  it('中身は 1 つの部分木としてそろえる: 中の上付きのずらしは保つ', async () => {
    const [l] = await run('<p>Text <span style="vertical-align: bottom">x<span style="vertical-align: super">2</span></span></p>');
    const x = glyph(l, 'x');
    const two = glyph(l, '2');
    // super は親の字の大きさの 0.35 倍だけ上げる (inlineFlatten.ts)
    expect(x.base - two.base).toBeCloseTo(12 * 0.35, 1);
  });
});

// 中の top・bottom の子孫は、外側の部分木に入らず、それ自身の部分木になる (CSS 2.1 §10.8.1 の aligned subtree:
// "the aligned subtree ... includes ... all inline-level descendant elements and boxes ... whose computed 'vertical-align' is not 'top' or 'bottom'")
describe('top・bottom の行内の要素の中の、top・bottom の箱', () => {
  const img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="40"><rect width="10" height="40"/></svg>');
  /** 1 行目の箱 (画像・inline-block の箱) の上端・下端 */
  const boxes = async (body: string) => {
    const t = (await typesetHtml(page(body), { loadFont: loadCachedFont, style: 'browser' })).areaTree;
    const out: Array<{ top: number; bottom: number }> = [];
    const rec = (a: AreaNode, oy: number, inLine: boolean) => {
      const y = oy + a.y;
      if (inLine && (a.type === 'image' || a.type === 'block')) out.push({ top: y, bottom: y + a.height });
      const inner = y + a.padding.top + (a.border.top?.width ?? 0);
      if (!(inLine && (a.type === 'image' || a.type === 'block'))) for (const c of childrenOf(a)) rec(c, inner, inLine || a.type === 'line');
    };
    for (const s of t.sheets) rec(s, 0, false);
    return out;
  };
  const tImg = `<img src="${img}" style="vertical-align:top;width:10pt;height:40pt">`;
  it('bottom の中の top の画像: 画像は行の上端、中の字は行の下端、行の高さは画像の高さ (外の字は動かない)', async () => {
    const [plain] = await run('<p>T</p>');
    const body = `<p>T <span style="vertical-align:bottom">a${tImg}</span></p>`;
    const [l] = await run(body);
    expect(l.bottom - l.top).toBeCloseTo(40, 1);
    const [b] = await boxes(body);
    expect(b.top).toBeCloseTo(l.top, 1);
    expect(b.bottom).toBeCloseTo(l.bottom, 1);
    const a = glyph(l, 'a');
    expect(a.base + box(a, 20).below).toBeCloseTo(l.bottom, 1);
    // 外の「T」は、何も無い行と同じ (行の箱は上に揃えた画像が下へ広げる)
    expect(glyph(l, 'T').base - l.top).toBeCloseTo(glyph(plain, 'T').base - plain.top, 1);
  });
  it('bottom の中の top の inline-block: 箱は自分の部分木 (外の部分木に入れず、入れ子でない top の inline-block と同じ位置)', async () => {
    const ib = '<span style="display:inline-block;width:10pt;height:40pt;vertical-align:top"></span>';
    const [solo] = await run(`<p>T ${ib}</p>`);
    const [soloBox] = await boxes(`<p>T ${ib}</p>`);
    const body = `<p>T <span style="vertical-align:bottom">a${ib}</span></p>`;
    const [l] = await run(body);
    const [b] = await boxes(body);
    expect(l.bottom - l.top).toBeCloseTo(solo.bottom - solo.top, 1);
    expect(b.top - l.top).toBeCloseTo(soloBox.top - solo.top, 1);
    expect(glyph(l, 'T').base - l.top).toBeCloseTo(glyph(solo, 'T').base - solo.top, 1);
    // 中の字は、外の部分木 (bottom) として行の下端に
    const a = glyph(l, 'a');
    expect(a.base + box(a, 20).below).toBeCloseTo(l.bottom, 1);
  });
  it('3 段の入れ子 (top の中の bottom の中の top の画像): それぞれの部分木を、それぞれの端に揃える', async () => {
    const body = `<p>T <span style="vertical-align:top">b<span style="vertical-align:bottom">a${tImg}</span></span></p>`;
    const [l] = await run(body);
    expect(l.bottom - l.top).toBeCloseTo(40, 1);
    const [im] = await boxes(body);
    expect(im.top).toBeCloseTo(l.top, 1);
    const b = glyph(l, 'b');
    expect(b.base - box(b, 20).above).toBeCloseTo(l.top, 1);
    const a = glyph(l, 'a');
    expect(a.base + box(a, 20).below).toBeCloseTo(l.bottom, 1);
  });
});

describe('行内の箱の vertical-align: text-top・text-bottom・middle (親の字にそろえる)', () => {
  it('text-bottom: 箱の下端が、親の内容の領域 (em の箱) の下端にそろう', async () => {
    const [l] = await run('<p>Text <span style="font-size: 24pt; line-height: 24pt; vertical-align: text-bottom">B</span></p>');
    const t = glyph(l, 'T');
    const b = glyph(l, 'B');
    expect(b.base + box(b, 24).below).toBeCloseTo(t.base + (1 - BR) * t.fs, 1);
  });

  it('text-top: 箱の上端が、親の内容の領域の上端にそろう', async () => {
    const [l] = await run('<p>Text <span style="font-size: 6pt; line-height: 6pt; vertical-align: text-top">s</span></p>');
    const t = glyph(l, 'T');
    const s = glyph(l, 's');
    expect(s.base - box(s, 6).above).toBeCloseTo(t.base - BR * t.fs, 1);
  });

  it('middle: 箱の上下の中央が、親の基線より x-height の半分ほど上 (0.2〜0.3em) に来る', async () => {
    const [l] = await run('<p>Text <span style="font-size: 6pt; line-height: 6pt; vertical-align: middle">m</span></p>');
    const t = glyph(l, 'T');
    const s = glyph(l, 'm');
    const center = s.base + (box(s, 6).below - box(s, 6).above) / 2;
    const up = (t.base - center) / t.fs;
    expect(up).toBeGreaterThan(0.2);
    expect(up).toBeLessThan(0.3);
  });
});

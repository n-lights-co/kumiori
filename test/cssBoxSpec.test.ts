/**
 * 箱の組版の CSS:
 *  - box-decoration-break: clone (CSS Fragmentation 3 §5.4): ページ・段・行で分かれた箱の断片ごとに、罫線・内側の余白を付け直す
 *  - 内容による大きさ (CSS Sizing 3 §3.2 の min-content・max-content・fit-content、CSS Sizing 4 §3.2 の fit-content(<長さ>))
 *  - initial-letter (CSS Inline 3 §7): 段落の最初の字を大きくして、数行に沈める
 *  - empty-cells (CSS 2.1 §17.6.1.1)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
});

type Side = { width?: number } | undefined;
type RawArea = {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  backgroundColor?: string;
  writingMode?: string;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  border?: { top?: Side; right?: Side; bottom?: Side; left?: Side };
  children?: RawArea[];
};
type Box = { type: string; text?: string; fontSize?: number; x: number; y: number; w: number; h: number; bg?: string; page: number; pad: number[]; bord: number[]; raw: RawArea };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** 組んだ箱を、本文の領域の左上からの位置で返す (pad・bord は 上・右・下・左) */
function boxesOf(tree: { sheets: Array<{ page: { regionBody: unknown } }> }): Box[] {
  const out: Box[] = [];
  tree.sheets.forEach((sh, k) => {
    const walk = (a: RawArea, ox: number, oy: number) => {
      const x = ox + (a.x ?? 0);
      const y = oy + (a.y ?? 0);
      const p = a.padding ?? {};
      const b = a.border ?? {};
      const pad = [p.top ?? 0, p.right ?? 0, p.bottom ?? 0, p.left ?? 0];
      const bord = [b.top?.width ?? 0, b.right?.width ?? 0, b.bottom?.width ?? 0, b.left?.width ?? 0];
      if (a.type) out.push({ type: a.type, text: a.text, fontSize: a.fontSize, x, y, w: a.width ?? 0, h: a.height ?? 0, bg: a.backgroundColor, page: k + 1, pad, bord, raw: a });
      // 子の位置は、内容の箱 (罫線と内側の余白の内側) の左上から
      for (const c of a.children ?? []) walk(c, x + pad[3] + bord[3], y + pad[0] + bord[0]);
    };
    for (const c of (sh.page.regionBody as RawArea).children ?? []) walk(c, 0, 0);
    // 絶対配置の箱はページの原点から (余白なしのページなので、本文の領域の原点と同じ)
    for (const c of ((sh.page as { absoluteAreas?: RawArea[] }).absoluteAreas ?? [])) walk(c, 0, 0);
  });
  return out;
}

/** 200pt × 100pt のページ (余白なし)、字は 10pt・行の送り 10pt */
async function lay(body: string, css = '', page = '@page { size: 200pt 100pt; margin: 0 }') {
  const all = `${page} html { font-family: 'Noto Serif JP' } body { margin: 0; font-size: 10pt; line-height: 10pt } p { margin: 0; text-indent: 0; text-align: left } ${css}`;
  const r = await typesetHtml(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${all}</style></head><body>${body}</body></html>`, { style: 'browser', loadFont });
  const boxes = boxesOf(r.areaTree as never);
  return { boxes, bg: (color: string) => boxes.filter((b) => b.bg === color), glyphs: (ch: string) => boxes.filter((b) => b.type === 'glyph' && b.text === ch), pages: r.areaTree.sheets.length, warnings: r.warnings };
}

const lines = (n: number, ch = 'あ') => Array.from({ length: n }, () => `<p>${ch}</p>`).join('');

describe('box-decoration-break (CSS Fragmentation 3 §5.4)', () => {
  const BOX = '.n { border: 3pt solid #000000; padding: 3pt; background: #ff0000 }';
  it('clone: ページで分かれた断片のそれぞれに、上下の罫線と内側の余白を付ける。中身は、その分を空けた所に入る', async () => {
    // ページの高さ 100pt。断片ごとに上下 6pt ずつを使うので、1 ページに 8 行
    const t = await lay(`<div class="n" style="box-decoration-break: clone">${lines(12)}</div>`, BOX);
    const f = t.bg('#ff0000');
    expect(f.map((b) => [b.page, r1(b.y), r1(b.h)])).toEqual([[1, 0, 100], [2, 0, 52]]);
    for (const b of f) {
      expect(b.pad).toEqual([3, 3, 3, 3]);
      expect(b.bord).toEqual([3, 3, 3, 3]);
    }
    const g = t.glyphs('あ');
    expect(g.filter((x) => x.page === 1).length).toBe(8);
    expect(g.filter((x) => x.page === 2).length).toBe(4);
    // 続きの断片の最初の行は、罫線と余白の下から
    expect(r1(t.boxes.find((b) => b.type === 'line' && b.page === 2)!.y)).toBe(6);
  });
  it('slice (初期値): 切れ目には罫線も余白も入れない (これまでと同じ)', async () => {
    for (const decl of ['', 'box-decoration-break: slice']) {
      const t = await lay(`<div class="n" style="${decl}">${lines(12)}</div>`, BOX);
      const f = t.bg('#ff0000');
      expect(f.map((b) => [b.page, r1(b.y), r1(b.h)])).toEqual([[1, 0, 100], [2, 0, 46]]);
      expect([f[0].pad, f[0].bord]).toEqual([[3, 3, 0, 3], [3, 3, 0, 3]]);
      expect([f[1].pad, f[1].bord]).toEqual([[0, 3, 3, 3], [0, 3, 3, 3]]);
      // 続きは上端から
      expect(t.glyphs('あ').filter((x) => x.page === 1).length).toBe(8);
      expect(r1(t.boxes.find((b) => b.type === 'line' && b.page === 2)!.y)).toBe(0);
    }
  });
  it('clone: 接頭辞付きの -webkit-box-decoration-break も同じ。読めない値の宣言は捨てる', async () => {
    const t = await lay(`<div class="n" style="-webkit-box-decoration-break: clone">${lines(12)}</div>`, BOX);
    expect(t.bg('#ff0000').map((b) => b.bord)).toEqual([[3, 3, 3, 3], [3, 3, 3, 3]]);
    const u = await lay(`<div class="n" style="box-decoration-break: clone; box-decoration-break: both">${lines(12)}</div>`, BOX);
    expect(u.bg('#ff0000').map((b) => b.bord)).toEqual([[3, 3, 3, 3], [3, 3, 3, 3]]);
    expect(t.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
  });
  it('clone: 入れ子の箱がどちらも clone のとき、外側の断片は、内側の断片の罫線・余白の外側を包む', async () => {
    const t = await lay(
      `<div class="n" style="box-decoration-break: clone"><div class="m" style="box-decoration-break: clone">${lines(12)}</div></div>`,
      `${BOX} .m { border: 0.75pt solid #000000; padding: 0.75pt; background: #0000ff }`,
    );
    const o = t.bg('#ff0000');
    const i = t.bg('#0000ff');
    // 1 ページ目: 外側は 0〜100、内側は 6〜94。行は 7.5〜92.5 に 8 行
    expect([r1(o[0].y), r1(o[0].h), r1(i[0].y), r1(i[0].h)]).toEqual([0, 100, 6, 88]);
    expect(t.glyphs('あ').filter((x) => x.page === 1).length).toBe(8);
    // 2 ページ目: 4 行 (40pt) を、内側 (上下 1.5pt ずつ)・外側 (上下 6pt ずつ) が包む
    expect([r1(o[1].y), r1(o[1].h), r1(i[1].y), r1(i[1].h)]).toEqual([0, 55, 6, 43]);
  });
  it('clone: 段で分かれた断片にも付ける', async () => {
    const t = await lay(`<div style="columns: 2; column-gap: 0"><div class="n" style="box-decoration-break: clone">${lines(12)}</div></div>`, BOX);
    const f = t.bg('#ff0000');
    expect(f.length).toBe(2);
    expect(f.map((b) => [b.page, r1(b.x), b.bord, b.pad])).toEqual([[1, 0, [3, 3, 3, 3], [3, 3, 3, 3]], [1, 100, [3, 3, 3, 3], [3, 3, 3, 3]]]);
  });
  it('clone: 縦書きでは、切れ目の側 (右と左) の罫線・余白を付ける', async () => {
    const u = await lay(`<div class="n" style="box-decoration-break: clone">${lines(25)}</div>`, `${BOX} html { writing-mode: vertical-rl }`);
    const g = u.bg('#ff0000');
    // 幅 200pt に、左右 6pt ずつを除いて 18 行
    expect(g.map((b) => [b.page, r1(b.w), b.bord, b.pad])).toEqual([[1, 200, [3, 3, 3, 3], [3, 3, 3, 3]], [2, 82, [3, 3, 3, 3], [3, 3, 3, 3]]]);
    expect(u.glyphs('あ').filter((x) => x.page === 1).length).toBe(18);
  });
  it('clone: 高さの指定のある箱は、内容の箱の高さを断片に配る (罫線・余白は高さに数えない)', async () => {
    const t = await lay('<div class="n" style="box-decoration-break: clone; height: 200pt"></div><p>後</p>', BOX);
    // 断片の内容の箱は 88pt・88pt・24pt
    expect(t.bg('#ff0000').map((b) => [b.page, r1(b.h)])).toEqual([[1, 100], [2, 100], [3, 36]]);
  });
});

describe('box-decoration-break: clone の inline の箱 (行で分かれた枠。CSS Fragmentation 3 §5.4)', () => {
  // 幅 100pt の段落に、10pt の字。枠は左右に罫線 3pt + 余白 3pt
  const SPAN = 'p { width: 100pt } span { border: 3pt solid #000000; padding: 0 3pt; background: #ff0000 }';
  const frames = (t: Awaited<ReturnType<typeof lay>>) => t.bg('#ff0000').filter((b) => b.bord.some((w) => w > 0));
  it('clone: 行ごとの断片の両端に罫線と余白を付け、その分だけ行に入る字が減る', async () => {
    const t = await lay(`<p>あ<span style="box-decoration-break: clone">${'い'.repeat(20)}</span>う</p>`, SPAN);
    const f = frames(t);
    // 1 行目: あ (10) + 枠 (6 + 7 字 + 6 = 82)。2 行目: 枠 (6 + 8 字 + 6)。3 行目: 枠 (6 + 5 字 + 6) + う
    expect(f.map((b) => [r1(b.x), r1(b.w), b.bord[3], b.bord[1]])).toEqual([[10, 82, 3, 3], [0, 92, 3, 3], [0, 62, 3, 3]]);
    const ys = [...new Set(t.glyphs('い').map((g) => r1(g.y)))];
    expect(ys.map((y) => t.glyphs('い').filter((g) => r1(g.y) === y).length)).toEqual([7, 8, 5]);
    // 続きの行の最初の字は、罫線 + 余白の後ろ
    expect(r1(t.glyphs('い')[7].x)).toBe(6);
  });
  it('slice (初期値): 切れ目の側には罫線も余白も付けない (これまでと同じ)', async () => {
    const t = await lay(`<p>あ<span>${'い'.repeat(20)}</span>う</p>`, SPAN);
    const f = frames(t);
    // 1 行目: あ + 枠 (6 + 8 字)。2 行目: 10 字。3 行目: 2 字 + 6
    expect(f.map((b) => [r1(b.x), r1(b.w), b.bord[3], b.bord[1]])).toEqual([[10, 86, 3, 0], [0, 100, 0, 0], [0, 26, 0, 3]]);
  });
  it('clone: 入れ子の枠は、外側の枠の罫線・余白の内側に、内側の枠の罫線・余白を置く', async () => {
    const t = await lay(
      `<p><span style="box-decoration-break: clone">あ<span class="i" style="box-decoration-break: clone">${'い'.repeat(12)}</span></span></p>`,
      `${SPAN} .i { border: 1.5pt solid #000000; padding: 0 1.5pt; background: #0000ff }`,
    );
    const o = frames(t);
    const i = t.bg('#0000ff').filter((b) => b.bord.some((w) => w > 0));
    // 1 行目: 外 6 + あ 10 + 内 3 + い 7 字 + 内 3 + 外 6 = 98。2 行目: 外 6 + 内 3 + い 5 字 + 内 3 + 外 6
    expect(o.map((b) => [r1(b.x), r1(b.w)])).toEqual([[0, 98], [0, 68]]);
    expect(i.map((b) => [r1(b.x), r1(b.w), b.bord[3], b.bord[1]])).toEqual([[16, 76, 1.5, 1.5], [6, 56, 1.5, 1.5]]);
  });
  it('clone: 縦書きでは、行の始めと終わり (上と下) に付ける', async () => {
    const t = await lay(`<p>あ<span style="box-decoration-break: clone">${'い'.repeat(12)}</span></p>`, 'html { writing-mode: vertical-rl } p { height: 100pt } span { border: 3pt solid #000000; padding: 3pt 0; background: #ff0000 }');
    const f = frames(t);
    expect(f.map((b) => [r1(b.y), r1(b.h), b.bord[0], b.bord[2]])).toEqual([[10, 82, 3, 3], [0, 62, 3, 3]]);
  });
  it('clone: 右から左へ書く段落では、行の始め (右) から付ける', async () => {
    const t = await lay(`<p dir="rtl"><span style="box-decoration-break: clone">${'אבג '.repeat(12)}</span></p>`, `${SPAN} p { text-align: start }`);
    const f = frames(t);
    // 1 行目・2 行目とも、枠は右端から (6 + 8 字 + 6)。字の幅は書体によるので、両端の罫線と、右端にそろうことだけを確かめる
    expect(f.length).toBeGreaterThan(1);
    for (const b of f) {
      expect([b.bord[3], b.bord[1]]).toEqual([3, 3]);
      expect(r1(b.x + b.w)).toBe(100);
    }
  });
});

describe('内容による大きさ (CSS Sizing 3 §3.2・§2.1)', () => {
  // ページの幅 200pt、字は 10pt (全角)。あ を 8 字並べると、折り返さない幅 (max-content) は 80pt、最も狭い幅 (min-content) は 1 字の 10pt
  const A8 = 'あ'.repeat(8);
  const RED = 'background: #ff0000';
  const w = (b: Box) => Math.round(b.w);
  const one = async (style: string, inner = A8, css = '') => (await lay(`<div style="${RED}; ${style}">${inner}</div>`, css)).bg('#ff0000')[0];
  it('width: max-content は折り返さない幅、min-content は最も狭い幅。中の、幅の指定のある箱は、その幅を数える', async () => {
    expect(w(await one('width: max-content'))).toBe(80);
    expect(w(await one('width: min-content'))).toBe(10);
    expect(w(await one('width: min-content', `<div style="width: 30pt; height: 5pt"></div>${A8}`))).toBe(30);
    // 使える幅 (200pt) より長い中身でも、max-content は折り返さない
    const long = await lay(`<div style="${RED}; width: max-content">${'あ'.repeat(30)}</div>`);
    expect(w(long.bg('#ff0000')[0])).toBe(300);
    expect(new Set(long.glyphs('あ').map((g) => r1(g.y))).size).toBe(1);
  });
  it('width: fit-content は min(max-content, max(min-content, 使える幅))', async () => {
    expect(w(await one('width: fit-content'))).toBe(80);
    expect(w(await one('width: fit-content', 'あ'.repeat(30)))).toBe(200);
    // 余白・枠の分は、使える幅から引く
    expect(w(await one('width: fit-content; margin: 0 15pt; padding: 0 6pt', 'あ'.repeat(30)))).toBe(170);
    // 使える幅が最も狭い幅より狭ければ、最も狭い幅
    const t = await lay(`<div style="width: 20pt"><div style="${RED}; width: fit-content"><div style="width: 30pt; height: 5pt"></div></div></div>`);
    expect(w(t.bg('#ff0000')[0])).toBe(30);
  });
  it('fit-content(<長さ>) は、使える幅をその長さに置き換える (CSS Sizing 4 §3.2)。負の長さの宣言は捨てる', async () => {
    expect(w(await one('width: fit-content(50pt)'))).toBe(50);
    expect(w(await one('width: fit-content(150pt)'))).toBe(80);
    expect(w(await one('width: fit-content(4pt)'))).toBe(10);
    expect(w(await one('width: fit-content(25%)'))).toBe(50);
    expect(w(await one('width: 120pt; width: fit-content(-5pt)'))).toBe(120);
  });
  it('min-width・max-width の語: 幅の指定や auto の幅を、中身の幅で抑える。auto の余白は、決まった幅で配る', async () => {
    expect(w(await one('width: 120pt; max-width: max-content'))).toBe(80);
    expect(w(await one('width: 20pt; min-width: max-content'))).toBe(80);
    expect(w(await one('max-width: min-content'))).toBe(10);
    // 語の大きさと、長さの上限・下限
    expect(w(await one('width: max-content; max-width: 50pt'))).toBe(50);
    expect(w(await one('width: min-content; min-width: 40pt'))).toBe(40);
    const c = await one('max-width: fit-content; margin-left: auto; margin-right: auto');
    expect([Math.round(c.x), w(c)]).toEqual([60, 80]);
    const r = await one('width: max-content; margin-left: auto');
    expect([Math.round(r.x), w(r)]).toEqual([120, 80]);
  });
  it('box-sizing: border-box でも、語の大きさは内容の箱を中身に合わせる', async () => {
    const b = await one('width: max-content; box-sizing: border-box; padding: 0 9pt; border: 3pt solid #000000');
    expect(w(b)).toBe(104);
    // fit-content(<長さ>) の長さは、box-sizing の箱の大きさ
    expect(w(await one('width: fit-content(60pt); box-sizing: border-box; padding: 0 9pt'))).toBe(60);
  });
  it('float・inline-block・絶対配置の箱: min-content・max-content で幅を決める (fit-content は auto と同じ)', async () => {
    const long = 'あ'.repeat(30);
    for (const pos of ['float: left', 'display: inline-block', 'position: absolute']) {
      expect([pos, w(await one(`${pos}; width: min-content`, long))]).toEqual([pos, 10]);
      expect([pos, w(await one(`${pos}; width: max-content`, long))]).toEqual([pos, 300]);
      // auto (shrink-to-fit) と fit-content は同じ
      const auto = await one(pos, long);
      const fit = await one(`${pos}; width: fit-content`, long);
      expect([pos, fit.w]).toEqual([pos, auto.w]);
      expect([pos, w(await one(`${pos}; max-width: min-content`, long))]).toEqual([pos, 10]);
    }
  });
  it('縦書きでは、行の向きの大きさは height。width (block の向き) の語は auto と同じ', async () => {
    const V = 'html { writing-mode: vertical-rl }';
    const h = (b: Box) => Math.round(b.h);
    expect(h(await one('height: max-content', A8, V))).toBe(80);
    expect(h(await one('height: min-content', A8, V))).toBe(10);
    expect(h(await one('height: fit-content(50pt)', A8, V))).toBe(50);
    const auto = await one('', A8, V);
    const kw = await one('width: min-content', A8, V);
    expect([kw.w, kw.h]).toEqual([auto.w, auto.h]);
  });
  it('height (block の向き) の語は auto と同じ。min-height の語は、高さの指定のある箱を中身の高さまで伸ばす', async () => {
    const auto = await one('width: 40pt');
    for (const k of ['min-content', 'max-content', 'fit-content']) {
      const b = await one(`width: 40pt; height: ${k}`);
      expect([k, b.w, b.h]).toEqual([k, auto.w, auto.h]);
    }
    // 40pt の幅に 8 字 = 2 行 (20pt)
    expect(Math.round((await one('width: 40pt; height: 5pt; min-height: min-content')).h)).toBe(20);
    expect(Math.round((await one('width: 40pt; height: 50pt; min-height: min-content')).h)).toBe(50);
  });
  it('横並びの flex の項目の width の語は、flex-basis の語として効く', async () => {
    const t = await lay(`<div style="display: flex"><div style="${RED}; width: min-content">${A8}</div><div style="background: #0000ff; width: max-content">${A8}</div></div>`);
    expect(w(t.bg('#ff0000')[0])).toBe(10);
    expect(w(t.bg('#0000ff')[0])).toBe(80);
  });
  it('flex・grid の容器、表とその中の箱の語の大きさは、auto として組んで知らせる。語の大きさを使わない文書には知らせない', async () => {
    const t = await lay(`<div style="display: flex; width: fit-content"><div>${A8}</div></div><table style="width: max-content"><tr><td>${A8}</td></tr></table><div style="height: 30pt; max-height: min-content">${A8}</div>`);
    expect(t.warnings.find((x) => x.startsWith('未対応の CSS を無視しました: '))).toBe('未対応の CSS を無視しました: max-height: min-content (height の指定のある箱)、width: fit-content (flex・grid の容器)、width: max-content (表とその中の箱)');
    const u = await lay(`<div style="width: min-content">${A8}</div><fieldset><legend>あ</legend>${A8}</fieldset><div style="float: left; width: fit-content">${A8}</div><table style="width: fit-content"><tr><td>${A8}</td></tr></table>`);
    expect(u.warnings.filter((x) => /未対応|知らない/.test(x))).toEqual([]);
  });
  it('語の大きさの箱の深い入れ子でも、計測は入れ子の深さに比例する回数で済む (計測の覚え)', async () => {
    let body = A8;
    for (let k = 0; k < 14; k++) body = `<div style="width: fit-content; padding: 0 1px">${body}</div>`;
    const t = await lay(`<div style="${RED}; width: fit-content">${body}</div>`);
    expect(t.pages).toBe(1);
    expect(t.glyphs('あ').length).toBe(8);
    expect(w(t.bg('#ff0000')[0])).toBe(101);
  });
});

describe('initial-letter (CSS Inline 3 §7)', () => {
  // ページの幅 200pt。字は 10pt、行の高さ 20pt (字の枠は、行の上端から 5pt 下)。段落は 70 字 (1 行に 20 字)
  const TEXT = `漢${'あ'.repeat(69)}`;
  const page = '@page { size: 200pt 300pt; margin: 0 }';
  const css = (v: string, more = '') => `body { line-height: 20pt } p::first-letter { initial-letter: ${v}; ${more} }`;
  const base = (g: Box) => r1(g.y + ((g.raw as { baselineY?: number }).baselineY ?? 0));
  it('和文 (lang="ja" は ideographic): N 行の字は、最初の行の字の枠の上端から N 行目の字の枠の下端まで。N 行が回り込む', async () => {
    const t = await lay(`<p>${TEXT}</p>`, css('3'), page);
    const g = t.glyphs('漢')[0];
    // 字の大きさ = (3 − 1) × 20 + 10 = 50pt。字の枠は 5pt〜55pt
    expect([r1(g.fontSize!), r1(g.y), r1(g.x)]).toEqual([50, 5, 0]);
    // 1〜3 行目は字の幅 (50pt) だけ右から、4 行目は左端から
    const ls = t.boxes.filter((b) => b.type === 'line' && b.page === 1 && b.w > 60).map((l) => r1(l.y));
    expect(ls.slice(0, 5)).toEqual([0, 20, 40, 60, 80]);
    const xs = (y: number) => r1(Math.min(...t.glyphs('あ').filter((k) => k.y >= y && k.y < y + 20).map((k) => k.x)));
    expect([xs(0), xs(20), xs(40), xs(60)]).toEqual([50, 50, 50, 0]);
    expect(t.warnings.filter((x) => /未対応|知らない/.test(x))).toEqual([]);
  });
  it('沈める行の数: 「3 2」は 1 行分だけ上へ出て、最初の行を下げる。「3 1」「3 raise」は 2 行分。「2 3」は上をそろえて 3 行が回り込む', async () => {
    const xs = (t: Awaited<ReturnType<typeof lay>>, y: number) => r1(Math.min(...t.glyphs('あ').filter((k) => k.y >= y && k.y < y + 20).map((k) => k.x)));
    const a = await lay(`<p>${TEXT}</p>`, css('3 2'), page);
    expect([r1(a.glyphs('漢')[0].fontSize!), r1(a.glyphs('漢')[0].y)]).toEqual([50, 5]);
    // 最初の行は 20pt 下から。2 行 (20〜60) が回り込み、3 行目 (60〜) は左端から
    expect(Math.min(...a.glyphs('あ').map((k) => r1(k.y)))).toBe(25);
    expect([xs(a, 20), xs(a, 40), xs(a, 60)]).toEqual([50, 50, 0]);
    for (const v of ['3 1', '3 raise', 'raise 3']) {
      const b = await lay(`<p>${TEXT}</p>`, css(v), page);
      expect([v, r1(b.glyphs('漢')[0].y), Math.min(...b.glyphs('あ').map((k) => r1(k.y))), xs(b, 40), xs(b, 60)]).toEqual([v, 5, 45, 50, 0]);
    }
    const c = await lay(`<p>${TEXT}</p>`, css('2 3'), page);
    // 字の大きさ = 20 + 10 = 30pt。上を最初の行の字の枠にそろえ、3 行が回り込む
    expect([r1(c.glyphs('漢')[0].fontSize!), r1(c.glyphs('漢')[0].y)]).toEqual([30, 5]);
    expect([xs(c, 0), xs(c, 20), xs(c, 40), xs(c, 60)]).toEqual([30, 30, 30, 0]);
    // 小数の大きさ: 「2.5」は 2 行沈める (drop は切り捨て)。字の大きさ = 1.5 × 20 + 10 = 40pt
    const d = await lay(`<p>${TEXT}</p>`, css('2.5'), page);
    expect(r1(d.glyphs('漢')[0].fontSize!)).toBe(40);
    expect([xs(d, 10), xs(d, 30), xs(d, 50)]).toEqual([40, 40, 0]);
  });
  it('欧文 (alphabetic): 字の基線は N 行目の基線、大文字の高さの上端は最初の行の大文字の高さ', async () => {
    const t = await lay('<p>Txxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx</p>', `${css('3', 'initial-letter-align: alphabetic')} html { font-family: 'Tinos' }`, page);
    const T = t.glyphs('T')[0];
    const x = t.glyphs('x');
    const lines = [...new Set(x.map(base))].sort((p, q) => p - q);
    // 3 行目の基線にそろう
    expect(base(T)).toBe(lines[2]);
    // 字の大きさ × 大文字の高さ = 2 行 + 本文の大文字の高さ (大文字の高さの比は書体の値。字の大きさから逆算して、妥当な範囲にあること)
    const cap = 40 / (T.fontSize! - 10);
    expect(cap).toBeGreaterThan(0.6);
    expect(cap).toBeLessThan(0.75);
    // 4 行目は左端から
    expect(r1(Math.min(...x.filter((k) => base(k) === lines[3]).map((k) => k.x)))).toBe(0);
    expect(r1(Math.min(...x.filter((k) => base(k) === lines[2]).map((k) => k.x)))).toBeGreaterThan(20);
  });
  it('initial-letter-align: leading は行の上端から N 行目の下端まで。alphabetic の和文の字は、字の枠を大文字の高さと基線に合わせる', async () => {
    const t = await lay(`<p>${TEXT}</p>`, css('2', 'initial-letter-align: leading'), page);
    expect([r1(t.glyphs('漢')[0].fontSize!), r1(t.glyphs('漢')[0].y)]).toEqual([40, 0]);
    const u = await lay(`<p>${TEXT}</p>`, css('2', 'initial-letter-align: alphabetic'), page);
    const g = u.glyphs('漢')[0];
    // 字の枠の下端 = 2 行目の基線
    const second = [...new Set(u.glyphs('あ').map(base))].sort((p, q) => p - q)[1];
    expect(r1(g.y + g.fontSize!)).toBe(second);
    expect(g.fontSize!).toBeLessThan(30);
  });
  it('字下げ (text-indent) は字の箱ごと下げる。余白 (margin) は回り込む範囲に入る。色などの書式は字に当たる', async () => {
    const t = await lay(`<p style="text-indent: 10pt">${TEXT}</p>`, css('2', 'margin-right: 4pt; color: #ff0000'), page);
    const g = t.glyphs('漢')[0];
    expect([r1(g.x), r1(g.fontSize!), (g.raw as { color?: string }).color]).toEqual([10, 30, '#ff0000']);
    // 1・2 行目は 10 + 30 + 4pt から (最初の行に、字下げを重ねて掛けない)
    const xs = (y: number) => r1(Math.min(...t.glyphs('あ').filter((k) => k.y >= y && k.y < y + 20).map((k) => k.x)));
    expect([xs(0), xs(20), xs(40)]).toEqual([44, 44, 0]);
  });
  it('縦書き: 字は行の進む向きの始め (上) に置き、N 行 (右から) が回り込む', async () => {
    const t = await lay(`<p>${TEXT}</p>`, `${css('2')} html { writing-mode: vertical-rl }`, '@page { size: 300pt 200pt; margin: 0 }');
    const g = t.glyphs('漢')[0];
    // 字の大きさ 30pt。右の端から 5pt (最初の行の字の枠) 〜 35pt
    expect([r1(g.fontSize!), r1(g.y), r1(g.x + g.w)]).toEqual([30, 0, 295]);
    const ys = (x0: number) => r1(Math.min(...t.glyphs('あ').filter((k) => k.x >= x0 && k.x < x0 + 20).map((k) => k.y)));
    expect([ys(280), ys(260), ys(240)]).toEqual([30, 30, 0]);
  });
  it('短い段落の字の箱は、続く段落へ回り込みが続く。続く段落も最初の字で始まるなら、前の字の下から', async () => {
    const t = await lay(`<p class="d">漢あ</p><p>${'い'.repeat(40)}</p>`, 'body { line-height: 20pt } p.d::first-letter { initial-letter: 3 }', page);
    const i = t.glyphs('い');
    expect([r1(Math.min(...i.filter((k) => k.y < 40).map((k) => k.x))), r1(Math.min(...i.filter((k) => k.y > 60).map((k) => k.x)))]).toEqual([50, 0]);
    const u = await lay('<p>漢あ</p><p>字い</p>', css('3'), page);
    expect([r1(u.glyphs('漢')[0].y), r1(u.glyphs('字')[0].y)]).toEqual([5, 65]);
  });
  it('ページの残りに字の箱が入らなければ、段落ごと次のページへ送る', async () => {
    const t = await lay(`${lines(13, 'い')}<p class="d">${TEXT}</p>`, 'body { line-height: 20pt } p.d::first-letter { initial-letter: 3 }', page);
    expect([t.glyphs('漢')[0].page, Math.min(...t.glyphs('あ').map((k) => k.page))]).toEqual([2, 2]);
  });
  it('float のある ::first-letter は、ただの回り込み。読めない値・normal は効かない。::first-letter 以外への指定と未対応の合わせ方は知らせる', async () => {
    const t = await lay(`<p>${TEXT}</p>`, css('3', 'float: left'), page);
    expect(r1(t.glyphs('漢')[0].fontSize!)).toBe(10);
    for (const v of ['normal', '0.5', '3 0', '3 1.5', '3 drop raise']) {
      const u = await lay(`<p>${TEXT}</p>`, css(v), page);
      expect([v, r1(u.glyphs('漢')[0].fontSize!)]).toEqual([v, 10]);
    }
    const w = await lay(`<p><span style="initial-letter: 2">漢</span>${'あ'.repeat(30)}</p><p class="h">${TEXT}</p>`, 'p.h::first-letter { initial-letter: 2; initial-letter-align: hanging }', page);
    expect(w.warnings.find((x) => x.startsWith('未対応の CSS を無視しました: '))).toBe('未対応の CSS を無視しました: initial-letter (::first-letter 以外の箱)、initial-letter-align: hanging');
  });
});

describe('empty-cells (CSS 2.1 §17.6.1.1)', () => {
  const CSS = 'table { border-spacing: 3pt; border-collapse: separate } td { border: 3pt solid #000000; padding: 3pt; background: #ff0000 } tr.g { background: #00ff00 } tr.g td { background: none }';
  type Cell = Box & { color: (string | undefined)[] };
  const cells = (t: Awaited<ReturnType<typeof lay>>): Cell[] =>
    t.boxes.filter((b) => b.type === 'table-cell').map((b) => ({ ...b, color: (['top', 'right', 'bottom', 'left'] as const).map((k) => (b.raw.border?.[k] as { color?: string } | undefined)?.color) }));
  it('hide: 罫線を分ける表の、中身の無いセルは、罫線 (太さは残す) も背景も描かない。空の要素のあるセル・空白を残すセルは中身がある', async () => {
    const t = await lay('<table style="empty-cells: hide"><tr><td>あ</td><td></td><td> \n</td><td><span></span></td><td style="white-space: pre"> </td></tr></table>', CSS);
    const c = cells(t);
    expect(c.map((x) => x.bg)).toEqual(['#ff0000', undefined, undefined, '#ff0000', '#ff0000']);
    expect(c.map((x) => x.color[0])).toEqual(['#000000', 'transparent', 'transparent', '#000000', '#000000']);
    // 罫線の太さは残る (表の組み方は変わらない)
    expect(c.map((x) => x.bord)).toEqual(c.map(() => [3, 3, 3, 3]));
    const show = cells(await lay('<table><tr><td>あ</td><td></td><td> \n</td><td><span></span></td><td style="white-space: pre"> </td></tr></table>', CSS));
    expect(show.map((x) => [x.bg, x.color[0]])).toEqual(show.map(() => ['#ff0000', '#000000']));
    expect(c.map((x) => [r1(x.x), r1(x.w), r1(x.h)])).toEqual(show.map((x) => [r1(x.x), r1(x.w), r1(x.h)]));
    expect(t.warnings.filter((x) => /未対応|知らない/.test(x))).toEqual([]);
  });
  it('hide: 行の背景も、中身の無いセル・visibility: hidden のセルの後ろには描かない。罫線を重ねる表では効かない', async () => {
    const t = cells(await lay('<table style="empty-cells: hide"><tr class="g"><td>あ</td><td></td><td style="visibility: hidden">い</td></tr></table>', CSS));
    expect(t.map((x) => x.bg)).toEqual(['#00ff00', undefined, undefined]);
    const u = cells(await lay('<table style="empty-cells: hide; border-collapse: collapse"><tr><td>あ</td><td></td></tr></table>', CSS));
    expect(u.map((x) => x.bg)).toEqual(['#ff0000', '#ff0000']);
  });
  it('hide: セルがすべて中身の無い行は、高さが 0', async () => {
    const t = await lay('<table style="empty-cells: hide"><tr><td>あ</td><td>い</td></tr><tr><td></td><td> </td></tr><tr><td>う</td><td></td></tr></table>', CSS);
    // セルの高さ (字 10pt + 余白・罫線 12pt)。中身の無い行のセルは 0 (行の領域には、行の間の空き 3pt が残る)
    expect(cells(t).map((x) => r1(x.h))).toEqual([22, 22, 0, 0, 22, 22]);
    const show = await lay('<table><tr><td>あ</td><td>い</td></tr><tr><td></td><td> </td></tr><tr><td>う</td><td></td></tr></table>', CSS);
    expect(cells(show).map((x) => r1(x.h))).toEqual([22, 22, 12, 12, 22, 22]);
  });
});

describe('XSL-FO: 罫線・余白の conditionality="retain" の入れ子', () => {
  it('入れ子の箱がどちらも後ろ側を残すとき、外側の断片は、内側の断片の罫線・余白まで包む', async () => {
    const keep = 'border-after-width.conditionality="retain" padding-after.conditionality="retain"';
    const fo =
      '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-family="Noto Serif JP" font-size="10pt" line-height="10pt"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="200pt" page-height="100pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>' +
      `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block border="2pt solid black" padding="3pt" background-color="#ff0000" ${keep}><fo:block border="1pt solid black" padding="1pt" background-color="#0000ff" ${keep}>` +
      Array.from({ length: 12 }, () => '<fo:block>あ</fo:block>').join('') +
      '</fo:block></fo:block></fo:flow></fo:page-sequence></fo:root>';
    const r = await typesetFo(fo, { name: 't.fo', loadFont });
    const boxes = boxesOf(r.areaTree as never);
    const o = boxes.filter((b) => b.bg === '#ff0000')[0];
    const i = boxes.filter((b) => b.bg === '#0000ff')[0];
    // 内側の断片の下端 (罫線の外側) は、外側の断片の内容の箱の下端
    expect(r1(i.y + i.h)).toBe(r1(o.y + o.h - 5));
    expect(r1(o.y + o.h)).toBeLessThanOrEqual(100);
  });
});

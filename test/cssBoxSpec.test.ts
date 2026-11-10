/**
 * 箱の組版の CSS:
 *  - box-decoration-break: clone (CSS Fragmentation 3 §5.4): ページ・段・行で分かれた箱の断片ごとに、罫線・内側の余白を付け直す
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

/**
 * 行の中に書いた float・絶対配置の箱の置き場所:
 *  - 段落の中の float は、書いた所 (参照) のある行に置く (CSS 2.1 §9.5.1 の規則 6・8)。前は、段落の頭 (ページをまたぐ段落では 1 ページ目の頭) に置いていた
 *  - ブロックを含む行内の要素の中の float は、書いた所の側の匿名のブロックに置く (CSS 2.1 §9.2.1.1)。前は、最後のブロックの後に置いていた
 *  - flex の項目の中身による幅 (max-content) に、中の float の幅を数える (CSS Flexbox 1 §9.2・CSS Sizing 3 §5)。前は数えず、float の横の字が次の行へ送られた
 *  - 位置の決まった祖先の無い絶対配置の箱の、top・left が auto の向きは、static position (CSS 2.1 §10.3.7・§10.6.4)。前は、ページの本文領域の左上に置いていた
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf } from '../src/areaTree';
import { DEFAULT_FONTS, typeset } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const opts = { loadFont: loadCachedFont, fetchImages: false } as const;
type Tree = Awaited<ReturnType<typeof typeset>>['areaTree'];
type Node = Parameters<typeof childrenOf>[0];
type G = { text: string; x: number; y: number; page: number };

/** 字の紙面の上の位置 (x・y) とページ */
function glyphs(tree: Tree): G[] {
  const out: G[] = [];
  tree.sheets.forEach((sheet, page) => {
    const visit = (a: Node, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') out.push({ text: a.text, x, y, page });
      // 子の座標は、親の content-box の左上から (areaTree.ts の決まり)
      const pa = a as { padding?: { left?: number; top?: number }; border?: { left?: { width?: number }; top?: { width?: number } } };
      for (const c of childrenOf(a)) visit(c, x + (pa.padding?.left ?? 0) + (pa.border?.left?.width ?? 0), y + (pa.padding?.top ?? 0) + (pa.border?.top?.width ?? 0));
    };
    visit(sheet, 0, 0);
  });
  return out;
}
const html = (body: string, page = '120mm 80mm') =>
  `<!DOCTYPE html><html lang="ja"><head><style>@page { size: ${page}; margin: 10mm } body { margin: 0; font-size: 12pt } p { text-indent: 0 }</style></head><body>${body}</body></html>`;
const one = (gs: G[], t: string) => {
  const g = gs.filter((x) => x.text === t);
  expect(g.length).toBe(1);
  return g[0];
};
const a = (n: number) => 'あ'.repeat(n);
const i = (n: number) => 'い'.repeat(n);

describe('段落の中の float は、書いた所のある行に置く', () => {
  it('p の直下の float: 3 行目に書いた float を、3 行目の上端に置く (段落の頭に置かない)', async () => {
    const gs = glyphs((await typeset(html(`<p>${a(50)}前<b style="float:right">浮</b>${i(40)}</p>`), opts)).areaTree);
    const f = one(gs, '浮');
    const prev = one(gs, '前');
    expect(f.y).toBeCloseTo(prev.y, 1);
    expect(f.y).toBeGreaterThan(gs[0].y + 30);
  });

  it('em の中の float も、書いた所の行に置く', async () => {
    const gs = glyphs((await typeset(html(`<p>${a(50)}<em>前<b style="float:right">浮</b>後</em>${i(40)}</p>`), opts)).areaTree);
    expect(one(gs, '浮').y).toBeCloseTo(one(gs, '前').y, 1);
  });

  it('ページをまたぐ段落の、2 ページ目に書いた float は、2 ページ目に置く', async () => {
    const gs = glyphs((await typeset(html(`<p>${a(200)}前<b style="float:left">浮</b>${i(30)}</p>`), opts)).areaTree);
    const f = one(gs, '浮');
    const prev = one(gs, '前');
    expect(prev.page).toBe(1);
    expect(f.page).toBe(1);
    expect(f.y).toBeCloseTo(prev.y, 1);
  });

  it('前の中身の横に入らない float は、その行の下 (次の行の上端) に置く', async () => {
    // 行の終わり近くに書いた、幅の広い float
    const gs = glyphs((await typeset(html(`<p>${a(20)}前<b style="float:right;width:150pt">浮</b>${i(40)}</p>`), opts)).areaTree);
    const f = one(gs, '浮');
    const prev = one(gs, '前');
    expect(f.y).toBeGreaterThan(prev.y + 10);
    // 前の行の字は、float に押されずに同じ行に残る
    expect(gs.filter((g) => g.text === 'あ').every((g) => Math.abs(g.y - gs[0].y) < 1)).toBe(true);
  });

  it('字下げのある段落の 2 行目以降に書いた float:left は、本文の左端に置く (字下げは 1 行目だけ。中の字は受け継いだ字下げの分だけ右)', async () => {
    const page = (body: string) =>
      `<!DOCTYPE html><html lang="ja"><head><style>@page { size: 120mm 80mm; margin: 10mm } body { margin: 0; font-size: 12pt }</style></head><body>${body}</body></html>`;
    for (const [box, inner] of [['float:left;text-indent:0', 0], ['float:left', 36]] as const) {
      const body = `<p style="text-indent:3em">${a(60)}前<b style="${box}">浮</b>後</p>`;
      const gs = glyphs((await typeset(page(body), opts)).areaTree);
      expect(one(gs, '浮').x, box).toBeCloseTo(28.35 + inner, 1);
      expect(one(gs, '浮').y, box).toBeCloseTo(one(gs, '前').y, 1);
    }
    // padding-left のある段落: 段落の内容の左端
    const gs = glyphs((await typeset(page(`<p style="padding-left:10mm;text-indent:3em">${a(60)}前<b style="float:left;text-indent:0">浮</b>後</p>`), opts)).areaTree);
    expect(one(gs, '浮').x).toBeCloseTo(28.35 + 28.35, 1);
  });

  it('行の頭の float は、これまでどおり段落の頭に置く', async () => {
    const gs = glyphs((await typeset(html(`<p><b style="float:left">浮</b>${a(10)}</p>`), opts)).areaTree);
    expect(one(gs, '浮').y).toBeCloseTo(gs.find((g) => g.text === 'あ')!.y, 1);
  });
});

describe('ブロックを含む行内の要素の中の float', () => {
  it('書いた所の側の匿名のブロック (甲乙の行) に置く (最後のブロックの後に置かない)', async () => {
    const gs = glyphs((await typeset(html('<div><span>甲<b style="float:right">浮</b>乙<div>塊一</div><div>塊二</div>丙</span></div>'), opts)).areaTree);
    expect(one(gs, '浮').y).toBeCloseTo(one(gs, '甲').y, 1);
    expect(one(gs, '丙').y).toBeGreaterThan(one(gs, '浮').y + 30);
  });
});

describe('flex の項目の中身による幅に、中の float を数える', () => {
  it('項目の中の float の横の字を、次の行へ送らない', async () => {
    const gs = glyphs((await typeset(html('<div style="display:flex"><span>項目<b style="float:left">浮</b>後</span><span>次</span></div>'), opts)).areaTree);
    const y = one(gs, '項').y;
    for (const t of ['浮', '後', '次']) expect(one(gs, t).y).toBeCloseTo(y, 1);
    // 次の項目は、前の項目 (4 字分) の後
    expect(one(gs, '次').x).toBeGreaterThan(one(gs, '後').x + 5);
  });
});

describe('位置の決まった祖先の無い絶対配置の箱の static position', () => {
  it('ブロックの間の箱: top が auto なら、前のブロックの下 (後のブロックと同じ高さ)', async () => {
    const gs = glyphs((await typeset(html('<p>一行目</p><div style="position:absolute">絶</div><p>後</p>'), opts)).areaTree);
    expect(one(gs, '絶').y).toBeCloseTo(one(gs, '後').y, 1);
    expect(one(gs, '絶').x).toBeCloseTo(one(gs, '一').x, 1);
  });

  it('left だけを書いた箱: 縦は static position、横は left', async () => {
    const gs = glyphs((await typeset(html('<p>一</p><div style="position:absolute;left:50pt">左</div><p>後</p>'), opts)).areaTree);
    expect(one(gs, '左').y).toBeCloseTo(one(gs, '後').y, 1);
    expect(one(gs, '左').x).toBeCloseTo(28.35 + 50, 0);
  });

  it('行の中の箱: 見つけた所の行の上端と、行の中の位置', async () => {
    const gs = glyphs((await typeset(html(`<p>${a(30)}前<span style="position:absolute">絶</span>後${i(10)}</p>`), opts)).areaTree);
    const z = one(gs, '絶');
    const prev = one(gs, '前');
    expect(z.y).toBeCloseTo(prev.y, 1);
    expect(z.x).toBeCloseTo(one(gs, '後').x, 1);
  });

  it('行内の要素の中の箱も、見つけた所 (行内の要素の終わりでない)', async () => {
    const gs = glyphs((await typeset(html(`<p>${a(30)}<em>前<span style="position:absolute">絶</span>後${i(5)}</em>${i(5)}</p>`), opts)).areaTree);
    expect(one(gs, '絶').x).toBeCloseTo(one(gs, '後').x, 1);
  });

  // 段落の字下げ (既定の p の 1em も)・padding のある段落の中の箱。箱そのものは static position に置き (字下げ・padding を二重に足さない)、
  // 箱の中の 1 行目は、受け継いだ text-indent で字下げする (CSS Text 3 §8.1: text-indent は受け継ぐ。ブラウザーも同じ)
  const htmlIndent = (body: string) =>
    `<!DOCTYPE html><html lang="ja"><head><style>@page { size: 120mm 80mm; margin: 10mm } body { margin: 0; font-size: 12pt }</style></head><body>${body}</body></html>`;
  const bodies = (box: string) => [
    `<p>前<b style="${box}">絶</b>後${i(10)}</p>`,
    `<p>${a(30)}前<b style="${box}">絶</b>後${i(10)}</p>`,
    `<p style="text-indent:3em">${a(60)}前<b style="${box}">絶</b>後</p>`,
    `<p style="text-indent:3em">前<b style="${box}">絶</b>後</p>`,
    `<p style="padding-left:10mm">${a(30)}前<b style="${box}">絶</b>後</p>`,
    `<blockquote style="margin:0 0 0 5mm;padding-left:5mm"><p style="padding-left:3mm">${a(30)}前<b style="${box}">絶</b>後</p></blockquote>`,
  ];
  it('字下げ・padding のある段落の中の箱: 箱は static position (中の字下げを 0 にすれば、字は後の字と同じ所)', async () => {
    for (const body of bodies('position:absolute;text-indent:0')) {
      const gs = glyphs((await typeset(htmlIndent(body), opts)).areaTree);
      expect(one(gs, '絶').x, body).toBeCloseTo(one(gs, '後').x, 1);
      expect(one(gs, '絶').y, body).toBeCloseTo(one(gs, '前').y, 1);
    }
  });

  it('字下げのある段落の中の箱の中の字は、受け継いだ字下げの分だけ右 (既定の p の 1em、3em)', async () => {
    const b = bodies('position:absolute');
    for (const [body, ind] of [[b[1], 12], [b[2], 36], [b[3], 36], [b[4], 12]] as const) {
      const gs = glyphs((await typeset(htmlIndent(body), opts)).areaTree);
      expect(one(gs, '絶').x - one(gs, '後').x, body).toBeCloseTo(ind, 1);
    }
  });

  it('ブロックを含む行内の要素の中の箱は、見つけた所の側の匿名のブロック', async () => {
    const gs = glyphs((await typeset(html('<div><span>甲<b style="position:absolute">絶</b>乙<div>塊一</div>丙</span></div>'), opts)).areaTree);
    expect(one(gs, '絶').y).toBeCloseTo(one(gs, '甲').y, 1);
    expect(one(gs, '絶').x).toBeCloseTo(one(gs, '乙').x, 1);
  });
});

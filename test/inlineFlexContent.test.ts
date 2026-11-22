/**
 * 行内の flex・grid の容器 (display: inline-flex・inline-grid) の中身と、flex・grid の項目にした行内の要素の端の空白の回帰テスト:
 *  - HTM-82: inline-flex・inline-grid の要素の中身が、警告も無く丸ごと消えた (0.2.0 からの退行。行内の要素の中身の並びでも項目をブロック化し、
 *    行内の箱の子に入れたブロックを組版が置かなかった。まわりの空白も、そのブロックを行の境目とみて消えた)。0.2.0 と同じに、中身を行の中に組む
 *  - HTM-83: flex・grid の項目にした行内の要素で、中身の前後の空白 (タグの直後の改行を含む) が行頭・行末に残り、項目が空白 1 つ分ずれた。
 *    項目はブロック化する (Flexbox 1 §4) ので、端の空白は行の頭・終わりの空白として消える (CSS Text 3 §4.1.2)。white-space: pre・pre-wrap では消さない
 *
 * テストの書体は Noto Sans JP。@font-face で読み、欧文もその書体で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, childrenOf, type FontSpec } from '../src/index';
import type { Area } from '../src/types';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
/** 本文の領域の左端 (ふつうのブロックの先頭の字の位置。段落 p は字下げがあるので使わない) */
let x0 = 0;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
  x0 = (await run('<div>X</div>')).at('X').x;
});

type G = { text: string; x: number; y: number };
type B = { text?: string; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };

/** 本文の領域の行ごとの字の並び (空白の字も含む) と、字の位置 (pt) */
async function run(body: string, css = '') {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;margin:0} ${css}</style><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
  const lines: string[] = [];
  const glyphs: G[] = [];
  /** 行の中の分けられない箱 (中にブロックを持つ行内の箱) の数 */
  let boxes = 0;
  const text = (a: Area): string => (a.type === 'glyph' ? ((a as B).text ?? '') : childrenOf(a).map((c) => text(c as Area)).join(''));
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as B;
    if (a.type === 'line') lines.push(text(a));
    if (a.type === 'glyph') glyphs.push({ text: b.text ?? '', x, y });
    if (a.type === 'inline' && childrenOf(a).some((c) => (c as Area).type === 'block')) boxes++;
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
  };
  rec(r.areaTree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  /** 字 ch の (n 番目の) 位置 */
  const at = (ch: string, n = 0) => glyphs.filter((g) => g.text === ch)[n];
  return { lines, glyphs, at, boxes };
}

describe('HTM-82 inline-flex・inline-grid の要素の中身を行の中に組む', () => {
  it('リンクの inline-flex: 中身と前後の空白が残る (直す前は「EEEtail」)', async () => {
    const r = await run('<p>EEE <a href="#" style="display:inline-flex;align-items:center">Label</a> tail</p>');
    expect(r.lines).toEqual(['EEE Label tail']);
    // 中身は前の字と同じ行 (同じ高さ) に、前の字より右に置く
    expect(r.at('L').y).toBeCloseTo(r.at('E').y, 1);
    expect(r.at('L').x).toBeGreaterThan(r.at('E', 2).x);
    expect(r.at('t').x).toBeGreaterThan(r.at('l').x);
  });
  it('inline-grid (直す前は「xy」)', async () => {
    expect((await run('<p>x <span style="display:inline-grid">GRID</span> y</p>')).lines).toEqual(['x GRID y']);
  });
  it('項目が 2 つの inline-flex: 字が出て、項目は横に並ぶ (直す前は字が 1 つも出ない)', async () => {
    const r = await run('<div style="display:inline-flex"><i>FFF</i><i>GGG</i></div>');
    expect(r.lines).toEqual(['FFFGGG']);
    expect(r.at('G').y).toBeCloseTo(r.at('F').y, 1);
    expect(r.at('G').x).toBeGreaterThan(r.at('F', 2).x);
  });
  it('button の inline-flex', async () => {
    expect((await run('<p><button style="display:inline-flex">BTN</button></p>')).lines.join('')).toContain('BTN');
  });
  it('表のセルの中の inline-flex', async () => {
    expect((await run('<table><tr><td><span style="display:inline-flex">JJJ</span></td></tr></table>')).lines).toEqual(['JJJ']);
  });
  it('::before・::after を持つ inline-flex', async () => {
    const r = await run('<p>a <span class="b">mid</span> z</p>', '.b{display:inline-flex} .b::before{content:"["} .b::after{content:"]"}');
    expect(r.lines).toEqual(['a [mid] z']);
  });
  it('入れ子の inline-flex と、flex の項目の中の inline-flex', async () => {
    expect((await run('<p>p <span style="display:inline-flex">o<span style="display:inline-flex">IN</span>q</span> r</p>')).lines).toEqual(['p oINq r']);
    expect((await run('<div style="display:flex"><span>S <span style="display:inline-flex">KKK</span> T</span></div>')).lines).toEqual(['S KKK T']);
  });
  it('縦並びの inline-flex も中身が出る', async () => {
    expect((await run('<p>a <span style="display:inline-flex;flex-direction:column"><b>UU</b><b>VV</b></span> b</p>')).lines.join('')).toMatch(/UU.*VV/);
  });
});

describe('HTM-83 flex・grid の項目にした行内の要素の端の空白は、行の頭・終わりの空白として消える', () => {
  const body = '<div class="c">\n <span>\n CCC\n </span>\n <span> DDD </span>\n</div>';
  it('横並びの flex: 項目の先頭の字は容器の左端 (直す前は空白 1 つ分ずれた)', async () => {
    const r = await run(body, '.c{display:flex}');
    expect(r.at('C').x).toBeCloseTo(x0, 1);
    // 項目ごとの行 (横に並べた表のセル)。中身の字の前後に空白が残らない
    expect(r.lines).toEqual(['CCC', 'DDD']);
    expect(r.at('D').y).toBeCloseTo(r.at('C').y, 1);
    expect(r.at('D').x).toBeGreaterThan(r.at('C', 2).x);
  });
  it('縦並びの flex', async () => {
    const r = await run(body, '.c{display:flex;flex-direction:column}');
    expect(r.lines).toEqual(['CCC', 'DDD']);
    expect(r.at('C').x).toBeCloseTo(x0, 1);
    expect(r.at('D').x).toBeCloseTo(x0, 1);
  });
  it('grid の項目', async () => {
    const r = await run(body, '.c{display:grid}');
    expect(r.lines).toEqual(['CCC', 'DDD']);
    expect(r.at('C').x).toBeCloseTo(x0, 1);
    expect(r.at('D').x).toBeCloseTo(x0, 1);
  });
  it('無名の項目 (容器の直下の文字)', async () => {
    const r = await run('<div style="display:flex;flex-direction:column">\n  AAA  \n<span>BBB</span></div>');
    expect(r.lines).toEqual(['AAA', 'BBB']);
    expect(r.at('A').x).toBeCloseTo(x0, 1);
  });
  it('中央に寄せた縦並びの項目: 前後の空白を数えずに寄せる', async () => {
    const a = await run('<div style="display:flex;flex-direction:column;align-items:center;width:200pt"><span> MMM </span></div>');
    const b = await run('<div style="display:flex;flex-direction:column;align-items:center;width:200pt"><span>MMM</span></div>');
    expect(a.at('M').x).toBeCloseTo(b.at('M').x, 1);
  });
  it('white-space: pre・pre-wrap の項目では、端の空白を消さない', async () => {
    for (const ws of ['pre', 'pre-wrap']) {
      const r = await run(`<div style="display:flex"><span style="white-space:${ws}">  QQQ</span></div>`);
      expect(r.at('Q').x - x0, ws).toBeGreaterThan(3);
    }
  });
  it('項目の中の行内の要素の間の空白は残す', async () => {
    expect((await run('<div style="display:flex"><span> word <b>bold </b>word </span></div>')).lines).toEqual(['word bold word']);
  });
});

describe('HTM-91 inline-flex・inline-grid のブロックの項目は、外の段落の行を分けず、行の中に横に並ぶ', () => {
  /** 字の並び chars が、同じ行 (同じ高さ) に、左から右へ並ぶ */
  const inRow = (r: Awaited<ReturnType<typeof run>>, chars: string[]) => {
    for (let k = 1; k < chars.length; k++) {
      expect(r.at(chars[k]).y).toBeCloseTo(r.at(chars[0]).y, 1);
      expect(r.at(chars[k]).x).toBeGreaterThan(r.at(chars[k - 1]).x);
    }
  };
  it('div の項目 2 つ: 1 行「EEE AB tail」(直す前は「EEE」「A」「B」「tail」の 4 行)', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><div>A</div><div>B</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE AB tail');
    inRow(r, ['E', 'A', 'B', 't']);
  });
  it('入れ子の行内の要素の中の inline-flex: 外の span の中のブロック (B) の前後だけで分ける', async () => {
    const r = await run('<p>x <span><span style="display:inline-flex"><div>A</div></span><div>B</div></span> y</p>');
    expect(r.lines[0]).toBe('x A');
    inRow(r, ['x', 'A']);
    expect(r.at('B').y).toBeGreaterThan(r.at('A').y);
  });
  it('ボタンの形 (アイコンとラベルを div で書いたリンク) が文の途中にあっても、行は分かれない', async () => {
    const r = await run('<p>文の <a href="#" style="display:inline-flex;align-items:center;gap:4px"><div><svg width="10" height="10"><rect width="10" height="10"/></svg></div><div>Label</div></a> 文</p>');
    expect(r.lines[0]).toBe('文の Label 文');
    inRow(r, ['の', 'L', 'l']);
    expect(r.at('文', 1).y).toBeCloseTo(r.at('L').y, 1);
  });
  it('div と span と直下の字が混ざる項目', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><div>A</div><span>B</span>C</span> tail</p>');
    expect(r.lines[0]).toBe('EEE ABC tail');
    inRow(r, ['E', 'A', 'B', 'C', 't']);
  });
  it('inline-grid: 容器が行いっぱいに広がらない', async () => {
    const r = await run('<p>EEE <span style="display:inline-grid;grid-template-columns:1fr 1fr"><div>A</div><div>B</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE AB tail');
    inRow(r, ['E', 'A', 'B', 't']);
  });
  it('入れ子の inline-flex', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><span style="display:inline-flex"><div>A</div><div>B</div></span><div>C</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE ABC tail');
    inRow(r, ['E', 'A', 'B', 'C', 't']);
  });
  it('表のセルの中', async () => {
    const r = await run('<table><tr><td>EEE <span style="display:inline-flex"><div>A</div><div>B</div></span> tail</td></tr></table>');
    expect(r.lines[0]).toBe('EEE AB tail');
    inRow(r, ['E', 'A', 'B', 't']);
  });
  it('中にブロックを持つ行内の要素の項目: 項目は 1 つの箱で、中のブロックは箱の中に積む。罫線は項目の箱に付ける', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><span style="border:1px solid">p<div>A</div>q</span><div>B</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE pAqB tail');
    inRow(r, ['E', 'p', 'B', 't']);
    expect(r.at('A').x).toBeCloseTo(r.at('p').x, 1);
    expect(r.at('A').y).toBeGreaterThan(r.at('p').y);
    expect(r.at('q').y).toBeGreaterThan(r.at('A').y);
  });
});

describe('inline-flex・inline-grid のブロックの項目の間の、空白だけの文字の並びは組まない (Flexbox 1 §4・CSS Grid 1 §6)', () => {
  const nl = (s: string) => `\n  ${s}`;
  it('項目の間の改行と字下げ: 空白なしで書いたときと同じ「EEE AB tail」(容器の外の前後の空白は残す)', async () => {
    const r = await run(`<p>EEE <span style="display:inline-flex">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span> tail</p>`);
    expect(r.lines[0]).toBe('EEE AB tail');
  });
  it('容器の頭・項目の間・容器の終わりの 3 か所の空白を組まない (和文の間)', async () => {
    const r = await run(`<p>あい<span style="display:inline-flex">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span>うえ</p>`);
    expect(r.lines[0]).toBe('あいABうえ');
  });
  it('inline-grid も同じ', async () => {
    const r = await run(`<p>EEE <span style="display:inline-grid">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span> tail</p>`);
    expect(r.lines[0]).toBe('EEE AB tail');
  });
  it('white-space: pre-wrap・pre の容器でも、空白だけの並びは組まない', async () => {
    for (const ws of ['pre-wrap', 'pre', 'break-spaces']) {
      const r = await run(`<p>EEE <span style="display:inline-flex;white-space:${ws}">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span> tail</p>`);
      expect(r.lines[0], ws).toBe('EEE AB tail');
    }
  });
  it('ブロックの項目と文字の項目が混ざる形: 文字の並びは 1 つの無名の項目で、その頭・終わりの空白は消える', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><div>A</div> text <div>B</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE AtextB tail');
  });
  it('文字の項目の頭の空白は、white-space: pre・pre-wrap では消さない', async () => {
    // 項目の行の終わりの空白は、ふつうのブロック・inline-block の行の終わりと同じ扱い (今の組版は、pre でも字として置かない) なので、ここでは見ない
    for (const ws of ['pre', 'pre-wrap']) {
      const r = await run(`<p>EEE <span style="display:inline-flex;white-space:${ws}"><div>A</div> text <div>B</div></span> tail</p>`);
      expect(r.lines[0], ws).toMatch(/^EEE A text ?B tail$/);
    }
  });
  it('NBSP は空白として扱わない (white-space の効く字でない)', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><div>A</div>&nbsp;<div>B</div></span> tail</p>');
    expect(r.lines[0]).toBe('EEE A\u00a0B tail');
  });
  it('行内の要素だけの項目の容器は、これまでどおり (項目の間の空白を残す)', async () => {
    const r = await run('<p>EEE <span style="display:inline-flex"><span>A</span> <span>B</span></span> tail</p>');
    expect(r.lines[0]).toBe('EEE A B tail');
    const s = await run(`<p>EEE <span style="display:inline-flex">${nl('<span>A</span>')}${nl('<span>B</span>')}\n</span> tail</p>`);
    expect(s.lines[0]).toBe('EEE A B tail');
  });
});

/** ブロックの項目が無い容器の、直す前 (main 4dd9c39) の最初の行の字と位置 */
const EXPECT_CONTENTS = ['E@66.69', 'E@72.58', 'E@78.47', ' @84.36', 'A@86.60', 'x@92.61', ' @97.59', 'c@99.83', ' @104.93', 'y@107.17', 'B@112.38', ' @118.95', 't@121.19', 'a@124.69', 'i@130.32', 'l@133.07'];

describe('inline-flex・inline-grid の、空白だけの並びは元の字で見分け、コメントと display: contents の字は並びを切らない', () => {
  const nl = (s: string) => `\n  ${s}`;
  /** 最初の行 (外の段落の行) の字と、その位置 (pt。0.01 に丸める) */
  const row = (r: Awaited<ReturnType<typeof run>>) => {
    const y = r.glyphs[0].y;
    return r.glyphs.filter((g) => Math.abs(g.y - y) < 0.5).map((g) => `${g.text}@${g.x.toFixed(2)}`);
  };
  it('項目の間の改行と字下げ: 空白を書かない形と、行の中の字の位置も箱の数も同じ (直す前は、改行が 0.01pt の空の箱として残った)', async () => {
    for (const d of ['inline-flex', 'inline-grid']) {
      const a = await run(`<p>EEE <span style="display:${d}">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span> tail</p>`);
      const b = await run(`<p>EEE <span style="display:${d}"><div>A</div><div>B</div></span> tail</p>`);
      expect(a.lines[0], d).toBe('EEE AB tail');
      expect(row(a), d).toEqual(row(b));
      expect(a.boxes, d).toBe(2);
      expect(b.boxes, d).toBe(2);
    }
  });
  it('和文の間でも同じ', async () => {
    const a = await run(`<p>あい<span style="display:inline-flex">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span>うえ</p>`);
    const b = await run('<p>あい<span style="display:inline-flex"><div>A</div><div>B</div></span>うえ</p>');
    expect(row(a)).toEqual(row(b));
    expect(a.boxes).toBe(2);
  });
  it('text-transform: full-width の容器: 空白だけの並びは全角の空白の項目にならない', async () => {
    const a = await run(`<p>EEE <span style="display:inline-flex;text-transform:full-width">${nl('<div>A</div>')}${nl('<div>B</div>')}\n</span> tail</p>`);
    const b = await run('<p>EEE <span style="display:inline-flex;text-transform:full-width"><div>A</div><div>B</div></span> tail</p>');
    expect(a.glyphs.some((g) => g.text === '\u3000')).toBe(false);
    expect(row(a)).toEqual(row(b));
    expect(a.boxes).toBe(2);
  });
  it('コメントは並びを切らない: 「Ax yB」(直す前は「AxyB」)。display: flex の容器の無名の項目と同じ中身', async () => {
    const body = '<div>A</div> x <!-- c --> y <div>B</div>';
    const a = await run(`<p><span style="display:inline-flex">${body}</span></p>`);
    expect(a.lines[0]).toBe('Ax yB');
    expect(a.boxes).toBe(3);
    const f = await run(`<div style="display:flex">${body}</div>`);
    expect(a.lines.slice(1)).toEqual(f.lines);
    // コメントの前後の改行も、つないだ並びの中の改行として扱う (前後が和文なら消す)
    expect((await run('<p><span style="display:inline-flex"><div>A</div>x\n<!-- c -->\ny<div>B</div></span></p>')).lines[0]).toBe('Ax yB');
    expect((await run('<p><span style="display:inline-flex"><div>A</div>あ\n<!-- c -->\nい<div>B</div></span></p>')).lines[0]).toBe('AあいB');
    // white-space: pre では、空白を詰めない (項目の行の終わりの空白は、上の pre の試しと同じく見ない)
    expect((await run(`<p><span style="display:inline-flex;white-space:pre">${body}</span></p>`)).lines[0]).toMatch(/^A x {2}y ?B$/);
  });
  it('display: none の要素も並びを切らない', async () => {
    expect((await run('<p><span style="display:inline-flex"><div>A</div> x <span style="display:none">n</span> y <div>B</div></span></p>')).lines[0]).toBe('Ax yB');
  });
  it('display: contents の要素の字は、まわりの字と 1 つの並び (CSS Display 3 §2.5): 「Ax c yB」(直す前は「AxcyB」)', async () => {
    const a = await run('<p><span style="display:inline-flex"><div>A</div>x <span style="display:contents">c</span> y<div>B</div></span></p>');
    expect(a.lines[0]).toBe('Ax c yB');
    expect(a.boxes).toBe(3);
    // 入れ子の display: contents と、字の書式 (contents の要素から受け継ぐ)
    const b = await run('<p><span style="display:inline-flex"><div>A</div>x <span style="display:contents"><b style="display:contents">c</b></span> y<div>B</div></span></p>');
    expect(b.lines[0]).toBe('Ax c yB');
  });
  it('display: contents の中の行内の要素・ブロックは項目のまま (並びを切る)', async () => {
    const a = await run('<p><span style="display:inline-flex"><div>A</div>x <span style="display:contents"><div>C</div></span> y<div>B</div></span></p>');
    expect(a.lines[0]).toBe('AxCyB');
    expect(a.boxes).toBe(5);
    // 行内の要素 (i) の項目は、これまでどおり行の中に組む (前後の文字の並びは、それぞれ無名の項目)
    const b = await run('<p><span style="display:inline-flex"><div>A</div>x <span style="display:contents"><i>c</i></span> y<div>B</div></span></p>');
    expect(b.lines[0]).toBe('AxcyB');
    expect(b.boxes).toBe(4);
  });
  it('ブロックの項目が無い容器は、コメント・display: contents を挟んでも、これまでと字も位置も同じ (コメントの所の空白は 1 つに詰める)', async () => {
    const a = await run('<p>EEE <span style="display:inline-flex"><span>A</span>x <!-- c --> y<span>B</span></span> tail</p>');
    // コメントを挟んだ空白は、コメントの無い「x  y」と同じく 1 つに詰める (CSS Text 3 §4.1.1。直す前は空白 2 つ)
    expect(a.lines[0]).toBe('EEE Ax yB tail');
    expect(row(a)).toEqual(row(await run('<p>EEE <span style="display:inline-flex"><span>A</span>x  y<span>B</span></span> tail</p>')));
    expect(a.boxes).toBe(0);
    const b = await run('<p>EEE <span style="display:inline-flex"><span>A</span>x <span style="display:contents">c</span> y<span>B</span></span> tail</p>');
    expect(b.lines[0]).toBe('EEE Ax c yB tail');
    expect(row(b)).toEqual(EXPECT_CONTENTS);
    expect(b.boxes).toBe(0);
  });
});

describe('inline-flex・inline-grid の文字の並びを、コメントなどの所でつなぐときの空白の扱いは、コメントの無い形と同じ', () => {
  /** 字と、その位置 (pt。0.01 に丸める)。項目の中の行も含める */
  const glyphsOf = (r: Awaited<ReturnType<typeof run>>) => r.glyphs.map((g) => `${g.text}@${g.x.toFixed(2)},${g.y.toFixed(2)}`);
  /** ブロックの項目の間に中身 s を置いた inline-flex を、外の段落の中で組む */
  const flex = (s: string, ws = '') => run(`<p>EEE <span style="display:inline-flex${ws ? `;white-space:${ws}` : ''}"><div>A</div>${s}<div>B</div></span> tail</p>`);
  it('空白の後にコメント・display: none の要素を挟んで来る改行も、改行として扱う (和文の間では消す。CSS Text 3 §4.1.1・§4.1.3)', async () => {
    const b = await flex('あい');
    expect(b.lines[0]).toBe('EEE AあいB tail');
    for (const s of ['あ <!--c-->\nい', 'あ <!--c--> \n い', 'あ <span style="display:none">n</span>\nい', 'あ\n<!--c--> い']) {
      const a = await flex(s);
      expect(a.lines[0], s).toBe('EEE AあいB tail');
      expect(glyphsOf(a), s).toEqual(glyphsOf(b));
    }
    // 欧文の間では空白 1 つ
    const a = await flex('x <!--c-->\ny');
    expect(a.lines[0]).toBe('EEE Ax yB tail');
    expect(glyphsOf(a)).toEqual(glyphsOf(await flex('x y')));
  });
  it('white-space: pre-line は、つなぎ目の空白を詰め、改行は残す', async () => {
    const a = await flex('x <!--c--> y', 'pre-line');
    expect(a.lines[0]).toBe('EEE Ax yB tail');
    expect(glyphsOf(a)).toEqual(glyphsOf(await flex('x y', 'pre-line')));
    for (const [s, t] of [
      ['x\n<!--c-->y', 'x\ny'],
      ['x \n<!--c--> y', 'x\ny'],
      ['x <!--c-->\n y', 'x\ny'],
      ['x\n<!--c-->\ny', 'x\n\ny'],
    ]) {
      const c = await flex(s, 'pre-line');
      const d = await flex(t, 'pre-line');
      expect(c.lines, s).toEqual(d.lines);
      expect(glyphsOf(c), s).toEqual(glyphsOf(d));
    }
  });
  it('white-space: pre・pre-wrap・break-spaces は、つなぎ目の空白も詰めない', async () => {
    for (const ws of ['pre', 'pre-wrap', 'break-spaces']) {
      const a = await flex('x  <!--c--> y', ws);
      const b = await flex('x   y', ws);
      expect(a.lines, ws).toEqual(b.lines);
      expect(glyphsOf(a), ws).toEqual(glyphsOf(b));
    }
  });
});

describe('inline-flex・inline-grid の文字の並びを、コメントなどの所でつなぐ手間は、節の数に比例する', () => {
  /** ブロックの項目の間に中身 s を置いた inline-flex を組む時間 (ms) */
  const time = async (s: string, ws = '') => {
    const t0 = performance.now();
    await run(`<p>EEE <span style="display:inline-flex${ws ? `;white-space:${ws}` : ''}"><div>A</div>${s}<div>B</div></span> tail</p>`);
    return performance.now() - t0;
  };
  // 混んだ機械では 1 回の計測が揺れるので、比べる元と本体を交互に 3 回ずつ測り、それぞれの最小の値で比べる
  // (最小の値は、ほかの処理に割り込まれなかった回の時間に近い。1 回が 1 秒前後かかるので 3 回にする)
  const best = async (a: () => Promise<number>, b: () => Promise<number>) => {
    let ta = Infinity;
    let tb = Infinity;
    for (let i = 0; i < 3; i++) {
      ta = Math.min(ta, await a());
      tb = Math.min(tb, await b());
    }
    return [ta, tb];
  };
  // つなぐたびに、長くなった文字列の終わりの空白を正規表現 (`[…]*$`) で探して作り直していたので、節の数の 2 乗の時間だった
  // (直す前は、コメントの無い同じ中身の、節 40000 個で 12 倍ほど、pre-line の改行 80000 個で 7 倍ほど)。線形なら、コメントの無い形と同じほど (余裕を見て 3 倍まで)
  it('コメントで分かれた節 40000 個', async () => {
    await time('x <!--c-->'.repeat(100)); // 暖機
    const [base, t] = await best(() => time('x '.repeat(40000)), () => time('x <!--c-->'.repeat(40000)));
    expect(t).toBeLessThan(Math.max(base, 200) * 3);
  }, 120000);
  it('white-space: pre-line で、改行が長く続いた後の字の後にコメント', async () => {
    await time(`x${'\n'.repeat(100)}y<!--c-->z`, 'pre-line'); // 暖機
    const nl = '\n'.repeat(80000);
    const [base, t] = await best(() => time(`x${nl}yz`, 'pre-line'), () => time(`x${nl}y<!--c-->z`, 'pre-line'));
    expect(t).toBeLessThan(Math.max(base, 200) * 3);
  }, 120000);
});

/**
 * 文字の節のつなぎ目の空白の回帰テスト:
 *  - 文字の間にコメント・display: none の要素を挟むと、前後の空白が 1 つに詰まらずに 2 つ続いた (段落の中でも、行内の flex の容器の中でも)。
 *    コメントは CSS では無いものとして扱い (CSS Display 3 §1)、続いた空白は 1 つに詰める (CSS Text 3 §4.1.1 の 4)
 *  - text-transform: full-width の容器で、コメントを挟んだ所の空白が全角の空白 2 つになった (字の変換は、空白を詰めた後。CSS Text 3 §2.1)
 *  - display: flex・grid の容器の直下の、NBSP・全角の空白だけの文字の並びが、空白だけとみなされて項目にならなかった。組まないのは
 *    document white space characters (空白・タブ・改行) だけの並び (Flexbox 1 §4・CSS Text 3 §4.1)
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
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

/** 本文の領域の行ごとの字の並び (空白の字も含む) と、字と位置 (pt。0.01 に丸める) の並び */
async function run(body: string, css = '') {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;margin:0} p{text-indent:0} ${css}</style><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
  const lines: string[] = [];
  const glyphs: string[] = [];
  const text = (a: Area): string => (a.type === 'glyph' ? ((a as { text?: string }).text ?? '') : childrenOf(a).map((c) => text(c as Area)).join(''));
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { text?: string; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
    if (a.type === 'line') lines.push(text(a));
    if (a.type === 'glyph') glyphs.push(`${b.text ?? ''}@${x.toFixed(2)},${y.toFixed(2)}`);
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
  };
  rec(r.areaTree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  return { lines, glyphs };
}

/** a と b を組んだ行と字の位置が同じことを確かめる */
async function same(a: string, b: string, css = '') {
  const x = await run(a, css);
  const y = await run(b, css);
  expect(x.lines, a).toEqual(y.lines);
  expect(x.glyphs, a).toEqual(y.glyphs);
  return x;
}

describe('文字の間のコメント・display: none の要素の所の空白は、コメントの無い形と同じく 1 つに詰める', () => {
  it('段落の中 (直す前は「x  y」)', async () => {
    expect((await same('<p>x <!--c--> y</p>', '<p>x y</p>')).lines).toEqual(['x y']);
    await same('<p>x <!--c--><!--d--> <?pi?> y</p>', '<p>x y</p>');
    await same('<p>x <span style="display:none">n</span> y</p>', '<p>x y</p>');
    await same('<p>x <span style="display:contents">c</span> <!--d--> y</p>', '<p>x c y</p>');
  });
  it('節の端の改行も、コメントを挟んで前後の字で決める (和文の間では消す。CSS Text 3 §4.1.3)', async () => {
    expect((await same('<p>あ <!--c-->\nい</p>', '<p>あい</p>')).lines).toEqual(['あい']);
    await same('<p>あ\n<!--c--> い</p>', '<p>あい</p>');
    await same('<p>x <!--c-->\n y</p>', '<p>x y</p>');
  });
  it('ブロックの項目が無い inline-flex の中', async () => {
    const r = await same('<p>EEE <span style="display:inline-flex">x <!--c--> y</span> tail</p>', '<p>EEE <span style="display:inline-flex">x y</span> tail</p>');
    expect(r.lines).toEqual(['EEE x y tail']);
  });
  it('white-space: pre-line は空白を詰め、改行は残す。pre・pre-wrap は詰めない', async () => {
    await same('<p style="white-space:pre-line">x <!--c--> y</p>', '<p style="white-space:pre-line">x y</p>');
    await same('<p style="white-space:pre-line">x \n<!--c--> y</p>', '<p style="white-space:pre-line">x\ny</p>');
    for (const ws of ['pre', 'pre-wrap']) await same(`<p style="white-space:${ws}">x <!--c--> y</p>`, `<p style="white-space:${ws}">x  y</p>`);
  });
});

describe('text-transform: full-width の容器で、コメントを挟んだ所の空白は全角の空白 1 つ', () => {
  it('ブロックの項目を持つ inline-flex (直す前は全角の空白 2 つ)', async () => {
    const flex = (s: string) => `<p>EEE <span style="display:inline-flex;text-transform:full-width"><div>A</div>${s}<div>B</div></span> tail</p>`;
    const r = await same(flex('x <!--c--> y'), flex('x y'));
    expect(r.lines[0]).toContain('ｘ　ｙ');
    expect(r.lines[0]).not.toContain('　　');
  });
  it('段落と display: flex の容器', async () => {
    await same('<p style="text-transform:full-width">x <!--c--> y</p>', '<p style="text-transform:full-width">x y</p>');
    await same('<div style="display:flex;text-transform:full-width">x <!--c--> y</div>', '<div style="display:flex;text-transform:full-width">x y</div>');
  });
});

describe('display: flex・grid の容器の直下の、NBSP・全角の空白だけの並びは項目にする', () => {
  for (const d of ['flex', 'grid']) {
    it(`display: ${d}`, async () => {
      // NBSP だけの並びは項目 (直す前は消えた)。空白・改行だけの並びは、これまでどおり項目にしない
      const nb = await run(`<div style="display:${d}"><span>A</span>&nbsp;<span>B</span></div>`);
      expect(nb.lines.join('|')).toContain(' ');
      const ideo = await run(`<div style="display:${d}"><span>A</span>　<span>B</span></div>`);
      expect(ideo.lines.join('|')).toContain('　');
      const sp = await run(`<div style="display:${d}"><span>A</span> \n <span>B</span></div>`);
      expect(sp.lines.join('|')).not.toMatch(/[  ]/);
    });
  }
  it('display: contents の子の中の並びも同じ', async () => {
    const r = await run('<div style="display:flex"><span style="display:contents">&nbsp;<i>B</i></span><span>A</span></div>');
    expect(r.lines.join('|')).toContain(' ');
  });
});

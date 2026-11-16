/**
 * ブロックを含む行内の箱 (CSS 2.1 §9.2.1.1) の回帰テスト (HTM-88):
 *  行内の要素の中のブロック (<span><p>…</p></span>・<a><div>…</div></a> など) の中身が、警告も無く消えた (0.2.0 でも消えていた。
 *  行内の箱 (LInline) の子にブロックを入れ、組版がそれを行の中に置かなかった)。いまは、行内の箱をブロックの前後で分け、ブロックはブロックとして、
 *  前後の行内の中身はその前後の行に組む。行内の要素の受け継ぐ書式 (色・太さ) とリンクは、中のブロックに受け継がれる。
 *  分けた所の辺には、罫線を描かない。読み込みが分けなかった経路で行内の箱の子に残ったブロックは、組版が警告を出す
 *
 * テストの書体は Noto Sans JP。@font-face で読み、欧文もその書体で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, childrenOf, type FontSpec } from '../src/index';
import type { Area, LBlock, LInline } from '../src/types';
import { defaultFontBuffer, doc, fontDir, makeEngine } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

type G = { text: string; x: number; y: number; color: string; fontWeight: number; fakeBold?: boolean };
type Box = { border?: Record<string, { width?: number } | undefined>; padding?: { left?: number; top?: number }; link?: unknown };

/** 本文の領域の行ごとの字の並び (空白の字も含む) と行の上端・字の位置 (pt)・警告・リンクの付いた箱の数・罫線の付いた行内の箱の辺 */
async function run(body: string, style: 'kumiori' | 'browser' = 'kumiori') {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;margin:0}</style><body>${body}</body></html>`;
  const r = await typeset(html, { style, loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
  const lines: string[] = [];
  const lineYs: number[] = [];
  const glyphs: G[] = [];
  const bordered: string[][] = [];
  let links = 0;
  const text = (a: Area): string => (a.type === 'glyph' ? ((a as unknown as G).text ?? '') : childrenOf(a).map((c) => text(c as Area)).join(''));
  const rec = (a: Area, ox: number, oy: number, inLine = false) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as Box;
    // 行の中の箱 (リストの記号の行は、項目の行と同じ高さなので数えない)
    if (a.type === 'line') {
      lines.push(text(a));
      if (text(a) !== '•') lineYs.push(y);
    }
    if (a.type === 'glyph') glyphs.push({ ...(a as unknown as G), x, y });
    if (b.link) links++;
    // 行の中の、罫線の付いた箱 (行内の箱の枠)
    if (inLine && b.border && Object.keys(b.border).length) bordered.push(Object.keys(b.border).sort());
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0), inLine || a.type === 'line');
  };
  rec(r.areaTree.sheets[0].page.regionBody as unknown as Area, 0, 0);
  /** 字 ch の (n 番目の) 位置 */
  const at = (ch: string, n = 0) => glyphs.filter((g) => g.text === ch)[n];
  return { lines, lineYs, glyphs, at, warnings: r.warnings, links, bordered };
}

describe('HTM-88 行内の要素の中のブロックを、行内の箱をブロックの前後で分けて組む (CSS 2.1 §9.2.1.1)', () => {
  // [題, 本文, 行の並び] (直す前は、どれも中のブロックの字が無く「beforeafter」の 1 行だった)
  const cases: Array<[string, string, string[]]> = [
    ['<span><p>', '<div>before <span class="n"><p>Inside P</p></span> after</div>', ['before', 'Inside P', 'after']],
    ['body の直下の <span><p>', 'before <span><p>Inside P</p></span> after', ['before', 'Inside P', 'after']],
    ['<a><div> (カードのリンク)', '<div>before <a href="#x"><div>Card</div></a> after</div>', ['before', 'Card', 'after']],
    ['<b><div>', '<div>before <b><div>Bold D</div></b> after</div>', ['before', 'Bold D', 'after']],
    ['<span><ul>', '<div>before <span><ul><li>Item</li></ul></span> after</div>', ['before', '•', 'Item', 'after']],
    ['<span><table>', '<div>before <span><table><tr><td>Cell</td></tr></table></span> after</div>', ['before', 'Cell', 'after']],
    ['<span><h2>', '<div>before <span><h2>Head</h2></span> after</div>', ['before', 'Head', 'after']],
    ['<em> の中の display: block の span', '<div>before <em><span style="display:block">BlockSpan</span></em> after</div>', ['before', 'BlockSpan', 'after']],
    ['<label><div>', '<div>before <label><div>Lab</div></label> after</div>', ['before', 'Lab', 'after']],
    ['入れ子の行内の要素の中の <p>', '<div>x <span><i><p>Deep</p></i></span> y</div>', ['x', 'Deep', 'y']],
    ['幅の狭い箱の中の <span><div>', '<div style="width:60pt">before <span><div>Inside D</div></span> after</div>', ['before', 'Inside D', 'after']],
  ];
  for (const style of ['kumiori', 'browser'] as const) {
    for (const [title, body, want] of cases) {
      it(`${title} (${style}): 中のブロックの字が出て、前後の字とは別の行になる`, async () => {
        const r = await run(body, style);
        expect(r.lines).toEqual(want);
        // 上から順に並ぶ (ブロックの行は前の行の下、後ろの行はブロックの下)
        for (let k = 1; k < r.lineYs.length; k++) expect(r.lineYs[k]).toBeGreaterThan(r.lineYs[k - 1]);
        expect(r.warnings.join('\n')).not.toMatch(/行内の箱の中のブロック|しおり/);
      });
    }
  }

  it('ブロックの前後の行内の中身 (行内の要素の中の字) と空白: 分けた所の空白は行の頭・終わりとして消え、ほかの空白は残る', async () => {
    const r = await run('<div>x <span>s1 <p>Mid</p> s2</span> y</div>');
    expect(r.lines).toEqual(['x s1', 'Mid', 's2 y']);
  });

  it('中にブロックだけを持つ行内の要素 (Mermaid のラベルの形 <span class="nodeLabel"><p>…</p></span>)', async () => {
    expect((await run('<span class="nodeLabel"><p>Label</p></span>')).lines).toEqual(['Label']);
    expect((await run('<a href="#x"><div>Card</div></a>')).lines).toEqual(['Card']);
  });

  it('行内の要素の受け継ぐ書式 (色・太さ) は、中のブロックと、分けた前後の行内の箱に受け継がれる', async () => {
    const r = await run('<div>x <span style="color:#c00">a<p>Red</p>c</span> y</div>');
    expect(r.lines).toEqual(['x a', 'Red', 'c y']);
    for (const ch of ['a', 'R', 'c']) expect(r.at(ch).color).toBe('#cc0000');
    expect(r.at('x').color).not.toBe('#cc0000');
    const b = await run('<div>n <b><div>Bold</div></b> m</div>');
    // テストの書体は太字を持たないので、太字を求めた字は疑似太字になる
    const bold = (g: G) => g.fontWeight >= 700 || !!g.fakeBold;
    expect(bold(b.at('B'))).toBe(true);
    expect(bold(b.at('n'))).toBe(false);
  });

  it('リンクの中のブロック (<a><div>) は、リンクの箱として組む', async () => {
    const r = await run('<div><a href="https://example.com/"><div>Card</div></a></div>');
    expect(r.lines).toEqual(['Card']);
    expect(r.links).toBeGreaterThan(0);
  });

  it('罫線のある行内の要素を分けた所の辺には、罫線を描かない', async () => {
    const r = await run('<div>x <span style="border:1pt solid red">a<div>B</div>c</span> y</div>');
    expect(r.lines).toEqual(['x a', 'B', 'c y']);
    // 前の断片は終わりの辺 (右) が無く、後ろの断片は始まりの辺 (左) が無い
    expect(r.bordered).toEqual([
      ['bottom', 'left', 'top'],
      ['bottom', 'right', 'top'],
    ]);
  });

  it('読み込みが分けなかった、行内の箱の子のブロックは、組版が置かずに警告を出す (黙って捨てない)', async () => {
    const { engine } = await makeEngine();
    const inl: LInline = { type: 'inline', children: ['a', { type: 'block', children: ['B'] } as LBlock as never, 'c'] };
    const t = engine.layout(doc([{ type: 'block', children: [inl] }]));
    expect(t.warnings.join('\n')).toMatch(/行内の箱の中のブロック \(block\) を置けない/);
  });
});

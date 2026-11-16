/**
 * 行内の要素から作る、1 つのブロックの中身 (脚注の本体・柱に出す要素の中身) の端の空白の回帰テスト (HTM-90):
 *  - 行内の要素の端の空白を残して読むようにした (行内の要素の中身は、ブロックの中身をつないだ後に collapseAcrossInlines で詰める) 後、
 *    float: footnote の span・position: running() の span の中身は、その処理を通らずに作られ、中身の前後の空白 (タグの直後の改行を含む) が
 *    残った。脚注の行は「1 注」(0.2.0 は「1注」)、柱は「 ラ」(0.2.0 は「ラ」。中央寄せが空白の分ずれる)。
 *    これらの中身は、それ自体が 1 つのブロックの中身なので、端の空白は行の頭・終わりの空白として消える (CSS Text 3 §4.1.2)。
 *    中身の途中の、行内の要素の境目をまたぐ和文の間の改行も、ブロックの中身と同じに消す (§4.1.3)。white-space: pre・pre-wrap では消さない
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

type B = { text?: string; border?: { left?: { width?: number }; top?: { width?: number } }; padding?: { left?: number; top?: number } };
type L = { text: string; x: number; y: number; first?: number };

/** 1 ページ目の行 (本文・脚注の領域・余白の箱のすべて) の字の並び (空白の字も含む) と、行の位置・先頭の字の位置 (pt) */
async function run(body: string, css = '') {
  const html = `<html lang="ja"><style>@font-face{font-family:K;src:url(k.ttf)} body{font:10pt K;margin:0} ${css}</style><body>${body}</body></html>`;
  const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
  const lines: L[] = [];
  const text = (a: Area): string => (a.type === 'glyph' ? ((a as B).text ?? '') : childrenOf(a).map((c) => text(c as Area)).join(''));
  let cur: L | undefined;
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as B;
    const outer = cur;
    if (a.type === 'line') lines.push((cur = { text: text(a), x, y }));
    if (a.type === 'glyph' && cur && cur.first === undefined) cur.first = x;
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
    if (a.type === 'line') cur = outer;
  };
  rec(r.areaTree.sheets[0].page as unknown as Area, 0, 0);
  return lines;
}
const texts = (ls: L[]) => ls.map((l) => l.text);

describe('脚注の本体 (float: footnote の行内の要素) の端の空白', () => {
  it('タグの直後・直前の改行は消える (直す前は「1 注」)', async () => {
    const ls = await run('<p>あい<span style="float:footnote">\n注\n</span>うえ</p>');
    expect(texts(ls)).toContain('1注');
    expect(texts(ls)).not.toContain('1 注');
    // 本文の側は変わらない
    expect(texts(ls)).toContain('あい1うえ');
  });
  it('前後の空白も消える', async () => {
    expect(texts(await run('<p>あい<span style="float:footnote"> 注 </span>うえ</p>'))).toContain('1注');
    // 入れ子の行内の要素の端の空白も
    expect(texts(await run('<p>x<span style="float:footnote"><span>\n注\n</span></span>y</p>'))).toContain('1注');
  });
  it('中身の途中の、行内の要素の境目をまたぐ和文の間の改行は消え、欧文の間の改行は空白 1 つになる', async () => {
    expect(texts(await run('<p>あい<span style="float:footnote">注の<b>\n太\n</b>\nです</span>うえ</p>'))).toContain('1注の太です');
    expect(texts(await run('<p>x<span style="float:footnote">\nA note <b>\nbold\n</b>\ntext\n</span>y</p>'))).toContain('1A note bold text');
  });
  it('white-space: pre-wrap の脚注では、空白を消さない', async () => {
    expect(texts(await run('<p>あい<span style="float:footnote;white-space:pre-wrap"> 注 </span>うえ</p>'))).toContain('1 注');
  });
});

describe('柱に出す要素 (position: running() の行内の要素) の端の空白', () => {
  const page = '@page{size:200pt 200pt;margin:30pt;@top-center{content:element(h)}}';
  /** 余白の箱 (本文の領域より上) の行 */
  const head = (ls: L[]) => ls.filter((l) => l.y < 30);
  it('タグの直後・直前の改行は消え、中央寄せの位置が空白の無いときと同じになる (直す前は「 ラ」)', async () => {
    const a = head(await run('<p>x<span style="position:running(h)">\nラ\n</span>y</p>', page));
    const b = head(await run('<p>x<span style="position:running(h)">ラ</span>y</p>', page));
    expect(texts(a)).toEqual(['ラ']);
    expect(a[0].first).toBeCloseTo(b[0].first!, 2);
  });
  it('中身の途中の、行内の要素の境目をまたぐ和文の間の改行は消える', async () => {
    expect(texts(head(await run('<p>x<span style="position:running(h)">柱の<b>\n太\n</b>\nです</span>y</p>', page)))).toEqual(['柱の太です']);
  });
  it('white-space: pre の要素では、空白を消さない', async () => {
    expect(texts(head(await run('<p>x<span style="position:running(h);white-space:pre"> ラ </span>y</p>', page)))[0]).toMatch(/^ ラ/);
  });
});

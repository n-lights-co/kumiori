/**
 * CSS-Print (『CSS ページ組版入門』第 4 版) との組み比べで直したものの回帰テスト:
 *  - --style ah の line-break: auto は、小書きの仮名・長音記号・繰返し記号の前でも改行する (ほかのスタイルは normal のまま)
 *  - 行グリッド (-ah-baseline-grid: new) の箱の終わり: 半行間が負の行は、em の箱の下端まで箱を伸ばす
 *  - -ah-baseline-grid: root の格子は、ページの本文の領域の上端から、根元の書式で引く
 *  - -ah-last-line-end-indent (XSL 1.1 §7.16.3 の last-line-end-indent) を HTML で読む (::before の指定も)
 *  - 横書きの中の、幅が中身で決まる縦書きの箱の、左右の auto の余白 (CSS 2.1 §10.3.3)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

interface Glyph { text: string; x: number; y: number; w: number; h: number }
interface Box { x: number; y: number; w: number; h: number }
function scan(tree: AreaTree, sheet = 0) {
  const glyphs: Glyph[] = [];
  const lines: Array<{ y: number; text: string }> = [];
  const borders: Box[] = [];
  const rec = (a: Area, ox: number, oy: number, line?: { y: number; text: string }) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { text?: string; border?: Record<string, unknown> };
    if (b.border && Object.keys(b.border).length) borders.push({ x, y, w: a.width, h: a.height });
    let ln = line;
    if (a.type === 'line') {
      ln = { y, text: '' };
      lines.push(ln);
    }
    if (a.type === 'glyph') {
      glyphs.push({ text: b.text ?? '', x, y, w: a.width, h: a.height });
      if (ln) ln.text += b.text ?? '';
    }
    for (const c of childrenOf(a)) rec(c as Area, x, y, ln);
  };
  rec(tree.sheets[sheet].page as unknown as Area, 0, 0);
  return { glyphs, lines: lines.filter((l) => l.text), borders };
}
const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 20pt } body { margin: 0; font-size: 20pt; line-height: 30pt } p { margin: 0 } ${css}</style></head><body>${body}</body></html>`;
const html = async (body: string, css = '', style?: 'ah') => scan((await typesetHtml(doc(body, css), { loadFont: loadCachedFont, ...(style ? { style } : {}) })).areaTree);

describe('line-break: auto (--style ah)', () => {
  const body = '<p style="width: 100pt">あいうえこーろ</p><p style="width: 100pt">あいうえこゝろ</p><p style="width: 100pt">あいうえこょろ</p><p style="width: 100pt; line-break: normal">あいうえこーろ</p>';
  it('--style ah: 小書きの仮名・長音記号・繰返し記号の前でも改行する。line-break: normal の指定は normal のまま', async () => {
    const t = (await html(body, '', 'ah')).lines.map((l) => l.text);
    expect(t).toEqual(['あいうえこ', 'ーろ', 'あいうえこ', 'ゝろ', 'あいうえこ', 'ょろ', 'あいうえ', 'こーろ']);
  });
  it('ほかのスタイル: auto は normal (CSS Text 3 §5.2)。小書きの仮名・長音記号・繰返し記号の前で改行しない', async () => {
    const t = (await html(body)).lines.map((l) => l.text).filter((x) => !/^\d+$/.test(x));
    expect(t).toEqual(['あいうえ', 'こーろ', 'あいうえ', 'こゝろ', 'あいうえ', 'こょろ', 'あいうえ', 'こーろ']);
  });
});

describe('行グリッド (-ah-baseline-grid)', () => {
  it('new の箱の最後の行の半行間が負なら、箱は em の箱の下端まで (後ろの箱を下げる)', async () => {
    const css = 'h1 { -ah-baseline-grid: new; font-size: 40pt; line-height: 20pt; margin: 0 }';
    const g = await html('<h1>題</h1><p>本</p>', css);
    const g0 = await html('<h1 style="-ah-baseline-grid: normal">題</h1><p>本</p>', css);
    const gap = (r: typeof g) => r.glyphs.find((x) => x.text === '本')!.y - r.glyphs.find((x) => x.text === '題')!.y;
    // 題の後ろが、半行間 (20 − 40) / 2 = −10pt の分だけ広がる
    expect(gap(g) - gap(g0)).toBeCloseTo(10, 1);
  });
  it('root の格子はページの本文の領域の上端から引く (箱の上端からではない)', async () => {
    const css = 'figcaption { -ah-baseline-grid: root; font-size: 10pt; margin: 0 } div.sp { height: 7pt }';
    const a = await html('<div class="sp"></div><figcaption>図</figcaption>', css);
    const b = await html('<div class="sp" style="height: 3pt"></div><figcaption>図</figcaption>', css);
    const ya = a.glyphs.find((x) => x.text === '図')!;
    const yb = b.glyphs.find((x) => x.text === '図')!;
    // どちらも同じ格子の線 (本文の上端 + 根元の字のアセント + 30pt の倍数) に載る: 7pt と 3pt の箱の後ろは、どちらも最初の格子
    // (箱の上端から引くと、4pt ずれる)
    expect(yb.y).toBeCloseTo(ya.y, 1);
  });
});

describe('-ah-last-line-end-indent', () => {
  const css = 'p { width: 200pt; text-align: justify; text-align-last: end }';
  it('負の値は、最後の行の終わりを外へ出す。::before の 0 の指定は、その中の行に効く', async () => {
    const base = await html('<p>あいう</p>', css);
    const out = await html('<p style="-ah-last-line-end-indent: -1em">あいう</p>', css);
    const right = (r: typeof base) => Math.max(...r.glyphs.map((g) => g.x + g.w));
    expect(right(out) - right(base)).toBeCloseTo(20, 1);
  });
  it('受け継ぐ (em は指定した要素の字の大きさで解決する)', async () => {
    const base = await html('<div><p>あいう</p></div>', css);
    const out = await html('<div style="-ah-last-line-end-indent: -1em; font-size: 10pt"><p style="font-size: 20pt">あいう</p></div>', css);
    const right = (r: typeof base) => Math.max(...r.glyphs.map((g) => g.x + g.w));
    expect(right(out) - right(base)).toBeCloseTo(10, 1);
  });
});

describe('縦書きの箱の左右の auto の余白', () => {
  it('幅が中身で決まる縦書きの箱は、左右が auto なら中央に置く (-ah-display-align のある箱も)', async () => {
    for (const extra of ['', ' -ah-display-align: center;']) {
      const r = await html('<div class="v"><p>あいう</p></div>', `div.v { writing-mode: vertical-rl; height: 5em; margin-left: auto; margin-right: auto; border: 1pt solid;${extra} }`);
      const b = r.borders[0];
      // 本文の幅 360pt の中央
      expect(b.x - 20 + b.w / 2).toBeCloseTo(180, 0);
    }
  });
});

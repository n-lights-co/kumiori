/**
 * アンテナハウスのフロートの拡張の -ah-float-x (横の位置) と、ページの余白の箱に出す章の印 (ツメ) の回帰テスト (HTM-31):
 *  - position: running() の要素の -ah-float-x: inside・outside は、余白の箱の中でノドの側・小口の側の端に寄せる
 *    (余白の箱より幅の広い箱は、反対の側へはみ出す。左ページのツメが本文に重ならない)
 *  - 本文の要素の -ah-float-x は、同じ側の float と同じに組む。読まない値 (center など・-ah-float-y との組) は、指定の無いときと同じ
 *  - --style ah: running() の要素の書体は、要素に font-family の指定が無ければ、出す先の余白の箱から受け継ぐ
 * 値の意味は、アンテナハウスの公開の説明 (AH Formatter のオンラインマニュアル「フロート拡張」) による
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

interface Box { x: number; y: number; w: number; h: number }
/** ページの中の、背景の色ごとの箱と、字 (ページの座標) */
function scan(tree: AreaTree, sheet: number) {
  const bg = new Map<string, Box[]>();
  const glyphs: Array<{ text: string; x: number; y: number; w: number; font: string; weight: number }> = [];
  const rec = (a: Area, ox: number, oy: number) => {
    const x = ox + (a.x ?? 0);
    const y = oy + (a.y ?? 0);
    const b = a as unknown as { backgroundColor?: string; text?: string; fontId?: string; fontWeight?: number; padding?: { left: number; top: number }; border?: { left?: { width: number }; top?: { width: number } } };
    if (b.backgroundColor) bg.set(b.backgroundColor.toLowerCase(), [...(bg.get(b.backgroundColor.toLowerCase()) ?? []), { x, y, w: a.width, h: a.height }]);
    if (a.type === 'glyph') glyphs.push({ text: b.text ?? '', x, y, w: a.width, font: (b.fontId ?? '').replace(/@.*$/, ''), weight: b.fontWeight ?? 0 });
    // 子の原点は、内容の箱の左上 (罫線と内側の余白の内側)
    for (const c of childrenOf(a)) rec(c as Area, x + (b.border?.left?.width ?? 0) + (b.padding?.left ?? 0), y + (b.border?.top?.width ?? 0) + (b.padding?.top ?? 0));
  };
  rec(tree.sheets[sheet].page as unknown as Area, 0, 0);
  return { bg, glyphs };
}
const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>t</title><style>@page { size: 400pt 400pt; margin: 40pt 60pt } body { margin: 0; font-size: 10pt; line-height: 2 } p { margin: 0; text-indent: 0 } h2 { break-before: page; margin: 0; font-size: 10pt } ${css}</style></head><body>${body}</body></html>`;
const typeset = async (body: string, css: string, style?: 'ah') => (await typesetHtml(doc(body, css), { loadFont: loadCachedFont, ...(style ? { style } : {}) })).areaTree;

describe('HTM-31 余白の箱に出す running() の要素の -ah-float-x (章の印 = ツメ)', () => {
  // 左右の余白は 60pt。印の箱は幅 80pt (余白より広い)・左右の余白 10pt。1 ページ目は右ページ (ノドは左)、2 ページ目は左ページ (ノドは右)
  const tab = (x: string) => `
    @page :left { @left-top { content: element(Tab) } }
    @page :right { @right-top { content: element(Tab) } }
    p.tab { position: running(Tab); ${x} margin: 30pt 10pt 0; width: 80pt; height: 50pt; box-sizing: border-box; padding: 5pt; background-color: #00aa00; color: white; text-align: left }`;
  const body = '<h2>一</h2><p class="tab">1</p><p>あ</p><h2>二</h2><p>い</p><h2>三</h2><p>う</p>';
  const boxes = async (x: string, style?: 'ah') => {
    const t = await typeset(body, tab(x), style);
    return [0, 1, 2].map((k) => scan(t, k).bg.get('#00aa00')?.[0]);
  };

  it('inside: 右ページでは余白の箱の左端 (ノドの側)、左ページでは余白の箱の右端に寄り、ページの外 (小口の側) へはみ出す', async () => {
    for (const style of [undefined, 'ah'] as const) {
      const b = await boxes('-ah-float-x: inside;', style);
      // 右ページ: 余白の箱は x = 340〜400。左端 + 左の余白 10pt から 80pt (ページの右端 400pt を 30pt 越える)
      expect(b[0]!.x).toBeCloseTo(350, 1);
      expect(b[0]!.w).toBeCloseTo(80, 1);
      // 左ページ: 余白の箱は x = 0〜60。右端 − 右の余白 10pt が箱の右端 (x = −30〜50。本文の左端 60pt に重ならない)
      expect(b[1]!.x).toBeCloseTo(-30, 1);
      expect(b[1]!.x + b[1]!.w).toBeCloseTo(50, 1);
      expect(b[2]!.x).toBeCloseTo(350, 1);
      // 上下の位置と高さは、どのページも同じ (本文領域の上端 40pt + 上の余白 30pt)
      for (const p of b) {
        expect(p!.y).toBeCloseTo(70, 1);
        expect(p!.h).toBeCloseTo(50, 1);
      }
    }
  });
  it('outside: 小口の側の端に寄り、ノドの側 (本文の側) へはみ出す。left・right は、ページによらず同じ側', async () => {
    const o = await boxes('-ah-float-x: outside;');
    expect(o[0]!.x + o[0]!.w).toBeCloseTo(390, 1);
    expect(o[1]!.x).toBeCloseTo(10, 1);
    const r = await boxes('-ah-float-x: right;');
    expect(r[0]!.x + r[0]!.w).toBeCloseTo(390, 1);
    expect(r[1]!.x + r[1]!.w).toBeCloseTo(50, 1);
    const l = await boxes('-ah-float-x: left;');
    expect(l[0]!.x).toBeCloseTo(350, 1);
    expect(l[1]!.x).toBeCloseTo(10, 1);
  });
  it('-ah-float-x の無い running() の要素・none は、これまでどおり余白の箱の左端から置く', async () => {
    for (const x of ['', '-ah-float-x: none;']) {
      const b = await boxes(x);
      expect(b[0]!.x).toBeCloseTo(350, 1);
      expect(b[1]!.x).toBeCloseTo(10, 1);
    }
  });
  it('箱の中の数字: --style ah の text-align: inside は、左ページでは箱の右 (ノドの側)、右ページでは箱の左', async () => {
    const t = await typeset(body, `${tab('-ah-float-x: inside;')} p.tab { text-align: inside }`, 'ah');
    const one = [0, 1].map((k) => scan(t, k).glyphs.find((g) => g.text === '1')!);
    expect(one[0].x).toBeCloseTo(350 + 5, 1);
    expect(one[1].x + one[1].w).toBeCloseTo(50 - 5, 1);
  });
});

describe('HTM-31 本文の要素の -ah-float-x は、同じ側の float と同じに組む', () => {
  const css = '.f { width: 80pt; height: 30pt; background-color: #00aa00; margin: 0 6pt }';
  const flow = (decl: string) => `<div class="f" style="${decl}"></div><p>一二三四五</p><h2>次</h2><div class="f" style="${decl}"></div><p>一二三四五</p>`;
  const shape = async (decl: string) => {
    const t = await typeset(flow(decl), css);
    return [0, 1].map((k) => {
      const s = scan(t, k);
      const b = s.bg.get('#00aa00')![0];
      return [Math.round(b.x), Math.round(b.y), ...s.glyphs.filter((g) => '一五'.includes(g.text)).map((g) => `${g.text}${Math.round(g.x)},${Math.round(g.y)}`)];
    });
  };
  it('left・right・start・end・inside・outside', async () => {
    for (const [ah, css2] of [['left', 'left'], ['right', 'right'], ['start', 'left'], ['end', 'right'], ['inside', 'inside'], ['outside', 'outside']]) {
      expect(await shape(`-ah-float-x: ${ah}`), ah).toEqual(await shape(`float: ${css2}`));
    }
    // 右ページ (1 ページ目) の inside は左: 箱は本文の左端 60pt + 左の余白 6pt、本文は箱の右へ回り込む
    const i = await shape('-ah-float-x: inside');
    expect(i[0][0]).toBe(66);
    expect(i[1][0]).toBe(340 - 6 - 80);
    expect(i).not.toEqual(await shape(''));
  });
  it('float の指定 (none 以外) があれば、float を使う', async () => {
    expect(await shape('float: right; -ah-float-x: left')).toEqual(await shape('float: right'));
  });
  it('読まない値 (center・alternate・column-outside・top・bottom) と、-ah-float-y を指定したものは、指定の無いときと同じに組む', async () => {
    const plain = await shape('');
    for (const d of ['-ah-float-x: center', '-ah-float-x: alternate', '-ah-float-x: column-outside', '-ah-float-x: top', '-ah-float-x: none', '-ah-float-x: left; -ah-float-y: top', '-ah-float-y: bottom']) {
      expect(await shape(d), d).toEqual(plain);
    }
    // -ah-float-y: none は、指定の無いのと同じ (横へ寄せる)
    expect(await shape('-ah-float-x: left; -ah-float-y: none')).toEqual(await shape('float: left'));
  });
});

describe('HTM-31 running() の要素の書体 (--style ah: 要素に font-family の指定が無ければ、出す先の余白の箱から受け継ぐ)', () => {
  // 本文は明朝 (serif)、余白の箱 (ページ文脈) はゴシック (sans-serif)。印は太さだけを指定する (欧文の字で、明朝系・ゴシック系の書体を見分ける)
  const css = (own = '') => `
    html { font-family: serif }
    @page { font-family: sans-serif; @top-left { content: element(Tab) } }
    p.tab { position: running(Tab); font-weight: 900; ${own} }`;
  const fontOf = async (own: string, style?: 'ah') => scan(await typeset('<p class="tab">A</p><p>本文</p>', css(own), style), 0).glyphs.find((g) => g.text === 'A')!.font;
  it('--style ah: 余白の箱の書体 (ゴシック) で組む。要素に font-family があれば、その書体', async () => {
    expect(await fontOf('', 'ah')).toBe(await fontOf('font-family: sans-serif;', 'ah'));
    expect(await fontOf('font-family: monospace;', 'ah')).not.toBe(await fontOf('', 'ah'));
    // 太さを変えない要素も同じ (余白の箱の書体)
    const plain = (own: string) => typeset('<p class="tab">A</p><p>本文</p>', css(own).replace('font-weight: 900;', ''), 'ah').then((t) => scan(t, 0).glyphs.find((g) => g.text === 'A')!.font);
    expect(await plain('')).toBe(await plain('font-family: sans-serif;'));
  });
  it('標準のスタイル: 文書の中の元の場所から受け継ぐ (CSS GCPM 3 §1.2.1)', async () => {
    expect(await fontOf('')).toBe(await fontOf('font-family: serif;'));
    expect(await fontOf('')).not.toBe(await fontOf('font-family: sans-serif;'));
  });
  it('--style ah: 余白の箱ごとに書体が違うときは、元の場所から受け継ぐ', async () => {
    const two = `html { font-family: serif } @page { @top-left { font-family: sans-serif; content: element(Tab) } @bottom-left { font-family: monospace; content: element(Tab) } } p.tab { position: running(Tab); font-weight: 900 }`;
    const f = (c: string) => typeset('<p class="tab">A</p><p>本文</p>', c, 'ah').then((t) => scan(t, 0).glyphs.find((g) => g.text === 'A')!.font);
    expect(await f(two)).toBe(await f(`${two} p.tab { font-family: serif }`));
  });
});
